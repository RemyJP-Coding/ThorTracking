import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import { Log, LogLevel, Miniflare } from 'miniflare';

const DATABASE_ID = 'thor-track-desktop';
const MIGRATION_TABLE = '__thor_desktop_migrations';
const require = createRequire(import.meta.url);
const requireFromMiniflare = createRequire(require.resolve('miniflare'));

let hiddenSpawnUsers = 0;
let restoreSpawn;

// Miniflare does not expose spawn options. Apply windowsHide only to its exact
// workerd executable; other child processes keep their normal launch behavior.
function hideWorkerdConsole() {
  if (process.platform !== 'win32') return () => {};
  if (hiddenSpawnUsers === 0) {
    const executable = path.resolve(process.env.MINIFLARE_WORKERD_PATH ?? requireFromMiniflare('workerd').default).toLowerCase();
    const original = childProcess.spawn;
    const hiddenSpawn = function (command, args, options) {
      if (typeof command === 'string' && path.resolve(command).toLowerCase() === executable) {
        return original.call(this, command, args, { ...options, windowsHide: true });
      }
      return original.call(this, command, args, options);
    };
    childProcess.spawn = hiddenSpawn;
    restoreSpawn = () => {
      if (childProcess.spawn === hiddenSpawn) childProcess.spawn = original;
    };
  }
  hiddenSpawnUsers += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    hiddenSpawnUsers -= 1;
    if (hiddenSpawnUsers === 0) {
      restoreSpawn?.();
      restoreSpawn = undefined;
    }
  };
}

async function readMigrations(appDirectory) {
  const directory = path.join(appDirectory, 'drizzle');
  const journal = JSON.parse(await readFile(path.join(directory, 'meta', '_journal.json'), 'utf8'));
  if (journal.dialect !== 'sqlite' || !Array.isArray(journal.entries)) {
    throw new Error('The shipment history migration journal is invalid.');
  }

  const tags = new Set();
  return Promise.all(journal.entries.map(async (entry, index) => {
    if (entry.idx !== index || !/^[A-Za-z0-9_-]+$/.test(entry.tag) || tags.has(entry.tag)) {
      throw new Error('The shipment history migration sequence is invalid.');
    }
    tags.add(entry.tag);
    const sql = (await readFile(path.join(directory, `${entry.tag}.sql`), 'utf8')).replace(/\r\n?/g, '\n');
    return {
      index,
      tag: entry.tag,
      checksum: createHash('sha256').update(sql).digest('hex'),
      statements: sql.split('--> statement-breakpoint').map(statement => statement.trim()).filter(Boolean),
    };
  }));
}

async function migrateDatabase(database, migrations) {
  await database.prepare(`CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
    migration_index INTEGER PRIMARY KEY NOT NULL,
    tag TEXT NOT NULL UNIQUE,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`).run();
  const { results } = await database.prepare(
    `SELECT migration_index, tag, checksum FROM ${MIGRATION_TABLE} ORDER BY migration_index`,
  ).all();

  for (let index = 0; index < results.length; index += 1) {
    const applied = results[index];
    const current = migrations[index];
    if (!current || applied.migration_index !== index || applied.tag !== current.tag || applied.checksum !== current.checksum) {
      throw new Error('An installed shipment history migration has changed. Reinstall the matching application version.');
    }
  }

  for (const migration of migrations.slice(results.length)) {
    // D1 batches run as a transaction: schema changes and the journal marker
    // either both persist or both roll back if an update is interrupted.
    await database.batch([
      ...migration.statements.map(sql => database.prepare(sql)),
      database.prepare(
        `INSERT INTO ${MIGRATION_TABLE} (migration_index, tag, checksum, applied_at) VALUES (?, ?, ?, ?)`,
      ).bind(migration.index, migration.tag, migration.checksum, new Date().toISOString()),
    ]);
  }
}

/** Start the bundled application and its private, persistent shipment archive. */
export function createDesktopRuntime({ appDirectory, dataDirectory, dev = false, outboundService }) {
  let runtime;
  let runtimeUrl;
  let closed = false;
  let disposal;
  let closePromise;
  let releaseSpawn = () => {};

  const dispose = () => {
    if (!disposal && runtime) disposal = runtime.dispose().finally(() => releaseSpawn());
    return disposal ?? Promise.resolve();
  };

  const ready = (async () => {
    const serverDirectory = path.join(appDirectory, 'dist', 'server');
    const clientDirectory = path.join(appDirectory, 'dist', 'client');
    const [files, config, migrations] = await Promise.all([
      readdir(serverDirectory, { recursive: true }),
      readFile(path.join(serverDirectory, 'wrangler.json'), 'utf8').then(JSON.parse),
      readMigrations(appDirectory),
      mkdir(dataDirectory, { recursive: true }),
    ]);
    if (closed) throw new Error('The application was closed during startup.');
    const main = config.main ?? 'index.js';
    if (main !== 'index.js' || !files.includes(main)) {
      throw new Error('The bundled application is incomplete. Reinstall Thor Track.');
    }
    const modules = [main, ...files.filter(file => /\.m?js$/.test(file) && file !== main).sort()];

    releaseSpawn = hideWorkerdConsole();
    // Keep Miniflare's non-secret registry beside application data rather than
    // in a developer's Wrangler directory or the installation directory.
    process.env.MINIFLARE_REGISTRY_PATH = path.join(dataDirectory, 'runtime-registry');
    try {
      runtime = new Miniflare({
        name: DATABASE_ID,
        host: '127.0.0.1',
        port: 0,
        modulesRoot: serverDirectory,
        // Vinext contains dynamic imports; explicit modules avoid Miniflare's
        // static scanner rejecting the otherwise valid production bundle.
        modules: modules.map(file => ({ type: 'ESModule', path: path.join(serverDirectory, file) })),
        compatibilityDate: config.compatibility_date,
        compatibilityFlags: config.compatibility_flags,
        d1Databases: { DB: DATABASE_ID },
        d1Persist: path.join(dataDirectory, 'shipment-history'),
        ...(outboundService ? { outboundService } : {}),
        assets: {
          directory: clientDirectory,
          binding: 'ASSETS',
          routerConfig: { has_user_worker: true },
        },
        log: new Log(dev ? LogLevel.INFO : LogLevel.NONE),
        ...(dev ? {} : {
          handleRuntimeStdio(stdout, stderr) {
            stdout.resume();
            stderr.resume();
          },
        }),
      });
      runtimeUrl = (await runtime.ready).href;
      if (closed) throw new Error('The application was closed during startup.');
      const database = await runtime.getD1Database('DB');
      await migrateDatabase(database, migrations);
      if (closed) throw new Error('The application was closed during startup.');
      return runtimeUrl;
    } catch (error) {
      await dispose();
      releaseSpawn();
      throw error;
    }
  })();

  return {
    ready,
    get url() { return runtimeUrl; },
    async fetch(request) {
      await ready;
      if (closed) throw new Error('The application is closed.');
      const method = request.method ?? 'GET';
      return runtime.dispatchFetch(request.url, {
        method,
        headers: [...request.headers],
        ...(method === 'GET' || method === 'HEAD' ? {} : { body: await request.arrayBuffer() }),
        redirect: 'manual',
        signal: request.signal,
      });
    },
    close() {
      if (!closePromise) {
        closed = true;
        closePromise = (async () => {
          await dispose();
          await ready.catch(() => {});
          await dispose();
        })();
      }
      return closePromise;
    },
  };
}
