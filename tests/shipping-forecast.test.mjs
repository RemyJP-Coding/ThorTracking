import assert from 'node:assert/strict';
import test from 'node:test';

import { predictShippingWindow } from '../app/lib/shipments.ts';

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

const blackBaseWatch = (prefix) => ({ prefix, color: 'Black', model: 'base' });

test('builds an inclusive seven-day window from a monotone exact-variant frontier', () => {
  const days = [
    shipment('2026-01-01', [['Black', 'base', 1980, 2000]]),
    shipment('2026-01-03', [['Black', 'base', 2001, 2020]]),
    shipment('2026-01-04', [['Black', 'base', 1990, 2015]]),
    shipment('2026-01-07', [
      ['Black', 'base', 2021, 2025],
      ['Black', 'base', 2021, 2030],
    ]),
    shipment('2026-01-10', [['White', 'base', 8000, 9000]]),
  ];

  const forecast = predictShippingWindow(days, blackBaseWatch(2040), '2026-01-10');

  assert.ok(forecast);
  assert.equal(forecast.latestPrefix, 2030);
  assert.equal(forecast.gap, 10);
  assert.equal(forecast.intervalCount, 2);
  assert.equal(forecast.confidence, 'low');
  assert.equal(forecast.sourceDate, '2026-01-10');
  assert.equal(
    (Date.parse(`${forecast.windowEnd}T00:00:00Z`) - Date.parse(`${forecast.windowStart}T00:00:00Z`)) /
      (24 * 60 * 60 * 1000),
    6,
  );
  assert.ok(forecast.windowStart > forecast.asOfDate);
});

test('does not let another color or model change the forecast', () => {
  const exactOnly = [
    shipment('2026-02-01', [['Black', 'pro', 2450, 2500]]),
    shipment('2026-02-08', [['Black', 'pro', 2501, 2540]]),
    shipment('2026-02-15', [['Black', 'pro', 2541, 2580]]),
  ];
  const withUnrelatedSurges = exactOnly.map((day) => ({
    ...day,
    entries: [
      ...day.entries,
      {
        color: 'White',
        model: 'max-1tb',
        sourceVariant: 'White Max',
        startPrefix: 1000,
        endPrefix: 9000,
      },
    ],
  }));
  const watch = { prefix: 2600, color: 'Black', model: 'pro' };

  assert.deepEqual(
    predictShippingWindow(withUnrelatedSurges, watch, '2026-02-15'),
    predictShippingWindow(exactOnly, watch, '2026-02-15'),
  );
});

test('marks a forecast based on only one advancing interval as very low confidence', () => {
  const days = [
    shipment('2026-03-01', [['Black', 'base', 1980, 2000]]),
    shipment('2026-03-08', [['Black', 'base', 2001, 2040]]),
  ];

  const forecast = predictShippingWindow(days, blackBaseWatch(2060), '2026-03-08');

  assert.ok(forecast);
  assert.equal(forecast.intervalCount, 1);
  assert.equal(forecast.confidence, 'very-low');
});

test('keeps a longer extrapolation when it remains inside the 90-day ceiling', () => {
  const days = [
    shipment('2026-04-01', [['Black', 'base', 1980, 2000]]),
    shipment('2026-04-08', [['Black', 'base', 2001, 2040]]),
    shipment('2026-04-15', [['Black', 'base', 2041, 2080]]),
  ];

  const forecast = predictShippingWindow(days, blackBaseWatch(2280), '2026-04-15');

  assert.ok(forecast);
  assert.equal(forecast.gap, 200);
  assert.equal(forecast.confidence, 'low');
});

test('withholds estimates for listed, beyond-90-day, and stale orders', () => {
  const days = [
    shipment('2026-01-01', [['Black', 'base', 1980, 2000]]),
    shipment('2026-01-08', [['Black', 'base', 2001, 2040]]),
  ];

  assert.equal(predictShippingWindow(days, blackBaseWatch(2030), '2026-01-08'), null);
  assert.equal(predictShippingWindow(days, blackBaseWatch(2600), '2026-01-08'), null);
  assert.equal(predictShippingWindow(days, blackBaseWatch(2060), '2026-03-01'), null);
});

test('withholds a forecast when only unrelated configurations have moved recently', () => {
  const days = [
    shipment('2026-01-01', [['Black', 'base', 1980, 2000]]),
    shipment('2026-01-08', [['Black', 'base', 2001, 2040]]),
    shipment('2026-03-01', [['White', 'pro', 2500, 2600]]),
  ];

  assert.equal(predictShippingWindow(days, blackBaseWatch(2060), '2026-03-01'), null);
});
