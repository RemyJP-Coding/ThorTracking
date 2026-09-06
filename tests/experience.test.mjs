import assert from 'node:assert/strict';
import test from 'node:test';
import { compareShipments, normalizeSnapshotDays } from '../app/lib/shipment-comparison.ts';
import { beginVisit, recordDisplayed, visitVisibility, VISIT_AWAY_MS, parseExperience, readExperience, writeExperience, EXPERIENCE_KEY, isOlderObservation, cacheObservation } from '../app/lib/experience.ts';
import { writeWatchSnapshot, readWatchSnapshot } from '../app/lib/watch-storage.ts';
import { readShipmentCache, writeShipmentCache } from '../app/lib/shipment-cache.ts';

const watch = { prefix: 2160, color: 'Black', model: 'base' };
const row = (date, endPrefix, startPrefix = endPrefix - 20, model = 'base', color = 'Black') => ({ date, entries: [{ color, model, sourceVariant: `${color} ${model}`, startPrefix, endPrefix }] });
const days = [row('2026-01-01', 2000), row('2026-01-08', 2040), row('2026-01-15', 2080), row('2026-01-22', 2120)];
const observed = (history = days, checkedAt = '2026-01-22T12:00:00Z', source = 'live') => ({ days: history, checkedAt, source, archivedAt: source === 'live' ? null : checkedAt, sourceUpdatedAt: null });
const options = (extra = {}) => ({ watch, visible: true, settled: true, now: '2026-01-22T12:00:01Z', today: '2026-01-22', ...extra });
const fresh = () => beginVisit(watch, null, '2026-01-22T12:00:00Z');
const settle = (visit = fresh(), observation = observed(), extra = {}) => recordDisplayed(visit, observation, options(extra));
const memoryStorage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
};

test('first use adopts the watch without guessing its original save date; no provisional baseline', () => {
  const visit = fresh();
  assert.equal(visit.baseline, null);
  assert.equal(visit.record.startedAt, '2026-01-22T12:00:00Z');
  assert.equal(visit.record.initialEndpoint, null);
  assert.equal(settle(visit, observed(), { settled: false }), visit);
  assert.equal(settle(visit, null), visit); // bundled fallback has no accepted observation
  const displayed = settle(visit);
  assert.equal(displayed.baseline, null);
  assert.equal(displayed.record.initialEndpoint, 2120);
  assert.equal(displayed.record.history.length, 1);
});

test('an unchanged revisit compares the previous displayed snapshot and deduplicates refresh timestamps', () => {
  const first = settle();
  const next = beginVisit(watch, first.record, '2026-01-22T15:00:00Z');
  assert.deepEqual(next.baseline, first.record.latest);
  const refreshed = settle(next, observed(days, '2026-01-22T15:00:00Z'));
  assert.equal(compareShipments(refreshed.baseline.days, refreshed.record.latest.days, watch).changed, false);
  assert.equal(refreshed.record.history.length, 1);
});

test('multiple refreshes keep a frozen baseline and next visit starts at the last displayed snapshot', () => {
  const first = settle();
  const visit = beginVisit(watch, first.record, '2026-01-23T12:00:00Z');
  const refreshed = settle(visit, observed([...days, row('2026-01-23', 2130)], '2026-01-23T12:00:00Z'), { today: '2026-01-23' });
  const twice = settle(refreshed, observed([...days, row('2026-01-23', 2130), row('2026-01-24', 2140)], '2026-01-24T12:00:00Z'), { today: '2026-01-24' });
  assert.deepEqual(twice.baseline, visit.baseline);
  assert.equal(compareShipments(twice.baseline.days, twice.record.latest.days, watch).watched.published.length, 2);
  assert.deepEqual(beginVisit(watch, twice.record, '2026-01-24T13:00:00Z').baseline, twice.record.latest);
});

test('hidden refreshes are not seen; 30-minute return freezes the last visible snapshot', () => {
  const visit = settle();
  const hidden = visitVisibility(visit, false, 1000);
  const update = observed([...days, row('2026-01-23', 2140)], '2026-01-23T12:00:00Z');
  assert.equal(settle(hidden, update, { visible: false }), hidden);
  assert.equal(visitVisibility(hidden, false, 2000), hidden);
  assert.equal(visitVisibility(hidden, true, 1000 + VISIT_AWAY_MS - 1).baseline, null);
  const returned = visitVisibility(hidden, true, 1000 + VISIT_AWAY_MS);
  assert.deepEqual(returned.baseline, visit.record.latest);
  const displayed = settle(returned, update);
  assert.equal(compareShipments(displayed.baseline.days, displayed.record.latest.days, watch).watched.published.length, 1);
});

