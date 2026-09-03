import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SHIPMENT_CACHE_KEY,
  readShipmentCache,
  writeShipmentCache,
} from '../app/lib/shipment-cache.ts';

const days = [
  {
    date: '2026-09-03',
    entries: [
      {
        color: 'Black',
        model: 'base',
        sourceVariant: 'Black Base',
        startPrefix: 2621,
        endPrefix: 2650,
      },
    ],
  },
];

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test('persists and restores the last successful shipment history on the device', () => {
  const storage = memoryStorage();
  const snapshot = {
    savedAt: '2026-09-03T20:00:00.000Z',
    sourceUpdatedAt: '2026-09-03T19:00:00.000Z',
    days,
  };

  assert.equal(writeShipmentCache(storage, snapshot), true);
  assert.deepEqual(readShipmentCache(storage), { version: 1, ...snapshot });
});

test('rejects malformed cached shipment data', () => {
  const storage = memoryStorage();
  storage.setItem(
    SHIPMENT_CACHE_KEY,
    JSON.stringify({
      version: 1,
      savedAt: '2026-09-03T20:00:00.000Z',
      sourceUpdatedAt: null,
      days: [{ date: 'not-a-date', entries: [] }],
    }),
  );

  assert.equal(readShipmentCache(storage), null);
});

test('fails softly when browser storage is blocked', () => {
  const blocked = {
    getItem() {
      throw new DOMException('Blocked', 'SecurityError');
    },
    setItem() {
      throw new DOMException('Blocked', 'SecurityError');
    },
  };

  assert.equal(readShipmentCache(blocked), null);
  assert.equal(
    writeShipmentCache(blocked, {
      savedAt: '2026-09-03T20:00:00.000Z',
      sourceUpdatedAt: null,
      days,
    }),
    false,
  );
});
