import { SOURCE_JSON_URL, parseShipmentDashboard, type ShipmentDay } from '../../lib/shipments.ts';

const SOURCE_TIMEOUT_MS = 12_000;

type SourceErrorCode = 'AYN_HTTP' | 'AYN_NETWORK' | 'AYN_PAYLOAD' | 'AYN_SCHEMA' | 'AYN_TIMEOUT';

function unavailable(code: SourceErrorCode, checkedAt: string, status = 502) {
  return Response.json(
    {
      version: 1,
      status: 'unavailable',
      checkedAt,
      code,
      message: 'Live AYN shipment data is temporarily unavailable.',
    },
    {
      status,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

export const dynamic = 'force-dynamic';

export async function GET() {
  const checkedAt = new Date().toISOString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);

  try {
    const response = await fetch(SOURCE_JSON_URL, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return unavailable('AYN_HTTP', checkedAt);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return unavailable('AYN_PAYLOAD', checkedAt);
    }

    const page = (payload as { page?: { body_html?: unknown; updated_at?: unknown } } | null)?.page;
    if (typeof page?.body_html !== 'string' || page.body_html.length === 0) {
      return unavailable('AYN_PAYLOAD', checkedAt);
    }

    let days: ShipmentDay[];
    try {
      days = parseShipmentDashboard(page.body_html);
    } catch {
      return unavailable('AYN_SCHEMA', checkedAt);
    }
    if (days.length === 0) return unavailable('AYN_SCHEMA', checkedAt);

    return Response.json(
      {
        version: 1,
        status: 'live',
        checkedAt,
        sourceUpdatedAt: typeof page.updated_at === 'string' ? page.updated_at : null,
        days,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return unavailable(
      controller.signal.aborted ? 'AYN_TIMEOUT' : 'AYN_NETWORK',
      checkedAt,
      controller.signal.aborted ? 504 : 502,
    );
  } finally {
    clearTimeout(timeout);
  }
}
