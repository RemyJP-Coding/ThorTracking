import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { Log, LogLevel, Miniflare, Response as WorkerResponse } from 'miniflare';

import { createDesktopRuntime } from '../desktop/runtime.mjs';
import { createDesktopOutboundService } from '../desktop/network.mjs';

const appDirectory = fileURLToPath(new URL('../', import.meta.url));
const testOutputDirectory = path.join(appDirectory, 'outputs', 'desktop-runtime-tests');
const sourceUnavailable = () => new WorkerResponse('Source unavailable in this test', { status: 503 });

async function testDirectory(context) {
  await mkdir(testOutputDirectory, { recursive: true });
  const directory = await mkdtemp(path.join(testOutputDirectory, 'run-'));
  context.after(async () => {
    const [resolved, allowedParent] = await Promise.all([realpath(directory), realpath(testOutputDirectory)]);
    if (path.dirname(resolved) !== allowedParent || !path.basename(resolved).startsWith('run-')) {
      throw new Error('Refusing to remove a directory outside the runtime test output folder.');
    }
    await rm(resolved, { recursive: true, force: true });
  });
  return directory;
}

async function withDatabase(dataDirectory, action) {
  const instance = new Miniflare({
    host: '127.0.0.1',
    port: 0,
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } }',
    d1Databases: { DB: 'thor-track-desktop' },
    d1Persist: path.join(dataDirectory, 'shipment-history'),
    log: new Log(LogLevel.NONE),
  });
  try {
    return await action(await instance.getD1Database('DB'));
  } finally {
    await instance.dispose();
  }
}

function startRuntime(dataDirectory, root = appDirectory) {
  return createDesktopRuntime({ appDirectory: root, dataDirectory, outboundService: sourceUnavailable });
}

async function assertStopped(runtime) {
  const url = runtime.url;
  await runtime.close();
  await runtime.close();
  await assert.rejects(runtime.fetch(new Request('http://thor-track.local/')), /closed/);
  if (url) {
    await assert.rejects(fetch(url, { signal: AbortSignal.timeout(1_000) }));
  }
}

