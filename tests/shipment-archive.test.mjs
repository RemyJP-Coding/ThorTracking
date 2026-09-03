import assert from 'node:assert/strict';
import test from 'node:test';

import { handleShipmentRequest } from '../app/api/shipments/route.ts';
import { mergeShipmentDays } from '../app/lib/shipments.ts';

function shipment(date, color, model, startPrefix, endPrefix) {
  return {
    date,
    entries: [
      {
        color,
        model,
        sourceVariant: `${color} ${model === 'base' ? 'Base' : model}`,
        startPrefix,
        endPrefix,
      },
    ],
  };
}

function sourceResponse(date, range) {
  return Response.json({
    page: {
      updated_at: `${date}T12:00:00Z`,
      body_html: `<p>${date.replaceAll('-', '/')}<br>AYN Thor Black Base: ${range}</p>`,
    },
  });
}

test('serves the shared archive with a successful response when AYN is unavailable', async () => {
  const archivedDays = [shipment('2026-09-01', 'Black', 'base', 2600, 2620)];
  const archive = {
    async read() {
      return {
        days: archivedDays,
        lastSuccessfulAt: '2026-09-01T15:00:00.000Z',
        sourceUpdatedAt: '2026-09-01T14:00:00.000Z',
      };
    },
    async seed() {
      throw new Error('existing archive should not be seeded');
    },
    async save() {
      throw new Error('an unavailable source should not be saved');
    },
  };

  const response = await handleShipmentRequest({
    archive,
    fetcher: async () => {
      throw new TypeError('offline');
    },
    now: () => new Date('2026-09-03T20:00:00.000Z'),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.status, 'archived');
  assert.equal(payload.code, 'AYN_NETWORK');
  assert.deepEqual(payload.days.at(-1), archivedDays[0]);
  assert.ok(payload.days.length > archivedDays.length);
  assert.equal(payload.history.persisted, true);
});

test('retains archived days that have fallen out of the current source window', async () => {
  const oldDay = shipment('2026-09-01', 'Black', 'base', 2600, 2620);
  const currentDay = shipment('2026-09-03', 'Black', 'base', 2621, 2650);
  let snapshot = {
    days: [oldDay],
    lastSuccessfulAt: '2026-09-01T15:00:00.000Z',
    sourceUpdatedAt: '2026-09-01T14:00:00.000Z',
  };
  let savedSourceDays = [];
  const archive = {
    async read() {
      return snapshot;
    },
    async seed() {
      throw new Error('existing archive should not be seeded');
    },
    async save(input) {
      savedSourceDays = input.days;
      snapshot = {
        days: mergeShipmentDays(snapshot.days, input.days),
        lastSuccessfulAt: input.checkedAt,
        sourceUpdatedAt: input.sourceUpdatedAt,
      };
    },
  };

  const response = await handleShipmentRequest({
    archive,
    fetcher: async () => sourceResponse('2026-09-03', '2621xx--2650xx'),
    now: () => new Date('2026-09-03T20:00:00.000Z'),
  });
  const payload = await response.json();

  assert.equal(payload.status, 'live');
  assert.equal(payload.history.persisted, true);
  assert.ok(payload.history.retainedDayCount >= 1);
  assert.equal(savedSourceDays.length, 1);
  assert.ok(payload.days.some((day) => day.date === oldDay.date));
  assert.deepEqual(payload.days.at(-1), currentDay);
});
