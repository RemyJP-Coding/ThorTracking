import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeShipmentTrend } from '../app/lib/shipments.ts';

function shipment(date, rows) {
  return {
    date,
    entries: rows.map(([color, model, startPrefix, endPrefix]) => ({
      color,
      model,
      sourceVariant: `${color} ${model}`,
      startPrefix,
      endPrefix,
    })),
  };
}

function pointMetrics(summary) {
  return summary.points.map((point) => ({
    date: point.date,
    startPrefix: point.startPrefix,
    endPrefix: point.endPrefix,
    deltaFromPrevious: point.deltaFromPrevious,
    daysFromPrevious: point.daysFromPrevious,
    frontierIncrease: point.frontierIncrease,
  }));
}

test('summarizes irregularly spaced updates over their UTC calendar span', () => {
  const summary = summarizeShipmentTrend(
    [
      shipment('2026-01-10', [['Black', 'base', 1031, 1045]]),
      shipment('2026-01-01', [['Black', 'base', 990, 1000]]),
      shipment('2026-01-03', [['Black', 'base', 1001, 1010]]),
    ],
    'Black',
    'base',
  );

  assert.deepEqual(pointMetrics(summary), [
    { date: '2026-01-01', startPrefix: 990, endPrefix: 1000, deltaFromPrevious: null, daysFromPrevious: null, frontierIncrease: 0 },
    { date: '2026-01-03', startPrefix: 1001, endPrefix: 1010, deltaFromPrevious: 10, daysFromPrevious: 2, frontierIncrease: 10 },
    { date: '2026-01-10', startPrefix: 1031, endPrefix: 1045, deltaFromPrevious: 35, daysFromPrevious: 7, frontierIncrease: 35 },
  ]);
  assert.equal(summary.updateCount, 3);
  assert.equal(summary.spanDays, 9);
  assert.equal(summary.totalAdvance, 45);
  assert.equal(summary.averagePerDay, 5);
  assert.equal(summary.averagePer7Days, 35);
  assert.equal(summary.averagePer30Days, 150);
});

test('collapses duplicate exact-configuration rows to the greatest endpoint', () => {
  const summary = summarizeShipmentTrend(
    [
      shipment('2026-02-01', [
        ['Black', 'base', 1180, 1200],
        ['Black', 'base', 1201, 1220],
        ['Black', 'base', 1195, 1220],
      ]),
      shipment('2026-02-05', [['Black', 'base', 1221, 1240]]),
    ],
    'Black',
    'base',
  );

  assert.deepEqual(pointMetrics(summary), [
    { date: '2026-02-01', startPrefix: 1195, endPrefix: 1220, deltaFromPrevious: null, daysFromPrevious: null, frontierIncrease: 0 },
    { date: '2026-02-05', startPrefix: 1221, endPrefix: 1240, deltaFromPrevious: 20, daysFromPrevious: 4, frontierIncrease: 20 },
  ]);
  assert.equal(summary.updateCount, 2);
  assert.equal(summary.spanDays, 4);
  assert.equal(summary.totalAdvance, 20);
  assert.equal(summary.averagePerDay, 5);
  assert.equal(summary.averagePer7Days, 35);
  assert.equal(summary.averagePer30Days, 150);
});

test('isolates pace calculations to the selected color and model', () => {
  const summary = summarizeShipmentTrend(
    [
      shipment('2026-03-01', [
        ['Black', 'base', 1490, 1500],
        ['White', 'base', 8000, 9000],
        ['Black', 'pro', 7000, 7500],
      ]),
      shipment('2026-03-08', [
        ['Black', 'base', 1501, 1570],
        ['White', 'base', 9001, 9999],
        ['Black', 'pro', 7501, 8000],
      ]),
    ],
    'Black',
    'base',
  );

  assert.deepEqual(summary.points.map(({ color, model, endPrefix }) => ({ color, model, endPrefix })), [
    { color: 'Black', model: 'base', endPrefix: 1500 },
    { color: 'Black', model: 'base', endPrefix: 1570 },
  ]);
  assert.equal(summary.totalAdvance, 70);
  assert.equal(summary.averagePerDay, 10);
  assert.equal(summary.averagePer7Days, 70);
  assert.equal(summary.averagePer30Days, 300);
});

test('keeps plateau and correction deltas without reducing frontier pace', () => {
  const summary = summarizeShipmentTrend(
    [
      shipment('2026-04-01', [['Black', 'base', 1990, 2000]]),
      shipment('2026-04-03', [['Black', 'base', 1990, 2000]]),
      shipment('2026-04-05', [['Black', 'base', 1970, 1980]]),
      shipment('2026-04-08', [['Black', 'base', 2001, 2035]]),
    ],
    'Black',
    'base',
  );

  assert.deepEqual(summary.points.map(({ deltaFromPrevious, daysFromPrevious, frontierIncrease }) => ({ deltaFromPrevious, daysFromPrevious, frontierIncrease })), [
    { deltaFromPrevious: null, daysFromPrevious: null, frontierIncrease: 0 },
    { deltaFromPrevious: 0, daysFromPrevious: 2, frontierIncrease: 0 },
    { deltaFromPrevious: -20, daysFromPrevious: 2, frontierIncrease: 0 },
    { deltaFromPrevious: 55, daysFromPrevious: 3, frontierIncrease: 35 },
  ]);
  assert.equal(summary.updateCount, 4);
  assert.equal(summary.spanDays, 7);
  assert.equal(summary.totalAdvance, 35);
  assert.equal(summary.averagePerDay, 5);
  assert.equal(summary.averagePer7Days, 35);
  assert.equal(summary.averagePer30Days, 150);
});

test('returns an empty summary when the selected configuration has no updates', () => {
  const summary = summarizeShipmentTrend(
    [shipment('2026-05-01', [['White', 'pro', 2400, 2450]])],
    'Black',
    'base',
  );

  assert.deepEqual(summary, {
    points: [],
    updateCount: 0,
    spanDays: 0,
    totalAdvance: 0,
    averagePerDay: null,
    averagePer7Days: null,
    averagePer30Days: null,
  });
});

test('withholds pace averages when only one update is available', () => {
  const summary = summarizeShipmentTrend(
    [shipment('2026-05-07', [['Black', 'base', 2490, 2500]])],
    'Black',
    'base',
  );

  assert.deepEqual(pointMetrics(summary), [
    { date: '2026-05-07', startPrefix: 2490, endPrefix: 2500, deltaFromPrevious: null, daysFromPrevious: null, frontierIncrease: 0 },
  ]);
  assert.equal(summary.updateCount, 1);
  assert.equal(summary.spanDays, 0);
  assert.equal(summary.totalAdvance, 0);
  assert.equal(summary.averagePerDay, null);
  assert.equal(summary.averagePer7Days, null);
  assert.equal(summary.averagePer30Days, null);
});
