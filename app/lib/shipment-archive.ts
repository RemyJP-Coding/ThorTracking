import { COLORS, MODELS, type ModelId, type ShipmentDay, type ShipmentEntry, type ThorColor } from './shipments.ts';

export type ShipmentArchiveSnapshot = {
  days: ShipmentDay[];
  lastSuccessfulAt: string | null;
  sourceUpdatedAt: string | null;
};

export type ShipmentArchiveStore = {
  read(): Promise<ShipmentArchiveSnapshot | null>;
  seed(days: ShipmentDay[], observedAt: string): Promise<void>;
  save(snapshot: {
    days: ShipmentDay[];
    checkedAt: string;
    sourceUpdatedAt: string | null;
  }): Promise<void>;
};

type ShipmentEntryRow = {
  shipment_date: string;
  color: string;
  model: string;
  source_variant: string;
  start_prefix: number;
  end_prefix: number;
  last_seen_at: string;
};

type ShipmentArchiveStateRow = {
  last_successful_at: string;
  source_updated_at: string | null;
};

const UPSERT_BATCH_SIZE = 75;

const UPSERT_ENTRY_SQL = `
  INSERT INTO shipment_entries (
    shipment_date,
    color,
    model,
    source_variant,
    start_prefix,
    end_prefix,
    first_seen_at,
    last_seen_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (shipment_date, color, model, start_prefix, end_prefix) DO UPDATE SET
    source_variant = CASE
      WHEN excluded.last_seen_at >= shipment_entries.last_seen_at THEN excluded.source_variant
      ELSE shipment_entries.source_variant
    END,
    first_seen_at = MIN(shipment_entries.first_seen_at, excluded.first_seen_at),
    last_seen_at = MAX(shipment_entries.last_seen_at, excluded.last_seen_at)
`;

const READ_ENTRIES_SQL = `
  SELECT
    entries.shipment_date,
    entries.color,
    entries.model,
    entries.source_variant,
    entries.start_prefix,
    entries.end_prefix,
    entries.last_seen_at
  FROM shipment_entries AS entries
  INNER JOIN (
    SELECT shipment_date, MAX(last_seen_at) AS last_seen_at
    FROM shipment_entries
    GROUP BY shipment_date
  ) AS latest
    ON latest.shipment_date = entries.shipment_date
    AND latest.last_seen_at = entries.last_seen_at
  ORDER BY
    entries.shipment_date ASC,
    entries.color ASC,
    entries.model ASC,
    entries.start_prefix ASC,
    entries.end_prefix ASC
`;

const READ_STATE_SQL = `
  SELECT last_successful_at, source_updated_at
  FROM shipment_archive_state
  WHERE id = 1
`;

const UPSERT_STATE_SQL = `
  INSERT INTO shipment_archive_state (
    id,
    last_successful_at,
    source_updated_at,
    source_first_date,
    source_last_date,
    source_entry_count
  ) VALUES (1, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET
    last_successful_at = MAX(shipment_archive_state.last_successful_at, excluded.last_successful_at),
    source_updated_at = CASE
      WHEN excluded.last_successful_at >= shipment_archive_state.last_successful_at THEN excluded.source_updated_at
      ELSE shipment_archive_state.source_updated_at
    END,
    source_first_date = CASE
      WHEN excluded.last_successful_at >= shipment_archive_state.last_successful_at THEN excluded.source_first_date
      ELSE shipment_archive_state.source_first_date
    END,
    source_last_date = CASE
      WHEN excluded.last_successful_at >= shipment_archive_state.last_successful_at THEN excluded.source_last_date
      ELSE shipment_archive_state.source_last_date
    END,
    source_entry_count = CASE
      WHEN excluded.last_successful_at >= shipment_archive_state.last_successful_at THEN excluded.source_entry_count
      ELSE shipment_archive_state.source_entry_count
    END
`;

function isThorColor(value: string): value is ThorColor {
  return COLORS.includes(value as ThorColor);
}

function isModelId(value: string): value is ModelId {
  return MODELS.some((model) => model.id === value);
}

function rowsToDays(rows: ShipmentEntryRow[]): ShipmentDay[] {
  const days = new Map<string, ShipmentEntry[]>();

  for (const row of rows) {
    if (!isThorColor(row.color) || !isModelId(row.model)) continue;
    const entries = days.get(row.shipment_date) ?? [];
    entries.push({
      color: row.color,
      model: row.model,
      sourceVariant: row.source_variant,
      startPrefix: row.start_prefix,
      endPrefix: row.end_prefix,
    });
    days.set(row.shipment_date, entries);
  }

  return [...days.entries()].map(([date, entries]) => ({ date, entries }));
}

function uniqueEntries(days: ShipmentDay[]) {
  const entries = new Map<string, { date: string; entry: ShipmentEntry }>();

  for (const day of days) {
    for (const item of day.entries) {
      const key = `${day.date}\u0000${item.color}\u0000${item.model}\u0000${item.startPrefix}\u0000${item.endPrefix}`;
      entries.set(key, { date: day.date, entry: item });
    }
  }

  return [...entries.values()];
}

async function upsertEntries(database: D1Database, days: ShipmentDay[], observedAt: string) {
  const entries = uniqueEntries(days);

  for (let offset = 0; offset < entries.length; offset += UPSERT_BATCH_SIZE) {
    const statements = entries.slice(offset, offset + UPSERT_BATCH_SIZE).map(({ date, entry }) =>
      database
        .prepare(UPSERT_ENTRY_SQL)
        .bind(
          date,
          entry.color,
          entry.model,
          entry.sourceVariant,
          entry.startPrefix,
          entry.endPrefix,
          observedAt,
          observedAt,
        ),
    );
    await database.batch(statements);
  }
}

export function createD1ShipmentArchive(database: D1Database): ShipmentArchiveStore {
  return {
    async read() {
      const results = await database.batch([
        database.prepare(READ_ENTRIES_SQL),
        database.prepare(READ_STATE_SQL),
      ]);
      const entryRows = (results[0]?.results ?? []) as unknown as ShipmentEntryRow[];
      if (entryRows.length === 0) return null;

      const state = (results[1]?.results?.[0] ?? null) as ShipmentArchiveStateRow | null;
      const lastObservedAt = entryRows.reduce(
        (latest, row) => (row.last_seen_at > latest ? row.last_seen_at : latest),
        '',
      );

      return {
        days: rowsToDays(entryRows),
        lastSuccessfulAt: state?.last_successful_at ?? lastObservedAt,
        sourceUpdatedAt: state?.source_updated_at ?? null,
      };
    },

    async seed(days, observedAt) {
      await upsertEntries(database, days, observedAt);
    },

    async save({ days, checkedAt, sourceUpdatedAt }) {
      await upsertEntries(database, days, checkedAt);
      const entryCount = days.reduce((total, day) => total + day.entries.length, 0);
      const sourceFirstDate = days[0]?.date ?? checkedAt.slice(0, 10);
      const sourceLastDate = days[days.length - 1]?.date ?? sourceFirstDate;

      await database
        .prepare(UPSERT_STATE_SQL)
        .bind(checkedAt, sourceUpdatedAt, sourceFirstDate, sourceLastDate, entryCount)
        .run();
    },
  };
}
