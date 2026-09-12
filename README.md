<div align="center">
  <img src="./public/og.png" alt="Thor Track — AYN shipment watch" width="100%" />
  <h1>Thor Track</h1>
  <p><strong>A desktop app for following AYN Thor shipment ranges, with a mobile-friendly web version.</strong></p>
  <p>
    <a href="#how-it-works">How it works</a> ·
    <a href="#install-on-windows">Install on Windows</a> ·
    <a href="#run-from-source">Run from source</a> ·
    <a href="https://www.ayntec.com/pages/shipment-dashboard">Official AYN dashboard</a>
  </p>
</div>

Thor Track is an unofficial community utility that turns AYN's public shipment dashboard into a focused view of the Thor queue. Save an order prefix and exact configuration to see whether it has been listed, how far it is from the latest published range, and—when the data supports it—a cautious dispatch-window estimate.

## Install on Windows

The locally built installer is [`release/Thor-Track-Setup-0.1.3.exe`](./release/Thor-Track-Setup-0.1.3.exe). Double-click it, then open **Thor Track** from its shortcut or the Start menu. The installer is a build artifact in this checkout; it has not been published as a download or signed.

Version 0.1.3 minimizes to the system tray, keeping shipment checks and notifications running without a taskbar button. Choose **Exit** in the running app before installing over the previous version; your saved watch, theme, and history stay in the same app profile. It includes the native desktop connection fix from version 0.1.1.

The installed app needs no Node.js setup, terminal, local URL, or manual database migration. **Minimize to tray**, the window's minimize button, and its close button **×** hide Thor Track in the system tray so checks can continue. Click its tray icon or choose **Show Thor Track** from the icon's menu to reopen the window. Windows may place the icon under the tray's hidden-icons arrow. Choose **Exit** in the app or **Exit Thor Track** from the tray menu to stop checks and quit. Opening it again restores your saved watch, theme, and window position.

Thor Track uses its own profile for your Windows user. A watch saved in your web browser is not imported automatically—enter its prefix, color, and model once in the desktop app.

## What you can do

- **Watch your place in the queue.** Enter an AYN order number, color, and model. Only the first four digits of the order number are retained.
- **Get shipment notifications.** The Windows app checks your watched color and model every ten minutes, including while in the system tray, and notifies you when its published ranges change. Click a notification to open your watch.
- **Keep configurations separate.** Every color and model has its own queue, including separate Max 512GB and Max 1TB ranges.
- **Understand the result.** Thor Track distinguishes orders that are listed, still ahead of the frontier, not explicitly included in a posted range, or waiting on their first configuration update.
- **Open straight to your order.** Saved watches lead with the exact configuration, masked prefix, status, personal progress, and dispatch estimate. Use **Edit order**, **Save**, **Cancel**, or **Clear** to manage it; Refresh and Theme stay in the sticky header.
- **See what changed.** “Since your last visit” highlights your configuration, with other configuration updates tucked into an expandable section. Historical additions and corrections are identified separately from newly published dates.
- **Follow your estimate over time.** Expand the calculation explanation or review the assessments actually displayed on this device, including why a window moved or became unavailable.
- **Explore shipment movement.** Compare the latest range for every configuration, inspect pace statistics, and browse the historical dispatch timeline.
- **Keep the full history.** Successful checks retain older update days even if AYN later removes them from its page. The desktop app keeps this history on your device; the hosted web app maintains a shared public archive.
- **Refresh with confidence.** The app checks AYN when opened, every ten minutes while open, and when you return after its last check becomes stale. If AYN is unavailable, it shows saved history. The installed app can open offline; the web app can also reopen offline after an online visit.
- **Use it comfortably anywhere.** The interface is responsive, keyboard-friendly, and includes a persistent light/dark theme toggle.

## How it works

1. Enter at least the first four digits of your AYN order number.
2. Choose the exact Thor color and model you ordered.
3. Select **Watch this order**.
4. Read the result, then use the trend chart and timeline for more context.

Your saved watch stays on your device, in Thor Track’s app profile or the browser profile used for the web version. There is no account or external notification service. Desktop checks continue in the system tray, but stop when you choose **Exit**, sign out, or shut down Windows. The hosted archive contains only AYN’s public shipment ranges and check timestamps—never order watches. If the app cannot save on your device, it keeps the watch while the current window is open and tells you it could not be saved.

### Desktop notifications

Saving a watch turns on notifications for its exact color and model. The first successful live check establishes a quiet baseline. Later checks notify you about newly published ranges, historical additions, or corrections for that configuration. A check with several changes produces one notification; unchanged data, other configurations, and saved-history fallbacks do not produce notifications. The saved baseline prevents repeat notifications when you reopen the app.

Checks run every **10 minutes** while the app is running, including when its window is hidden in the system tray. The tray menu offers **Show Thor Track** and **Exit Thor Track**. Notifications reopen the app when clicked. Clearing the watch stops its notifications; changing the watched configuration starts a new quiet baseline. No checks run after you exit the app or while Windows is shut down.

