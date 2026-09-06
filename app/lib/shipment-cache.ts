import { COLORS, MODELS, type ModelId, type ShipmentDay, type ThorColor } from './shipments.ts';

export const SHIPMENT_CACHE_KEY = 'thor-track.shipments.v1';

export type ShipmentCacheStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type ShipmentCacheSnapshot = {
  version: 1;
  savedAt: string;
  sourceUpdatedAt: string | null;
  days: ShipmentDay[];
  checkedAt?: string | null;
  archivedAt?: string | null;
  source?: 'live' | 'archive';
};

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function isShipmentEntry(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    COLORS.includes(entry.color as ThorColor) &&
    MODELS.some((model) => model.id === (entry.model as ModelId)) &&
    typeof entry.sourceVariant === 'string' &&
    entry.sourceVariant.length > 0 &&
    entry.sourceVariant.length <= 100 &&
    Number.isInteger(entry.startPrefix) &&
    Number.isInteger(entry.endPrefix) &&
    Number(entry.startPrefix) >= 1000 &&
    Number(entry.endPrefix) >= Number(entry.startPrefix) &&
    Number(entry.endPrefix) <= 9999
  );
}

export function isShipmentHistory(value: unknown): value is ShipmentDay[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 2000) return false;

  let entryCount = 0;
  let previousDate = '';
  for (const item of value) {
    if (!item || typeof item !== 'object') return false;
    const day = item as Record<string, unknown>;
    if (!isIsoDate(day.date) || day.date < previousDate || !Array.isArray(day.entries)) return false;
    if (day.entries.length === 0 || day.entries.length > 200) return false;
    if (!day.entries.every(isShipmentEntry)) return false;
    previousDate = day.date;
    entryCount += day.entries.length;
    if (entryCount > 20_000) return false;
  }
  return true;
}

export function readShipmentCache(storage: ShipmentCacheStorage | null): ShipmentCacheSnapshot | null {
  if (!storage) return null;

  try {
    const raw = storage.getItem(SHIPMENT_CACHE_KEY);
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as Partial<ShipmentCacheSnapshot>;
    if (
      snapshot.version !== 1 ||
      typeof snapshot.savedAt !== 'string' ||
      !Number.isFinite(Date.parse(snapshot.savedAt)) ||
      (snapshot.sourceUpdatedAt !== null && typeof snapshot.sourceUpdatedAt !== 'string') ||
      [snapshot.checkedAt, snapshot.archivedAt].some((date) => date != null &&
        (typeof date !== 'string' || !Number.isFinite(Date.parse(date)))) ||
      (snapshot.source !== undefined && snapshot.source !== 'live' && snapshot.source !== 'archive') ||
      !isShipmentHistory(snapshot.days)
    ) {
      return null;
    }
    return snapshot as ShipmentCacheSnapshot;
  } catch {
    return null;
  }
}

export function writeShipmentCache(
  storage: ShipmentCacheStorage | null,
  snapshot: Omit<ShipmentCacheSnapshot, 'version'>,
) {
  if (!storage || !isShipmentHistory(snapshot.days)) return false;

  try {
    storage.setItem(SHIPMENT_CACHE_KEY, JSON.stringify({ version: 1, ...snapshot }));
    return true;
  } catch {
    return false;
  }
}
