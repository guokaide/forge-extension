# AGENTS.md

This file gives coding agents the project rules for working on Forge.

## Project Facts

- Forge is a Chrome Manifest V3 extension.
- Source code lives in `src/`.
- Chrome loads the generated extension from `dist/`.
- Do not manually edit `dist/`; run the build instead.
- `manifest.json` is the source of truth for extension entrypoints and permissions.

## Important Files

- `src/shared/store.ts`: state shape handling, daily rollover, entertainment balance, lock reconciliation, history helpers.
- `src/background.ts`: service worker, tab/activity tracking, badge updates, lock redirects.
- `src/shared/types.ts`: shared TypeScript interfaces and default settings.
- `build.mjs`: copies static assets, generates icons, and bundles TypeScript into `dist/`.

## Core Behavior

The entertainment balance model is:

```text
entertainmentBalance = currentThreshold + today.workTime - today.entertainmentTime
```

A site is locked when the user has entertainment time today, full-day unlock is not active, and entertainment balance is less than or equal to zero.

Full-day unlock still overrides normal entertainment locking once today's work time reaches `settings.fullUnlockWork`.

## Development Rules

- Prefer existing patterns in the local files before introducing new abstractions.
- Keep UI changes synchronized across new tab, popup, dashboard, options, and blocked pages when the behavior is shared.
- Keep business logic centralized in `src/shared/store.ts` where practical.
- Avoid unrelated refactors while making focused product changes.
- Do not revert user changes unless explicitly requested.
- Before committing, check `git status --short`.

## Verification

After code changes, run:

```bash
npm exec --yes --package=typescript -- tsc --noEmit
npm run build
git diff --check
```

For documentation-only changes, at least run:

```bash
npm run build
git diff --check
git status --short
```
