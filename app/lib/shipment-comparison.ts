import { evaluateWatch, entriesForVariant, variantKey, type ShipmentDay, type ShipmentWatch, type ShipmentEntry } from './shipments.ts';

export type RangeObservation = Omit<ShipmentEntry, 'sourceVariant'> & { date: string };
export type ConfigurationChange = {
  color: ShipmentEntry['color'];
  model: ShipmentEntry['model'];
  published: RangeObservation[];
  historical: Array<{ date: string; kind: 'added' | 'removed' | 'revised'; added: RangeObservation[]; removed: RangeObservation[] }>;
  previousEndpoint: number | null;
  currentEndpoint: number | null;
};

// The identity deliberately excludes labels, row order and repeated source rows.
export function normalizedRanges(days: ShipmentDay[]): RangeObservation[] {
  const ranges = new Map<string, RangeObservation>();
  for (const day of days) for (const entry of day.entries) {
    const range = { date: day.date, color: entry.color, model: entry.model, startPrefix: entry.startPrefix, endPrefix: entry.endPrefix };
    ranges.set(JSON.stringify(range), range);
  }
  return [...ranges.values()].sort((a, b) => a.date.localeCompare(b.date) ||
    variantKey(a.color, a.model).localeCompare(variantKey(b.color, b.model)) || a.startPrefix - b.startPrefix || a.endPrefix - b.endPrefix);
}

export function normalizeSnapshotDays(days: ShipmentDay[]): ShipmentDay[] {
  const result = new Map<string, ShipmentDay>();
  for (const { date, ...entry } of normalizedRanges(days)) {
    if (!result.has(date)) result.set(date, { date, entries: [] });
    result.get(date)!.entries.push({ ...entry, sourceVariant: `${entry.color} ${entry.model}` });
  }
  return [...result.values()];
}

export function publishedEndpoint(days: ShipmentDay[], watch: ShipmentWatch): number | null {
  const entries = entriesForVariant(days, watch.color, watch.model);
  return entries.length ? Math.max(...entries.map((entry) => entry.endPrefix)) : null;
}

export function compareShipments(previous: ShipmentDay[], current: ShipmentDay[], watch: ShipmentWatch) {
  const before = normalizedRanges(previous);
  const after = normalizedRanges(current);
  const oldKeys = new Set(before.map((range) => JSON.stringify(range)));
  const newKeys = new Set(after.map((range) => JSON.stringify(range)));
  const added = after.filter((range) => !oldKeys.has(JSON.stringify(range)));
  const removed = before.filter((range) => !newKeys.has(JSON.stringify(range)));
  const previousDate = before[before.length - 1]?.date ?? '';
  const configurations = new Map<string, ConfigurationChange>();
  for (const range of [...added, ...removed]) {
    const key = variantKey(range.color, range.model);
    if (configurations.has(key)) continue;
    const same = (item: RangeObservation) => variantKey(item.color, item.model) === key;
    const additions = added.filter(same);
    const removals = removed.filter(same);
    const historicalDates = [...new Set([...additions.filter((item) => item.date <= previousDate), ...removals].map((item) => item.date))].sort();
    configurations.set(key, {
      color: range.color, model: range.model,
      published: additions.filter((item) => item.date > previousDate),
      historical: historicalDates.map((date) => {
        const added = additions.filter((item) => item.date === date);
        const removed = removals.filter((item) => item.date === date);
        return { date, kind: added.length && removed.length ? 'revised' : added.length ? 'added' : 'removed', added, removed };
      }),
      previousEndpoint: publishedEndpoint(previous, { ...watch, color: range.color, model: range.model }),
      currentEndpoint: publishedEndpoint(current, { ...watch, color: range.color, model: range.model }),
    });
  }
  const watchKey = variantKey(watch.color, watch.model);
  return {
    changed: configurations.size > 0,
    watched: configurations.get(watchKey) ?? null,
    others: [...configurations.entries()].filter(([key]) => key !== watchKey).map(([, value]) => value),
    previousStatus: evaluateWatch(normalizeSnapshotDays(previous), watch).kind,
    currentStatus: evaluateWatch(normalizeSnapshotDays(current), watch).kind,
  };
}
