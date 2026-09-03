import {
  createD1ShipmentArchive,
  type ShipmentArchiveSnapshot,
  type ShipmentArchiveStore,
} from '../../lib/shipment-archive.ts';
import {
  FALLBACK_SHIPMENTS,
  SOURCE_JSON_URL,
  mergeShipmentDays,
  parseShipmentDashboard,
  type ShipmentDay,
} from '../../lib/shipments.ts';

const SOURCE_TIMEOUT_MS = 12_000;
const BUNDLED_ARCHIVE_OBSERVED_AT = '2026-08-26T00:00:00.000Z';

type SourceErrorCode = 'AYN_HTTP' | 'AYN_NETWORK' | 'AYN_PAYLOAD' | 'AYN_SCHEMA' | 'AYN_TIMEOUT';

type SourceResult =
  | {
      ok: true;
      sourceUpdatedAt: string | null;
      days: ShipmentDay[];
    }
  | {
      ok: false;
      code: SourceErrorCode;
      status: number;
    };

type ShipmentRouteOptions = {
  archive?: ShipmentArchiveStore | null;
  fetcher?: typeof fetch;
  now?: () => Date;
};

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function unavailable(code: SourceErrorCode, checkedAt: string, status = 502) {
  return json(
    {
      version: 2,
      status: 'unavailable',
      checkedAt,
      code,
      message: 'Live AYN shipment data is temporarily unavailable.',
    },
    status,
  );
}

async function fetchSource(fetcher: typeof fetch): Promise<SourceResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);

  try {
    const response = await fetcher(SOURCE_JSON_URL, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, code: 'AYN_HTTP', status: 502 };

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, code: 'AYN_PAYLOAD', status: 502 };
    }

    const page = (payload as { page?: { body_html?: unknown; updated_at?: unknown } } | null)?.page;
    if (typeof page?.body_html !== 'string' || page.body_html.length === 0) {
      return { ok: false, code: 'AYN_PAYLOAD', status: 502 };
    }

    let days: ShipmentDay[];
    try {
      days = parseShipmentDashboard(page.body_html);
    } catch {
      return { ok: false, code: 'AYN_SCHEMA', status: 502 };
    }
    if (days.length === 0) return { ok: false, code: 'AYN_SCHEMA', status: 502 };

    return {
      ok: true,
      sourceUpdatedAt: typeof page.updated_at === 'string' ? page.updated_at : null,
      days,
    };
  } catch {
    return {
      ok: false,
      code: controller.signal.aborted ? 'AYN_TIMEOUT' : 'AYN_NETWORK',
      status: controller.signal.aborted ? 504 : 502,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readArchive(archive: ShipmentArchiveStore | null) {
  if (!archive) return null;
  try {
    return await archive.read();
  } catch {
    return null;
  }
}

async function seedBundledHistory(archive: ShipmentArchiveStore | null) {
  if (!archive) return null;
  try {
    await archive.seed(FALLBACK_SHIPMENTS, BUNDLED_ARCHIVE_OBSERVED_AT);
    return await archive.read();
  } catch {
    return null;
  }
}

function retainedDayCount(days: ShipmentDay[], sourceDays: ShipmentDay[]) {
  const sourceDates = new Set(sourceDays.map((day) => day.date));
  return days.reduce((count, day) => count + (sourceDates.has(day.date) ? 0 : 1), 0);
}

function archivedResponse(
  source: Extract<SourceResult, { ok: false }>,
  checkedAt: string,
  archive: ShipmentArchiveSnapshot,
) {
  const days = mergeShipmentDays(FALLBACK_SHIPMENTS, archive.days);
  return json({
    version: 2,
    status: 'archived',
    checkedAt,
    archivedAt: archive.lastSuccessfulAt,
    sourceUpdatedAt: archive.sourceUpdatedAt,
    code: source.code,
    message: 'AYN is temporarily unavailable. Showing saved shipment history.',
    history: {
      persisted: true,
      totalDayCount: days.length,
      retainedDayCount: days.length,
    },
    days,
  });
}

async function getRuntimeArchive(): Promise<ShipmentArchiveStore | null> {
  try {
    const { env } = await import('cloudflare:workers');
    const database = (env as unknown as { DB?: D1Database }).DB;
    return database ? createD1ShipmentArchive(database) : null;
  } catch {
    return null;
  }
}

export const dynamic = 'force-dynamic';

export async function handleShipmentRequest(options: ShipmentRouteOptions = {}) {
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const fetcher = options.fetcher ?? fetch;
  const archive = options.archive ?? null;
  const [source, initialArchive] = await Promise.all([fetchSource(fetcher), readArchive(archive)]);
  let savedArchive = initialArchive;

  if (!savedArchive) savedArchive = await seedBundledHistory(archive);

  if (!source.ok) {
    return savedArchive?.days.length
      ? archivedResponse(source, checkedAt, savedArchive)
      : unavailable(source.code, checkedAt, source.status);
  }

  let archivePersisted = false;
  if (archive) {
    try {
      await archive.save({
        days: source.days,
        checkedAt,
        sourceUpdatedAt: source.sourceUpdatedAt,
      });
      savedArchive = await archive.read();
      archivePersisted = Boolean(savedArchive?.days.length);
    } catch {
      archivePersisted = false;
    }
  }

  const days = mergeShipmentDays(FALLBACK_SHIPMENTS, savedArchive?.days ?? [], source.days);

  return json({
    version: 2,
    status: 'live',
    checkedAt,
    archivedAt: savedArchive?.lastSuccessfulAt ?? null,
    sourceUpdatedAt: source.sourceUpdatedAt,
    history: {
      persisted: archivePersisted,
      totalDayCount: days.length,
      retainedDayCount: retainedDayCount(days, source.days),
    },
    days,
  });
}

export async function GET() {
  return handleShipmentRequest({ archive: await getRuntimeArchive() });
}
