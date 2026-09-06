<div align="center">
  <img src="./public/og.png" alt="Thor Track — AYN shipment watch" width="100%" />
  <h1>Thor Track</h1>
  <p><strong>A clear, mobile-friendly way to follow AYN Thor shipment ranges.</strong></p>
  <p>
    <a href="#how-it-works">How it works</a> ·
    <a href="#run-locally">Run locally</a> ·
    <a href="https://www.ayntec.com/pages/shipment-dashboard">Official AYN dashboard</a>
  </p>
</div>

Thor Track is an unofficial community utility that turns AYN's public shipment dashboard into a focused view of the Thor queue. Save an order prefix and exact configuration to see whether it has been listed, how far it is from the latest published range, and—when the data supports it—a cautious dispatch-window estimate.

## What you can do

- **Watch your place in the queue.** Enter an AYN order number, color, and model. Only the first four digits of the order number are retained.
- **Keep configurations separate.** Every color and model has its own queue, including separate Max 512GB and Max 1TB ranges.
- **Understand the result.** Thor Track distinguishes orders that are listed, still ahead of the frontier, not explicitly included in a posted range, or waiting on their first configuration update.
- **Open straight to your order.** Saved watches lead with the exact configuration, masked prefix, status, personal progress, and dispatch estimate. Use **Edit order**, **Save**, **Cancel**, or **Clear** to manage it; Refresh and Theme stay in the sticky header.
- **See what changed.** “Since your last visit” highlights your configuration, with other configuration updates tucked into an expandable section. Historical additions and corrections are identified separately from newly published dates.
- **Follow your estimate over time.** Expand the calculation explanation or review the assessments actually displayed on this device, including why a window moved or became unavailable.
- **Explore shipment movement.** Compare the latest range for every configuration, inspect pace statistics, and browse the historical dispatch timeline.
- **Keep the full history.** Every successful scrape is merged into a shared archive, so older update days remain available even if AYN’s page becomes a moving window.
- **Refresh with confidence.** The app checks AYN on load, every ten minutes while open, and when a stale tab becomes active again. If AYN is unavailable, it serves the saved archive instead. After an online visit, the app shell and public timeline are also available to that browser while offline.
- **Use it comfortably anywhere.** The interface is responsive, keyboard-friendly, and includes a persistent light/dark theme toggle.

## How it works

1. Enter at least the first four digits of your AYN order number.
2. Choose the exact Thor color and model you ordered.
3. Select **Watch this order**.
4. Read the result, then use the trend chart and timeline for more context.

Your saved watch stays in that browser. There is no account, server-side watch list, background monitoring, or notification service. The shared database contains only AYN’s public shipment ranges and scrape timestamps—never order watches. If browser storage is blocked, Thor Track keeps the watch for the current tab and tells you that it may not survive after the tab closes.

### Your visits and personal progress

A visit begins on a page load or reload, or when you return after the page was hidden for **at least 30 minutes**. The comparison uses the last settled shipment snapshot you saw during your previous visit. Its baseline stays fixed throughout the visit, so using **Refresh** keeps changes visible. Reloading the page begins the next visit and compares against what you just saw.

On first use, the app establishes a baseline; comparisons begin with the next visit. Existing watches adopt device history the next time they are opened. Because their original save date is unknown, the label is **“History on this device starts…”**.

The prefix scale labels the initial recorded endpoint, current highest published endpoint for the exact configuration, and your watched prefix. Read the remaining prefix steps and **Last advance** alongside it. These numbers are not a queue percentage or a count of people ahead. If a correction lowers the endpoint, the display identifies the revision. A passed prefix without a matching range remains **Not explicitly listed**.

Only settled live or archived observations displayed while the page is visible enter personal history. Loading previews, hidden-tab refreshes, and bundled fallback data do not mark changes as seen. When no configuration data exists, the initial endpoint waits until data becomes available. An older fallback cannot replace a newer saved observation. If a live check fails, **“Unable to check for new changes”** is shown rather than claiming there were no updates.