test('normalization ignores labels, duplicate days and rows, and all ordering', () => {
  const changedFormatting = [...days].reverse().map((day) => ({ ...day, entries: [...day.entries, ...day.entries].map((entry) => ({ ...entry, sourceVariant: 'AYN   Black Base' })) }));
  changedFormatting.push(days[0]);
  assert.deepEqual(normalizeSnapshotDays(changedFormatting), normalizeSnapshotDays(days));
  assert.equal(compareShipments(days, changedFormatting, watch).changed, false);
});

test('historical additions, removals, and revisions are separate from newly published dates', () => {
  const current = [row('2025-12-31', 1900), row('2026-01-01', 1995), ...days.slice(2), row('2026-01-23', 2140)];
  const comparison = compareShipments(days, current, watch);
  assert.deepEqual(comparison.watched.historical.map((item) => item.kind), ['added', 'revised', 'removed']);
  assert.deepEqual(comparison.watched.published.map((item) => item.date), ['2026-01-23']);
  const historicalOnly = compareShipments(days, [...days, row('2026-01-10', 2200)], watch);
  assert.equal(historicalOnly.watched.published.length, 0);
  assert.equal(historicalOnly.watched.historical.length, 1);
  assert.equal(historicalOnly.watched.currentEndpoint, 2200);
});

test('exact configuration isolation includes Max 512GB and Max 1TB; gaps stay passed, not listed', () => {
  const watched = { ...watch, model: 'max-512' };
  const previous = [row('2026-01-01', 2100, 2000, 'max-512')];
  const unrelated = [...previous, row('2026-01-02', 2300, 2100, 'max-1tb')];
  assert.equal(compareShipments(previous, unrelated, watched).watched, null);
  assert.equal(compareShipments(previous, unrelated, watched).others[0].model, 'max-1tb');
  const passed = compareShipments(previous, [...previous, row('2026-01-02', 2200, 2180, 'max-512')], watched);
  assert.equal(passed.previousStatus, 'watching');
  assert.equal(passed.currentStatus, 'passed');
  assert.equal(compareShipments(previous, [...previous, row('2026-01-02', 2200, 2150, 'max-512')], watched).currentStatus, 'listed');
});

test('progress uses the highest endpoint and records a later downward revision', () => {
  const first = settle();
  const backwardRow = settle(first, observed([...days, row('2026-01-23', 2110)], '2026-01-23T12:00:00Z'));
  assert.equal(backwardRow.record.history.at(-1).assessment.evidence.latestPrefix, 2120);
  const corrected = settle(backwardRow, observed([...days.slice(0, -1), row('2026-01-22', 2100)], '2026-01-24T12:00:00Z'));
  assert.equal(corrected.record.initialEndpoint, 2120);
  assert.equal(corrected.record.endpointRevision.from, 2120);
  assert.equal(corrected.record.endpointRevision.to, 2100);
  assert.equal(corrected.record.history.at(-1).assessment.evidence.latestPrefix, 2100);
});

test('missing configuration data waits before establishing the initial endpoint', () => {
  const waiting = settle(fresh(), observed([row('2026-01-22', 3000, 2980, 'pro')]));
  assert.equal(waiting.record.initialEndpoint, null);
  assert.equal(waiting.record.history[0].assessment.reason, 'no-configuration');
  const started = settle(waiting, observed(days, '2026-01-23T12:00:00Z'));
  assert.equal(started.record.initialEndpoint, 2120);
});

test('saving the same identity preserves history; prefix, color, and model changes start fresh', () => {
  const record = settle().record;
  assert.equal(beginVisit({ ...watch }, record, '2026-01-23T00:00:00Z').record, record);
  for (const next of [{ ...watch, prefix: 2161 }, { ...watch, color: 'White' }, { ...watch, model: 'max-1tb' }]) {
    const replacement = beginVisit(next, record, '2026-01-23T00:00:00Z');
    assert.equal(replacement.record.history.length, 0);
    assert.equal(replacement.record.initialEndpoint, null);
    assert.equal(replacement.baseline, null);
  }
});

test('malformed companion data never erases the watch and storage failures keep the session record', () => {
  const storage = memoryStorage();
  writeWatchSnapshot(storage, watch);
  for (const raw of ['{', 'null', '{}', JSON.stringify({ ...settle().record, history: [{}] }), JSON.stringify({ ...settle().record, latest: { days: [] } })]) {
    storage.setItem(EXPERIENCE_KEY, raw);
    assert.equal(readExperience(storage), null);
    assert.equal(readWatchSnapshot(storage).snapshot, JSON.stringify(watch));
  }
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } };
  const record = settle().record;
  assert.equal(readExperience(blocked, record), record);
  assert.equal(writeExperience(blocked, record, watch), false);
  assert.deepEqual(parseExperience(JSON.stringify(record)), record);
});

