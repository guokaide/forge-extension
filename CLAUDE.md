# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Forge

Forge is a Chrome Manifest V3 extension that manages attention by making users "earn" entertainment time through work. It tracks work and entertainment site usage, computing an entertainment balance:

```
entertainmentBalance = currentThreshold + today.workTime - today.entertainmentTime
```

When the balance hits zero (and entertainment time has been used today, and full-day unlock is not active), blocked sites are redirected to a lock screen. Full-day unlock activates when `today.workTime >= settings.fullUnlockWork`, clearing all blocks for the day.

**Time attribution (intentional design tradeoff):** every non-idle tick counts as work unless the active tab is on a blocked site. Time outside the browser (up to the 10-minute idle threshold) and time on non-blocked sites both count as work. This is generous by design — Forge is a self-discipline aid, not surveillance, so ambiguity favors the user. Nothing accrues while Chrome is not running. Do not "fix" this by adding a work-site whitelist without an explicit product decision.

## Build & Verify

```bash
npm install
npm run build          # one-shot build to dist/
npm run dev            # watch mode with auto-rebuild
```

After code changes, always run:

```bash
npm exec --yes --package=typescript -- tsc --noEmit   # type check
npm run build                                          # build
git diff --check                                       # whitespace check
```

There is no test framework — verification is type checking + manual testing in Chrome (`chrome://extensions/` → load `dist/`).

## Architecture

**Build system:** `build.mjs` uses esbuild to bundle TypeScript entry points as IIFE for Chrome 120+. It also copies static HTML/CSS assets and generates PNG icons programmatically. Output goes to `dist/` (never edit `dist/` directly).

**Entry points** (each is a standalone page with its own HTML/CSS/TS):

| Entry | Purpose |
|-------|---------|
| `src/background.ts` | Service worker: 1-minute tick timer, tab/idle tracking, declarativeNetRequest blocking, badge updates |
| `src/newtab/` | New tab override: daily progress, balance, open tabs, plus inline dashboard (7-day history, site time) and settings panels (opened via `#dashboard` / `#settings` hash) |
| `src/popup/` | Extension popup: quick status view |
| `src/blocked/` | Lock screen shown when entertainment sites are blocked |

**Shared layer** (`src/shared/`):

- `types.ts` — `ForgeState`, `DayData`, `ForgeSettings` interfaces and defaults
- `store.ts` — all business logic: state persistence (`chrome.storage.local`), daily rollover, balance calculations, lock reconciliation, history queries. This is where core logic should live.

**Data flow:** The background service worker runs a 1-minute alarm (`forge-tick`). Each tick: sync active tab → determine if user is idle/working/entertained → accumulate time → reconcile lock state → update declarativeNetRequest rules → update badge. UI pages read state via `getState()`, re-render on `chrome.storage.onChanged`, and signal changes via `chrome.runtime.sendMessage({ type: 'stateChanged' })`.

**Per-site tracking** uses `chrome.storage.session` for ephemeral tracking state (current host, focus, idle) and `chrome.storage.local` for persistent per-day site-time data. Intervals are capped at 90 seconds and split across midnight boundaries.

## Development Rules

- Keep business logic in `src/shared/store.ts`; UI pages should be thin consumers.
- Keep UI behavior synchronized across newtab, popup, and blocked pages when shared.
- Prefer existing patterns before introducing new abstractions.
- `manifest.json` is the source of truth for extension entry points and permissions.
- Times are in minutes for work/entertainment tracking, seconds for per-site tracking.
