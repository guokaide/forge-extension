import {
  getState, getStreak, getHistory, saveState,
  getUnlockWorkNeeded, getFullUnlockWorkRemaining, extractDomain, reconcileLockState,
  getEntertainmentBalance, getEntertainmentUsagePct,
} from '../shared/store.js';

// ================================================================
// TYPES
// ================================================================

interface TabInfo {
  url: string;
  title: string;
  isForgeTab: boolean;
}

interface DomainGroup {
  domain: string;
  tabs: TabInfo[];
}

interface DeferredTab {
  id: string;
  url: string;
  title: string;
  savedAt: string;
  completed: boolean;
  completedAt?: string;
  dismissed: boolean;
}

// ================================================================
// STATE
// ================================================================

let openTabs: TabInfo[] = [];
let domainGroups: DomainGroup[] = [];

// ================================================================
// FORMAT HELPER
// ================================================================

function fmt(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.ceil(min % 60);
  if (h > 0 && m === 0) return `${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ================================================================
// CHROME TAB MANAGEMENT
// ================================================================

async function fetchOpenTabs(): Promise<void> {
  try {
    const extensionId = chrome.runtime.id;
    const newtabUrl = `chrome-extension://${extensionId}/newtab/newtab.html`;
    const tabs = await chrome.tabs.query({});
    openTabs = tabs.map(t => ({
      url: t.url || '',
      title: t.title || '',
      isForgeTab: t.url === newtabUrl || t.url === 'chrome://newtab/',
    }));
  } catch {
    openTabs = [];
  }
}

