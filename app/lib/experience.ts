import { assessShippingForecast, COLORS, MODELS, evaluateWatch, explainForecastChange, type ForecastAssessment, type ShipmentDay, type ShipmentWatch, type ShippingForecast, type WatchStatus } from './shipments.ts';
import { isShipmentHistory, type ShipmentCacheSnapshot } from './shipment-cache.ts';
import { compareShipments, normalizeSnapshotDays, publishedEndpoint } from './shipment-comparison.ts';
import { readWatchSnapshot, type WatchStorage } from './watch-storage.ts';

export const EXPERIENCE_KEY = 'thor-track.experience.v1';
export const VISIT_AWAY_MS = 30 * 60 * 1000;
export const HISTORY_LIMIT = 50;
export type Observation = {
  days: ShipmentDay[];
  source: 'live' | 'archive' | 'device';
  checkedAt: string | null;
  archivedAt: string | null;
  sourceUpdatedAt: string | null;
};
export type ForecastHistoryEntry = {
  displayedAt: string;
  calendarDate: string;
  source: Observation['source'];
  status: WatchStatus['kind'];
  assessment: ForecastAssessment;
  confidence: ShippingForecast['confidence'] | null;
  changes: string[];
};
export type ExperienceRecord = {
  version: 1;
  watch: ShipmentWatch;
  startedAt: string;
  initialEndpoint: number | null;
  latest: Observation | null;
  endpointRevision: { from: number; to: number | null; observedAt: string } | null;
  history: ForecastHistoryEntry[];
};
export type ExperienceVisit = {
  record: ExperienceRecord;
  baseline: Observation | null;
  hiddenAt: number | null;
};

export function watchIdentity(watch: ShipmentWatch | null) {
  return watch ? `${watch.prefix}:${watch.color}:${watch.model}` : '';
}

export function isWatch(value: unknown): value is ShipmentWatch {
  if (!value || typeof value !== 'object') return false;
  const watch = value as ShipmentWatch;
  return Number.isInteger(watch.prefix) && watch.prefix >= 1000 && watch.prefix <= 9999 &&
    COLORS.includes(watch.color) && MODELS.some((item) => item.id === watch.model);
}

const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const calendarDate = (value: unknown): value is string => timestamp(value) && /^20\d{2}-\d{2}-\d{2}$/.test(value) && new Date(value).toISOString().slice(0, 10) === value;
const prefix = (value: unknown) => Number.isInteger(value) && Number(value) >= 1000 && Number(value) <= 9999;
const sources = ['live', 'archive', 'device'];
const statuses = ['listed', 'passed', 'watching', 'no-data'];
const confidences = ['very-low', 'low', 'moderate'];
const reasons = ['no-data', 'no-configuration', 'listed', 'passed', 'source-stale', 'configuration-inactive', 'insufficient-history', 'unusable-pace', 'beyond-horizon'];

function validAssessment(value: ForecastAssessment) {
  if (!value || !value.evidence) return false;
  const evidence = value.evidence;
  if (![evidence.sourceDate, evidence.lastAdvanceDate].every((date) => date === null || calendarDate(date))) return false;
  if (!['latestPrefix', 'gap', 'ratePerDay', 'intervalCount', 'historySpanDays', 'observedMovement', 'projectedDays', 'sourceAgeDays', 'observationCount']
    .every((key) => { const item = evidence[key as keyof typeof evidence]; return item === null || (typeof item === 'number' && Number.isFinite(item) && item >= 0); })) return false;
  if (value.kind === 'unavailable') return reasons.includes(value.reason);
  if (value.kind !== 'available' || !value.forecast) return false;
  const forecast = value.forecast;
  return [forecast.windowStart, forecast.windowEnd, forecast.asOfDate, forecast.sourceDate, forecast.lastVariantDate].every(calendarDate) &&
    confidences.includes(forecast.confidence) && prefix(forecast.latestPrefix) &&
    [forecast.ratePerDay, forecast.intervalCount, forecast.gap].every((item) => typeof item === 'number' && Number.isFinite(item) && item > 0);
}

export function validObservation(value: Observation | null): boolean {
  return value !== null && sources.includes(value.source) && (value.days?.length === 0 || isShipmentHistory(value.days)) &&
    [value.checkedAt, value.archivedAt, value.sourceUpdatedAt].every((date) => date === null || timestamp(date));
}

