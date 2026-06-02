import { getState, saveState, addEntertainmentTime, addWorkTime, addSiteTime, getThreshold } from './shared/store.js';

// ================================================================
// BLOCKING RULES
// ================================================================

async function enableBlocking(): Promise<void> {
  const state = await getState();
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const existingIds = existingRules.map(r => r.id);

  const rules: chrome.declarativeNetRequest.Rule[] = state.settings.blockedSites.map((site, i) => ({
    id: i + 1,
    priority: 1,
    action: {
      type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
      redirect: { extensionPath: '/blocked/blocked.html' },
    },
    condition: {
      urlFilter: `||${site}`,
      resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
    },
  }));

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existingIds,
    addRules: rules,
  });
}

async function disableBlocking(): Promise<void> {
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const existingIds = existingRules.map(r => r.id);
  if (existingIds.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existingIds });
  }
}

async function syncBlocking(): Promise<void> {
  const state = await getState();
  if (state.today.locked) {
    await enableBlocking();
  } else {
    await disableBlocking();
  }
}

// ================================================================
// BADGE
// ================================================================

async function updateBadge(): Promise<void> {
  const state = await getState();

  if (state.today.dayUnlocked) {
    await chrome.action.setBadgeText({ text: '✓' });
    await chrome.action.setBadgeBackgroundColor({ color: '#5a7a62' });
  } else if (state.today.locked) {
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#b35a5a' });
  } else {
    const threshold = getThreshold(state);
    const remaining = Math.max(0, threshold - state.today.entertainmentTime);
    if (remaining > 0 && state.today.entertainmentTime > 0) {
      await chrome.action.setBadgeText({ text: `${remaining}m` });
      await chrome.action.setBadgeBackgroundColor({ color: '#5a7a62' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  }
}

// ================================================================
// SITE TIME TRACKING
// ================================================================

let currentHost: string | null = null;
let browserFocused = true;
let userIdle = false;
let lastTick = Date.now();

function extractHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    if (!host || host === 'newtab' || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return null;
    return host;
  } catch { return null; }
}

function isBlockedHost(hostname: string, blockedSites: string[]): boolean {
  return blockedSites.some(site => hostname === site || hostname.endsWith('.' + site));
}

async function flushSiteTime(): Promise<void> {
  const now = Date.now();
  const elapsed = Math.round((now - lastTick) / 1000);
  lastTick = now;
  if (currentHost && elapsed > 0 && elapsed < 300) {
    await addSiteTime(currentHost, elapsed);
  }
}

async function updateCurrentHost(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const newHost = extractHost(tab?.url);
    if (newHost !== currentHost) {
      await flushSiteTime();
      currentHost = newHost;
    }
  } catch {}
}

chrome.tabs.onActivated.addListener(() => updateCurrentHost());
chrome.tabs.onUpdated.addListener((_tabId, info) => {
  if (info.url) updateCurrentHost();
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    flushSiteTime();
    currentHost = null;
    browserFocused = false;
  } else {
    browserFocused = true;
    updateCurrentHost();
  }
});

// ================================================================
// IDLE DETECTION
// ================================================================

chrome.idle.setDetectionInterval(600);
chrome.idle.onStateChanged.addListener((newState) => {
  if (newState === 'idle' || newState === 'locked') {
    userIdle = true;
  } else {
    userIdle = false;
  }
});

// ================================================================
// TICK — PASSIVE TIME TRACKING
// ================================================================

async function tick(): Promise<void> {
  if (userIdle) {
    await updateBadge();
    return;
  }

  const state = await getState();

  if (state.today.dayUnlocked) {
    await flushSiteTime();
    await syncBlocking();
    await updateBadge();
    return;
  }

  if (!browserFocused) {
    await addWorkTime(1);
  } else if (currentHost && isBlockedHost(currentHost, state.settings.blockedSites)) {
    await addEntertainmentTime(1);
  } else {
    await addWorkTime(1);
  }

  await flushSiteTime();
  await syncBlocking();
  await updateBadge();
}

// ================================================================
// LIFECYCLE
// ================================================================

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'forge-tick') tick();
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('forge-tick', { periodInMinutes: 1 });
  syncBlocking();
  updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('forge-tick', { periodInMinutes: 1 });
  syncBlocking();
  updateBadge();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'stateChanged') {
    syncBlocking();
    updateBadge();
  }
  return false;
});
