export const SOURCE_PAGE_URL = 'https://www.ayntec.com/pages/shipment-dashboard';
export const SOURCE_JSON_URL = `${SOURCE_PAGE_URL}.json`;

export const COLORS = ['Black', 'White', 'Rainbow', 'Clear Purple'] as const;
export type ThorColor = (typeof COLORS)[number];

export const MODELS = [
  { id: 'lite', label: 'Lite', detail: '8+128GB' },
  { id: 'base', label: 'Base', detail: '8+128GB' },
  { id: 'pro', label: 'Pro', detail: '12+256GB' },
  { id: 'max-512', label: 'Max', detail: '16+512GB' },
  { id: 'max-1tb', label: 'Max', detail: '16+1TB' },
] as const;

export type ModelId = (typeof MODELS)[number]['id'];

export type ShipmentEntry = {
  color: ThorColor;
  model: ModelId;
  sourceVariant: string;
  startPrefix: number;
  endPrefix: number;
};

export type ShipmentDay = {
  date: string;
  entries: ShipmentEntry[];
};

export type ShipmentWatch = {
  prefix: number;
  color: ThorColor;
  model: ModelId;
};

export type WatchStatus =
  | { kind: 'listed'; match: ShipmentEntry; date: string; latest: ShipmentEntry }
  | { kind: 'watching'; latest: ShipmentEntry; distance: number }
  | { kind: 'passed'; latest: ShipmentEntry }
  | { kind: 'no-data' };

export type ShippingForecast = {
  windowStart: string;
  windowEnd: string;
  asOfDate: string;
  sourceDate: string;
  lastVariantDate: string;
  ratePerDay: number;
  intervalCount: number;
  latestPrefix: number;
  gap: number;
  confidence: 'very-low' | 'low' | 'moderate';
};

export type ShipmentTrendPoint = ShipmentEntry & {
  date: string;
  deltaFromPrevious: number | null;
  daysFromPrevious: number | null;
  frontierIncrease: number;
};

export type ShipmentTrendSummary = {
  points: ShipmentTrendPoint[];
  updateCount: number;
  spanDays: number;
  totalAdvance: number;
  averagePerDay: number | null;
  averagePer7Days: number | null;
  averagePer30Days: number | null;
};

export const variantKey = (color: ThorColor, model: ModelId) => `${color}:${model}`;

export function modelDisplay(model: ModelId) {
  const match = MODELS.find((item) => item.id === model);
  return match ? `${match.label} ${match.detail}` : model;
}

export function shortModelDisplay(model: ModelId) {
  if (model === 'max-512') return 'Max 512GB';
  if (model === 'max-1tb') return 'Max 1TB';
  return MODELS.find((item) => item.id === model)?.label ?? model;
}

function decodeEntities(value: string) {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };

  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, token: string) => {
    if (token.startsWith('#x')) return String.fromCodePoint(Number.parseInt(token.slice(2), 16));
    if (token.startsWith('#')) return String.fromCodePoint(Number.parseInt(token.slice(1), 10));
    return named[token.toLowerCase()] ?? entity;
  });
}

