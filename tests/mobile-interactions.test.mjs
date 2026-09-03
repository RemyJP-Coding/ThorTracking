import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../app/api/shipments/route.ts';
import { readWatchSnapshot, writeWatchSnapshot } from '../app/lib/watch-storage.ts';

const watch = { prefix: 2516, color: 'Black', model: 'base' };

test('watch storage survives blocked mobile browser storage', () => {
  const blocked = {
    getItem() {
      throw new DOMException('Blocked', 'SecurityError');
    },
    setItem() {
      throw new DOMException('Blocked', 'SecurityError');
    },
    removeItem() {
      throw new DOMException('Blocked', 'SecurityError');
    },
  };

  assert.deepEqual(readWatchSnapshot(blocked, JSON.stringify(watch)), {
    available: false,
    snapshot: JSON.stringify(watch),
  });
  assert.deepEqual(writeWatchSnapshot(blocked, watch), {
    persisted: false,
    snapshot: JSON.stringify(watch),
  });
});

test('watch storage persists and clears the masked watch', () => {
  const values = new Map();
  const storage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };

  assert.equal(writeWatchSnapshot(storage, watch).persisted, true);
  assert.deepEqual(readWatchSnapshot(storage), {
    available: true,
    snapshot: JSON.stringify(watch),
  });
  assert.equal(writeWatchSnapshot(storage, null).persisted, true);
  assert.equal(readWatchSnapshot(storage).snapshot, '');
});

test('same-origin shipment route returns parsed data instead of raw HTML', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      page: {
        updated_at: '2026-08-27T12:00:00-07:00',
        body_html: '<p>2026/8/27<br>AYN Thor Black Base: 2500xx--2516xx</p>',
      },
    });

  try {
    const response = await GET();
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.status, 'live');
    assert.equal(
      payload.days.find((day) => day.date === '2026-08-27').entries[0].endPrefix,
      2516,
    );
    assert.equal('body_html' in payload, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('same-origin shipment route reports an invalid upstream payload', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ page: {} });

  try {
    const response = await GET();
    const payload = await response.json();
    assert.equal(response.status, 502);
    assert.equal(payload.status, 'unavailable');
    assert.equal(payload.code, 'AYN_PAYLOAD');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
