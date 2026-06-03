import {
  getState, addEntertainmentTime, addWorkTime, addSiteTime, getEntertainmentBalance, getDateKey,
} from './shared/store.js';

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
    const balance = Math.max(0, getEntertainmentBalance(state));
    if (balance > 0 && state.today.entertainmentTime > 0) {
      await chrome.action.setBadgeText({ text: `${balance}m` });
      await chrome.action.setBadgeBackgroundColor({ color: '#5a7a62' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  }
}

// ================================================================
// SITE TIME TRACKING
// ================================================================

interface SiteTrackingState {
  currentHost: string | null;
  browserFocused: boolean;
  userIdle: boolean;
  lastTick: number;
}

const TRACKING_KEY = 'forgeSiteTracking';
const MAX_TRACKED_INTERVAL_MS = 90 * 1000;

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

function freshTrackingState(): SiteTrackingState {
  return {
    currentHost: null,
    browserFocused: false,
    userIdle: false,
    lastTick: Date.now(),
  };
}

async function getTrackingState(): Promise<SiteTrackingState> {
  const result = await chrome.storage.session.get(TRACKING_KEY);
  const tracking = result[TRACKING_KEY] as Partial<SiteTrackingState> | undefined;
  if (!tracking || typeof tracking.lastTick !== 'number') return freshTrackingState();
  return {
    currentHost: typeof tracking.currentHost === 'string' ? tracking.currentHost : null,
    browserFocused: tracking.browserFocused === true,
    userIdle: tracking.userIdle === true,
    lastTick: tracking.lastTick,
  };
}

async function saveTrackingState(tracking: SiteTrackingState): Promise<void> {
  await chrome.storage.session.set({ [TRACKING_KEY]: tracking });
}

async function addSiteInterval(hostname: string, startedAt: number, endedAt: number): Promise<void> {
  let cursor = Math.max(startedAt, endedAt - MAX_TRACKED_INTERVAL_MS);
  while (cursor < endedAt) {
    const date = new Date(cursor);
    const nextMidnight = new Date(date);
    nextMidnight.setHours(24, 0, 0, 0);
    const segmentEnd = Math.min(endedAt, nextMidnight.getTime());
    const seconds = Math.floor((segmentEnd - cursor) / 1000);
    if (seconds > 0) await addSiteTime(hostname, seconds, getDateKey(date));
    cursor = segmentEnd;
  }
}

async function flushSiteTime(tracking: SiteTrackingState, now: number = Date.now()): Promise<void> {
  if (tracking.currentHost && tracking.browserFocused && !tracking.userIdle && now > tracking.lastTick) {
    await addSiteInterval(tracking.currentHost, tracking.lastTick, now);
  }
  tracking.lastTick = now;
}

async function getBrowserActivity(): Promise<{ browserFocused: boolean; currentHost: string | null }> {
  try {
    const window = await chrome.windows.getLastFocused();
    if (!window.focused || window.id === undefined) {
      return { browserFocused: false, currentHost: null };
    }
    const [tab] = await chrome.tabs.query({ active: true, windowId: window.id });
    return { browserFocused: true, currentHost: extractHost(tab?.url) };
  } catch {
    return { browserFocused: false, currentHost: null };
  }
}

async function syncActivityNow(idleState?: chrome.idle.IdleState): Promise<SiteTrackingState> {
  const tracking = await getTrackingState();
  await flushSiteTime(tracking);

  const activity = await getBrowserActivity();
  tracking.browserFocused = activity.browserFocused;
  tracking.currentHost = activity.currentHost;
  tracking.userIdle = idleState
    ? idleState !== 'active'
    : await chrome.idle.queryState(600) !== 'active';

  await saveTrackingState(tracking);
  return tracking;
}

let activitySyncQueue: Promise<void> = Promise.resolve();

function syncActivity(idleState?: chrome.idle.IdleState): Promise<SiteTrackingState> {
  const sync = activitySyncQueue
    .catch(() => undefined)
    .then(() => syncActivityNow(idleState));
  activitySyncQueue = sync.then(() => undefined, () => undefined);
  return sync;
}

chrome.tabs.onActivated.addListener(() => { void syncActivity(); });
chrome.tabs.onUpdated.addListener((_tabId, info) => {
  if (info.url) void syncActivity();
});
chrome.windows.onFocusChanged.addListener(() => { void syncActivity(); });

// ================================================================
// IDLE DETECTION
// ================================================================

chrome.idle.setDetectionInterval(600);
chrome.idle.onStateChanged.addListener((newState) => {
  void syncActivity(newState);
});

// ================================================================
// TICK — PASSIVE TIME TRACKING
// ================================================================

async function tick(): Promise<void> {
  const tracking = await syncActivity();

  if (tracking.userIdle) {
    await updateBadge();
    return;
  }

  const state = await getState();

  if (!tracking.browserFocused) {
    await addWorkTime(1);
  } else if (tracking.currentHost && isBlockedHost(tracking.currentHost, state.settings.blockedSites)) {
    await addEntertainmentTime(1);
  } else {
    await addWorkTime(1);
  }

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
  void syncActivity();
  void syncBlocking();
  void updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('forge-tick', { periodInMinutes: 1 });
  void syncActivity();
  void syncBlocking();
  void updateBadge();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'stateChanged') {
    void syncBlocking();
    void updateBadge();
  }
  return false;
});
