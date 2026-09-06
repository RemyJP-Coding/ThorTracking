import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assessShippingForecast,
  explainForecastChange,
  forecastUnavailableCopy,
  localCalendarDate,
  predictShippingWindow,
} from '../app/lib/shipments.ts';

const watch = (prefix = 2160) => ({ prefix, color: 'Black', model: 'base' });
const row = (date, endPrefix, startPrefix = endPrefix - 20, color = 'Black', model = 'base') => ({
  date,
  entries: [{ color, model, sourceVariant: `${color} ${model}`, startPrefix, endPrefix }],
});
const steady = [row('2026-01-01', 2000), row('2026-01-08', 2040), row('2026-01-15', 2080), row('2026-01-22', 2120)];
const afterDays = (date, amount) => new Date(Date.parse(`${date}T00:00:00Z`) + amount * 86400000).toISOString().slice(0, 10);
const reason = (days, savedWatch, today) => {
  const assessment = assessShippingForecast(days, savedWatch, today);
  assert.equal(assessment.kind, 'unavailable');
  assert.equal(predictShippingWindow(days, savedWatch, today), null);
  return assessment.reason;
};

test('assessment preserves the complete existing forecast and exposes its computed evidence', () => {
  const result = assessShippingForecast(steady, watch(), '2026-01-22');
  assert.equal(result.kind, 'available');
  assert.deepEqual(result.forecast, {
    windowStart: '2026-01-26', windowEnd: '2026-02-01', asOfDate: '2026-01-22',
    sourceDate: '2026-01-22', lastVariantDate: '2026-01-22', ratePerDay: 40 / 7,
    intervalCount: 3, latestPrefix: 2120, gap: 40, confidence: 'moderate',
  });
  assert.deepEqual(predictShippingWindow(steady, watch(), '2026-01-22'), result.forecast);
  assert.deepEqual(result.evidence, {
    sourceDate: '2026-01-22', lastAdvanceDate: '2026-01-22', latestPrefix: 2120,
    gap: 40, ratePerDay: 40 / 7, intervalCount: 3, historySpanDays: 21,
    observedMovement: 120, projectedDays: 7, sourceAgeDays: 0, observationCount: 4,
  });
});

test('missing data and exact configuration precede every other unavailable reason', () => {
  assert.equal(reason([], watch(), '2026-05-01'), 'no-data');
  assert.equal(reason([row('2026-01-01', 2000, 1980, 'White')], watch(), '2026-05-01'), 'no-configuration');
  const empty = assessShippingForecast([], watch(), '2026-01-22');
  assert.equal(empty.evidence.latestPrefix, null);
  assert.equal(empty.evidence.ratePerDay, null);
  assert.equal(empty.evidence.observationCount, 0);
});

test('explicit listing and an unlisted passed prefix take precedence over stale or insufficient history', () => {
  const one = [row('2026-01-01', 2000)];
  assert.equal(reason(one, watch(1990), '2026-05-01'), 'listed');
  assert.equal(reason(one, watch(1900), '2026-05-01'), 'passed');
  assert.equal(reason([row('2026-01-01', 2000), row('2026-01-08', 2040, 2020)], watch(2010), '2026-01-08'), 'passed');
  assert.match(forecastUnavailableCopy('passed'), /does not confirm shipment/);
});

test('the 28-day inactivity boundary is inclusive and precedes insufficient history or a long horizon', () => {
  assert.equal(assessShippingForecast(steady, watch(), afterDays('2026-01-22', 28)).kind, 'available');
  assert.equal(reason(steady, watch(), afterDays('2026-01-22', 29)), 'configuration-inactive');
  assert.equal(reason(steady, watch(9999), afterDays('2026-01-22', 29)), 'configuration-inactive');
  const one = [row('2026-01-22', 2120)];
  assert.equal(reason(one, watch(), afterDays('2026-01-22', 28)), 'insufficient-history');
  assert.equal(reason(one, watch(), afterDays('2026-01-22', 29)), 'configuration-inactive');
});

test('source staleness wins above 45 days while the 45th day still reports configuration inactivity', () => {
  assert.equal(reason(steady, watch(), afterDays('2026-01-22', 45)), 'configuration-inactive');
  assert.equal(reason(steady, watch(), afterDays('2026-01-22', 46)), 'source-stale');
  assert.equal(reason([row('2026-01-22', 2120)], watch(9999), afterDays('2026-01-22', 46)), 'source-stale');
});

test('one advancing interval is enough, while flat or backward endpoints are insufficient history', () => {
  const two = steady.slice(0, 2);
  const available = assessShippingForecast(two, watch(2060), '2026-01-08');
  assert.equal(available.kind, 'available');
  assert.equal(available.forecast.confidence, 'very-low');
  const flat = [row('2026-01-01', 2000), row('2026-01-08', 2000), row('2026-01-10', 1990)];
  const insufficient = assessShippingForecast(flat, watch(), '2026-01-10');
  assert.equal(insufficient.kind, 'unavailable');
  assert.equal(insufficient.reason, 'insufficient-history');
  assert.equal(insufficient.evidence.lastAdvanceDate, '2026-01-01');
  assert.equal(insufficient.evidence.latestPrefix, 2000);
  assert.equal(insufficient.evidence.intervalCount, 0);
});