export function parseExperience(raw: string | null): ExperienceRecord | null {
  if (!raw || raw.length > 6_000_000) return null;
  try {
    const record = JSON.parse(raw) as ExperienceRecord;
    if (!record || record.version !== 1 || !isWatch(record.watch) || !timestamp(record.startedAt) ||
      !(record.initialEndpoint === null || prefix(record.initialEndpoint)) ||
      !(record.latest === null || validObservation(record.latest)) || !Array.isArray(record.history) || record.history.length > HISTORY_LIMIT ||
      !record.history.every((entry) => entry && timestamp(entry.displayedAt) && calendarDate(entry.calendarDate) && sources.includes(entry.source) &&
        statuses.includes(entry.status) && (entry.confidence === null || confidences.includes(entry.confidence)) && validAssessment(entry.assessment) &&
        Array.isArray(entry.changes) && entry.changes.length <= 20 && entry.changes.every((text) => typeof text === 'string' && text.length <= 2000))) return null;
    if (record.endpointRevision !== null && (!record.endpointRevision || !prefix(record.endpointRevision.from) ||
      !(record.endpointRevision.to === null || prefix(record.endpointRevision.to)) || !timestamp(record.endpointRevision.observedAt))) return null;
    return record;
  } catch { return null; }
}

export function readExperience(storage: WatchStorage | null, fallback: ExperienceRecord | null = null) {
  try { return storage ? parseExperience(storage.getItem(EXPERIENCE_KEY)) : fallback; }
  catch { return fallback; }
}

// Verify the authoritative watch immediately before a write (including another tab's edits).
export function writeExperience(storage: WatchStorage | null, record: ExperienceRecord | null, expectedWatch: ShipmentWatch | null) {
  if (!storage) return false;
  try {
    const saved = readWatchSnapshot(storage);
    if (!saved.available) return false;
    const current: ShipmentWatch | null = saved.snapshot ? JSON.parse(saved.snapshot) : null;
    if (watchIdentity(current) !== watchIdentity(expectedWatch) || (record && watchIdentity(record.watch) !== watchIdentity(expectedWatch))) return false;
    const existing = parseExperience(storage.getItem(EXPERIENCE_KEY));
    if (record && existing && watchIdentity(existing.watch) === watchIdentity(record.watch) && existing.latest &&
      (!record.latest || isOlderObservation(record.latest, existing.latest))) return false;
    if (record) storage.setItem(EXPERIENCE_KEY, JSON.stringify(record));
    else storage.removeItem(EXPERIENCE_KEY);
    return true;
  } catch { return false; }
}

export function beginVisit(watch: ShipmentWatch, record: ExperienceRecord | null, now: string): ExperienceVisit {
  const adopted = record && watchIdentity(record.watch) === watchIdentity(watch) ? record : {
    version: 1 as const, watch, startedAt: now, initialEndpoint: null, latest: null, endpointRevision: null, history: [],
  };
  return { record: adopted, baseline: adopted.latest, hiddenAt: null };
}

export function visitVisibility(visit: ExperienceVisit, visible: boolean, now: number): ExperienceVisit {
  if (!visible) return visit.hiddenAt === null ? { ...visit, hiddenAt: now } : visit;
  if (visit.hiddenAt === null) return visit;
  return { ...visit, baseline: now - visit.hiddenAt >= VISIT_AWAY_MS ? visit.record.latest : visit.baseline, hiddenAt: null };
}

// archived checkedAt is an attempted check, not the time the source succeeded.
function observationTime(observation: Observation): number | null {
  const value = observation.source === 'live' ? observation.checkedAt : observation.archivedAt;
  const fallback = value ?? observation.sourceUpdatedAt;
  return fallback && timestamp(fallback) ? Date.parse(fallback) : null;
}

export function isOlderObservation(candidate: Observation, previous: Observation | null) {
  if (!previous) return false;
  const nextTime = observationTime(candidate);
  const oldTime = observationTime(previous);
  if (nextTime !== null && oldTime !== null && nextTime !== oldTime) return nextTime < oldTime;
  if (oldTime !== null && nextTime === null) return true;
  const newest = (days: ShipmentDay[]) => days.reduce((date, day) => day.date > date ? day.date : date, '');
  return newest(candidate.days) < newest(previous.days);
}

