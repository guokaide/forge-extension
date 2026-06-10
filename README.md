# Forge

**Earn your screen time.**

Forge is a Chrome extension that tracks your work and entertainment time, then blocks entertainment sites when your balance runs out. Work more, play more. Simple as that.

No server. No account. No external API calls. Just a Chrome extension.

---

## How it works

```
You browse normally
  -> Forge silently tracks work time vs entertainment time
  -> You start each day with a free entertainment allowance (default: 60 min)
  -> Every minute of work earns another minute of entertainment
  -> When your balance hits zero, entertainment sites get blocked
  -> Work a bit more to unlock, or hit 3 hours of work to unlock the whole day
```

The core formula:

```
Entertainment balance = free allowance + work time - entertainment time
```

**What counts as work?** Any non-idle minute where your active tab isn't on a blocked site. Browsing non-blocked sites and time spent outside the browser (until you've been idle for 10 minutes) both count as work. This is generous by design — Forge is a self-discipline aid, not surveillance — and note that nothing accrues while Chrome isn't running.

Everything runs inside the Chrome extension. No external server, no data sent anywhere.

---

## Install with a coding agent

Send your coding agent (Claude Code, Codex, etc.) this repo and say **"install this"**:

```
https://github.com/guokaide/forge-extension
```

The agent will clone it, run `npm install && npm run build`, and walk you through loading it in Chrome. Takes about 1 minute.

---

## Manual setup

**1. Clone and build**

```bash
git clone https://github.com/guokaide/forge-extension.git
cd forge-extension
npm install
npm run build
```

**2. Load the Chrome extension**

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Navigate to the `dist/` folder inside the cloned repo and select it

**3. Open a new tab**

You'll see Forge.

---

## Features

- **New tab dashboard** shows today's work progress, entertainment balance, and open tabs at a glance
- **Automatic time tracking** counts work minutes when you're on non-entertainment sites (or when the browser is in the background)
- **Smart blocking** redirects entertainment sites to a motivational lock screen when balance runs out
- **Full-day unlock** hit 3 hours of work and all blocks are cleared for the day
- **Streak tracking** see how many consecutive days you've hit your work goal
- **Daily penalty** skip your work goal yesterday? Today's free allowance shrinks
- **Per-site breakdown** see exactly how much time you spent on each domain
- **7-day history** track your work and entertainment trends over the past week
- **Customizable** set your own entertainment allowance, work goal, and blocked sites
- **100% local** your data never leaves your machine

---

## Pages

| Page | What it does |
|------|-------------|
| New tab | Daily dashboard with progress, balance, and open tabs |
| Popup | Quick status view when you click the extension icon |
| Dashboard | 7-day history and per-site time breakdown |
| Settings | Configure blocked sites, allowance, and work goal |
| Blocked | Motivational lock screen with stats and progress |

---

## Tech stack

| What | How |
|------|-----|
| Extension | Chrome Manifest V3 |
| Language | TypeScript |
| Bundler | esbuild (IIFE for Chrome 120+) |
| Storage | chrome.storage.local + chrome.storage.session |
| Blocking | declarativeNetRequest (redirect rules) |
| Time tracking | chrome.alarms + chrome.idle + chrome.tabs |

---

## Development

```bash
npm run dev          # watch mode with auto-rebuild
```

After changes:

```bash
npx tsc --noEmit     # type check
npm run build        # production build
```

No test framework — verification is type checking + manual testing in Chrome.

---

## Acknowledgments

The open tabs feature on the new tab page is built on code from [Tab Out](https://github.com/zarazhangrui/tab-out) by [Zara](https://x.com/zarazhangrui). Thanks for the great work.

---

## License

MIT