test('the 90-day projection ceiling is inclusive', () => {
  const tenPerDay = [row('2026-02-01', 2000), row('2026-02-02', 2010)];
  const atLimit = assessShippingForecast(tenPerDay, watch(2910), '2026-02-02');
  assert.equal(atLimit.kind, 'available');
  assert.equal(atLimit.evidence.projectedDays, 90);
  const beyond = assessShippingForecast(tenPerDay, watch(2911), '2026-02-02');
  assert.equal(beyond.kind, 'unavailable');
  assert.equal(beyond.reason, 'beyond-horizon');
  assert.equal(beyond.evidence.projectedDays, 91);
});

test('invalid observation timing produces an unusable pace without claiming a rate', () => {
  const invalidTiming = [row('2026-01-00', 2000), row('2026-01-08', 2040)];
  const result = assessShippingForecast(invalidTiming, watch(), '2026-01-08');
  assert.equal(result.kind, 'unavailable');
  assert.equal(result.reason, 'unusable-pace');
  assert.equal(result.evidence.ratePerDay, null);
});

test('duplicate dates and backward ranges do not invent progress or affect a published-day endpoint', () => {
  const extended = steady.map((day) => ({ ...day, entries: [...day.entries, { ...day.entries[0], endPrefix: day.entries[0].endPrefix - 10 }] }));
  extended.push(row('2026-01-20', 2001));
  assert.deepEqual(assessShippingForecast(extended, watch(), '2026-01-22'), assessShippingForecast(steady, watch(), '2026-01-22'));
});

test('calendar-only shifts are explicitly distinguished from shipment movement', () => {
  const before = assessShippingForecast(steady, watch(), '2026-01-22');
  const nextDay = assessShippingForecast(steady, watch(), '2026-01-23');
  const explanations = explainForecastChange(before, nextDay);
  assert.match(explanations.join(' '), /moved 1 day later/);
  assert.match(explanations.join(' '), /evaluation date changed.*unchanged shipment evidence/);
  assert.doesNotMatch(explanations.join(' '), /endpoint advanced|pace increased/);
  assert.deepEqual(explainForecastChange(before, before), ['The forecast assessment is unchanged.']);
});

test('a new unrelated dashboard day can slow the estimate without claiming configuration progress', () => {
  const before = assessShippingForecast(steady, watch(), '2026-01-22');
  const updated = [...steady, row('2026-02-05', 9000, 8000, 'White', 'pro')];
  const after = assessShippingForecast(updated, watch(), '2026-02-05');
  assert.equal(after.kind, 'available');
  assert.equal(after.evidence.latestPrefix, before.evidence.latestPrefix);
  assert.ok(after.evidence.ratePerDay < before.evidence.ratePerDay);
  const explanations = explainForecastChange(before, after).join(' ');
  assert.match(explanations, /observed pace decreased/);
  assert.match(explanations, /dashboard date changed.*endpoint did not advance/);
  assert.doesNotMatch(explanations, /unchanged shipment evidence|endpoint advanced/);
  const sameDatedRows = steady.map((day) => ({ ...day, entries: [...day.entries, row(day.date, 9000, 8000, 'White', 'pro').entries[0]] }));
  assert.deepEqual(assessShippingForecast(sameDatedRows, watch(), '2026-01-22'), before);
});

test('changed inputs explain gap, pace, and earlier or later windows as facts', () => {
  const before = assessShippingForecast(steady, watch(2250), '2026-01-22');
  const advanced = assessShippingForecast([...steady, row('2026-01-23', 2160, 2121), row('2026-01-24', 2220, 2161)], watch(2250), '2026-01-24');
  const explanation = explainForecastChange(before, advanced).join(' ');
  assert.match(explanation, /days earlier/);
  assert.match(explanation, /endpoint advanced by 100 prefix steps/);
  assert.match(explanation, /gap narrowed from 130 to 30/);
  assert.match(explanation, /observed pace increased/);
});

test('availability, confidence, and staleness transitions have explicit explanations', () => {
  const before = assessShippingForecast(steady.slice(0, 1), watch(), '2026-01-01');
  const ready = assessShippingForecast(steady, watch(), '2026-01-22');
  assert.match(explainForecastChange(before, ready).join(' '), /estimate is now available/);
  const aged = assessShippingForecast(steady, watch(), afterDays('2026-01-22', 15));
  assert.match(explainForecastChange(ready, aged).join(' '), /confidence label changed from moderate to low/);
  const stale = assessShippingForecast(steady, watch(), afterDays('2026-01-22', 29));
  assert.match(explainForecastChange(ready, stale).join(' '), /has not advanced for more than 28 days/);
  assert.match(explainForecastChange(ready, stale).join(' '), /unchanged shipment evidence/);
  const listed = assessShippingForecast([...steady, row('2026-01-23', 2160, 2121)], watch(), '2026-01-23');
  assert.match(explainForecastChange(ready, listed).join(' '), /explicitly listed/);
});

test('all unavailable reasons have user-facing copy, and calendar dates use local date parts', () => {
  for (const code of ['no-data', 'no-configuration', 'listed', 'passed', 'source-stale', 'configuration-inactive', 'insufficient-history', 'unusable-pace', 'beyond-horizon']) {
    assert.ok(forecastUnavailableCopy(code).length > 20);
  }
  assert.equal(localCalendarDate(new Date(2026, 0, 2, 23, 59)), '2026-01-02');
});

