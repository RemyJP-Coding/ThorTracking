import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeWatch, readNotificationState, setNotificationWatch, observeNotificationFeed } from '../desktop/notification-state.mjs';
import { compareShipments } from '../app/lib/shipment-comparison.ts';
import { COLORS, MODELS } from '../app/lib/shipments.ts';

const watch = { prefix: 2600, color: 'Black', model: 'base' };
const other = { color: 'White', model: 'base' };
const row = (startPrefix = 2400, endPrefix = 2500, config = watch) => ({
  color: config.color, model: config.model, sourceVariant: 'AYN display label', startPrefix, endPrefix,
});
const day = (date = '2026-09-09', entries = [row()]) => ({ date, entries });
const feed = (days = [day()], checkedAt = '2026-09-11T12:00:00.000Z', sourceUpdatedAt = '2026-09-10T18:24:44+08:00') => ({
  version: 2, status: 'live', days, checkedAt, sourceUpdatedAt,
});
const initial = () => setNotificationWatch(readNotificationState(null), watch);
const observed = (value = feed()) => observeNotificationFeed(initial(), value).state;

test('notification watches match the existing exact color/model domain and keep only bounded fields', () => {
  for (const color of COLORS) for (const model of MODELS) {
    assert.deepEqual(normalizeWatch({ prefix: 1000, color, model: model.id, extra: 'discard' }), { prefix: 1000, color, model: model.id });
  }
  assert.equal(normalizeWatch(null), null);
  for (const invalid of [undefined, [], {}, { ...watch, prefix: '2600' }, { ...watch, prefix: 999 },
    { ...watch, prefix: 10_000 }, { ...watch, prefix: 2600.1 }, { ...watch, color: 'black' },
    { ...watch, model: 'max' }, { ...watch, model: ['base'] }, { ...watch, model: '__proto__' }]) assert.throws(() => normalizeWatch(invalid), TypeError);
});

test('the first confirmed live check is quiet, including configurations with no published ranges', () => {
  const first = observeNotificationFeed(initial(), feed());
  assert.equal(first.notification, null);
  assert.deepEqual(first.state.baseline.ranges, [['2026-09-09', 2400, 2500]]);
  const empty = observeNotificationFeed(initial(), feed([day('2026-09-09', [row(2400, 2500, other)])]));
  assert.equal(empty.notification, null);
  assert.deepEqual(empty.state.baseline.ranges, []);
  assert.ok(observeNotificationFeed(empty.state, feed()).notification, 'a first published watched range after a baseline is an update');
});

test('watched notifications match existing comparison for additions, corrections, removals, and unrelated changes', () => {
  const before = [day('2026-09-08', [row(2300, 2400)]), day('2026-09-09', [row(), row(2200, 2300, other)])];
  const alternatives = [
    [...before, day('2026-09-10', [row(2500, 2550)])],
    [before[0], day('2026-09-09', [row(2390, 2500), row(2200, 2300, other)])],
    [before[0], day('2026-09-09', [row(2400, 2490), row(2200, 2300, other)])],
    [day('2026-09-09', [row(2200, 2300, other)])],
    [before[0], day('2026-09-09', [row(), row(2200, 2400, other)])],
    [before[0], day('2026-09-09', [row(), row(2400, 2550, { ...watch, model: 'pro' })])],
    [before[0], day('2026-09-09', [row(), row(), { ...row(2200, 2300, other), sourceVariant: 'Renamed label' }])],
    [before[1], before[0]],
  ];
  for (const current of alternatives) {
    const result = observeNotificationFeed(observed(feed(before)), feed(current, '2026-09-11T12:05:00Z'));
    assert.equal(result.notification !== null, compareShipments(before, current, watch).watched !== null);
    if (result.notification) {
      assert.equal(result.notification.title, 'Black Base shipment update');
      assert.equal(result.notification.body, 'AYN updated shipment ranges for your tracked configuration. Open Thor Track to view the changes.');
    }
  }
});

test('source timestamps, source labels, duplicate rows and row/day order alone do not notify', () => {
  const before = [day('2026-09-08', [row(2300, 2400)]), day()];
  const changedLabels = before.map((item) => ({ ...item, entries: item.entries.flatMap((entry) =>
    [{ ...entry, sourceVariant: 'Changed label' }, { ...entry, sourceVariant: 'Duplicate label' }]) })).reverse();
  const result = observeNotificationFeed(observed(feed(before)), feed(changedLabels, '2026-09-11T12:05:00Z', '2026-09-11T12:04:00Z'));
  assert.equal(result.notification, null);
  assert.equal(result.state.baseline.checkedAt, '2026-09-11T12:05:00Z');
});

