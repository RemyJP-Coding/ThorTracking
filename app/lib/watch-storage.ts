import type { ShipmentWatch } from './shipments.ts';

export type WatchStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type WatchStorageRead = {
  available: boolean;
  snapshot: string;
};

export type WatchStorageWrite = {
  persisted: boolean;
  snapshot: string;
};

export function readWatchSnapshot(
  storage: WatchStorage | null,
  fallbackSnapshot = '',
): WatchStorageRead {
  if (!storage) return { available: false, snapshot: fallbackSnapshot };

  try {
    return {
      available: true,
      snapshot: storage.getItem('thor-track.watch.v1') ?? '',
    };
  } catch {
    return { available: false, snapshot: fallbackSnapshot };
  }
}

export function writeWatchSnapshot(
  storage: WatchStorage | null,
  watch: ShipmentWatch | null,
): WatchStorageWrite {
  const snapshot = watch ? JSON.stringify(watch) : '';
  if (!storage) return { persisted: false, snapshot };

  try {
    if (watch) storage.setItem('thor-track.watch.v1', snapshot);
    else storage.removeItem('thor-track.watch.v1');
    return { persisted: true, snapshot };
  } catch {
    return { persisted: false, snapshot };
  }
}
