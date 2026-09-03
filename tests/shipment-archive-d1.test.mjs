import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { Miniflare } from 'miniflare';

import { createD1ShipmentArchive } from '../app/lib/shipment-archive.ts';

function shipment(date, startPrefix, endPrefix) {
  return {
    date,
    entries: [
      {
        color: 'Black',
        model: 'base',
        sourceVariant: 'Black Base',
        startPrefix,
        endPrefix,
      },
    ],
  };
}

test('D1 archive preserves dropped days and keeps the last observed version of a corrected day', async (context) => {
  const miniflare = new Miniflare({
    compatibilityDate: '2026-05-15',
    d1Databases: ['DB'],
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } }',
  });
  context.after(() => miniflare.dispose());

  const database = await miniflare.getD1Database('DB');
  const migration = await readFile(
    new URL('../drizzle/0000_fantastic_lionheart.sql', import.meta.url),
    'utf8',
  );
  for (const statement of migration.split('--> statement-breakpoint')) {
    const sql = statement.trim();
    if (sql) await database.prepare(sql).run();
  }

  const archive = createD1ShipmentArchive(database);
  await archive.seed([shipment('2026-09-01', 2600, 2620)], '2026-09-01T12:00:00.000Z');
  await archive.save({
    days: [
      shipment('2026-09-01', 2600, 2625),
      shipment('2026-09-02', 2626, 2640),
    ],
    checkedAt: '2026-09-02T12:00:00.000Z',
    sourceUpdatedAt: '2026-09-02T11:00:00.000Z',
  });
  await archive.save({
    days: [shipment('2026-09-03', 2641, 2660)],
    checkedAt: '2026-09-03T12:00:00.000Z',
    sourceUpdatedAt: '2026-09-03T11:00:00.000Z',
  });

  const snapshot = await archive.read();
  assert.ok(snapshot);
  assert.deepEqual(snapshot.days.map((day) => day.date), [
    '2026-09-01',
    '2026-09-02',
    '2026-09-03',
  ]);
  assert.equal(snapshot.days[0].entries.length, 1);
  assert.equal(snapshot.days[0].entries[0].endPrefix, 2625);
  assert.equal(snapshot.lastSuccessfulAt, '2026-09-03T12:00:00.000Z');

  const observationCount = await database
    .prepare('SELECT COUNT(*) AS count FROM shipment_entries WHERE shipment_date = ?')
    .bind('2026-09-01')
    .first();
  assert.equal(observationCount.count, 2);
});