async function closeTabsByUrls(urls: string[]): Promise<void> {
  if (!urls || urls.length === 0) return;
  const targetHostnames: string[] = [];
  const exactUrls = new Set<string>();
  for (const u of urls) {
    if (u.startsWith('file://')) {
      exactUrls.add(u);
    } else {
      try { targetHostnames.push(new URL(u).hostname); } catch {}
    }
  }
  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs
    .filter(tab => {
      const tabUrl = tab.url || '';
      if (tabUrl.startsWith('file://') && exactUrls.has(tabUrl)) return true;
      try {
        const tabHostname = new URL(tabUrl).hostname;
        return tabHostname && targetHostnames.includes(tabHostname);
      } catch { return false; }
    })
    .map(tab => tab.id!);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

async function closeTabsExact(urls: string[]): Promise<void> {
  if (!urls || urls.length === 0) return;
  const urlSet = new Set(urls);
  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs.filter(t => urlSet.has(t.url!)).map(t => t.id!);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

async function focusTab(url: string): Promise<void> {
  if (!url) return;
  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();
  let matches = allTabs.filter(t => t.url === url);
  if (matches.length === 0) {
    try {
      const targetHost = new URL(url).hostname;
      matches = allTabs.filter(t => {
        try { return new URL(t.url!).hostname === targetHost; } catch { return false; }
      });
    } catch {}
  }
  if (matches.length === 0) return;
  const match = matches.find(t => t.windowId !== currentWindow.id) || matches[0];
  await chrome.tabs.update(match.id!, { active: true });
  await chrome.windows.update(match.windowId!, { focused: true });
}

async function closeDuplicateTabs(urls: string[], keepOne = true): Promise<void> {
  const allTabs = await chrome.tabs.query({});
  const toClose: number[] = [];
  for (const url of urls) {
    const matching = allTabs.filter(t => t.url === url);
    if (keepOne) {
      const keep = matching.find(t => t.active) || matching[0];
      for (const tab of matching) {
        if (tab.id !== keep.id) toClose.push(tab.id!);
      }
    } else {
      for (const tab of matching) toClose.push(tab.id!);
    }
  }
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

async function closeForgeDupes(): Promise<void> {
  const extensionId = chrome.runtime.id;
  const newtabUrl = `chrome-extension://${extensionId}/newtab/newtab.html`;
  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();
  const forgeTabs = allTabs.filter(t =>
    t.url === newtabUrl || t.url === 'chrome://newtab/'
  );
  if (forgeTabs.length <= 1) return;
  const keep =
    forgeTabs.find(t => t.active && t.windowId === currentWindow.id) ||
    forgeTabs.find(t => t.active) ||
    forgeTabs[0];
  const toClose = forgeTabs.filter(t => t.id !== keep.id).map(t => t.id!);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

// ================================================================
// SAVED FOR LATER
// ================================================================

async function saveTabForLater(tab: { url: string; title: string }): Promise<void> {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  deferred.push({
    id: Date.now().toString(),
    url: tab.url,
    title: tab.title,
    savedAt: new Date().toISOString(),
    completed: false,
    dismissed: false,
  });
  await chrome.storage.local.set({ deferred });
}

async function getSavedTabs(): Promise<{ active: DeferredTab[]; archived: DeferredTab[] }> {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const visible = deferred.filter((t: DeferredTab) => !t.dismissed);
  return {
    active: visible.filter((t: DeferredTab) => !t.completed),
    archived: visible.filter((t: DeferredTab) => t.completed),
  };
}

async function checkOffSavedTab(id: string): Promise<void> {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find((t: DeferredTab) => t.id === id);
  if (tab) {
    tab.completed = true;
    tab.completedAt = new Date().toISOString();
    await chrome.storage.local.set({ deferred });
  }
}

async function dismissSavedTab(id: string): Promise<void> {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find((t: DeferredTab) => t.id === id);
  if (tab) {
    tab.dismissed = true;
    await chrome.storage.local.set({ deferred });
  }
}

// ================================================================
// UI HELPERS
// ================================================================

function playCloseSound(): void {
  try {
    const ctx = new AudioContext();
    const t = ctx.currentTime;
    const duration = 0.25;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const pos = i / data.length;
      const env = pos < 0.1 ? pos / 0.1 : Math.pow(1 - (pos - 0.1) / 0.9, 1.5);
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.0;
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t);
    setTimeout(() => ctx.close(), 500);
  } catch {}
}

function shootConfetti(x: number, y: number): void {
  const colors = ['#c8713a', '#e8a070', '#5a7a62', '#8aaa92', '#5a6b7a', '#8a9baa', '#d4b896', '#b35a5a'];
  for (let i = 0; i < 17; i++) {
    const el = document.createElement('div');
    const isCircle = Math.random() > 0.5;
    const size = 5 + Math.random() * 6;
    const color = colors[Math.floor(Math.random() * colors.length)];
    el.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${size}px;height:${size}px;background:${color};border-radius:${isCircle ? '50%' : '2px'};pointer-events:none;z-index:9999;transform:translate(-50%,-50%);opacity:1;`;
    document.body.appendChild(el);
    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 120;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed - 80;
    const gravity = 200;
    const startTime = performance.now();
    const dur = 700 + Math.random() * 200;
    function frame(now: number) {
      const elapsed = (now - startTime) / 1000;
      const progress = elapsed / (dur / 1000);
      if (progress >= 1) { el.remove(); return; }
      const px = vx * elapsed;
      const py = vy * elapsed + 0.5 * gravity * elapsed * elapsed;
      const opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;
      const rotate = elapsed * 200 * (isCircle ? 0 : 1);
      el.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) rotate(${rotate}deg)`;
      el.style.opacity = String(opacity);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
}

function animateCardOut(card: HTMLElement): void {
  if (!card) return;
  const rect = card.getBoundingClientRect();
  shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
  card.classList.add('closing');
  setTimeout(() => { card.remove(); checkAndShowEmptyState(); }, 300);
}

function showToast(message: string): void {
  const toast = document.getElementById('toast')!;
  document.getElementById('toastText')!.textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2500);
}

function checkAndShowEmptyState(): void {
  const missionsEl = document.getElementById('openTabsMissions');
  if (!missionsEl) return;
  const remaining = missionsEl.querySelectorAll('.mission-card:not(.closing)').length;
  if (remaining > 0) return;
  missionsEl.innerHTML = `
    <div class="missions-empty-state">
      <div class="empty-checkmark">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </div>
      <div class="empty-title">Inbox zero, but for tabs.</div>
      <div class="empty-subtitle">You're free.</div>
    </div>`;
  const countEl = document.getElementById('openTabsSectionCount');
  if (countEl) countEl.textContent = '0 domains';
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return '';
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  const diffMins = Math.floor((now - then) / 60000);
  const diffHours = Math.floor((now - then) / 3600000);
  const diffDays = Math.floor((now - then) / 86400000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return diffMins + ' min ago';
  if (diffHours < 24) return diffHours + ' hr' + (diffHours !== 1 ? 's' : '') + ' ago';
  if (diffDays === 1) return 'yesterday';
  return diffDays + ' days ago';
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function getDateDisplay(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

// ================================================================
// DOMAIN & TITLE HELPERS
// ================================================================

const FRIENDLY_DOMAINS: Record<string, string> = {
  'github.com': 'GitHub', 'www.github.com': 'GitHub', 'gist.github.com': 'GitHub Gist',
  'youtube.com': 'YouTube', 'www.youtube.com': 'YouTube', 'music.youtube.com': 'YouTube Music',
  'x.com': 'X', 'www.x.com': 'X', 'twitter.com': 'X', 'www.twitter.com': 'X',
  'reddit.com': 'Reddit', 'www.reddit.com': 'Reddit', 'old.reddit.com': 'Reddit',
  'substack.com': 'Substack', 'www.substack.com': 'Substack',
  'medium.com': 'Medium', 'www.medium.com': 'Medium',
  'linkedin.com': 'LinkedIn', 'www.linkedin.com': 'LinkedIn',
  'stackoverflow.com': 'Stack Overflow', 'www.stackoverflow.com': 'Stack Overflow',
  'news.ycombinator.com': 'Hacker News',
  'google.com': 'Google', 'www.google.com': 'Google',
  'mail.google.com': 'Gmail', 'docs.google.com': 'Google Docs',
  'drive.google.com': 'Google Drive', 'calendar.google.com': 'Google Calendar',
  'meet.google.com': 'Google Meet', 'gemini.google.com': 'Gemini',
  'chatgpt.com': 'ChatGPT', 'www.chatgpt.com': 'ChatGPT', 'chat.openai.com': 'ChatGPT',
  'claude.ai': 'Claude', 'www.claude.ai': 'Claude', 'code.claude.com': 'Claude Code',
  'notion.so': 'Notion', 'www.notion.so': 'Notion',
  'figma.com': 'Figma', 'www.figma.com': 'Figma',
  'slack.com': 'Slack', 'app.slack.com': 'Slack',
  'discord.com': 'Discord', 'www.discord.com': 'Discord',
  'wikipedia.org': 'Wikipedia', 'en.wikipedia.org': 'Wikipedia',
  'amazon.com': 'Amazon', 'www.amazon.com': 'Amazon',
  'netflix.com': 'Netflix', 'www.netflix.com': 'Netflix',
  'spotify.com': 'Spotify', 'open.spotify.com': 'Spotify',
  'vercel.com': 'Vercel', 'www.vercel.com': 'Vercel',
  'npmjs.com': 'npm', 'www.npmjs.com': 'npm',
  'developer.mozilla.org': 'MDN', 'arxiv.org': 'arXiv', 'www.arxiv.org': 'arXiv',
  'huggingface.co': 'Hugging Face', 'www.huggingface.co': 'Hugging Face',
  'producthunt.com': 'Product Hunt', 'www.producthunt.com': 'Product Hunt',
  'xiaohongshu.com': 'RedNote', 'www.xiaohongshu.com': 'RedNote',
  'bilibili.com': 'Bilibili', 'www.bilibili.com': 'Bilibili',
  't.bilibili.com': 'Bilibili',
  'weibo.com': 'Weibo', 'www.weibo.com': 'Weibo',
  'zhihu.com': 'Zhihu', 'www.zhihu.com': 'Zhihu',
  'douyin.com': 'Douyin', 'www.douyin.com': 'Douyin',
  'local-files': 'Local Files',
};

function capitalize(str: string): string {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function friendlyDomain(hostname: string): string {
  if (!hostname) return '';
  if (FRIENDLY_DOMAINS[hostname]) return FRIENDLY_DOMAINS[hostname];
  if (hostname.endsWith('.substack.com') && hostname !== 'substack.com')
    return capitalize(hostname.replace('.substack.com', '')) + "'s Substack";
  if (hostname.endsWith('.github.io'))
    return capitalize(hostname.replace('.github.io', '')) + ' (GitHub Pages)';
  let clean = hostname
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|io|co|ai|dev|app|so|me|xyz|info|us|uk|co\.uk|co\.jp)$/, '');
  return clean.split('.').map(part => capitalize(part)).join(' ');
}

function stripTitleNoise(title: string): string {
  if (!title) return '';
  title = title.replace(/^\(\d+\+?\)\s*/, '');
  title = title.replace(/\s*\([\d,]+\+?\)\s*/g, ' ');
  title = title.replace(/\s*[\-‐-―]\s*[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/\s+on X:\s*/, ': ');
  title = title.replace(/\s*\/\s*X\s*$/, '');
  return title.trim();
}

function cleanTitle(title: string, hostname: string): string {
  if (!title || !hostname) return title || '';
  const friendly = friendlyDomain(hostname);
  const domain = hostname.replace(/^www\./, '');
  const seps = [' - ', ' | ', ' — ', ' · ', ' – '];
  for (const sep of seps) {
    const idx = title.lastIndexOf(sep);
    if (idx === -1) continue;
    const suffix = title.slice(idx + sep.length).trim();
    const suffixLow = suffix.toLowerCase();
    if (
      suffixLow === domain.toLowerCase() ||
      suffixLow === friendly.toLowerCase() ||
      suffixLow === domain.replace(/\.\w+$/, '').toLowerCase() ||
      domain.toLowerCase().includes(suffixLow) ||
      friendly.toLowerCase().includes(suffixLow)
    ) {
      const cleaned = title.slice(0, idx).trim();
      if (cleaned.length >= 5) return cleaned;
    }
  }
  return title;
}

function smartTitle(title: string, url: string): string {
  if (!url) return title || '';
  let pathname = '', hostname = '';
  try { const u = new URL(url); pathname = u.pathname; hostname = u.hostname; }
  catch { return title || ''; }
  const titleIsUrl = !title || title === url || title.startsWith(hostname) || title.startsWith('http');
  if ((hostname === 'x.com' || hostname === 'twitter.com' || hostname === 'www.x.com') && pathname.includes('/status/')) {
    const username = pathname.split('/')[1];
    if (username) return titleIsUrl ? `Post by @${username}` : title;
  }
  if (hostname === 'github.com' || hostname === 'www.github.com') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const [owner, repo, ...rest] = parts;
      if (rest[0] === 'issues' && rest[1]) return `${owner}/${repo} Issue #${rest[1]}`;
      if (rest[0] === 'pull' && rest[1]) return `${owner}/${repo} PR #${rest[1]}`;
      if (rest[0] === 'blob' || rest[0] === 'tree') return `${owner}/${repo} — ${rest.slice(2).join('/')}`;
      if (titleIsUrl) return `${owner}/${repo}`;
    }
  }
  if ((hostname === 'www.youtube.com' || hostname === 'youtube.com') && pathname === '/watch') {
    if (titleIsUrl) return 'YouTube Video';
  }
  if ((hostname === 'www.reddit.com' || hostname === 'reddit.com' || hostname === 'old.reddit.com') && pathname.includes('/comments/')) {
    const parts = pathname.split('/').filter(Boolean);
    const subIdx = parts.indexOf('r');
    if (subIdx !== -1 && parts[subIdx + 1]) {
      if (titleIsUrl) return `r/${parts[subIdx + 1]} post`;
    }
  }
  return title || url;
}

// ================================================================
// SVG ICONS
// ================================================================

const ICONS = {
  tabs: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18" /></svg>`,
  close: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`,
};

// ================================================================
// TAB HELPERS
// ================================================================

function getRealTabs(): TabInfo[] {
  return openTabs.filter(t => {
    const url = t.url || '';
    return (
      !url.startsWith('chrome://') &&
      !url.startsWith('chrome-extension://') &&
      !url.startsWith('about:') &&
      !url.startsWith('edge://') &&
      !url.startsWith('brave://')
    );
  });
}

function checkForgeDupes(): void {
  const forgeTabs = openTabs.filter(t => t.isForgeTab);
  const banner = document.getElementById('tabOutDupeBanner');
  const countEl = document.getElementById('tabOutDupeCount');
  if (!banner) return;
  if (forgeTabs.length > 1) {
    if (countEl) countEl.textContent = String(forgeTabs.length);
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

// ================================================================
// OVERFLOW CHIPS
// ================================================================

function buildOverflowChips(hiddenTabs: TabInfo[], urlCounts: Record<string, number>): string {
  const hiddenChips = hiddenTabs.map(tab => {
    const label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), '');
    const count = urlCounts[tab.url] || 1;
    const dupeTag = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const safeUrl = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle = label.replace(/"/g, '&quot;');
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '';
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="chip-text">${label}</span>${dupeTag}
      <div class="chip-actions">
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Save for later">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="Close this tab">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('');

  return `
    <div class="page-chips-overflow" style="display:none">${hiddenChips}</div>
    <div class="page-chip page-chip-overflow clickable" data-action="expand-chips">
      <span class="chip-text">+${hiddenTabs.length} more</span>
    </div>`;
}

// ================================================================
// DOMAIN CARD RENDERER
// ================================================================

function renderDomainCard(group: DomainGroup): string {
  const tabs = group.tabs || [];
  const tabCount = tabs.length;
  const isLanding = group.domain === '__landing-pages__';
  const stableId = 'domain-' + group.domain.replace(/[^a-z0-9]/g, '-');

  const urlCounts: Record<string, number> = {};
  for (const tab of tabs) urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  const dupeUrls = Object.entries(urlCounts).filter(([, c]) => c > 1);
  const hasDupes = dupeUrls.length > 0;
  const totalExtras = dupeUrls.reduce((s, [, c]) => s + c - 1, 0);

  const tabBadge = `<span class="open-tabs-badge">${ICONS.tabs} ${tabCount} tab${tabCount !== 1 ? 's' : ''} open</span>`;
  const dupeBadge = hasDupes
    ? `<span class="open-tabs-badge" style="color:var(--accent-amber);background:rgba(200,113,58,0.08);">${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}</span>`
    : '';

  const seen = new Set<string>();
  const uniqueTabs: TabInfo[] = [];
  for (const tab of tabs) {
    if (!seen.has(tab.url)) { seen.add(tab.url); uniqueTabs.push(tab); }
  }

  const visibleTabs = uniqueTabs.slice(0, 8);
  const extraCount = uniqueTabs.length - visibleTabs.length;

  const pageChips = visibleTabs.map(tab => {
    let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), group.domain);
    try {
      const parsed = new URL(tab.url);
      if (parsed.hostname === 'localhost' && parsed.port) label = `${parsed.port} ${label}`;
    } catch {}
    const count = urlCounts[tab.url];
    const dupeTag = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const safeUrl = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle = label.replace(/"/g, '&quot;');
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '';
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="chip-text">${label}</span>${dupeTag}
      <div class="chip-actions">
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Save for later">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="Close this tab">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('') + (extraCount > 0 ? buildOverflowChips(uniqueTabs.slice(8), urlCounts) : '');

  let actionsHtml = `
    <button class="action-btn close-tabs" data-action="close-domain-tabs" data-domain-id="${stableId}">
      ${ICONS.close} Close all ${tabCount} tab${tabCount !== 1 ? 's' : ''}
    </button>`;

  if (hasDupes) {
    const dupeUrlsEncoded = dupeUrls.map(([url]) => encodeURIComponent(url)).join(',');
    actionsHtml += `
      <button class="action-btn" data-action="dedup-keep-one" data-dupe-urls="${dupeUrlsEncoded}">
        Close ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}
      </button>`;
  }

  return `
    <div class="mission-card domain-card ${hasDupes ? 'has-amber-bar' : 'has-neutral-bar'}" data-domain-id="${stableId}">
      <div class="mission-content">
        <div class="mission-top">
          <span class="mission-name">${isLanding ? 'Homepages' : friendlyDomain(group.domain)}</span>
          ${tabBadge}
          ${dupeBadge}
        </div>
        <div class="mission-pages">${pageChips}</div>
        <div class="actions">${actionsHtml}</div>
      </div>
    </div>`;
}

// ================================================================
// SAVED FOR LATER COLUMN RENDERER
// ================================================================

function renderDeferredItem(item: DeferredTab): string {
  let domain = '';
  try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  const ago = timeAgo(item.savedAt);
  return `
    <div class="deferred-item" data-deferred-id="${item.id}">
      <input type="checkbox" class="deferred-checkbox" data-action="check-deferred" data-deferred-id="${item.id}">
      <div class="deferred-info">
        <a href="${item.url}" target="_blank" rel="noopener" class="deferred-title" title="${(item.title || '').replace(/"/g, '&quot;')}">
          <img src="${faviconUrl}" alt="" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px" onerror="this.style.display='none'">${item.title || item.url}
        </a>
        <div class="deferred-meta"><span>${domain}</span><span>${ago}</span></div>
      </div>
      <button class="deferred-dismiss" data-action="dismiss-deferred" data-deferred-id="${item.id}" title="Dismiss">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>`;
}

function renderArchiveItem(item: DeferredTab): string {
  const ago = item.completedAt ? timeAgo(item.completedAt) : timeAgo(item.savedAt);
  return `
    <div class="archive-item">
      <a href="${item.url}" target="_blank" rel="noopener" class="archive-item-title" title="${(item.title || '').replace(/"/g, '&quot;')}">${item.title || item.url}</a>
      <span class="archive-item-date">${ago}</span>
    </div>`;
}

async function renderDeferredColumn(): Promise<void> {
  const column = document.getElementById('deferredColumn');
  const list = document.getElementById('deferredList');
  const empty = document.getElementById('deferredEmpty');
  const countEl = document.getElementById('deferredCount');
  const archiveEl = document.getElementById('deferredArchive');
  const archiveCountEl = document.getElementById('archiveCount');
  const archiveList = document.getElementById('archiveList');
  if (!column) return;
  try {
    const { active, archived } = await getSavedTabs();
    if (active.length === 0 && archived.length === 0) { column.style.display = 'none'; return; }
    column.style.display = 'block';
    if (active.length > 0) {
      countEl!.textContent = `${active.length} item${active.length !== 1 ? 's' : ''}`;
      list!.innerHTML = active.map(item => renderDeferredItem(item)).join('');
      list!.style.display = 'block';
      empty!.style.display = 'none';
    } else {
      list!.style.display = 'none';
      countEl!.textContent = '';
      empty!.style.display = 'block';
    }
    if (archived.length > 0) {
      archiveCountEl!.textContent = `(${archived.length})`;
      archiveList!.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      archiveEl!.style.display = 'block';
    } else {
      archiveEl!.style.display = 'none';
    }
  } catch {
    column.style.display = 'none';
  }
}

// ================================================================
// FORGE STATUS BAR RENDERER
// ================================================================

let dayUnlockedConfettiFired = false;

async function renderForgeBar(): Promise<void> {
  const state = await getState();
  const $bar = document.getElementById('forgeBar')!;
  const $status = document.getElementById('forgeStatus')!;
  const $meta = document.getElementById('forgeMeta')!;
  const $headerCount = document.getElementById('forgeHeaderCount')!;

  const entertainmentTime = state.today.entertainmentTime || 0;
  const workTime = state.today.workTime || 0;
  const { locked, dayUnlocked } = state.today;
  const fullUnlock = state.settings.fullUnlockWork;
  const streak = getStreak(state);

  if (dayUnlocked) {
    $bar.setAttribute('data-state', 'unlocked');
    $headerCount.textContent = '已达标';
    $status.innerHTML = `
      <div class="forge-main-row">
        <div class="forge-unlock-icon">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        </div>
        <div class="forge-work-display">
          <div class="forge-hero-number">${fmt(workTime)}</div>
          <div class="forge-unlock-subtitle">已达标 · 自由时间</div>
        </div>
      </div>`;

    if (!dayUnlockedConfettiFired) {
      dayUnlockedConfettiFired = true;
      requestAnimationFrame(() => {
        const rect = $bar.getBoundingClientRect();
        shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
      });
    }
  } else if (locked) {
    dayUnlockedConfettiFired = false;
    $bar.setAttribute('data-state', 'locked');
    $headerCount.textContent = '已锁定';
    const unlockNeeded = getUnlockWorkNeeded(state);
    const fullRemaining = getFullUnlockWorkRemaining(state);
    const pct = getEntertainmentUsagePct(state);

    $status.innerHTML = `
      <div class="forge-main-row">
        <div class="forge-lock-icon">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
          </svg>
        </div>
        <div class="forge-work-display" style="flex:1">
          <span class="forge-tag play">娱乐已锁定</span>
          <div class="forge-progress">
            <div class="forge-progress-track locked"><div class="forge-progress-fill" style="width:${pct}%"></div></div>
            <span class="forge-progress-label">还需工作 ${fmt(unlockNeeded)}</span>
          </div>
          <div class="forge-hint">或工作满 ${fmt(fullUnlock)} 解锁全天（还需 ${fmt(fullRemaining)}）</div>
        </div>
      </div>`;
  } else {
    dayUnlockedConfettiFired = false;
    $bar.setAttribute('data-state', 'normal');
    $headerCount.innerHTML = `<span class="forge-header-current">${fmt(workTime)}</span> / ${fmt(fullUnlock)}`;
    const pct = fullUnlock > 0 ? Math.round(Math.min(workTime / fullUnlock, 1) * 100) : 0;
    const balance = Math.max(0, getEntertainmentBalance(state));
    const entertainmentPct = getEntertainmentUsagePct(state);
    const circumference = 2 * Math.PI * 30;
    const offset = circumference * (1 - pct / 100);
    const lowWarning = balance < 15 && entertainmentTime > 0;

    $status.innerHTML = `
      <div class="forge-main-row">
        <div class="forge-work-display">
          <div class="forge-hero-number">${fmt(workTime)}</div>
          <div class="forge-hero-label">工作时长 / ${fmt(fullUnlock)} 解锁全天</div>
        </div>
        <div class="forge-ring">
          <svg width="72" height="72" viewBox="0 0 72 72">
            <circle cx="36" cy="36" r="30" fill="none" stroke="var(--warm-gray)" stroke-width="4"/>
            <circle cx="36" cy="36" r="30" fill="none" stroke="var(--accent-amber)" stroke-width="4"
                    stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}" stroke-linecap="round"
                    transform="rotate(-90 36 36)"/>
          </svg>
          <div class="forge-ring-pct">${pct}%</div>
        </div>
      </div>
      ${entertainmentTime > 0 ? `
      <div class="forge-entertainment-strip${lowWarning ? ' low' : ''}">
        <div class="forge-strip-track">
          <div class="forge-strip-fill" style="width:${entertainmentPct}%"></div>
        </div>
        <span class="forge-strip-text">娱乐余额 ${fmt(balance)} · 已娱乐 ${fmt(entertainmentTime)}</span>
      </div>` : ''}`;
  }

  let metaHtml = '';
  if (streak > 0) metaHtml += `<span class="forge-meta-badge streak">🔥 ${streak}天连续达标</span>`;
  if (state.penalty > 0) metaHtml += `<span class="forge-meta-badge penalty">惩罚 -${state.penalty}m</span>`;
  $meta.innerHTML = metaHtml;
}

// ================================================================
// TAB MANAGEMENT RENDERER
// ================================================================

const LANDING_PAGE_PATTERNS: Array<{
  hostname?: string;
  pathExact?: string[];
  pathPrefix?: string;
  test?: (p: string, h: string) => boolean;
}> = [
  { hostname: 'mail.google.com', test: (_p, h) =>
      !h.includes('#inbox/') && !h.includes('#sent/') && !h.includes('#search/') },
  { hostname: 'x.com', pathExact: ['/home'] },
  { hostname: 'www.linkedin.com', pathExact: ['/'] },
  { hostname: 'github.com', pathExact: ['/'] },
  { hostname: 'www.youtube.com', pathExact: ['/'] },
];

function isLandingPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    return LANDING_PAGE_PATTERNS.some(p => {
      if (!p.hostname || parsed.hostname !== p.hostname) return false;
      if (p.test) return p.test(parsed.pathname, url);
      if (p.pathPrefix) return parsed.pathname.startsWith(p.pathPrefix);
      if (p.pathExact) return p.pathExact.includes(parsed.pathname);
      return parsed.pathname === '/';
    });
  } catch { return false; }
}

async function renderTabManagement(): Promise<void> {
  await fetchOpenTabs();
  const realTabs = getRealTabs();

  domainGroups = [];
  const groupMap: Record<string, DomainGroup> = {};
  const landingTabs: TabInfo[] = [];

  for (const tab of realTabs) {
    try {
      if (isLandingPage(tab.url)) { landingTabs.push(tab); continue; }
      let hostname: string;
      if (tab.url && tab.url.startsWith('file://')) {
        hostname = 'local-files';
      } else {
        hostname = new URL(tab.url).hostname;
      }
      if (!hostname) continue;
      if (!groupMap[hostname]) groupMap[hostname] = { domain: hostname, tabs: [] };
      groupMap[hostname].tabs.push(tab);
    } catch {}
  }

  if (landingTabs.length > 0) {
    groupMap['__landing-pages__'] = { domain: '__landing-pages__', tabs: landingTabs };
  }

  const landingHostnames = new Set(LANDING_PAGE_PATTERNS.map(p => p.hostname).filter(Boolean) as string[]);
  domainGroups = Object.values(groupMap).sort((a, b) => {
    const aIsLanding = a.domain === '__landing-pages__';
    const bIsLanding = b.domain === '__landing-pages__';
    if (aIsLanding !== bIsLanding) return aIsLanding ? -1 : 1;
    const aIsPriority = landingHostnames.has(a.domain);
    const bIsPriority = landingHostnames.has(b.domain);
    if (aIsPriority !== bIsPriority) return aIsPriority ? -1 : 1;
    return b.tabs.length - a.tabs.length;
  });

  const openTabsSection = document.getElementById('openTabsSection');
  const openTabsMissionsEl = document.getElementById('openTabsMissions');
  const openTabsSectionCount = document.getElementById('openTabsSectionCount');

  if (domainGroups.length > 0 && openTabsSection) {
    openTabsSectionCount!.innerHTML = `${domainGroups.length} domain${domainGroups.length !== 1 ? 's' : ''} &nbsp;&middot;&nbsp; ${openTabs.length} open tabs &nbsp;&middot;&nbsp; <button class="action-btn close-tabs" data-action="close-all-open-tabs" style="font-size:11px;padding:3px 10px;">${ICONS.close} Close all ${realTabs.length} tabs</button>`;
    openTabsMissionsEl!.innerHTML = domainGroups.map(g => renderDomainCard(g)).join('');
    openTabsSection.style.display = 'block';
  } else if (openTabsSection) {
    openTabsSection.style.display = 'none';
  }

  checkForgeDupes();
  await renderDeferredColumn();
}

// ================================================================
// EVENT HANDLERS
// ================================================================

document.addEventListener('click', async (e) => {
  const target = e.target as HTMLElement;
  const actionEl = target.closest('[data-action]') as HTMLElement | null;
  if (!actionEl) return;
  const action = actionEl.dataset.action;

  // Close duplicate new tabs
  if (action === 'close-tabout-dupes') {
    await closeForgeDupes();
    playCloseSound();
    const banner = document.getElementById('tabOutDupeBanner');
    if (banner) {
      banner.style.transition = 'opacity 0.4s';
      banner.style.opacity = '0';
      setTimeout(() => { banner.style.display = 'none'; banner.style.opacity = '1'; }, 400);
    }
    showToast('Closed extra tabs');
    return;
  }

  const card = actionEl.closest('.mission-card') as HTMLElement | null;

  if (action === 'expand-chips') {
    const overflowContainer = actionEl.parentElement?.querySelector('.page-chips-overflow') as HTMLElement | null;
    if (overflowContainer) {
      overflowContainer.style.display = 'contents';
      actionEl.remove();
    }
    return;
  }

  if (action === 'focus-tab') {
    const tabUrl = actionEl.dataset.tabUrl;
    if (tabUrl) await focusTab(tabUrl);
    return;
  }

  if (action === 'close-single-tab') {
    e.stopPropagation();
    const tabUrl = actionEl.dataset.tabUrl;
    if (!tabUrl) return;
    const allTabs = await chrome.tabs.query({});
    const match = allTabs.find(t => t.url === tabUrl);
    if (match) await chrome.tabs.remove(match.id!);
    await fetchOpenTabs();
    playCloseSound();
    const chip = actionEl.closest('.page-chip') as HTMLElement | null;
    if (chip) {
      const rect = chip.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity = '0';
      chip.style.transform = 'scale(0.8)';
      setTimeout(() => {
        chip.remove();
        document.querySelectorAll('.mission-card').forEach(c => {
          if (c.querySelectorAll('.page-chip[data-action="focus-tab"]').length === 0) {
            animateCardOut(c as HTMLElement);
          }
        });
      }, 200);
    }
    showToast('Tab closed');
    return;
  }

  if (action === 'defer-single-tab') {
    e.stopPropagation();
    const tabUrl = actionEl.dataset.tabUrl;
    const tabTitle = actionEl.dataset.tabTitle || tabUrl;
    if (!tabUrl) return;
    await saveTabForLater({ url: tabUrl, title: tabTitle! });
    const allTabs = await chrome.tabs.query({});
    const match = allTabs.find(t => t.url === tabUrl);
    if (match) await chrome.tabs.remove(match.id!);
    await fetchOpenTabs();
    const chip = actionEl.closest('.page-chip') as HTMLElement | null;
    if (chip) {
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity = '0';
      chip.style.transform = 'scale(0.8)';
      setTimeout(() => chip.remove(), 200);
    }
    showToast('Saved for later');
    await renderDeferredColumn();
    return;
  }

  if (action === 'check-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;
    await checkOffSavedTab(id);
    const item = actionEl.closest('.deferred-item') as HTMLElement | null;
    if (item) {
      item.classList.add('checked');
      setTimeout(() => {
        item.classList.add('removing');
        setTimeout(() => { item.remove(); renderDeferredColumn(); }, 300);
      }, 800);
    }
    return;
  }

  if (action === 'dismiss-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;
    await dismissSavedTab(id);
    const item = actionEl.closest('.deferred-item') as HTMLElement | null;
    if (item) {
      item.classList.add('removing');
      setTimeout(() => { item.remove(); renderDeferredColumn(); }, 300);
    }
    return;
  }

  if (action === 'close-domain-tabs') {
    const domainId = actionEl.dataset.domainId;
    const group = domainGroups.find(g =>
      'domain-' + g.domain.replace(/[^a-z0-9]/g, '-') === domainId
    );
    if (!group) return;
    const urls = group.tabs.map(t => t.url);
    const useExact = group.domain === '__landing-pages__';
    if (useExact) await closeTabsExact(urls); else await closeTabsByUrls(urls);
    if (card) { playCloseSound(); animateCardOut(card); }
    const idx = domainGroups.indexOf(group);
    if (idx !== -1) domainGroups.splice(idx, 1);
    const groupLabel = group.domain === '__landing-pages__' ? 'Homepages' : friendlyDomain(group.domain);
    showToast(`Closed ${urls.length} tab${urls.length !== 1 ? 's' : ''} from ${groupLabel}`);
    return;
  }

  if (action === 'dedup-keep-one') {
    const urlsEncoded = actionEl.dataset.dupeUrls || '';
    const urls = urlsEncoded.split(',').map(u => decodeURIComponent(u)).filter(Boolean);
    if (urls.length === 0) return;
    await closeDuplicateTabs(urls, true);
    playCloseSound();
    actionEl.style.transition = 'opacity 0.2s';
    actionEl.style.opacity = '0';
    setTimeout(() => actionEl.remove(), 200);
    if (card) {
      card.querySelectorAll('.chip-dupe-badge').forEach(b => {
        (b as HTMLElement).style.transition = 'opacity 0.2s';
        (b as HTMLElement).style.opacity = '0';
        setTimeout(() => b.remove(), 200);
      });
      card.querySelectorAll('.open-tabs-badge').forEach(badge => {
        if (badge.textContent?.includes('duplicate')) {
          (badge as HTMLElement).style.transition = 'opacity 0.2s';
          (badge as HTMLElement).style.opacity = '0';
          setTimeout(() => badge.remove(), 200);
        }
      });
      card.classList.remove('has-amber-bar');
      card.classList.add('has-neutral-bar');
    }
    showToast('Closed duplicates, kept one copy each');
    return;
  }

  if (action === 'close-all-open-tabs') {
    const allUrls = openTabs
      .filter(t => t.url && !t.url.startsWith('chrome') && !t.url.startsWith('about:'))
      .map(t => t.url);
    await closeTabsByUrls(allUrls);
    playCloseSound();
    document.querySelectorAll('#openTabsMissions .mission-card').forEach(c => {
      const r = c.getBoundingClientRect();
      shootConfetti(r.left + r.width / 2, r.top + r.height / 2);
      animateCardOut(c as HTMLElement);
    });
    showToast('All tabs closed. Fresh start.');
    return;
  }
});

// ================================================================
// PANEL DRAWER
// ================================================================

function openPanel(panel: 'dashboard' | 'settings'): void {
  const overlay = document.getElementById('panelOverlay')!;
  const title = document.getElementById('panelTitle')!;
  const body = document.getElementById('panelBody')!;

  title.textContent = panel === 'dashboard' ? '统计' : '设置';
  overlay.classList.add('open');

  if (panel === 'dashboard') renderDashboardPanel(body);
  else renderSettingsPanel(body);
}

function closePanel(): void {
  document.getElementById('panelOverlay')!.classList.remove('open');
}

document.getElementById('panelOverlay')!.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closePanel();
});
document.getElementById('panelClose')!.addEventListener('click', closePanel);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePanel();
});

// ================================================================
// DASHBOARD PANEL
// ================================================================

async function renderDashboardPanel(body: HTMLElement): Promise<void> {
  const state = await getState();
  const streak = getStreak(state);
  const history = getHistory(state, 7);
  const { workTime, entertainmentTime } = state.today;
  const balance = Math.max(0, getEntertainmentBalance(state));
  const today = state.today.date;

  const ratioText = entertainmentTime > 0
    ? `${(workTime / entertainmentTime).toFixed(1)} : 1`
    : (workTime > 0 ? '∞' : '-');
  const goalRemaining = Math.max(0, state.settings.fullUnlockWork - workTime);
  const goalPct = state.settings.fullUnlockWork > 0
    ? Math.round(Math.min(workTime / state.settings.fullUnlockWork, 1) * 100)
    : 0;
  const streakHint = goalRemaining > 0
    ? `今天再工作 ${fmt(goalRemaining)}，延续连续记录`
    : '今日目标已完成，连续记录已延续';

  let chartHtml = '';
  if (history.length > 0) {
    const maxMin = Math.max(
      ...history.map(d => Math.max(d.workTime || 0, d.entertainmentTime || 0)),
      workTime, entertainmentTime, state.settings.fullUnlockWork,
    );
    const barScale = maxMin > 0 ? 100 / maxMin : 0;

    chartHtml = history.map(day => {
      const isToday = day.date === today;
      const w = isToday ? workTime : (day.workTime || 0);
      const e = isToday ? entertainmentTime : (day.entertainmentTime || 0);
      const dateLabel = isToday ? '今天' : day.date.slice(5);
      const goalTag = w >= state.settings.fullUnlockWork ? '<span class="panel-chart-goal">✓</span>' : '';

      return `
        <div class="panel-chart-row">
          <div class="panel-chart-date ${isToday ? 'today' : ''}">${dateLabel}</div>
          <div class="panel-chart-bars">
            <div class="panel-chart-bar-row">
              <div class="panel-chart-bar work" style="width:${Math.max(w * barScale, 0.5)}%"></div>
              <span class="panel-chart-bar-label">${fmt(w)}${goalTag}</span>
            </div>
            <div class="panel-chart-bar-row">
              <div class="panel-chart-bar play" style="width:${Math.max(e * barScale, 0.5)}%"></div>
              <span class="panel-chart-bar-label">${fmt(e)}</span>
            </div>
          </div>
        </div>`;
    }).join('');
  } else {
    chartHtml = '<div class="panel-empty">还没有数据</div>';
  }

  let siteHtml = '';
  const siteEntries = Object.entries(state.today.siteTime || {})
    .map(([host, sec]) => ({ host, sec }))
    .sort((a, b) => b.sec - a.sec);

  if (siteEntries.length > 0) {
    const maxSec = siteEntries[0].sec;
    siteHtml = siteEntries.slice(0, 15).map(({ host, sec }) => {
      const min = Math.floor(sec / 60);
      const s = sec % 60;
      const duration = min > 0 ? `${min}m ${s}s` : `${s}s`;
      const pct = Math.round((sec / maxSec) * 100);
      return `
        <div class="panel-site-row">
          <span class="panel-site-host">${host}</span>
          <span class="panel-site-duration">${duration}</span>
          <div class="panel-site-bar-bg"><div class="panel-site-bar-fill" style="width:${pct}%"></div></div>
        </div>`;
    }).join('');
  } else {
    siteHtml = '<div class="panel-empty">还没有浏览数据</div>';
  }

  body.innerHTML = `
    <div class="panel-streak-summary">
      <div class="panel-streak-score">
        <div class="panel-streak-value">${streak}</div>
        <div class="panel-streak-label">天连续达标</div>
      </div>
      <div class="panel-streak-progress">
        <div class="panel-streak-copy">
          <span>${streakHint}</span>
          <span>${fmt(workTime)} / ${fmt(state.settings.fullUnlockWork)}</span>
        </div>
        <div class="panel-streak-track"><div class="panel-streak-fill" style="width:${goalPct}%"></div></div>
      </div>
    </div>

    <div class="panel-section">
      <div class="section-header"><h2>今日概览</h2><div class="section-line"></div></div>
      <div class="panel-today-stats">
        <div>
          <div class="panel-stat-label">工作</div>
          <div class="panel-stat-value work">${fmt(workTime)}</div>
        </div>
        <div>
          <div class="panel-stat-label">娱乐</div>
          <div class="panel-stat-value play">${fmt(entertainmentTime)}</div>
        </div>
        <div>
          <div class="panel-stat-label">余额</div>
          <div class="panel-stat-value credit">${fmt(balance)}</div>
        </div>
        <div>
          <div class="panel-stat-label">工作/娱乐比</div>
          <div class="panel-stat-value ratio">${ratioText}</div>
        </div>
        ${state.penalty > 0 ? `<div>
          <div class="panel-stat-label">惩罚</div>
          <div class="panel-stat-value debt">-${state.penalty}m</div>
        </div>` : ''}
      </div>
    </div>

    <div class="panel-section">
      <div class="section-header"><h2>最近 7 天</h2><div class="section-line"></div></div>
      <div class="panel-chart">${chartHtml}</div>
    </div>

    <div class="panel-section">
      <div class="section-header"><h2>今日网站用时</h2><div class="section-line"></div></div>
      ${siteHtml}
    </div>`;
}

// ================================================================
// SETTINGS PANEL
// ================================================================

async function renderSettingsPanel(body: HTMLElement): Promise<void> {
  const state = await getState();

  body.innerHTML = `
    <div class="settings-section">
      <div class="section-header" style="margin-bottom:6px"><h2>娱乐阈值</h2><div class="section-line"></div></div>
      <div class="settings-desc">每天免费娱乐时长，超过后锁定所有黑名单网站</div>
      <div class="settings-row">
        <input type="number" class="settings-input" id="panelThreshold" min="15" max="180" step="15" value="${state.settings.baseThreshold}">
        <span class="settings-unit">分钟</span>
      </div>
    </div>

    <div class="settings-section">
      <div class="section-header" style="margin-bottom:6px"><h2>全天解锁工作时长</h2><div class="section-line"></div></div>
      <div class="settings-desc">累计工作达到此时长后，当天不再锁定</div>
      <div class="settings-row">
        <input type="number" class="settings-input" id="panelFullUnlock" min="60" max="480" step="30" value="${state.settings.fullUnlockWork}">
        <span class="settings-unit">分钟</span>
      </div>
    </div>

    <div class="settings-section">
      <div class="section-header" style="margin-bottom:6px"><h2>娱乐网站黑名单</h2><div class="section-line"></div></div>
      <div class="settings-desc">每行一个域名，例如 bilibili.com</div>
      <textarea class="settings-textarea" id="panelBlockedSites" rows="10">${state.settings.blockedSites.join('\n')}</textarea>
    </div>

    <button class="settings-save" id="panelSaveSettings">保存设置</button>`;

  document.getElementById('panelSaveSettings')!.addEventListener('click', async () => {
    const freshState = await getState();
    const thresholdVal = parseInt((document.getElementById('panelThreshold') as HTMLInputElement).value, 10);
    const fullUnlockVal = parseInt((document.getElementById('panelFullUnlock') as HTMLInputElement).value, 10);
    const sitesVal = [...new Set((document.getElementById('panelBlockedSites') as HTMLTextAreaElement).value
      .split('\n').map(extractDomain).filter(Boolean))];

    if (thresholdVal >= 15 && thresholdVal <= 180) freshState.settings.baseThreshold = thresholdVal;
    if (fullUnlockVal >= 60 && fullUnlockVal <= 480) freshState.settings.fullUnlockWork = fullUnlockVal;
    freshState.settings.blockedSites = sitesVal;
    reconcileLockState(freshState);

    dayUnlockedConfettiFired = false;
    await saveState(freshState);
    chrome.runtime.sendMessage({ type: 'stateChanged' });
    await renderForgeBar();
    showToast('设置已保存');
  });

}

// Archive toggle
document.addEventListener('click', (e) => {
  const toggle = (e.target as HTMLElement).closest('#archiveToggle');
  if (!toggle) return;
  toggle.classList.toggle('open');
  const body = document.getElementById('archiveBody');
  if (body) body.style.display = body.style.display === 'none' ? 'block' : 'none';
});

// Archive search
document.addEventListener('input', async (e) => {
  const target = e.target as HTMLElement;
  if (target.id !== 'archiveSearch') return;
  const q = (target as HTMLInputElement).value.trim().toLowerCase();
  const archiveList = document.getElementById('archiveList');
  if (!archiveList) return;
  const { archived } = await getSavedTabs();
  if (q.length < 2) {
    archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
    return;
  }
  const results = archived.filter(item =>
    (item.title || '').toLowerCase().includes(q) || (item.url || '').toLowerCase().includes(q)
  );
  archiveList.innerHTML = results.map(item => renderArchiveItem(item)).join('')
    || '<div style="font-size:12px;color:var(--muted);padding:8px 0">No results</div>';
});

// Footer navigation — open inline panels
document.getElementById('nav-dashboard')!.addEventListener('click', () => {
  openPanel('dashboard');
});
document.getElementById('nav-options')!.addEventListener('click', () => {
  openPanel('settings');
});

// ================================================================
// INIT
// ================================================================

async function init(): Promise<void> {
  document.getElementById('greeting')!.textContent = getGreeting();
  document.getElementById('dateDisplay')!.textContent = getDateDisplay();
  await renderForgeBar();
  await renderTabManagement();
  setInterval(renderForgeBar, 1000);
}

init();
