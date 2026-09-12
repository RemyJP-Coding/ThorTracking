// Kept as plain ESM so the packaged Electron main process needs no TS runtime.
// These domain values mirror app/lib/shipments.ts; parity is covered by tests.
const COLORS = ['Black', 'White', 'Rainbow', 'Clear Purple'];
const MODEL_LABELS = { lite: 'Lite', base: 'Base', pro: 'Pro', 'max-512': 'Max 512GB', 'max-1tb': 'Max 1TB' };
const MAX_DAYS = 2000;
const MAX_RANGES = 20_000;

const emptyState = () => ({ version: 1, watch: null, baseline: null });
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isPrefix = (value) => Number.isInteger(value) && value >= 1000 && value <= 9999;
const isModel = (value) => typeof value === 'string' && Object.hasOwn(MODEL_LABELS, value);
const sameWatch = (left, right) => left === right || (left !== null && right !== null &&
  left.prefix === right.prefix && left.color === right.color && left.model === right.model);

function isDate(value) {
  return typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function isTimestamp(value) {
  return typeof value === 'string' && value.length <= 64 &&
    /^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    isDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}

function canonicalRanges(ranges) {
  const unique = new Map(ranges.map((range) => [JSON.stringify(range), range]));
  return [...unique.values()].sort((left, right) =>
    left[0].localeCompare(right[0]) || left[1] - right[1] || left[2] - right[2]);
}

export function normalizeWatch(value) {
  if (value === null) return null;
  if (!isRecord(value) || !isPrefix(value.prefix) || !COLORS.includes(value.color) ||
    !isModel(value.model)) throw new TypeError('Invalid shipment watch.');
  return { prefix: value.prefix, color: value.color, model: value.model };
}

/** Return a safe initial state for absent or malformed saved state. */
export function readNotificationState(value) {
  if (!isRecord(value) || value.version !== 1) return emptyState();
  let watch;
  try { watch = normalizeWatch(value.watch); } catch { return emptyState(); }
  if (value.baseline === null) return { version: 1, watch, baseline: null };
  const baseline = value.baseline;
  if (!watch || !isRecord(baseline) || !isTimestamp(baseline.checkedAt) ||
    !(baseline.sourceUpdatedAt === null || isTimestamp(baseline.sourceUpdatedAt)) ||
    !Array.isArray(baseline.ranges) || baseline.ranges.length > MAX_RANGES ||
    !baseline.ranges.every((range) => Array.isArray(range) && range.length === 3 &&
      isDate(range[0]) && isPrefix(range[1]) && isPrefix(range[2]) && range[1] <= range[2])) return emptyState();
  return { version: 1, watch, baseline: {
    ranges: canonicalRanges(baseline.ranges.map((range) => [...range])),
    checkedAt: baseline.checkedAt, sourceUpdatedAt: baseline.sourceUpdatedAt,
  } };
}

export function setNotificationWatch(state, value) {
  const watch = normalizeWatch(value);
  if (sameWatch(state.watch, watch)) return state;
  return { version: 1, watch, baseline: null };
}

function feedRanges(feed, watch) {
  if (!isRecord(feed) || feed.version !== 2 || feed.status !== 'live' ||
    !isTimestamp(feed.checkedAt) || !(feed.sourceUpdatedAt === null || isTimestamp(feed.sourceUpdatedAt)) ||
    !Array.isArray(feed.days) || feed.days.length === 0 || feed.days.length > MAX_DAYS) return null;
  const ranges = [];
  let count = 0;
  for (const day of feed.days) {
    if (!isRecord(day) || !isDate(day.date) || !Array.isArray(day.entries) ||
      day.entries.length === 0 || day.entries.length > 200) return null;
    count += day.entries.length;
    if (count > MAX_RANGES) return null;
    for (const entry of day.entries) {
      if (!isRecord(entry) || !COLORS.includes(entry.color) || !isModel(entry.model) ||
        !isPrefix(entry.startPrefix) || !isPrefix(entry.endPrefix) || entry.startPrefix > entry.endPrefix) return null;
      if (entry.color === watch.color && entry.model === watch.model) {
        ranges.push([day.date, entry.startPrefix, entry.endPrefix]);
      }
    }
  }
  return canonicalRanges(ranges);
}

/** Only confirmed live observations can establish or advance notification state. */
export function observeNotificationFeed(state, feed) {
  const unchanged = { state, notification: null };
  if (!state.watch) return unchanged;
  const ranges = feedRanges(feed, state.watch);
  if (!ranges) return unchanged;
  const previous = state.baseline;
  if (previous && (Date.parse(feed.checkedAt) < Date.parse(previous.checkedAt) ||
    (previous.sourceUpdatedAt !== null && feed.sourceUpdatedAt !== null &&
      Date.parse(feed.sourceUpdatedAt) < Date.parse(previous.sourceUpdatedAt)))) return unchanged;
  const baseline = { ranges, checkedAt: feed.checkedAt,
    sourceUpdatedAt: feed.sourceUpdatedAt ?? previous?.sourceUpdatedAt ?? null };
  const changed = previous !== null && JSON.stringify(previous.ranges) !== JSON.stringify(ranges);
  return {
    state: { version: 1, watch: state.watch, baseline },
    notification: changed ? {
      title: `${state.watch.color} ${MODEL_LABELS[state.watch.model]} shipment update`,
      body: 'AYN updated shipment ranges for your tracked configuration. Open Thor Track to view the changes.',
    } : null,
  };
}
