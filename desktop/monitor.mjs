import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readNotificationState, setNotificationWatch, observeNotificationFeed } from './notification-state.mjs';

export const CHECK_INTERVAL_MS = 10 * 60 * 1000;

/** One request at a time for both the window and background shipment checks. */
export function createShipmentMonitor({ dataDirectory, fetchFeed, notify, onError = () => {},
  isBackground = () => true, intervalMs = CHECK_INTERVAL_MS }) {
  const statePath = path.join(dataDirectory, 'notifications.json');
  let state = readNotificationState(null);
  try { state = readNotificationState(JSON.parse(readFileSync(statePath, 'utf8'))); } catch { /* First launch. */ }
  let synchronized = false;
  let stopped = false;
  let timer;
  let inFlight;
  let controller;
  const report = (error) => { try { onError(error); } catch { /* Keep checks available. */ } };
  const save = () => {
    try {
      writeFileSync(`${statePath}.tmp`, JSON.stringify(state));
      renameSync(`${statePath}.tmp`, statePath);
    } catch (error) { report(error); }
  };
  const schedule = () => {
    clearTimeout(timer);
    if (stopped || !synchronized || !state.watch) return;
    timer = setTimeout(() => {
      if (isBackground()) void checkInBackground();
      else schedule();
    }, intervalMs);
    timer.unref?.();
  };
  async function refresh() {
    if (stopped) throw new Error('Shipment checks have stopped.');
    if (!inFlight) {
      controller = new AbortController();
      inFlight = (async () => {
        const response = await fetchFeed(controller.signal);
        // Buffer once so simultaneous consumers have independent response bodies.
        const body = await response.arrayBuffer();
        const result = { body, status: response.status, statusText: response.statusText, headers: response.headers };
        if (!stopped && synchronized && response.ok) {
          try {
            const feed = JSON.parse(new TextDecoder().decode(body));
            const next = observeNotificationFeed(state, feed);
            if (next.state !== state) { state = next.state; save(); }
            if (next.notification) await notify(next.notification);
          } catch (error) { report(error); }
        }
        return result;
      })().finally(() => { inFlight = undefined; controller = undefined; schedule(); });
    }
    const result = await inFlight;
    return new Response(result.body.slice(0), { status: result.status, statusText: result.statusText, headers: result.headers });
  }
  async function checkInBackground() {
    if (stopped || !synchronized || !state.watch) return;
    try { await refresh(); } catch (error) { report(error); }
  }
  return {
    setWatch(watch) {
      if (stopped) return;
      const next = setNotificationWatch(state, watch);
      synchronized = true;
      if (next !== state) { state = next; save(); }
      // Idempotent renderer synchronization must not postpone an existing timer.
      if (!state.watch) { clearTimeout(timer); timer = undefined; }
      else if (!timer && !inFlight) schedule();
    },
    refresh,
    checkInBackground,
    stop() {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
    },
  };
}