test('bundled desktop assets and offline shipment history persist across an idempotent restart', async (context) => {
  const directory = await testDirectory(context);
  const dataDirectory = path.join(directory, 'data');
  const first = startRuntime(dataDirectory);
  context.after(() => first.close());
  await first.ready;

  // The internal listener must be private; the desktop uses a stable custom
  // protocol origin instead of exposing a server address to users.
  assert.equal(new URL(first.url).hostname, '127.0.0.1');
  const response = await first.fetch(new Request('http://thor-track.local/'));
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Thor Track/);
  const assetPaths = [...new Set([...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map(match => match[1]).filter(url => url.startsWith('/_next/')))];
  assert.ok(assetPaths.some(url => url.endsWith('.css')));
  assert.ok(assetPaths.some(url => url.endsWith('.js')));
  await Promise.all(assetPaths.map(async assetPath => {
    const asset = await first.fetch(new Request(new URL(assetPath, 'http://thor-track.local')));
    assert.equal(asset.status, 200, assetPath);
    assert.match(asset.headers.get('content-type'), assetPath.endsWith('.css') ? /text\/css/ : /javascript/);
    assert.ok((await asset.arrayBuffer()).byteLength > 0);
  }));
  const shipmentResponse = await first.fetch(new Request('http://thor-track.local/api/shipments'));
  const shipments = await shipmentResponse.json();
  assert.equal(shipmentResponse.status, 200);
  assert.equal(shipments.status, 'archived');
  assert.equal(shipments.history.persisted, true);
  assert.ok(shipments.days.length > 0);
  await assertStopped(first);

  const journal = await withDatabase(dataDirectory, async database => {
    const { results } = await database.prepare('SELECT * FROM __thor_desktop_migrations ORDER BY migration_index').all();
    assert.ok(results.length > 0);
    for (const entry of results) assert.match(entry.checksum, /^[a-f0-9]{64}$/);
    await database.prepare(`INSERT INTO shipment_entries (
      shipment_date, color, model, source_variant, start_prefix, end_prefix, first_seen_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      '2020-01-01', 'Black', 'base', 'Desktop persistence fixture', 1000, 1001,
      '2020-01-01T12:00:00.000Z', '2020-01-01T12:00:00.000Z',
    ).run();
    return results;
  });

  const second = startRuntime(dataDirectory);
  context.after(() => second.close());
  const retainedResponse = await second.fetch(new Request('http://thor-track.local/api/shipments'));
  const retained = await retainedResponse.json();
  assert.equal(retained.status, 'archived');
  assert.equal(retained.history.persisted, true);
  assert.ok(retained.days.some(day => day.date === '2020-01-01'));
  await assertStopped(second);
  const nextJournal = await withDatabase(dataDirectory, async database => (
    await database.prepare('SELECT * FROM __thor_desktop_migrations ORDER BY migration_index').all()
  ).results);
  assert.deepEqual(nextJournal, journal);
});

test('native desktop source refreshes persist new shipment days and remain available after an offline restart', async (context) => {
  const directory = await testDirectory(context);
  const dataDirectory = path.join(directory, 'data');
  let requests = 0;
  let date = '2026-09-10';
  let range = '9000xx--9010xx';
  const outboundService = createDesktopOutboundService({
    fetcher: async (url, options) => {
      requests += 1;
      assert.equal(url, 'https://www.ayntec.com/pages/shipment-dashboard.json');
      assert.equal(options.cache, 'no-store');
      return Response.json({
        page: {
          updated_at: `${date}T12:00:00Z`,
          body_html: `<p>${date.replaceAll('-', '/')}<br>AYN Thor Black Base: ${range}</p>`,
        },
      });
    },
  });
  const first = createDesktopRuntime({ appDirectory, dataDirectory, outboundService });
  context.after(() => first.close());
  const firstResponse = await first.fetch(new Request('http://thor-track.local/api/shipments'));
  const firstFeed = await firstResponse.json();
  assert.equal(firstResponse.status, 200);
  assert.equal(firstFeed.status, 'live', 'an archived fallback must not pass a successful refresh check');
  assert.equal(firstFeed.history.persisted, true);
  assert.equal(firstFeed.sourceUpdatedAt, '2026-09-10T12:00:00Z');
  assert.equal(firstFeed.days.find(day => day.date === date)?.entries[0].endPrefix, 9010);

  date = '2026-09-11';
  range = '9011xx--9020xx';
  const refreshedResponse = await first.fetch(new Request('http://thor-track.local/api/shipments'));
  const refreshedFeed = await refreshedResponse.json();
  assert.equal(refreshedResponse.status, 200);
  assert.equal(refreshedFeed.status, 'live');
  assert.equal(refreshedFeed.history.persisted, true);
  assert.equal(refreshedFeed.sourceUpdatedAt, '2026-09-11T12:00:00Z');
  assert.equal(refreshedFeed.days.find(day => day.date === date)?.entries[0].endPrefix, 9020);
  assert.equal(refreshedFeed.days.find(day => day.date === '2026-09-10')?.entries[0].endPrefix, 9010);
  assert.equal(requests, 2, 'refresh must perform a new outbound request');
  await assertStopped(first);

  const second = createDesktopRuntime({
    appDirectory,
    dataDirectory,
    outboundService: createDesktopOutboundService({ fetcher: async () => { throw new TypeError('Offline fixture'); } }),
  });
  context.after(() => second.close());
  const offlineResponse = await second.fetch(new Request('http://thor-track.local/api/shipments'));
  const offlineFeed = await offlineResponse.json();
  assert.equal(offlineResponse.status, 200);
  assert.equal(offlineFeed.status, 'archived');
  assert.equal(offlineFeed.history.persisted, true);
  assert.equal(offlineFeed.sourceUpdatedAt, refreshedFeed.sourceUpdatedAt);
  assert.equal(offlineFeed.archivedAt, refreshedFeed.archivedAt);
  assert.deepEqual(offlineFeed.days, refreshedFeed.days);
  await assertStopped(second);
});

test('closing immediately cancels desktop startup without leaving a listener', async (context) => {
  const directory = await testDirectory(context);
  const runtime = startRuntime(path.join(directory, 'data'));
  await runtime.close();
  await assert.rejects(runtime.ready, /closed during startup/);
  assert.equal(runtime.url, undefined);
  await runtime.close();
});

test('desktop migrations reject changed history and roll back failed schema updates', async (context) => {
  const directory = await testDirectory(context);
  const dataDirectory = path.join(directory, 'data');
  const fixtureDirectory = path.join(directory, 'application');
  await Promise.all(['dist/server', 'dist/client', 'drizzle'].map(relative =>
    cp(path.join(appDirectory, relative), path.join(fixtureDirectory, relative), { recursive: true }),
  ));
  const original = startRuntime(dataDirectory, fixtureDirectory);
  await original.ready;
  await original.close();

  const journalPath = path.join(fixtureDirectory, 'drizzle', 'meta', '_journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8'));
  const firstMigrationPath = path.join(fixtureDirectory, 'drizzle', `${journal.entries[0].tag}.sql`);
  const firstMigration = await readFile(firstMigrationPath, 'utf8');
  await writeFile(firstMigrationPath, firstMigration.replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n'));
  const differentLineEndings = startRuntime(dataDirectory, fixtureDirectory);
  await differentLineEndings.ready;
  await differentLineEndings.close();
  await writeFile(firstMigrationPath, `${firstMigration}\n-- changed applied migration\n`);
  const changed = startRuntime(dataDirectory, fixtureDirectory);
  await assert.rejects(changed.ready, /migration has changed/);
  await changed.close();
  await writeFile(firstMigrationPath, firstMigration);

  const previousCount = journal.entries.length;
  journal.entries.push({ idx: previousCount, version: '6', when: 1, tag: 'runtime_rollback_probe', breakpoints: true });
  await writeFile(journalPath, JSON.stringify(journal));
  await writeFile(path.join(fixtureDirectory, 'drizzle', 'runtime_rollback_probe.sql'),
    'CREATE TABLE runtime_rollback_probe (id integer);\n--> statement-breakpoint\nINSERT INTO nonexistent_runtime_test_table VALUES (1);');
  const broken = startRuntime(dataDirectory, fixtureDirectory);
  await assert.rejects(broken.ready);
  await broken.close();

  await withDatabase(dataDirectory, async database => {
    const markers = await database.prepare('SELECT * FROM __thor_desktop_migrations').all();
    assert.equal(markers.results.length, previousCount);
    const tables = await database.prepare("SELECT name FROM sqlite_master WHERE name = 'runtime_rollback_probe'").all();
    assert.deepEqual(tables.results, []);
  });
});
