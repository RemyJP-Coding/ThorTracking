import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const shipmentEntries = sqliteTable(
  'shipment_entries',
  {
    shipmentDate: text('shipment_date').notNull(),
    color: text('color').notNull(),
    model: text('model').notNull(),
    sourceVariant: text('source_variant').notNull(),
    startPrefix: integer('start_prefix').notNull(),
    endPrefix: integer('end_prefix').notNull(),
    firstSeenAt: text('first_seen_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.shipmentDate, table.color, table.model, table.startPrefix, table.endPrefix],
      name: 'shipment_entries_pk',
    }),
    index('idx_shipment_entries_date_seen').on(table.shipmentDate, table.lastSeenAt),
    check(
      'shipment_entries_color_check',
      sql`${table.color} in ('Black', 'White', 'Rainbow', 'Clear Purple')`,
    ),
    check(
      'shipment_entries_model_check',
      sql`${table.model} in ('lite', 'base', 'pro', 'max-512', 'max-1tb')`,
    ),
    check(
      'shipment_entries_prefix_check',
      sql`${table.startPrefix} between 1000 and 9999 and ${table.endPrefix} between ${table.startPrefix} and 9999`,
    ),
  ],
);

export const shipmentArchiveState = sqliteTable(
  'shipment_archive_state',
  {
    id: integer('id').primaryKey(),
    lastSuccessfulAt: text('last_successful_at').notNull(),
    sourceUpdatedAt: text('source_updated_at'),
    sourceFirstDate: text('source_first_date').notNull(),
    sourceLastDate: text('source_last_date').notNull(),
    sourceEntryCount: integer('source_entry_count').notNull(),
  },
  (table) => [
    check('shipment_archive_state_singleton_check', sql`${table.id} = 1`),
    check('shipment_archive_state_entry_count_check', sql`${table.sourceEntryCount} >= 0`),
  ],
);