export function cacheObservation(cache: ShipmentCacheSnapshot): Observation {
  return { days: normalizeSnapshotDays(cache.days), source: 'device', checkedAt: cache.checkedAt ?? null,
    archivedAt: cache.source === 'live' ? cache.checkedAt ?? cache.savedAt : cache.archivedAt ?? cache.sourceUpdatedAt,
    sourceUpdatedAt: cache.sourceUpdatedAt };
}

export function displayedConfidence(assessment: ForecastAssessment, source: Observation['source']) {
  if (assessment.kind === 'unavailable') return null;
  const confidence = assessment.forecast.confidence;
  return source === 'live' || confidence === 'very-low' ? confidence : 'low';
}

export function assessmentIdentity(entry: Pick<ForecastHistoryEntry, 'assessment' | 'confidence' | 'status'>) {
  const evidence = { ...entry.assessment.evidence, sourceAgeDays: null };
  const outcome = entry.assessment.kind === 'available'
    ? [entry.assessment.forecast.windowStart, entry.assessment.forecast.windowEnd, entry.assessment.forecast.confidence]
    : entry.assessment.reason;
  return JSON.stringify([outcome, evidence, entry.confidence, entry.status]);
}

export function recordDisplayed(visit: ExperienceVisit, observation: Observation | null, options: {
  watch: ShipmentWatch; visible: boolean; settled: boolean; now: string; today: string;
}): ExperienceVisit {
  if (!options.visible || !options.settled || !observation || !validObservation(observation) ||
    watchIdentity(options.watch) !== watchIdentity(visit.record.watch) || isOlderObservation(observation, visit.record.latest)) return visit;
  const normalized = { ...observation, days: normalizeSnapshotDays(observation.days) };
  const assessment = assessShippingForecast(normalized.days, options.watch, options.today);
  const entry: ForecastHistoryEntry = { displayedAt: options.now, calendarDate: options.today, source: observation.source,
    status: evaluateWatch(normalized.days, options.watch).kind, assessment, confidence: displayedConfidence(assessment, observation.source), changes: [] };
  const previous = visit.record.history[visit.record.history.length - 1];
  const changed = !previous || assessmentIdentity(entry) !== assessmentIdentity(previous);
  if (previous && changed) {
    entry.changes = explainForecastChange(previous.assessment, assessment).filter((text) => text !== 'The forecast assessment is unchanged.');
    if (visit.record.latest && compareShipments(visit.record.latest.days, normalized.days, options.watch).watched?.historical.length) {
      entry.changes = entry.changes.map((text) => text.replace("Your configuration's published endpoint advanced", 'The recorded endpoint increased'));
      entry.changes.push('Historical configuration ranges were added, removed or revised. These edits do not establish new dispatch progress.');
    }
    if (previous.status !== entry.status) entry.changes.push(`Watch status changed from ${statusLabel(previous.status)} to ${statusLabel(entry.status)}.`);
    if (previous.confidence !== entry.confidence && previous.source !== entry.source) entry.changes.push(`Source changed to ${sourceLabel(entry.source)}; confidence reflects the displayed source.`);
  } else if (!previous) entry.changes = ['First assessment displayed on this device. Earlier predictions are not reconstructed.'];
  const endpoint = publishedEndpoint(normalized.days, options.watch);
  const oldEndpoint = visit.record.latest ? publishedEndpoint(visit.record.latest.days, options.watch) : null;
  return { ...visit, record: { ...visit.record,
    initialEndpoint: visit.record.initialEndpoint ?? endpoint,
    latest: normalized,
    endpointRevision: oldEndpoint !== null && (endpoint === null || endpoint < oldEndpoint)
      ? { from: oldEndpoint, to: endpoint, observedAt: options.now } : visit.record.endpointRevision,
    history: changed ? [...visit.record.history, entry].slice(-HISTORY_LIMIT) : visit.record.history,
  } };
}

export function statusLabel(status: WatchStatus['kind']) {
  return { listed: 'Listed by AYN', passed: 'Not explicitly listed', watching: 'Watching', 'no-data': 'No range yet' }[status];
}
export function sourceLabel(source: Observation['source']) {
  return { live: 'live AYN data', archive: 'saved archive', device: 'this device’s saved history' }[source];
}
