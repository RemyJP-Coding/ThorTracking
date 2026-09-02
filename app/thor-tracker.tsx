'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  COLORS,
  FALLBACK_SHIPMENTS,
  MODELS,
  SOURCE_PAGE_URL,
  evaluateWatch,
  latestByVariant,
  modelDisplay,
  predictShippingWindow,
  shortModelDisplay,
  summarizeShipmentTrend,
  variantKey,
  type ModelId,
  type ShipmentDay,
  type ShipmentTrendPoint,
  type ShipmentWatch,
  type ThorColor,
  type WatchStatus,
} from './lib/shipments';
import { readWatchSnapshot, writeWatchSnapshot, type WatchStorage } from './lib/watch-storage';

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const WATCH_CHANGE_EVENT = 'thor-track-watch-change';
const THEME_STORAGE_KEY = 'thor-track.theme.v1';
const THEME_CHANGE_EVENT = 'thor-track-theme-change';
const SHIPMENTS_API_URL = '/api/shipments';

type SourceState = 'checking' | 'live' | 'fallback';
type Theme = 'light' | 'dark';

function formatDate(date: string, options?: Intl.DateTimeFormatOptions) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
      ...options,
    }).format(new Date(`${date}T12:00:00Z`));
  } catch {
    return date;
  }
}

function formatRange(start: number, end: number) {
  return `${start}xx—${end}xx`;
}

function formatPace(value: number | null) {
  if (value === null) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
}

function formatTrendChange(point: ShipmentTrendPoint, previous: ShipmentTrendPoint | undefined) {
  if (point.deltaFromPrevious === null || !previous) return 'First recorded update; no prior comparison.';

  const elapsedDays = point.daysFromPrevious ?? 0;
  const elapsedCopy = `${elapsedDays} calendar ${elapsedDays === 1 ? 'day' : 'days'}`;
  const previousDate = formatDate(previous.date, { year: undefined });
  if (point.deltaFromPrevious > 0) {
    return `+${point.deltaFromPrevious} prefix steps since ${previousDate} · ${elapsedCopy}.`;
  }
  if (point.deltaFromPrevious < 0) {
    return `Down ${Math.abs(point.deltaFromPrevious)} prefix steps from the prior update on ${previousDate} · ${elapsedCopy}.`;
  }
  return `No endpoint change since ${previousDate} · ${elapsedCopy}.`;
}

function confidenceLabel(confidence: 'very-low' | 'low' | 'moderate') {
  if (confidence === 'very-low') return 'Very low confidence';
  if (confidence === 'moderate') return 'Moderate confidence';
  return 'Low confidence';
}

function formatCheckedAt(value: string | null) {
  if (!value) return 'Connecting';
  try {
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleTimeString();
  }
}

function formatSourceUpdatedAt(value: string) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function safeStoredWatch(value: string | null): ShipmentWatch | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ShipmentWatch>;
    const modelIds = MODELS.map((model) => model.id as string);
    if (
      typeof parsed.prefix === 'number' &&
      parsed.prefix >= 1000 &&
      parsed.prefix <= 9999 &&
      COLORS.includes(parsed.color as ThorColor) &&
      modelIds.includes(parsed.model as string)
    ) {
      return parsed as ShipmentWatch;
    }
  } catch {
    return null;
  }
  return null;
}

function subscribeToStoredWatch(onStoreChange: () => void) {
  window.addEventListener('storage', onStoreChange);
  window.addEventListener(WATCH_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener('storage', onStoreChange);
    window.removeEventListener(WATCH_CHANGE_EVENT, onStoreChange);
  };
}

let volatileWatchSnapshot = '';

function getBrowserStorage(): WatchStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getStoredWatchSnapshot() {
  const result = readWatchSnapshot(getBrowserStorage(), volatileWatchSnapshot);
  if (result.available) volatileWatchSnapshot = result.snapshot;
  return result.snapshot;
}

function getServerWatchSnapshot() {
  return '';
}

function writeStoredWatch(watch: ShipmentWatch | null) {
  const result = writeWatchSnapshot(getBrowserStorage(), watch);
  volatileWatchSnapshot = result.snapshot;
  window.dispatchEvent(new Event(WATCH_CHANGE_EVENT));
  return result.persisted;
}

function readStoredTheme(): Theme | null {
  try {
    const theme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return theme === 'light' || theme === 'dark' ? theme : null;
  } catch {
    return null;
  }
}

function preferredTheme(): Theme {
  const storedTheme = readStoredTheme();
  if (storedTheme) return storedTheme;
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  } catch {
    return 'light';
  }
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