test('archived, offline, malformed and stale results cannot alter the last confirmed baseline', () => {
  const state = observed();
  const changed = feed([day('2026-09-10', [row(2500, 2550)])], '2026-09-11T12:05:00Z');
  const invalidFeeds = [null, {}, { ...changed, status: 'archived' }, { ...changed, status: 'device' },
    { ...changed, status: 'unavailable' }, { ...changed, version: 1 }, { ...changed, checkedAt: null },
    { ...changed, checkedAt: 'yesterday' }, { ...changed, checkedAt: '2026-09-11T11:59:59Z' },
    { ...changed, sourceUpdatedAt: '2026-09-09T12:00:00Z' }, { ...changed, sourceUpdatedAt: 'broken' },
    { ...changed, days: [] }, { ...changed, days: [day('2026-02-30')] },
    { ...changed, days: [day('2026-09-10', [row(2600, 2500)])] },
    { ...changed, days: [day('2026-09-10', [row(999, 2500)])] },
    { ...changed, days: [day('2026-09-10', [row(2400, 10_000)])] },
    { ...changed, days: [day('2026-09-10', [{ ...row(), color: 'Red' }])] },
    { ...changed, days: [day('2026-09-10', [{ ...row(), model: 'max' }])] },
    { ...changed, days: [day('2026-09-10', Array.from({ length: 201 }, () => row()))] },
    { ...changed, days: Array.from({ length: 2001 }, () => day()) },
    { ...changed, days: Array.from({ length: 101 }, () => day('2026-09-10', Array.from({ length: 200 }, () => row()))) },
  ];
  for (const invalid of invalidFeeds) {
    const result = observeNotificationFeed(state, invalid);
    assert.equal(result.state, state);
    assert.equal(result.notification, null);
  }
  const first = initial();
  assert.equal(observeNotificationFeed(first, { ...changed, status: 'archived' }).state.baseline, null);
});

test('a persisted baseline deduplicates on restart and catches a new update after reopening', () => {
  const state = readNotificationState(JSON.parse(JSON.stringify(observed())));
  assert.equal(observeNotificationFeed(state, feed()).notification, null);
  const update = feed([day(), day('2026-09-10', [row(2500, 2550)])], '2026-09-11T12:05:00Z');
  const notified = observeNotificationFeed(state, update);
  assert.ok(notified.notification);
  const reopened = readNotificationState(JSON.parse(JSON.stringify(notified.state)));
  assert.equal(observeNotificationFeed(reopened, update).notification, null);
  assert.deepEqual(reopened, notified.state);
});

test('a missing optional source update time cannot erase the stale-source watermark', () => {
  const state = observed();
  const next = observeNotificationFeed(state, feed([day()], '2026-09-11T12:05:00Z', null));
  assert.equal(next.notification, null);
  assert.equal(next.state.baseline.sourceUpdatedAt, state.baseline.sourceUpdatedAt);
  const stale = feed([day('2026-09-10', [row(2500, 2550)])], '2026-09-11T12:10:00Z', '2026-09-09T12:00:00Z');
  assert.equal(observeNotificationFeed(next.state, stale).state, next.state);
});

test('saving the same watch preserves the baseline; prefix, color or model changes start quietly', () => {
  const state = observed();
  assert.equal(setNotificationWatch(state, { ...watch }), state);
  for (const nextWatch of [{ ...watch, prefix: 2601 }, { ...watch, color: 'White' }, { ...watch, model: 'max-512' }]) {
    const changed = setNotificationWatch(state, nextWatch);
    assert.equal(changed.baseline, null);
    assert.equal(observeNotificationFeed(changed, feed()).notification, null);
  }
  const cleared = setNotificationWatch(state, null);
  assert.deepEqual(cleared, { version: 1, watch: null, baseline: null });
  assert.equal(observeNotificationFeed(cleared, feed()).state, cleared);
});

test('invalid saved notification state safely resets without adopting corrupt timestamps or ranges', () => {
  const state = observed();
  const bad = [undefined, null, [], {}, { ...state, version: 2 }, { ...state, watch: { ...watch, prefix: 1 } },
    { ...state, watch: null }, { ...state, baseline: {} }, { ...state, baseline: { ...state.baseline, checkedAt: 'invalid' } },
    { ...state, baseline: { ...state.baseline, sourceUpdatedAt: '2026-02-30T12:00:00Z' } },
    { ...state, baseline: { ...state.baseline, ranges: [['2026-09-09', 2500, 2400]] } },
    { ...state, baseline: { ...state.baseline, ranges: [['2026-02-30', 2400, 2500]] } },
    { ...state, baseline: { ...state.baseline, ranges: Array.from({ length: 20_001 }, () => ['2026-09-09', 2400, 2500]) } },
  ];
  for (const value of bad) assert.deepEqual(readNotificationState(value), { version: 1, watch: null, baseline: null });
  assert.deepEqual(readNotificationState(initial()), initial());
  const duplicated = { ...state, baseline: { ...state.baseline, ranges: [...state.baseline.ranges, ...state.baseline.ranges] } };
  assert.deepEqual(readNotificationState(duplicated), state);
});