test('cross-tab replacement or clear rejects writes from the previous watch and stale requests', () => {
  const storage = memoryStorage();
  const first = settle();
  writeWatchSnapshot(storage, watch);
  assert.equal(writeExperience(storage, first.record, watch), true);
  const other = { ...watch, prefix: 2500 };
  writeWatchSnapshot(storage, other);
  assert.equal(writeExperience(storage, first.record, watch), false);
  const replacement = beginVisit(other, first.record, '2026-01-23T00:00:00Z');
  assert.equal(settle(replacement, observed()), replacement);
  assert.equal(writeExperience(storage, replacement.record, other), true);
  writeWatchSnapshot(storage, null);
  assert.equal(writeExperience(storage, first.record, watch), false);
  assert.equal(writeExperience(storage, null, null), true);
  assert.equal(storage.getItem(EXPERIENCE_KEY), null);
});

test('archived check attempts and older fallbacks cannot overwrite a newer observation', () => {
  const current = observed(days, '2026-01-23T12:00:00Z');
  const older = { ...observed(days.slice(0, -1), '2026-01-24T12:00:00Z', 'archive'), archivedAt: '2026-01-21T12:00:00Z' };
  assert.equal(isOlderObservation(older, current), true);
  const first = settle(fresh(), current);
  assert.equal(settle(first, older), first);
  // A newer successful observation can remove a date as a genuine correction.
  assert.equal(isOlderObservation(observed(days.slice(0, -1), '2026-01-24T12:00:00Z'), current), false);
  const storage = memoryStorage();
  writeWatchSnapshot(storage, watch);
  assert.equal(writeExperience(storage, first.record, watch), true);
  assert.equal(writeExperience(storage, settle().record, watch), false);
  assert.deepEqual(readExperience(storage), first.record);
});

test('cache metadata carries source freshness while old caches remain readable', () => {
  const storage = memoryStorage();
  const old = { savedAt: '2026-01-22T12:00:00Z', sourceUpdatedAt: null, days };
  writeShipmentCache(storage, old);
  assert.deepEqual(readShipmentCache(storage), { version: 1, ...old });
  assert.equal(cacheObservation(readShipmentCache(storage)).archivedAt, null);
  const current = { ...old, source: 'archive', checkedAt: '2026-01-24T12:00:00Z', archivedAt: '2026-01-22T12:00:00Z' };
  writeShipmentCache(storage, current);
  assert.deepEqual(readShipmentCache(storage), { version: 1, ...current });
  assert.equal(cacheObservation(readShipmentCache(storage)).archivedAt, current.archivedAt);
});

test('calendar shifts, unrelated dashboard dates, availability, and displayed confidence are recorded honestly', () => {
  const first = settle();
  const calendar = settle(first, observed(), { today: '2026-01-23' });
  assert.equal(calendar.record.history.length, 2);
  assert.match(calendar.record.history.at(-1).changes.join(' '), /1 day later.*evaluation date changed/);
  const unrelated = settle(calendar, observed([...days, row('2026-01-24', 3000, 2950, 'pro')], '2026-01-24T12:00:00Z'), { today: '2026-01-24' });
  assert.match(unrelated.record.history.at(-1).changes.join(' '), /dashboard date changed.*endpoint did not advance/);
  const archive = settle(first, observed(days, '2026-01-22T12:00:00Z', 'archive'));
  assert.equal(archive.record.history.at(-1).confidence, 'low');
  assert.equal(archive.record.history.at(-1).assessment.forecast.confidence, 'moderate');
  const unavailable = settle(first, observed(), { today: '2026-02-20' });
  assert.equal(unavailable.record.history.at(-1).assessment.reason, 'configuration-inactive');
  assert.equal(settle(unavailable, observed(), { today: '2026-02-21' }).record.history.length, unavailable.record.history.length);
});

test('the newest 50 meaningful assessments are retained and identical requests are deduplicated', () => {
  let visit = settle();
  for (let index = 0; index < 60; index++) {
    visit = settle(visit, observed(days, `2026-01-22T13:${String(index).padStart(2, '0')}:00Z`, index % 2 ? 'live' : 'archive'), { now: `2026-01-22T13:${String(index).padStart(2, '0')}:01Z` });
  }
  assert.equal(visit.record.history.length, 50);
  assert.equal(visit.record.history.at(-1).displayedAt, '2026-01-22T13:59:01Z');
  const repeated = settle(visit, observed(days, '2026-01-22T14:00:00Z'));
  assert.equal(repeated.record.history, visit.record.history);
  assert.deepEqual(parseExperience(JSON.stringify(visit.record)), visit.record);
});