Windows controls whether notifications display a banner or make a sound. Enable Thor Track in **Settings → System → Notifications** and check **Do not disturb** if banners do not appear. These desktop notifications are separate from the web version.

### Your visits and personal progress

A visit begins when you open Thor Track, or when you return after it was out of view for **at least 30 minutes**. The comparison uses the last completed shipment check you saw during your previous visit. Its baseline stays fixed throughout the visit, so using **Refresh** keeps changes visible. Reopening the app—or reloading the web version—begins the next visit and compares against what you just saw.

On first use, the app establishes a baseline; comparisons begin with the next visit. Existing watches adopt device history the next time they are opened. Because their original save date is unknown, the label is **“History on this device starts…”**.

The prefix scale labels the initial recorded endpoint, current highest published endpoint for the exact configuration, and your watched prefix. Read the remaining prefix steps and **Last advance** alongside it. These numbers are not a queue percentage or a count of people ahead. If a correction lowers the endpoint, the display identifies the revision. A passed prefix without a matching range remains **Not explicitly listed**.

Only completed live or saved shipment checks displayed while Thor Track is visible enter personal history. Loading previews, checks while it is out of view, and bundled fallback data do not mark changes as seen. When no configuration data exists, the initial endpoint waits until data becomes available. An older fallback cannot replace a newer saved observation. If a live check fails, **“Unable to check for new changes”** is shown rather than claiming there were no updates.

Saving the same prefix, color, and model preserves history. Changing any of those starts a fresh history; **Clear** removes the saved watch and its companion history. History is specific to the app or browser profile on this device, with no account sync or transfer feature.

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

Forecast history retains the **newest 50 meaningful assessments**, showing five initially; **Show history** reveals the rest. It records changes to the window, confidence, unavailable reason, status, or forecast-driving evidence. Identical refreshes are deduplicated, and old predictions are never reconstructed from today’s archive. Window changes state the calendar days earlier or later and the changed inputs. Calendar-only recalculations and a newer dashboard date without movement in your configuration are explicitly distinguished from shipment progress. Assessments are refreshed on data checks and at local midnight while Thor Track remains open.

## Data and privacy