Saving the same prefix, color, and model preserves history. Changing any of those starts a fresh history; **Clear** removes the saved watch and its companion history. History is specific to this browser and device, with no account sync or transfer feature.

### Understanding watch statuses

| Status | What it means |
| --- | --- |
| **Listed by AYN** | The first four digits fall inside a range AYN published for the exact color and model. |
| **Watching** | The prefix is beyond that configuration's latest published endpoint. Thor Track shows the remaining prefix steps. |
| **Not explicitly listed** | AYN has published later prefixes for the configuration, but not a range containing this one. Thor Track does not guess across the gap. |
| **No range yet** | AYN has not published shipment data for that exact configuration. The watch remains saved. |

### About dispatch estimates

When an order is still ahead of the published frontier, Thor Track may show an inclusive seven-day **Estimated AYN dispatch window**. The estimate:

- uses only the selected color and model's history;
- follows the highest published endpoint over calendar time;
- requires recent, positive movement and enough history to support an estimate;
- is withheld when the source is stale, the queue is too sparse, or the projection is more than 90 days away; and
- includes a very low, low, or moderate confidence label.

This predicts when a prefix may appear on AYN's shipment dashboard. It is **not** an AYN promise, carrier tracking result, delivery confirmation, or delivery ETA.

**How this estimate is calculated** shows the remaining prefix steps, observed pace, advancing intervals, training span, and last advance. Pace uses the median of changes between pairs of endpoint observations, allowing for calendar gaps and plateaus. **Last advance** refers to the highest endpoint's advance date, which can be earlier than the latest published row. Confidence reflects the amount, consistency, freshness, and projection distance of the evidence; it does not claim a probability or measured accuracy. Saved/archive estimates retain the existing confidence cap of low (very low stays very low).

Unavailable estimates explain the first applicable reason: no shipment history, no exact-configuration history, already listed, passed without a matching range, a dashboard date more than 45 days old, no configuration advance for more than 28 days, insufficient advancing history, unusable positive pace, or a projection beyond 90 days.

Forecast history retains the **newest 50 meaningful assessments**, showing five initially; **Show history** reveals the rest. It records changes to the window, confidence, unavailable reason, status, or forecast-driving evidence. Identical refreshes are deduplicated, and old predictions are never reconstructed from today’s archive. Window changes state the calendar days earlier or later and the changed inputs. Calendar-only recalculations and a newer dashboard date without movement in your configuration are explicitly distinguished from shipment progress. Assessments are refreshed on data checks and at local midnight while the page remains open.

## Data and privacy