function textLinesFromParagraph(html: string) {
  return decodeEntities(
    html
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\u00a0/g, ' '),
  )
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function toIsoDate(year: string, month: string, day: string) {
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function parseVariant(sourceVariant: string): Pick<ShipmentEntry, 'color' | 'model'> | null {
  const normalized = sourceVariant
    .replace(/[（）]/g, (character) => (character === '（' ? '(' : ')'))
    .replace(/\s+/g, ' ')
    .trim();
  const color = COLORS.find((candidate) => normalized.toLowerCase().startsWith(candidate.toLowerCase()));
  if (!color) return null;

  const tier = normalized.slice(color.length).trim();
  let model: ModelId | null = null;
  if (/^lite$/i.test(tier)) model = 'lite';
  if (/^base$/i.test(tier)) model = 'base';
  if (/^pro$/i.test(tier)) model = 'pro';
  if (/^max\s*\(512\)$/i.test(tier)) model = 'max-512';
  if (/^max$/i.test(tier)) model = 'max-1tb';

  return model ? { color, model } : null;
}

export function parseShipmentDashboard(bodyHtml: string): ShipmentDay[] {
  const paragraphPattern = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  const paragraphs: RegExpExecArray[] = [];
  let paragraphMatch: RegExpExecArray | null;
  while ((paragraphMatch = paragraphPattern.exec(bodyHtml)) !== null) paragraphs.push(paragraphMatch);
  const days = new Map<string, ShipmentEntry[]>();
  const unparsedThorRows: string[] = [];
  let currentDate: string | null = null;

  for (const paragraph of paragraphs) {
    for (const line of textLinesFromParagraph(paragraph[1])) {
      const dateMatch = line.match(/^(20\d{2})\/(\d{1,2})\/(\d{1,2})$/);
      if (dateMatch) {
        currentDate = toIsoDate(dateMatch[1], dateMatch[2], dateMatch[3]);
        if (!days.has(currentDate)) days.set(currentDate, []);
        continue;
      }

      if (!/^AYN\s+Thor\s+/i.test(line)) continue;
      if (!currentDate) {
        unparsedThorRows.push(line);
        continue;
      }
      const rangeMatch = line.match(/^AYN\s+Thor\s+(.+?):\s*(\d{4})\s*xx\s*[-–—]{1,2}\s*(\d{4})\s*xx\s*$/i);
      if (!rangeMatch) {
        unparsedThorRows.push(line);
        continue;
      }
      const variant = parseVariant(rangeMatch[1]);
      if (!variant) {
        unparsedThorRows.push(line);
        continue;
      }

      days.get(currentDate)?.push({
        ...variant,
        sourceVariant: rangeMatch[1].trim(),
        startPrefix: Number(rangeMatch[2]),
        endPrefix: Number(rangeMatch[3]),
      });
    }
  }

  if (unparsedThorRows.length > 0) {
    throw new Error(`AYN published ${unparsedThorRows.length} Thor row(s) in an unrecognized format`);
  }

  return [...days.entries()]
    .filter(([, entries]) => entries.length > 0)
    .map(([date, entries]) => ({ date, entries }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function mergeShipmentDays(...histories: ShipmentDay[][]): ShipmentDay[] {
  const days = new Map<string, ShipmentDay>();

  for (const history of histories) {
    for (const day of history) {
      days.set(day.date, {
        date: day.date,
        entries: day.entries.map((entry) => ({ ...entry })),
      });
    }
  }

  return [...days.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function entriesForVariant(days: ShipmentDay[], color: ThorColor, model: ModelId) {
  const matches: Array<ShipmentEntry & { date: string }> = [];
  for (const day of days) {
    for (const entry of day.entries) {
      if (entry.color === color && entry.model === model) matches.push({ ...entry, date: day.date });
    }
  }
  return matches;
}

export function latestByVariant(days: ShipmentDay[]) {
  const latest = new Map<string, ShipmentEntry & { date: string }>();
  for (const day of days) {
    for (const entry of day.entries) latest.set(variantKey(entry.color, entry.model), { ...entry, date: day.date });
  }
  return [...latest.values()].sort((a, b) => {
    const dateOrder = b.date.localeCompare(a.date);
    if (dateOrder !== 0) return dateOrder;
    return a.color.localeCompare(b.color) || modelDisplay(a.model).localeCompare(modelDisplay(b.model));
  });
}

export function evaluateWatch(days: ShipmentDay[], watch: ShipmentWatch): WatchStatus {
  const entries = entriesForVariant(days, watch.color, watch.model);
  if (entries.length === 0) return { kind: 'no-data' };

  const latest = entries[entries.length - 1]!;
  const match = entries.find((entry) => watch.prefix >= entry.startPrefix && watch.prefix <= entry.endPrefix);
  if (match) return { kind: 'listed', match, date: match.date, latest };

  const highestPublished = Math.max(...entries.map((entry) => entry.endPrefix));
  if (watch.prefix > highestPublished) return { kind: 'watching', latest, distance: watch.prefix - highestPublished };
  return { kind: 'passed', latest };
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;

function dateValue(date: string) {
  return Date.parse(`${date}T00:00:00Z`);
}

function daysBetween(start: string, end: string) {
  return Math.round((dateValue(end) - dateValue(start)) / DAY_IN_MS);
}

export function summarizeShipmentTrend(
  days: ShipmentDay[],
  color: ThorColor,
  model: ModelId,
): ShipmentTrendSummary {
  const entriesByDate = new Map<string, ShipmentEntry>();

  for (const day of days) {
    for (const entry of day.entries) {
      if (entry.color !== color || entry.model !== model) continue;

      const existing = entriesByDate.get(day.date);
      if (
        !existing ||
        entry.endPrefix > existing.endPrefix ||
        (entry.endPrefix === existing.endPrefix && entry.startPrefix < existing.startPrefix)
      ) {
        entriesByDate.set(day.date, entry);
      }
    }
  }

  const normalized = [...entriesByDate.entries()]
    .map(([date, entry]) => ({ ...entry, date }))
    .sort((left, right) => left.date.localeCompare(right.date));

  let frontier = normalized[0]?.endPrefix ?? 0;
  const points = normalized.map((entry, index): ShipmentTrendPoint => {
    const previous = normalized[index - 1];
    const frontierIncrease = index === 0 ? 0 : Math.max(0, entry.endPrefix - frontier);
    frontier = Math.max(frontier, entry.endPrefix);

    return {
      ...entry,
      deltaFromPrevious: previous ? entry.endPrefix - previous.endPrefix : null,
      daysFromPrevious: previous ? daysBetween(previous.date, entry.date) : null,
      frontierIncrease,
    };
  });

  const updateCount = points.length;
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  const spanDays = firstPoint && lastPoint ? daysBetween(firstPoint.date, lastPoint.date) : 0;
  const totalAdvance = points.reduce((total, point) => total + point.frontierIncrease, 0);
  const averagePerDay = updateCount >= 2 && spanDays > 0 ? totalAdvance / spanDays : null;

  return {
    points,
    updateCount,
    spanDays,
    totalAdvance,
    averagePerDay,
    averagePer7Days: averagePerDay === null ? null : averagePerDay * 7,
    averagePer30Days: averagePerDay === null ? null : averagePerDay * 30,
  };
}

function addDays(date: string, amount: number) {
  return new Date(dateValue(date) + amount * DAY_IN_MS).toISOString().slice(0, 10);
}

function localCalendarDate(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[midpoint - 1] + sorted[midpoint]) / 2 : sorted[midpoint];
}

function quantile(values: number[], percentile: number) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * percentile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const weight = position - lowerIndex;
  return sorted[lowerIndex] * (1 - weight) + sorted[upperIndex] * weight;
}

export function predictShippingWindow(
  days: ShipmentDay[],
  watch: ShipmentWatch,
  today = localCalendarDate(),
): ShippingForecast | null {
  if (days.length === 0) return null;

  const variantEntries = entriesForVariant(days, watch.color, watch.model);
  if (variantEntries.length === 0) return null;

  const dailyEndpoints = new Map<string, number>();
  for (const item of variantEntries) {
    dailyEndpoints.set(item.date, Math.max(dailyEndpoints.get(item.date) ?? 0, item.endPrefix));
  }

  const frontier: Array<{ date: string; endPrefix: number }> = [];
  let highestEndpoint = 0;
  for (const [date, endPrefix] of [...dailyEndpoints.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (endPrefix <= highestEndpoint) continue;
    highestEndpoint = endPrefix;
    frontier.push({ date, endPrefix });
  }

  const latestFrontier = frontier[frontier.length - 1];
  if (!latestFrontier || watch.prefix <= latestFrontier.endPrefix || frontier.length < 2) return null;

  const sourceDate = days.reduce((latest, day) => (day.date > latest ? day.date : latest), days[0].date);
  const observations = [...frontier];
  if (latestFrontier.date < sourceDate) {
    observations.push({ date: sourceDate, endPrefix: latestFrontier.endPrefix });
  }

  const recentCutoff = addDays(sourceDate, -28);
  let training = observations.filter((point) => point.date >= recentCutoff).slice(-8);
  if (training.length < 3) training = observations.slice(-3);
  if (training.length < 2) return null;

  const pairwiseRates: number[] = [];
  for (let startIndex = 0; startIndex < training.length - 1; startIndex += 1) {
    for (let endIndex = startIndex + 1; endIndex < training.length; endIndex += 1) {
      const elapsedDays = daysBetween(training[startIndex].date, training[endIndex].date);
      if (elapsedDays <= 0) continue;
      pairwiseRates.push((training[endIndex].endPrefix - training[startIndex].endPrefix) / elapsedDays);
    }
  }

  if (pairwiseRates.length === 0) return null;
  const ratePerDay = median(pairwiseRates);
  if (!Number.isFinite(ratePerDay) || ratePerDay <= 0) return null;

  const gap = watch.prefix - latestFrontier.endPrefix;
  const observedMovement = training[training.length - 1]!.endPrefix - training[0].endPrefix;
  if (observedMovement <= 0) return null;

  const projectedDays = Math.max(1, Math.ceil(gap / ratePerDay));
  if (projectedDays > 90) return null;

  const validToday = /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : sourceDate;
  const asOfDate = validToday > sourceDate ? validToday : sourceDate;
  const sourceAgeDays = Math.max(0, daysBetween(sourceDate, asOfDate));
  if (sourceAgeDays > 45) return null;
  if (daysBetween(latestFrontier.date, asOfDate) > 28) return null;

  const projectedCrossing = addDays(asOfDate, projectedDays);
  const earliestPossibleStart = addDays(asOfDate, 1);
  const centeredStart = addDays(projectedCrossing, -3);
  const windowStart = centeredStart > earliestPossibleStart ? centeredStart : earliestPossibleStart;
  const windowEnd = addDays(windowStart, 6);

  const lowerQuartile = quantile(pairwiseRates, 0.25);
  const upperQuartile = quantile(pairwiseRates, 0.75);
  const spreadRatio = lowerQuartile > 0 ? upperQuartile / lowerQuartile : Number.POSITIVE_INFINITY;
  const intervalCount = training.slice(1).filter((point, index) => point.endPrefix > training[index].endPrefix).length;
  const historySpanDays = daysBetween(training[0].date, training[training.length - 1]!.date);
  let confidence: ShippingForecast['confidence'] = intervalCount === 1 ? 'very-low' : 'low';
  if (
    training.length >= 4 &&
    intervalCount >= 3 &&
    historySpanDays >= 14 &&
    spreadRatio <= 3 &&
    gap <= observedMovement &&
    projectedDays <= historySpanDays &&
    sourceAgeDays <= 14
  ) {
    confidence = 'moderate';
  }

  return {
    windowStart,
    windowEnd,
    asOfDate,
    sourceDate,
    lastVariantDate: latestFrontier.date,
    ratePerDay,
    intervalCount,
    latestPrefix: latestFrontier.endPrefix,
    gap,
    confidence,
  };
}

function entry(sourceVariant: string, startPrefix: number, endPrefix: number): ShipmentEntry {
  const parsed = parseVariant(sourceVariant);
  if (!parsed) throw new Error(`Unsupported fallback variant: ${sourceVariant}`);
  return { ...parsed, sourceVariant, startPrefix, endPrefix };
}

function day(date: string, rows: Array<[string, number, number]>): ShipmentDay {
  return { date, entries: rows.map(([variant, start, end]) => entry(variant, start, end)) };
}

export const FALLBACK_SHIPMENTS: ShipmentDay[] = [
  day('2026-07-10', [
    ['Black Max', 2280, 2299], ['White Pro', 2237, 2375], ['Clear Purple Pro', 2250, 2335],
    ['White Max (512)', 2403, 2458], ['Rainbow Max (512)', 2343, 2355], ['Clear Purple Max (512)', 2353, 2378],
  ]),
  day('2026-07-13', [
    ['Black Base', 2254, 2316], ['White Pro', 2375, 2411], ['Rainbow Pro', 2308, 2411],
    ['Clear Purple Pro', 2335, 2342], ['Black Max (512)', 2142, 2314],
  ]),
  day('2026-07-15', [
    ['Black Base', 2316, 2353], ['Black Pro', 2271, 2314], ['White Pro', 2411, 2462],
    ['Rainbow Pro', 2411, 2430], ['Clear Purple Pro', 2342, 2398],
  ]),
  day('2026-07-16', [
    ['White Max', 2248, 2294], ['Black Max', 2299, 2358], ['Rainbow Max', 2292, 2356], ['Rainbow Max (512)', 2355, 2365],
  ]),
  day('2026-07-17', [
    ['White Max', 2294, 2316], ['Black Max', 2358, 2369], ['Rainbow Max', 2356, 2366],
    ['Clear Purple Max', 2252, 2319], ['Black Max (512)', 2314, 2318],
  ]),
  day('2026-08-07', [
    ['Black Pro', 2314, 2430], ['Rainbow Pro', 2430, 2491], ['Rainbow Max', 2366, 2450],
    ['Clear Purple Pro', 2398, 2465], ['White Max (512)', 2458, 2551], ['Clear Purple Max (512)', 2378, 2429],
  ]),
  day('2026-08-09', [['Black Max (512)', 2318, 2424], ['Rainbow Max (512)', 2365, 2467]]),
  day('2026-08-10', [
    ['Black Max', 2369, 2439], ['Rainbow Max', 2450, 2485], ['White Max', 2316, 2345],
    ['Clear Purple Max', 2319, 2386], ['Black Max (512)', 2424, 2472], ['Rainbow Max (512)', 2467, 2472],
  ]),
  day('2026-08-11', [
    ['Black Pro', 2430, 2448], ['Rainbow Pro', 2491, 2502], ['White Max', 2345, 2361],
    ['Clear Purple Pro', 2465, 2484], ['Clear Purple Max (512)', 2429, 2446],
  ]),
  day('2026-08-12', [
    ['Black Lite', 2425, 2478], ['Black Base', 2353, 2428], ['White Pro', 2462, 2483], ['White Max (512)', 2551, 2580],
  ]),
  day('2026-08-13', [['Clear Purple Pro', 2484, 2498], ['Black Max (512)', 2472, 2490]]),
  day('2026-08-15', [
    ['Black Base', 2428, 2431], ['Black Pro', 2448, 2471], ['Rainbow Max', 2485, 2493], ['White Max', 2361, 2381],
    ['Clear Purple Max', 2386, 2414], ['White Max (512)', 2580, 2627], ['Clear Purple Max (512)', 2446, 2490],
  ]),
  day('2026-08-17', [
    ['Black Pro', 2471, 2493], ['Rainbow Max', 2493, 2500], ['Rainbow Pro', 2502, 2529], ['Rainbow Max (512)', 2472, 2600],
  ]),
  day('2026-08-18', [
    ['Black Base', 2428, 2444], ['Rainbow Max', 2500, 2560], ['White Pro', 2483, 2573], ['Clear Purple Pro', 2498, 2530],
  ]),
  day('2026-08-20', [
    ['Black Pro', 2493, 2516], ['Rainbow Max', 2500, 2582], ['White Max', 2381, 2489], ['Black Max', 2439, 2522],
  ]),
  day('2026-08-21', [
    ['Black Base', 2444, 2530], ['Black Max (512)', 2490, 2542], ['Clear Purple Max', 2414, 2434], ['Clear Purple Max (512)', 2490, 2568],
  ]),
  day('2026-08-24', [
    ['White Pro', 2483, 2647], ['Rainbow Max', 2582, 2638], ['Clear Purple Max (512)', 2568, 2665],
  ]),
  day('2026-08-25', [['Black Base', 2530, 2548], ['Black Lite', 2478, 2776]]),
];
