import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';

import { createShipmentMonitor } from '../desktop/monitor.mjs';

const WATCH = { prefix: 2600, color: 'Black', model: 'pro' };
const OTHER_WATCH = { prefix: 2700, color: 'White', model: 'pro' };
const INTERVAL = 1000;

function feed(endPrefix = 2500, options = {}) {
  return {
    version: 2,
    status: options.status ?? 'live',
    checkedAt: options.checkedAt ?? '2026-09-12T01:00:00.000Z',
    sourceUpdatedAt: options.sourceUpdatedAt ?? '2026-09-11T18:00:00.000Z',
    days: [{ date: '2026-09-11', entries: [
      { color: 'Black', model: 'pro', sourceVariant: 'Black Pro', startPrefix: 2400, endPrefix },
      { color: 'White', model: 'pro', sourceVariant: 'White Pro', startPrefix: 2500,
        endPrefix: options.otherEndPrefix ?? 2600 },
    ] }],
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(t, options = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dataDirectory = mkdtempSync(path.join(tmpdir(), 'thor-desktop-monitor-'));
  const notifications = [];
  const errors = [];
  const monitors = [];
  let currentFeed = feed();
  let calls = 0;
  function create(overrides = {}) {
    const monitor = createShipmentMonitor({
      dataDirectory,
      intervalMs: INTERVAL,
      fetchFeed: async () => { calls += 1; return Response.json(currentFeed); },
      notify: async notification => { notifications.push(notification); },
      onError: error => errors.push(error),
      ...options,
      ...overrides,
    });
    monitors.push(monitor);
    return monitor;
  }
  t.after(() => {
    for (const monitor of monitors) monitor.stop();
    rmSync(dataDirectory, { recursive: true, force: true });
  });
  return {
    create, notifications, errors,
    setFeed(value) { currentFeed = value; },
    get calls() { return calls; },
    savedState() { return JSON.parse(readFileSync(path.join(dataDirectory, 'notifications.json'), 'utf8')); },
  };
}

async function tick(t, milliseconds) {
  t.mock.timers.tick(milliseconds);
  // Response body reads settle asynchronously after a timer initiates a check.
  await setImmediate();
}

test('saved watches do not poll or notify until the renderer synchronizes its current watch', async t => {
  const h = harness(t);
  const first = h.create();
  first.setWatch(WATCH);
  await first.refresh();
  first.stop();
  h.setFeed(feed(2550));
  const reopened = h.create();
  await tick(t, 5 * INTERVAL);
  await reopened.checkInBackground();
  assert.equal(h.calls, 1);
  assert.equal(h.notifications.length, 0);

  reopened.setWatch({ ...WATCH });
  await tick(t, INTERVAL);
  assert.equal(h.calls, 2);
  assert.equal(h.notifications.length, 1);
});

test('window and background refreshes share one request while preserving independent response bodies', async t => {
  const pending = deferred();
  let calls = 0;
  let signal;
  const h = harness(t, { fetchFeed: receivedSignal => {
    calls += 1;
    signal = receivedSignal;
    return pending.promise;
  } });
  const monitor = h.create();
  monitor.setWatch(WATCH);
  const first = monitor.refresh();
  const second = monitor.refresh();
  const background = monitor.checkInBackground();
  assert.equal(calls, 1);
  assert.ok(signal instanceof AbortSignal);
  const payload = feed();
  pending.resolve(Response.json(payload, { headers: { 'x-fixture': 'shared' } }));
  const [left, right] = await Promise.all([first, second, background]);
  assert.notEqual(left, right);
  assert.equal(left.headers.get('x-fixture'), 'shared');
  assert.equal(right.headers.get('x-fixture'), 'shared');
  assert.deepEqual(await left.json(), payload);
  assert.deepEqual(await right.json(), payload);
  assert.equal(h.notifications.length, 0);
});

test('a live baseline is quiet, unrelated model updates stay quiet, and tracked changes notify once', async t => {
  const h = harness(t);
  const monitor = h.create();
  monitor.setWatch(WATCH);
  await monitor.refresh();
  assert.equal(h.notifications.length, 0);
  h.setFeed(feed(2500, { otherEndPrefix: 2700, checkedAt: '2026-09-12T01:10:00.000Z' }));
  await monitor.refresh();
  assert.equal(h.notifications.length, 0);
  h.setFeed(feed(2550, { checkedAt: '2026-09-12T01:20:00.000Z' }));
  await monitor.refresh();
  await monitor.refresh();
  assert.equal(h.notifications.length, 1);
  assert.match(h.notifications[0].title, /Black Pro/);
  assert.ok(h.notifications[0].body.length > 0);
  assert.deepEqual(h.savedState().baseline.ranges, [['2026-09-11', 2400, 2550]]);
  assert.equal(h.errors.length, 0);
});

test('notification deduplication survives closing and reopening the application', async t => {
  const h = harness(t);
  const first = h.create();
  first.setWatch(WATCH);
  await first.refresh();
  h.setFeed(feed(2550));
  await first.refresh();
  assert.equal(h.notifications.length, 1);
  first.stop();
  const reopened = h.create();
  reopened.setWatch({ ...WATCH });
  await reopened.refresh();
  assert.equal(h.notifications.length, 1, 'the update already notified before restart remains acknowledged');
  h.setFeed(feed(2600));
  await reopened.refresh();
  assert.equal(h.notifications.length, 2);
});

test('clearing or switching the watch during a pending refresh cannot notify the old watch', async t => {
  const h = harness(t);
  for (const nextWatch of [null, OTHER_WATCH]) {
    const pending = deferred();
    let deferNext = false;
    const monitor = h.create({ fetchFeed: async () => deferNext ? pending.promise : Response.json(feed()) });
    monitor.setWatch(WATCH);
    await monitor.refresh();
    deferNext = true;
    const refreshing = monitor.refresh();
    monitor.setWatch(nextWatch);
    pending.resolve(Response.json(feed(2550, { otherEndPrefix: 2700 })));
    await refreshing;
    assert.equal(h.notifications.length, 0);
    assert.deepEqual(h.savedState().watch, nextWatch);
    monitor.stop();
  }
});

test('idempotent watch synchronization does not postpone a scheduled background check', async t => {
  const h = harness(t);
  const monitor = h.create();
  monitor.setWatch(WATCH);
  await tick(t, INTERVAL - 1);
  monitor.setWatch({ ...WATCH });
  assert.equal(h.calls, 0);
  await tick(t, 1);
  assert.equal(h.calls, 1);
  await tick(t, INTERVAL);
  assert.equal(h.calls, 2, 'background checks continue after the first interval');
});

test('visible windows skip background polls and minimizing resumes scheduled checks', async t => {
  let background = false;
  const h = harness(t, { isBackground: () => background });
  const monitor = h.create();
  monitor.setWatch(WATCH);
  await tick(t, INTERVAL);
  await tick(t, INTERVAL);
  assert.equal(h.calls, 0);
  background = true;
  await tick(t, INTERVAL);
  assert.equal(h.calls, 1);
  background = false;
  await tick(t, INTERVAL);
  assert.equal(h.calls, 1);
});

test('stopping cancels the current request, suppresses late notifications, and prevents future checks', async t => {
  const pending = deferred();
  let signal;
  let calls = 0;
  const h = harness(t, { fetchFeed: receivedSignal => {
    signal = receivedSignal;
    calls += 1;
    return calls === 1 ? Promise.resolve(Response.json(feed())) : pending.promise;
  } });
  const monitor = h.create();
  monitor.setWatch(WATCH);
  await monitor.refresh();
  const refreshing = monitor.refresh();
  monitor.stop();
  assert.equal(signal.aborted, true);
  pending.resolve(Response.json(feed(2550)));
  await refreshing;
  await tick(t, 10 * INTERVAL);
  await monitor.checkInBackground();
  monitor.setWatch(OTHER_WATCH);
  assert.equal(calls, 2);
  assert.equal(h.notifications.length, 0);
  assert.deepEqual(h.savedState().watch, WATCH);
  await assert.rejects(monitor.refresh(), /stopped/);
});

test('archived, failed, or offline checks never replace the live baseline or suppress the next real update', async t => {
  const h = harness(t);
  const monitor = h.create();
  monitor.setWatch(WATCH);
  await monitor.refresh();
  const baseline = h.savedState().baseline;
  h.setFeed(feed(2550, { status: 'archived' }));
  await monitor.refresh();
  assert.deepEqual(h.savedState().baseline, baseline);
  assert.equal(h.notifications.length, 0);
  monitor.stop();

  const offline = h.create({ fetchFeed: async () => { throw new TypeError('offline'); } });
  offline.setWatch(WATCH);
  await offline.checkInBackground();
  assert.equal(h.errors.length, 1);
  assert.deepEqual(h.savedState().baseline, baseline);
  offline.stop();

  const unavailable = h.create({ fetchFeed: async () => Response.json(feed(2550), { status: 503 }) });
  unavailable.setWatch(WATCH);
  assert.equal((await unavailable.refresh()).status, 503);
  assert.deepEqual(h.savedState().baseline, baseline);
  unavailable.stop();

  h.setFeed(feed(2550));
  const recovered = h.create();
  recovered.setWatch(WATCH);
  await recovered.refresh();
  assert.equal(h.notifications.length, 1);
});

test('background failures retry on the next interval without unhandled rejections', async t => {
  let calls = 0;
  const h = harness(t, { fetchFeed: async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('offline');
    return Response.json(feed());
  } });
  const monitor = h.create();
  monitor.setWatch(WATCH);
  await tick(t, INTERVAL);
  assert.equal(calls, 1);
  assert.equal(h.errors.length, 1);
  await tick(t, INTERVAL);
  assert.equal(calls, 2);
  assert.equal(h.notifications.length, 0);
});