function subscribeToTheme(onStoreChange: () => void) {
  let colorScheme: MediaQueryList | null = null;
  try {
    if (typeof window.matchMedia === 'function') {
      colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
    }
  } catch {
    colorScheme = null;
  }
  const syncStoredTheme = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    applyTheme(preferredTheme());
    onStoreChange();
  };
  const syncSystemTheme = () => {
    if (readStoredTheme()) return;
    applyTheme(preferredTheme());
    onStoreChange();
  };

  window.addEventListener('storage', syncStoredTheme);
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  if (colorScheme && typeof colorScheme.addEventListener === 'function') {
    colorScheme.addEventListener('change', syncSystemTheme);
  } else if (colorScheme && typeof colorScheme.addListener === 'function') {
    colorScheme.addListener(syncSystemTheme);
  }
  return () => {
    window.removeEventListener('storage', syncStoredTheme);
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
    if (colorScheme && typeof colorScheme.removeEventListener === 'function') {
      colorScheme.removeEventListener('change', syncSystemTheme);
    } else if (colorScheme && typeof colorScheme.removeListener === 'function') {
      colorScheme.removeListener(syncSystemTheme);
    }
  };
}

function getThemeSnapshot(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function getServerThemeSnapshot(): Theme {
  return 'light';
}

function writeTheme(theme: Theme) {
  applyTheme(theme);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The active tab still keeps the chosen theme when storage is unavailable.
  }
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

function statusCopy(status: WatchStatus) {
  if (status.kind === 'listed') {
    return {
      eyebrow: 'Listed by AYN',
      title: `Your prefix appears in the ${formatDate(status.date)} batch.`,
      body: `AYN published ${formatRange(status.match.startPrefix, status.match.endPrefix)} for this exact configuration.`,
      tone: 'listed',
    } as const;
  }
  if (status.kind === 'watching') {
    return {
      eyebrow: 'Watching',
      title: `${status.distance} prefix ${status.distance === 1 ? 'step' : 'steps'} beyond the published frontier.`,
      body: `The latest exact-configuration range is ${formatRange(status.latest.startPrefix, status.latest.endPrefix)}.`,
      tone: 'watching',
    } as const;
  }
  if (status.kind === 'passed') {
    return {
      eyebrow: 'Not explicitly listed',
      title: 'AYN has posted later prefixes, but not this one.',
      body: `The newest exact-configuration range is ${formatRange(status.latest.startPrefix, status.latest.endPrefix)}. We won’t infer shipment across a gap.`,
      tone: 'passed',
    } as const;
  }
  return {
    eyebrow: 'No range yet',
    title: 'AYN has not published this configuration.',
    body: 'The watch is saved and will be checked whenever the dashboard refreshes.',
    tone: 'empty',
  } as const;
}

export function ThorTracker() {
  const theme = useSyncExternalStore(subscribeToTheme, getThemeSnapshot, getServerThemeSnapshot);
  const [days, setDays] = useState<ShipmentDay[]>(FALLBACK_SHIPMENTS);
  const [sourceState, setSourceState] = useState<SourceState>('checking');
  const [sourceUpdatedAt, setSourceUpdatedAt] = useState<string | null>(null);
  const [refreshNotice, setRefreshNotice] = useState('Connecting to AYN…');
  const [refreshing, setRefreshing] = useState(false);
  const lastAttemptRef = useRef(0);

  const storedWatchSnapshot = useSyncExternalStore(
    subscribeToStoredWatch,
    getStoredWatchSnapshot,
    getServerWatchSnapshot,
  );
  const watch = useMemo(() => safeStoredWatch(storedWatchSnapshot), [storedWatchSnapshot]);
  const [orderDraft, setOrderDraft] = useState<string | null>(null);
  const [colorDraft, setColorDraft] = useState<ThorColor | null>(null);
  const [modelDraft, setModelDraft] = useState<ModelId | null>(null);
  const orderInput = orderDraft ?? (watch ? `${watch.prefix}xx` : '');
  const color = colorDraft ?? watch?.color ?? 'Black';
  const model = modelDraft ?? watch?.model ?? 'base';
  const [formError, setFormError] = useState('');
  const [watchFeedback, setWatchFeedback] = useState<{ kind: 'saved' | 'session'; message: string } | null>(null);
  const [trendKeyOverride, setTrendKeyOverride] = useState<string | null>(null);
  const trendKey = trendKeyOverride ?? (watch ? variantKey(watch.color, watch.model) : variantKey('Black', 'base'));
  const [trendSelection, setTrendSelection] = useState<{ trendKey: string; date: string } | null>(null);
  const [colorFilter, setColorFilter] = useState<ThorColor | 'All'>('All');
  const [timelineFilter, setTimelineFilter] = useState('all');
  const [showAllTimeline, setShowAllTimeline] = useState(false);

  const refreshData = useCallback(async (manual = false) => {
    setRefreshing(true);
    setSourceState('checking');
    if (manual) setRefreshNotice('Checking AYN for the latest shipment ranges…');
    lastAttemptRef.current = Date.now();
    const attemptedAt = new Date().toISOString();
    try {
      const response = await fetch(SHIPMENTS_API_URL, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`Shipment feed returned ${response.status}`);
      const payload = (await response.json()) as {
        status?: string;
        checkedAt?: string;
        sourceUpdatedAt?: string | null;
        days?: ShipmentDay[];
      };
      if (payload.status !== 'live' || !Array.isArray(payload.days) || payload.days.length === 0) {
        throw new Error('Shipment feed payload was invalid');
      }
      setDays(payload.days);
      setSourceUpdatedAt(payload.sourceUpdatedAt ?? null);
      const checkedAt = payload.checkedAt ?? attemptedAt;
      setSourceState('live');
      setRefreshNotice(`Live AYN data checked at ${formatCheckedAt(checkedAt)}.`);
    } catch {
      setSourceState('fallback');
      const fallbackDate = FALLBACK_SHIPMENTS[FALLBACK_SHIPMENTS.length - 1]?.date;
      setRefreshNotice(
        `Live refresh failed at ${formatCheckedAt(attemptedAt)}. Showing last-known data${fallbackDate ? ` through ${formatDate(fallbackDate)}` : ''}.`,
      );
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refreshData(), 0);
    const interval = window.setInterval(() => void refreshData(), REFRESH_INTERVAL_MS);
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastAttemptRef.current >= REFRESH_INTERVAL_MS) {
        void refreshData();
      }
    };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
    };
  }, [refreshData]);

  const latestDay = days[days.length - 1] ?? FALLBACK_SHIPMENTS[FALLBACK_SHIPMENTS.length - 1]!;
  const latestVariants = useMemo(() => latestByVariant(days), [days]);
  const filteredLatest = useMemo(
    () => latestVariants.filter((entry) => colorFilter === 'All' || entry.color === colorFilter),
    [colorFilter, latestVariants],
  );

  const watchedStatus = useMemo(() => (watch ? evaluateWatch(days, watch) : null), [days, watch]);
  const watchedCopy = watchedStatus ? statusCopy(watchedStatus) : null;
  const watchedForecast = useMemo(
    () => (watch && watchedStatus?.kind === 'watching' ? predictShippingWindow(days, watch) : null),
    [days, watch, watchedStatus],
  );

  const [trendColor, trendModel] = trendKey.split(':') as [ThorColor, ModelId];
  const trendSummary = useMemo(
    () => summarizeShipmentTrend(days, trendColor, trendModel),
    [days, trendColor, trendModel],
  );
  const trendSeries = trendSummary.points;
  const trendEnds = trendSeries.map((entry) => entry.endPrefix);
  const trendMin = trendEnds.length ? Math.min(...trendEnds) : 0;
  const trendMax = trendEnds.length ? Math.max(...trendEnds) : 0;
  const latestTrend = trendSeries[trendSeries.length - 1];
  const requestedTrendDate = trendSelection?.trendKey === trendKey ? trendSelection.date : null;
  const requestedTrendIndex = requestedTrendDate
    ? trendSeries.findIndex((point) => point.date === requestedTrendDate)
    : -1;
  const selectedTrendIndex = requestedTrendIndex >= 0 ? requestedTrendIndex : trendSeries.length - 1;
  const selectedTrend = selectedTrendIndex >= 0 ? trendSeries[selectedTrendIndex] : undefined;
  const previousSelectedTrend = selectedTrendIndex > 0 ? trendSeries[selectedTrendIndex - 1] : undefined;

  const filteredTimeline = useMemo(() => {
    const [filterColor, filterModel] = timelineFilter.split(':') as [ThorColor, ModelId];
    return [...days]
      .reverse()
      .map((day) => ({
        ...day,
        entries:
          timelineFilter === 'all'
            ? day.entries
            : day.entries.filter((entry) => entry.color === filterColor && entry.model === filterModel),
      }))
      .filter((day) => day.entries.length > 0);
  }, [days, timelineFilter]);
  const visibleTimeline = showAllTimeline ? filteredTimeline : filteredTimeline.slice(0, 7);

  function saveWatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const digits = orderInput.match(/\d/g)?.join('') ?? '';
    if (digits.length < 4) {
      setFormError('Enter at least the first four digits of your AYN order number.');
      setWatchFeedback(null);
      return;
    }

    const nextWatch: ShipmentWatch = { prefix: Number(digits.slice(0, 4)), color, model };
    const persisted = writeStoredWatch(nextWatch);
    setOrderDraft(`${nextWatch.prefix}xx`);
    setFormError('');
    setTrendKeyOverride(variantKey(color, model));
    setTrendSelection(null);
    setWatchFeedback({
      kind: persisted ? 'saved' : 'session',
      message: persisted
        ? `Saved on this browser: watching ${nextWatch.prefix}xx · ${color} · ${shortModelDisplay(model)}.`
        : `Watching ${nextWatch.prefix}xx for this tab. This phone blocked browser storage, so the watch may disappear when you close it.`,
    });
  }

  function removeWatch() {
    setOrderDraft(null);
    setColorDraft(null);
    setModelDraft(null);
    setFormError('');
    setWatchFeedback(null);
    writeStoredWatch(null);
  }

  function toggleTheme() {
    writeTheme(theme === 'dark' ? 'light' : 'dark');
  }

  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--text)]">
      <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--header-surface)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-5 pb-2 pt-4 sm:gap-4 sm:px-8 sm:pb-2 sm:pt-5 lg:px-10">
          <a href="#top" className="flex shrink-0 items-center gap-3" aria-label="Thor Track home">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--ink)] text-sm font-black text-[var(--volt)]">T</span>
            <span className="leading-none">
              <span className="block text-sm font-black tracking-[-0.03em]">THOR TRACK</span>
              <span className="mt-1 block text-[9px] font-bold uppercase tracking-[0.22em] text-[var(--text-45)]">Dispatch watch</span>
            </span>
          </a>

          <div className="flex items-center gap-2 sm:gap-3 lg:gap-5">
            <a href="#timeline" className="hidden text-xs font-bold text-[var(--text-55)] transition hover:text-[var(--text)] sm:block">Timeline</a>
            <a href={SOURCE_PAGE_URL} target="_blank" rel="noreferrer" className="hidden text-xs font-bold text-[var(--text-55)] transition hover:text-[var(--text)] md:block">Official source ↗</a>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle color theme"
              aria-pressed={theme === 'dark'}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-soft)] px-3 text-[11px] font-black text-[var(--text-60)] transition hover:bg-[var(--surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)]"
            >
              <span aria-hidden="true" className="text-sm leading-none">◐</span>
              <span className="hidden sm:inline">Theme</span>
            </button>
            <button
              type="button"
              onClick={() => void refreshData(true)}
              disabled={refreshing}
              aria-busy={refreshing}
              className="flex min-h-11 items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-soft)] px-3 py-2 text-[11px] font-black text-[var(--text-60)] transition hover:bg-[var(--surface)] disabled:cursor-wait"
              aria-label="Refresh AYN shipment data"
            >
              <span className={`h-2 w-2 rounded-full ${sourceState === 'live' ? 'bg-[#35a853]' : sourceState === 'checking' ? 'bg-[#e2a42d]' : 'bg-[#d26345]'}`} />
              {refreshing ? 'Checking…' : 'Refresh'}
            </button>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-5 pb-3 text-right sm:px-8 lg:px-10">
          <p role="status" aria-live="polite" className="text-[10px] font-bold leading-4 text-[var(--text-45)]">
            {refreshNotice}
          </p>
        </div>
      </header>

      <div id="top" className="mx-auto max-w-7xl px-5 pb-16 pt-12 sm:px-8 sm:pt-16 lg:px-10">
        <section className="grid items-end gap-10 lg:grid-cols-[1.06fr_0.94fr]">
          <div>
            <p className="mb-5 text-xs font-black uppercase tracking-[0.2em] text-[var(--text-45)]">Independent AYN Thor shipment tracker</p>
            <h1 className="max-w-3xl text-[clamp(3.25rem,7vw,6.8rem)] font-black leading-[0.88] tracking-[-0.075em]">Know when your Thor is in the clear.</h1>
            <p className="mt-7 max-w-xl text-base leading-7 text-[var(--text-60)] sm:text-lg">Save your order prefix and exact configuration. Thor Track watches AYN’s published dispatch ranges and shows where your order stands.</p>

            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-xs font-bold text-[var(--text-45)]">
              <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[var(--text-30)]" />Checks every 10 minutes while open</span>
              <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[var(--text-30)]" />Only a masked prefix is saved</span>
            </div>
          </div>

          <section aria-labelledby="watch-title" className="rounded-[28px] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_24px_70px_var(--shadow)] sm:p-7">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-40)]">Order watch</p>
                <h2 id="watch-title" className="mt-2 text-2xl font-black tracking-[-0.04em]">{watch ? `${watch.prefix}xx is on watch` : 'Track your place'}</h2>
              </div>
              <span className="rounded-full bg-[var(--volt)] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-[var(--accent-ink)]">Auto checks</span>
            </div>

            <form className="space-y-4" onSubmit={saveWatch} noValidate>
              <label className="block">
                <span className="mb-2 block text-xs font-bold text-[var(--text-55)]">AYN order number</span>
                <input
                  value={orderInput}
                  onChange={(event) => { setOrderDraft(event.target.value); setWatchFeedback(null); }}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="#251612"
                  className="h-14 w-full rounded-2xl border border-[var(--line-strong)] bg-[var(--paper)] px-4 text-lg font-bold outline-none transition focus:border-[var(--text)] focus:ring-4 focus:ring-[var(--focus-ring-soft)]"
                  aria-describedby={`order-help${formError ? ' order-error' : ''}`}
                  aria-invalid={formError ? true : undefined}
                  aria-errormessage={formError ? 'order-error' : undefined}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-2 block text-xs font-bold text-[var(--text-55)]">Color</span>
                  <select value={color} onChange={(event) => { setColorDraft(event.target.value as ThorColor); setWatchFeedback(null); }} className="h-12 w-full rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] px-3 text-sm font-bold outline-none focus:border-[var(--text)]">
                    {COLORS.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-bold text-[var(--text-55)]">Model</span>
                  <select value={model} onChange={(event) => { setModelDraft(event.target.value as ModelId); setWatchFeedback(null); }} className="h-12 w-full rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] px-3 text-sm font-bold outline-none focus:border-[var(--text)]">
                    {MODELS.map((item) => <option value={item.id} key={item.id}>{item.label} {item.detail}</option>)}
                  </select>
                </label>
              </div>
              <button type="submit" className="h-14 w-full rounded-2xl bg-[var(--ink)] px-5 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-[var(--panel-hover)] focus:outline-none focus:ring-4 focus:ring-[var(--focus-ring-strong)] active:translate-y-0">
                {watch ? 'Update this watch' : 'Watch this order'} <span aria-hidden="true">→</span>
              </button>
              {watchFeedback ? (
                <p
                  role={watchFeedback.kind === 'session' ? 'alert' : 'status'}
                  className={`rounded-xl px-3 py-2 text-center text-xs font-bold ${watchFeedback.kind === 'session' ? 'error-message' : 'bg-[var(--surface-soft)] text-[var(--text-60)]'}`}
                >
                  {watchFeedback.message}
                </p>
              ) : null}
              <p id="order-help" className="text-center text-[11px] leading-5 text-[var(--text-45)]">AYN publishes the first 4 digits. Your full order number is never retained.</p>
              {formError ? <p id="order-error" role="alert" className="error-message rounded-xl px-3 py-2 text-center text-xs font-bold">{formError}</p> : null}
            </form>

            {watch && watchedCopy ? (
              <div className={`watch-result watch-result--${watchedCopy.tone} mt-5 rounded-2xl border p-4`} aria-live="polite">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em]">{watchedCopy.eyebrow}</p>
                  <button type="button" onClick={removeWatch} className="text-[10px] font-black uppercase tracking-[0.1em] opacity-55 transition hover:opacity-100">Clear</button>
                </div>
                <p className="mt-2 text-lg font-black leading-6 tracking-[-0.025em]">{watchedCopy.title}</p>
                <p className="mt-2 text-xs leading-5 opacity-70">{watchedCopy.body}</p>
                {watchedStatus?.kind === 'watching' ? (
                  watchedForecast ? (
                    <div className="mt-4 rounded-xl border border-white/15 bg-white/[0.07] p-4">
                      <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[var(--volt)]">Estimated AYN dispatch window</p>
                      <p className="mt-2 flex flex-wrap items-baseline gap-x-1 text-2xl font-black tracking-[-0.045em]">
                        <time dateTime={watchedForecast.windowStart}>{formatDate(watchedForecast.windowStart, { year: undefined })}</time>
                        <span aria-hidden="true">–</span><span className="sr-only">to</span>
                        <time dateTime={watchedForecast.windowEnd}>{formatDate(watchedForecast.windowEnd)}</time>
                      </p>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-bold text-white/55">
                        <span>{confidenceLabel(sourceState === 'live' ? watchedForecast.confidence : watchedForecast.confidence === 'very-low' ? 'very-low' : 'low')}</span>
                        <span>{watchedForecast.gap} prefix {watchedForecast.gap === 1 ? 'step' : 'steps'} ahead</span>
                      </div>
                      <p className="mt-3 text-[11px] leading-5 text-white/55">
                        Based on {watchedForecast.intervalCount} exact-configuration {watchedForecast.intervalCount === 1 ? 'advance' : 'advances'} through {formatDate(watchedForecast.sourceDate)}. {sourceState === 'live' ? '' : 'AYN live data is unavailable, so this uses the last-known timeline. '}This is a trend estimate for AYN’s dashboard—not an AYN promise or carrier delivery ETA.
                      </p>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-xl border border-white/15 bg-white/[0.07] p-4">
                      <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[var(--volt)]">Weekly estimate unavailable</p>
                      <p className="mt-2 text-[11px] leading-5 text-white/55">A responsible one-week estimate is not available for this queue yet. Its history may be too sparse, too stale, or too far beyond the measured trend.</p>
                    </div>
                  )
                ) : null}
                <div className="mt-4 flex items-center justify-between gap-3 border-t border-current/10 pt-3 text-[11px] font-bold">
                  <span>{watch.color} · {shortModelDisplay(watch.model)}</span>
                  <span className="font-mono">{watch.prefix}xx</span>
                </div>
              </div>
            ) : null}
          </section>
        </section>

        <section className="mt-16 border-t border-[var(--line)] pt-8" aria-labelledby="latest-title">
          <div className="grid gap-8 lg:grid-cols-[0.62fr_1.38fr]">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-[var(--volt)] px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[var(--accent-ink)]">Latest dispatch</span>
                <span className="text-xs font-bold text-[var(--text-45)]">{formatDate(latestDay.date)}</span>
              </div>
              <h2 id="latest-title" className="mt-5 text-4xl font-black tracking-[-0.055em] sm:text-5xl">{latestDay.entries.length} Thor {latestDay.entries.length === 1 ? 'range' : 'ranges'} moved.</h2>
              <p className="mt-4 max-w-md text-sm leading-6 text-[var(--text-55)]">These are the newest Thor rows on AYN’s dashboard—not a combined frontier across every model.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {latestDay.entries.map((item, index) => (
                <article key={`${item.color}-${item.model}-${item.startPrefix}`} className="relative overflow-hidden rounded-3xl bg-[var(--ink)] p-6 text-white">
                  <span className="absolute right-5 top-4 text-6xl font-black leading-none text-white/[0.06]">{String(index + 1).padStart(2, '0')}</span>
                  <p className="relative text-xs font-bold text-white/50">AYN Thor</p>
                  <h3 className="relative mt-2 text-xl font-black tracking-[-0.03em]">{item.color} · {shortModelDisplay(item.model)}</h3>
                  <p className="relative mt-8 font-mono text-[clamp(1.25rem,3vw,2rem)] font-bold tracking-[-0.05em] text-[var(--volt)]">{formatRange(item.startPrefix, item.endPrefix)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-20 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]" aria-labelledby="trend-title">
          <div className="min-w-0 rounded-[28px] bg-[var(--ink)] p-6 text-white sm:p-8">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Configuration trend</p>
            <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 id="trend-title" className="text-3xl font-black tracking-[-0.045em]">{trendColor} · {shortModelDisplay(trendModel)}</h2>
                {latestTrend ? <p className="mt-2 text-sm text-white/50">Latest endpoint <span className="font-mono font-bold text-[var(--volt)]">{latestTrend.endPrefix}xx</span></p> : null}
              </div>
              <select
                value={trendKey}
                onChange={(event) => {
                  setTrendKeyOverride(event.target.value);
                  setTrendSelection(null);
                }}
                aria-label="Choose configuration trend"
                className="h-11 rounded-xl border border-white/15 bg-white/10 px-3 text-xs font-bold text-white outline-none focus:border-[var(--volt)]"
              >
                {latestVariants.map((item) => <option className="text-[var(--option-text)]" value={variantKey(item.color, item.model)} key={variantKey(item.color, item.model)}>{item.color} · {modelDisplay(item.model)}</option>)}
              </select>
            </div>

            <div className="mt-7 grid grid-cols-3 gap-2" aria-label="Observed configuration pace">
              {[
                { label: 'Avg / day', value: trendSummary.averagePerDay },
                { label: 'Avg / 7 days', value: trendSummary.averagePer7Days },
                { label: 'Avg / 30 days', value: trendSummary.averagePer30Days },
              ].map((stat) => (
                <div key={stat.label} className="rounded-2xl bg-white/[0.06] px-2 py-3 text-center">
                  <p className="text-[10px] font-black uppercase tracking-[0.08em] text-white/45">{stat.label}</p>
                  <p className="mt-2 font-mono text-xl font-bold tracking-[-0.04em] text-[var(--volt)] sm:text-2xl">{formatPace(stat.value)}</p>
                  <p className="mt-1 text-[10px] font-bold text-white/40">prefix steps</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-center text-[10px] font-bold leading-4 text-white/40">
              {trendSummary.updateCount === 0
                ? 'No observed updates for this configuration.'
                : trendSummary.updateCount === 1
                  ? '1 observed update · More history is needed for a pace.'
                  : `${trendSummary.updateCount} updates across ${trendSummary.spanDays} calendar ${trendSummary.spanDays === 1 ? 'day' : 'days'} · +${trendSummary.totalAdvance} prefix ${trendSummary.totalAdvance === 1 ? 'step' : 'steps'}`}
            </p>

            <figure className="mt-7" aria-describedby="trend-chart-summary">
              <figcaption className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-white/45">
                <span>Published range endpoint by update</span>
                <span>Select a bar for details</span>
              </figcaption>
              <p id="trend-chart-summary" className="sr-only">
                {`Observed endpoint trend for ${trendColor} ${modelDisplay(trendModel)}, with ${trendSummary.updateCount} published ${trendSummary.updateCount === 1 ? 'update' : 'updates'}.`}
              </p>
              <div className="overflow-x-auto pb-1">
                <div className="flex h-56 min-w-full items-end gap-2 border-b border-white/15 px-1">
                  {trendSeries.map((point, index) => {
                    const spread = trendMax - trendMin;
                    const height = spread === 0 ? 72 : 28 + ((point.endPrefix - trendMin) / spread) * 68;
                    const isSelected = selectedTrend?.date === point.date;
                    const changeCopy = formatTrendChange(point, trendSeries[index - 1]);
                    return (
                      <button
                        key={`${point.date}-${point.startPrefix}-${point.endPrefix}`}
                        type="button"
                        onClick={() => setTrendSelection({ trendKey, date: point.date })}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return;
                          event.preventDefault();
                          setTrendSelection({ trendKey, date: point.date });
                        }}
                        aria-pressed={isSelected}
                        aria-label={`${formatDate(point.date)}. Published range ${formatRange(point.startPrefix, point.endPrefix)}; endpoint ${point.endPrefix}xx. ${changeCopy}`}
                        className={`group flex h-full min-w-11 flex-1 flex-col justify-end rounded-t-lg px-0.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--volt)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ink)] ${isSelected ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'}`}
                      >
                        <span className={`mb-2 hidden text-center font-mono text-[10px] font-bold sm:block ${isSelected ? 'text-white' : 'text-white/45'}`}>{point.endPrefix}</span>
                        <span
                          aria-hidden="true"
                          className={`block min-h-4 w-full rounded-t-lg transition ${isSelected ? 'bg-[var(--volt)] ring-2 ring-white/70 ring-offset-2 ring-offset-[var(--ink)]' : 'bg-[var(--volt)]/70 group-hover:bg-[var(--volt)]'}`}
                          style={{ height: `${height}%` }}
                        />
                        <span className={`my-2 block text-center text-[11px] font-bold ${isSelected ? 'text-white' : 'text-white/40'}`}>{formatDate(point.date, { month: 'numeric', day: 'numeric', year: undefined })}</span>
                      </button>
                    );
                  })}
                  {trendSeries.length === 0 ? <p className="m-auto text-sm text-white/50">No published updates yet.</p> : null}
                </div>
              </div>
            </figure>

            <div className="mt-4 min-h-16 border-t border-white/10 pt-4" role="status" aria-live="polite" aria-atomic="true">
              {selectedTrend ? (
                <>
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold text-white/75">
                    <span>{formatDate(selectedTrend.date)}</span>
                    <span className="font-mono text-[var(--volt)]">{formatRange(selectedTrend.startPrefix, selectedTrend.endPrefix)}</span>
                    <span>Endpoint {selectedTrend.endPrefix}xx</span>
                  </p>
                  <p className="mt-2 text-xs leading-5 text-white/50">{formatTrendChange(selectedTrend, previousSelectedTrend)}</p>
                </>
              ) : (
                <p className="text-xs text-white/50">No published update is available to compare.</p>
              )}
            </div>
          </div>

          <div className="min-w-0 rounded-[28px] border border-[var(--line)] bg-[var(--surface-soft)] p-6 sm:p-8">
            <div className="flex flex-wrap items-end justify-between gap-5">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-40)]">Latest by configuration</p>
                <h2 className="mt-2 text-3xl font-black tracking-[-0.045em]">Every queue, separately.</h2>
              </div>
              <div className="flex flex-wrap gap-1" aria-label="Filter configurations by color">
                {(['All', ...COLORS] as const).map((item) => (
                  <button key={item} type="button" onClick={() => setColorFilter(item)} aria-pressed={colorFilter === item} className={`rounded-full px-3 py-2 text-[10px] font-black transition ${colorFilter === item ? 'bg-[var(--ink)] text-white' : 'bg-[var(--fill-subtle)] text-[var(--text-50)] hover:bg-[var(--fill-hover)]'}`}>{item}</button>
                ))}
              </div>
            </div>
            <div className="mt-7 grid gap-x-7 sm:grid-cols-2">
              {filteredLatest.map((item) => (
                <article key={variantKey(item.color, item.model)} className="flex items-center justify-between gap-4 border-t border-[var(--line)] py-4">
                  <div>
                    <h3 className="text-sm font-black">{item.color} · {shortModelDisplay(item.model)}</h3>
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-35)]">{formatDate(item.date)}</p>
                  </div>
                  <p className="whitespace-nowrap font-mono text-xs font-bold text-[var(--text-60)]">{formatRange(item.startPrefix, item.endPrefix)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="timeline" className="mt-20 scroll-mt-8" aria-labelledby="timeline-title">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-40)]">Shipment log</p>
              <h2 id="timeline-title" className="mt-2 text-3xl font-black tracking-[-0.045em]">Dispatch timeline</h2>
            </div>
            <label className="flex items-center gap-3 text-xs font-bold text-[var(--text-45)]">
              Show
              <select value={timelineFilter} onChange={(event) => { setTimelineFilter(event.target.value); setShowAllTimeline(false); }} className="h-11 max-w-64 rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] px-3 text-xs font-bold text-[var(--text)] outline-none focus:border-[var(--text)]">
                <option value="all">All Thor updates</option>
                {latestVariants.map((item) => <option value={variantKey(item.color, item.model)} key={variantKey(item.color, item.model)}>{item.color} · {modelDisplay(item.model)}</option>)}
              </select>
            </label>
          </div>

          <div className="border-t border-[var(--line)]">
            {visibleTimeline.map((day, dayIndex) => (
              <article key={day.date} className="grid gap-5 border-b border-[var(--line)] py-6 sm:grid-cols-[165px_1fr] sm:py-8">
                <div className="flex items-baseline gap-3 sm:block">
                  <p className="text-2xl font-black tracking-[-0.04em]">{formatDate(day.date, { year: undefined })}</p>
                  <p className="mt-1 text-xs font-bold text-[var(--text-40)]">{formatDate(day.date, { weekday: 'long', month: undefined, day: undefined, year: undefined })}</p>
                  {dayIndex === 0 ? <span className="rounded-full bg-[var(--volt)] px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-[var(--accent-ink)] sm:mt-3 sm:inline-block">Newest</span> : null}
                </div>
                <div className="grid gap-x-6 gap-y-3 lg:grid-cols-2">
                  {day.entries.map((item) => (
                    <div key={`${day.date}-${item.color}-${item.model}-${item.startPrefix}`} className="flex items-center justify-between gap-5 rounded-xl bg-[var(--surface-soft)] px-4 py-3">
                      <span className="text-sm font-bold">{item.color} · {shortModelDisplay(item.model)}</span>
                      <span className="whitespace-nowrap font-mono text-xs font-bold text-[var(--text-55)]">{formatRange(item.startPrefix, item.endPrefix)}</span>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
          {filteredTimeline.length > 7 ? (
            <button type="button" onClick={() => setShowAllTimeline((value) => !value)} className="mt-6 rounded-full border border-[var(--line-strong)] px-5 py-3 text-xs font-black transition hover:bg-[var(--surface)]" aria-expanded={showAllTimeline}>
              {showAllTimeline ? 'Show recent updates' : `Show all ${filteredTimeline.length} update days`}
            </button>
          ) : null}
        </section>

        <aside className="mt-20 grid gap-5 rounded-[28px] border border-[var(--line)] bg-[var(--surface-muted)] p-6 sm:grid-cols-[1fr_auto] sm:items-center sm:p-8" aria-label="About this tracker">
          <div>
            <p className="text-sm font-black">A clear read of AYN’s public data.</p>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-[var(--text-50)]">“Listed” means the first four digits appear inside a range AYN posted for the exact color and tier. It is not carrier tracking, delivery confirmation, or an ETA. Plain “Max” on AYN’s dashboard is treated as the 1TB queue; “Max (512)” remains separate.</p>
            {sourceUpdatedAt ? <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-35)]">Source page updated {formatSourceUpdatedAt(sourceUpdatedAt)}</p> : null}
          </div>
          <a href={SOURCE_PAGE_URL} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center justify-center rounded-full bg-[var(--ink)] px-5 text-xs font-black text-white transition hover:-translate-y-0.5">Open AYN dashboard ↗</a>
        </aside>
      </div>

      <footer className="border-t border-[var(--line)]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-7 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-35)] sm:px-8 lg:px-10">
          <span>Thor Track · Unofficial community utility</span>
          <span>Local watch · Live public source</span>
        </div>
      </footer>
    </main>
  );
}