- Shipment ranges come from the [official AYN shipment dashboard](https://www.ayntec.com/pages/shipment-dashboard).
- A shared D1 archive stores public shipment ranges and source timestamps. New scrapes update dates still present on AYN’s page without deleting older dates that have fallen out of its window.
- The browser stores the four-digit order prefix, chosen configuration, theme preference, and a cached copy of the public timeline for connection failures. A service worker caches the app shell after an online visit so that copy can still be displayed offline.
- The existing `thor-track.watch.v1` format is unchanged. The versioned companion `thor-track.experience.v1` holds watch identity, history start time, initial endpoint, latest displayed snapshot with source freshness, revisions, and up to 50 forecast-history entries. A malformed companion does not erase the watch. When storage is unavailable, the active tab retains its watch and history for the session.
- The full order number is never retained or sent to the shipment endpoint, and the project has no user-account database.
- If AYN cannot be reached, the API serves the shared archive. If the tracker API cannot be reached, the browser serves its last saved copy. A clearly labeled bundled history remains the final fallback.
- Plain **Max** on AYN's dashboard is treated as the **1TB** queue; **Max (512)** remains a separate 512GB queue.

## Run locally

### Requirements

- [Node.js](https://nodejs.org/) 22.13 or newer
- npm (included with Node.js)

### Setup

```bash
git clone https://github.com/RemyJP-Coding/ThorTracking.git
cd ThorTracking
npm ci
npm run db:migrate:local
npm run dev
```

Open the local URL printed in the terminal.

No environment variables are required for local development. The migration command creates the project-local D1 archive used by the development server. The server route requests AYN's public feed at runtime and adds each successful result to that archive.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local Vinext development server. |
| `npm run db:generate` | Generate a new D1 migration after an intentional schema change. |
| `npm run db:migrate:local` | Apply pending migrations to the project-local D1 database. |
| `npm test` | Run shipment forecasting, trend, storage, and API-route tests. |
| `npm run lint` | Check the TypeScript and React source with ESLint. |
| `npm run build` | Create a production build. |
| `npm start` | Serve the production build locally. |

## Troubleshooting

### My watch disappeared

Watches stay in the current browser profile. Private browsing, blocked site storage, cleared browser data, or another device will not have the saved watch. Allow site storage and save it again.

### Refresh says live data is unavailable

Check your connection, try **Refresh** again, and compare the result with AYN's official dashboard. Thor Track continues to show its last-known timeline and identifies that it could not load live data.

### No estimate is shown

This is often intentional. Thor Track withholds an estimate when the exact queue lacks enough recent movement, its data is stale or flat, or the projected prefix is too far away.

### The status is not what I expected

Confirm the first four digits, color, and model. Every configuration is evaluated separately, and the 512GB and 1TB Max queues are never combined.

## Project map

```text
app/
├── api/shipments/route.ts  # Live scrape with shared-archive fallback
├── lib/shipment-archive.ts # Append-only D1 shipment history
├── lib/shipment-cache.ts   # Validated browser fallback cache
├── lib/shipments.ts        # Parsing, status, trend, and forecast logic
├── lib/watch-storage.ts    # Safe browser-local watch persistence
├── lib/shipment-comparison.ts # Normalized ranges and visit comparisons
├── lib/experience.ts       # Validated companion record and pure visit/history rules
├── lib/use-experience.ts   # Visible-display persistence and visit lifecycle
├── personal-dashboard.tsx # Saved-order progress, changes, and estimate history
├── thor-tracker.tsx        # Main responsive tracker interface
├── globals.css             # Theme and presentation styles
└── layout.tsx              # Metadata and early theme setup
tests/                      # Node test suite
db/schema.ts                # Drizzle definition for the D1 archive
drizzle/                    # Generated, append-only schema migrations
public/og.png               # Social and README artwork
public/sw.js                # Offline app-shell and API-response cache
```

The app uses React 19, Next.js 16 App Router conventions, TypeScript, Tailwind CSS 4, Vinext, Vite, OpenAI Sites tooling, and a Cloudflare-compatible runtime.

## Before opening a pull request

Run the complete local check:

```bash
npm test
npm run lint
npm run build
```

When changing shipment logic, keep color/model queues isolated and add a focused test for the new behavior. When changing the tracker UI, verify both a narrow phone layout and a desktop layout, including keyboard focus and light/dark themes.

The optional deterministic browser acceptance suite is `tests/personal-dashboard.browser.mjs`. With the development server running and Playwright/Chromium available, run `node tests/personal-dashboard.browser.mjs`. Set `THOR_QA_URL` to the local server URL (default `http://localhost:3001`) and, when using a separately installed Playwright, set `THOR_PLAYWRIGHT_MODULE` to its `index.mjs`. The suite intercepts shipment requests with fixtures and uses isolated browser profiles; it does not depend on a new AYN publication. Screenshots go to the ignored `outputs/personal-dashboard-qa/` directory. Phone checks use browser emulation, not physical devices.

This release adds no HTTP endpoints or database migrations. Notifications, multiple watches, configuration comparisons, installation flows, and device transfer remain deferred. Publication requires separate explicit approval.

---

Thor Track is an independent community project and is not affiliated with or endorsed by AYN. Always treat the official AYN dashboard and direct communication from AYN as the source of truth.