- Shipment ranges come from the [official AYN shipment dashboard](https://www.ayntec.com/pages/shipment-dashboard).
- The desktop app keeps its shipment archive in its own per-user app data. The hosted web version uses a shared D1 archive. Both retain public ranges and source timestamps, updating dates still present on AYN’s page without deleting older dates that have fallen out of its window.
- The app or browser profile stores the four-digit order prefix, chosen configuration, theme preference, and a saved copy of the public timeline for connection failures. The installed app includes its interface; the web version saves its interface after an online visit for offline use.
- The desktop app's local `notifications.json` stores the watched configuration, masked order prefix, and its last checked public ranges so background checks can detect changes and avoid repeat notifications after a restart.
- The existing `thor-track.watch.v1` format is unchanged. The versioned companion `thor-track.experience.v1` holds watch identity, history start time, initial endpoint, latest displayed snapshot with source freshness, revisions, and up to 50 forecast-history entries. A malformed companion does not erase the watch. When storage is unavailable, the open window retains its watch and history for that session.
- The full order number is never retained or sent with shipment requests, and the project has no user-account database.
- If AYN cannot be reached, Thor Track uses its shipment archive and then the last copy saved by the interface. A clearly labeled bundled history remains the final fallback. The desktop archive and a hosted web archive do not sync with each other.
- Plain **Max** on AYN's dashboard is treated as the **1TB** queue; **Max (512)** remains a separate 512GB queue.

## Run from source

### Requirements

- [Node.js](https://nodejs.org/) 22.13 or newer
- npm (included with Node.js)

### Desktop app

```bash
git clone https://github.com/RemyJP-Coding/ThorTracking.git
cd ThorTracking
npm ci
npm start
```

`npm start` and `npm run desktop` build and open the desktop app. Its shipment archive is initialized automatically. Node.js and npm are needed to develop or build from source; users of the Windows installer do not need them.

To create Windows packages:

```bash
npm run desktop:pack
npm run desktop:dist
```

`desktop:pack` creates the unpacked app at `release/win-unpacked/Thor Track.exe`. `desktop:dist` creates the NSIS installer at `release/Thor-Track-Setup-0.1.3.exe`. These are local build outputs; building does not publish or sign them.

### Developer mode

The regular desktop window hides development menus, runtime addresses, and diagnostics. Launch with **`--dev`** to show DevTools and the **Development** menu, including runtime details and access to the app data and diagnostic log. Runtime output is also shown in the launching terminal in this mode.

```bash
npm run desktop:dev
```

This is equivalent to `npm start -- --dev`. For an installed or unpacked build, add `--dev` to the shortcut target after the executable path, for example `"C:\path\to\Thor Track.exe" --dev`. The switch applies when starting the app; choose **Exit** in an already running Thor Track first.

### Web development

The web version remains supported:

```bash
npm run db:migrate:local
npm run dev
```

Open the development URL printed in the terminal. For a production web build, run `npm run build` followed by `npm run web:start`.

No environment variables are required for local development. The migration command creates the project-local D1 archive used by the development server. The server route requests AYN's public feed at runtime and adds each successful result to that archive.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm start` / `npm run desktop` | Build and launch the desktop app. |
| `npm run desktop:dev` | Build and launch the desktop app with `--dev` diagnostics. |
| `npm run desktop:pack` | Build an unpacked Windows app in `release/win-unpacked/`. |
| `npm run desktop:dist` | Build the Windows NSIS installer in `release/`. |
| `npm run test:desktop` | Run the desktop smoke test. |
| `npm run test:desktop:notifications` | Verify checks while hidden in the system tray, native notifications, and click-to-refresh using an isolated profile. |
| `npm run test:desktop:runtime` | Check desktop history migrations, restart persistence, and runtime shutdown after a build. |
| `npm run dev` | Start the local Vinext web development server. |
| `npm run db:generate` | Generate a new D1 migration after an intentional schema change. |
| `npm run db:migrate:local` | Apply pending migrations to the project-local D1 database. |
| `npm test` | Run shipment forecasting, trend, storage, and API-route tests. |
| `npm run lint` | Check the TypeScript and React source with ESLint. |
| `npm run build` | Create a production web build. |
| `npm run web:start` | Serve the production web build locally. |

## Troubleshooting

### My watch disappeared

The desktop app and web browser have separate profiles. When moving from the web version to the desktop app, enter the prefix and configuration once. Another Windows user or device has its own profile too. Clearing app data removes the desktop watch; in the web version, private browsing, blocked storage, or cleared browser data can remove it. Save your watch again in the profile you want to use.

### The desktop app could not open

Choose **Try again** in the app’s message, or close and reopen Thor Track. Your saved order and history are kept. For development troubleshooting, launch with `--dev` to see the underlying error and diagnostic log location.

### Refresh says live data is unavailable

Check your connection, try **Refresh** again, and compare the result with AYN's official dashboard. Thor Track continues to show its last-known timeline and identifies that it could not load live data.

### I am not seeing desktop notifications

Confirm that an order watch is saved and Thor Track is still running. Leave it in the system tray to continue checks, or reopen the app from its tray icon and select **Refresh**. The first successful check is quiet, and a new notification requires a change to the watched color and model. An unavailable source or unchanged history does not trigger one. Check Windows **Settings → System → Notifications → Thor Track** and **Do not disturb** if Windows is suppressing banners.

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
desktop/                    # Desktop window, runtime, and launch policy
release/                    # Generated Windows app and installer (ignored)
```

The app uses React 19, Next.js 16 App Router conventions, TypeScript, Tailwind CSS 4, Vinext, Vite, OpenAI Sites tooling, and a Cloudflare-compatible runtime. Electron provides the desktop window and per-user profile; the desktop package includes its runtime.

## Before opening a pull request

Run the complete local check:

```bash
npm test
npm run lint
npm run build
npm run test:desktop:runtime
npm run test:desktop
```

The desktop smoke test opens real app windows with a fresh, isolated profile under `outputs/desktop-qa/`. To test the packaged app, set `THOR_TRACK_EXECUTABLE` to the absolute path of `release/win-unpacked/Thor Track.exe` before running it. It checks normal and `--dev` launches, automatic first-use setup, saved watches and themes, window restoration, second launches, and shutdown of the app and its background runtime.

For release verification with internet access, also set `THOR_TRACK_REQUIRE_LIVE=1`. This requires both initial and manual refreshes after reopening to return live AYN data; an archived fallback cannot pass the online check. The runtime integration suite separately verifies successful updates and saved-history fallback with deterministic source responses.

When changing shipment logic, keep color/model queues isolated and add a focused test for the new behavior. When changing the tracker UI, verify both a narrow phone layout and a desktop layout, including keyboard focus and light/dark themes.

The optional deterministic browser acceptance suite is `tests/personal-dashboard.browser.mjs`. With the development server running and Playwright/Chromium available, run `node tests/personal-dashboard.browser.mjs`. Set `THOR_QA_URL` to the local server URL (default `http://localhost:3001`) and, when using a separately installed Playwright, set `THOR_PLAYWRIGHT_MODULE` to its `index.mjs`. The suite intercepts shipment requests with fixtures and uses isolated browser profiles; it does not depend on a new AYN publication. Screenshots go to the ignored `outputs/personal-dashboard-qa/` directory. Phone checks use browser emulation, not physical devices.

Notifications, multiple watches, configuration comparisons, and device transfer remain deferred. Windows installer output is local and unpublished; publication requires separate explicit approval.

---

Thor Track is an independent community project and is not affiliated with or endorsed by AYN. Always treat the official AYN dashboard and direct communication from AYN as the source of truth.
