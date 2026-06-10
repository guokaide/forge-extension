import type { ForgeState, DayData } from './types.js';
import { DEFAULT_SETTINGS, CURRENT_SCHEMA } from './types.js';

export function getDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function freshDay(date: string): DayData {
  return {
    date,
    entertainmentTime: 0,
    workTime: 0,
    siteTime: {},
    locked: false,
    dayUnlocked: false,
  };
}

function defaultState(): ForgeState {
  return {
    schemaVersion: CURRENT_SCHEMA,
    today: freshDay(getDateKey()),
    days: {},
    penalty: 0,
    settings: { ...DEFAULT_SETTINGS },
  };
}

function validNum(v: unknown, fallback: number): number {
  return typeof v === 'number' && isFinite(v) && v >= 0 ? v : fallback;
}

function migrateDay(d: any, dateKey: string): DayData {
  return {
    date: dateKey,
    entertainmentTime: validNum(d?.entertainmentTime, 0),
    workTime: validNum(d?.workTime, 0),
    siteTime: (d?.siteTime && typeof d.siteTime === 'object') ? d.siteTime : {},
    locked: d?.locked === true,
    dayUnlocked: d?.dayUnlocked === true,
  };
}

function migrate(raw: any): ForgeState {
  const s = raw.settings || {};
  const t = raw.today || {};
  const today = getDateKey();

  const state: ForgeState = {
    schemaVersion: CURRENT_SCHEMA,
    settings: {
      baseThreshold: validNum(s.baseThreshold, DEFAULT_SETTINGS.baseThreshold),
      fullUnlockWork: validNum(s.fullUnlockWork, DEFAULT_SETTINGS.fullUnlockWork),
      blockedSites: Array.isArray(s.blockedSites) ? s.blockedSites : [...DEFAULT_SETTINGS.blockedSites],
    },
    today: migrateDay(t, typeof t.date === 'string' ? t.date : today),
    days: {},
    penalty: validNum(raw.penalty, 0),
  };

  if (raw.days && typeof raw.days === 'object') {
    for (const [key, d] of Object.entries(raw.days as Record<string, any>)) {
      state.days[key] = migrateDay(d, key);
    }
  }

  return state;
}

export async function getState(): Promise<ForgeState> {
  const result = await chrome.storage.local.get('forge');
  let state: ForgeState;

  if (result.forge?.schemaVersion === CURRENT_SCHEMA) {
    state = result.forge;
  } else if (result.forge?.settings) {
    state = migrate(result.forge);
    await saveState(state);
  } else {
    await chrome.storage.local.remove('forge');
    state = defaultState();
    await saveState(state);
  }

  const today = getDateKey();
  if (state.today.date !== today) {
    state.days[state.today.date] = state.today;

    if (state.today.date < today) {
      if (state.today.workTime < state.settings.fullUnlockWork) {
        state.penalty = Math.min(state.penalty + 15, state.settings.baseThreshold - 15);
      } else {
        state.penalty = 0;
      }
    }

    state.today = freshDay(today);
    await saveState(state);
  }

  return state;
}

export function extractDomain(input: string): string {
  const s = input.trim();
  if (!s) return '';
  try {
    const hostname = new URL(s.includes('://') ? s : `https://${s}`).hostname;
    return hostname.replace(/^www\./, '');
  } catch {
    // Unparseable input would invalidate the whole DNR rule; drop it
    return '';
  }
}

// Mutations are read-modify-write over the whole `forge` key; serialize them
// within this JS context so tick and event-driven writes can't clobber each other.
let writeQueue: Promise<unknown> = Promise.resolve();

function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.catch(() => undefined).then(fn);
  writeQueue = run.then(() => undefined, () => undefined);
  return run;
}

export async function saveState(state: ForgeState): Promise<void> {
  if (!state.days) state.days = {};
  state.days[state.today.date] = state.today;
  await chrome.storage.local.set({ forge: state });
}

function getThreshold(state: ForgeState): number {
  return Math.max(15, state.settings.baseThreshold - state.penalty);
}

export function getEntertainmentBalance(state: ForgeState): number {
  return getThreshold(state) + state.today.workTime - state.today.entertainmentTime;
}

export function getEntertainmentUsagePct(state: ForgeState): number {
  const allowance = getThreshold(state) + state.today.workTime;
  if (allowance <= 0) return state.today.entertainmentTime > 0 ? 100 : 0;
  return Math.round(Math.min(state.today.entertainmentTime / allowance, 1) * 100);
}

export function reconcileLockState(state: ForgeState): void {
  if (state.today.workTime >= state.settings.fullUnlockWork) {
    state.today.dayUnlocked = true;
    state.today.locked = false;
    return;
  }

  state.today.dayUnlocked = false;
  state.today.locked = state.today.entertainmentTime > 0 && getEntertainmentBalance(state) <= 0;
}

export function getUnlockWorkNeeded(state: ForgeState): number {
  return Math.max(0, 1 - getEntertainmentBalance(state));
}

export function getFullUnlockWorkRemaining(state: ForgeState): number {
  return Math.max(0, state.settings.fullUnlockWork - state.today.workTime);
}

export function addEntertainmentTime(minutes: number): Promise<ForgeState> {
  return enqueueWrite(async () => {
    const state = await getState();
    state.today.entertainmentTime += minutes;
    reconcileLockState(state);
    await saveState(state);
    return state;
  });
}

export function addWorkTime(minutes: number): Promise<ForgeState> {
  return enqueueWrite(async () => {
    const state = await getState();
    state.today.workTime += minutes;
    reconcileLockState(state);
    await saveState(state);
    return state;
  });
}

export function addSiteTime(hostname: string, seconds: number, date: string = getDateKey()): Promise<void> {
  if (seconds <= 0) return Promise.resolve();
  return enqueueWrite(async () => {
    const state = await getState();
    const day = date === state.today.date ? state.today : state.days[date];
    if (!day) return;
    if (!day.siteTime) day.siteTime = {};
    day.siteTime[hostname] = (day.siteTime[hostname] || 0) + seconds;
    await saveState(state);
  });
}

export function getHistory(state: ForgeState, count: number = 7): DayData[] {
  const result: DayData[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = getDateKey(d);
    if (dateStr === state.today.date) {
      result.push(state.today);
    } else if (state.days[dateStr]) {
      result.push(state.days[dateStr]);
    }
  }
  return result;
}

export interface SettingsInput {
  baseThreshold: number;
  fullUnlockWork: number;
  blockedSites: string[];
}

export async function applySettings(input: SettingsInput): Promise<ForgeState> {
  const state = await enqueueWrite(async () => {
    const s = await getState();
    if (input.baseThreshold >= 15 && input.baseThreshold <= 180)
      s.settings.baseThreshold = input.baseThreshold;
    if (input.fullUnlockWork >= 60 && input.fullUnlockWork <= 480)
      s.settings.fullUnlockWork = input.fullUnlockWork;
    s.settings.blockedSites = input.blockedSites;
    reconcileLockState(s);
    await saveState(s);
    return s;
  });
  chrome.runtime.sendMessage({ type: 'stateChanged' });
  return state;
}

export function getStreak(state: ForgeState): number {
  const goal = state.settings.fullUnlockWork;
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = getDateKey(d);
    let workMin: number;
    if (dateStr === state.today.date) {
      workMin = state.today.workTime;
    } else {
      const dayData = state.days[dateStr];
      if (!dayData) { if (i === 0) continue; break; }
      workMin = dayData.workTime;
    }
    if (workMin >= goal) {
      streak++;
    } else if (i === 0) {
      continue;
    } else {
      break;
    }
  }
  return streak;
}
