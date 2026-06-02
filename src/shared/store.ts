import type { ForgeState, DayData } from './types.js';
import { DEFAULT_SETTINGS, CURRENT_SCHEMA } from './types.js';

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
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
    today: freshDay(getToday()),
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
  const today = getToday();

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

  const today = getToday();
  if (state.today.date !== today) {
    state.days[state.today.date] = state.today;

    if (state.today.workTime < state.settings.fullUnlockWork) {
      state.penalty = Math.min(state.penalty + 15, state.settings.baseThreshold - 15);
    } else {
      state.penalty = 0;
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
    return s;
  }
}

export async function saveState(state: ForgeState): Promise<void> {
  if (!state.days) state.days = {};
  state.days[state.today.date] = state.today;
  await chrome.storage.local.set({ forge: state });
}

export function getThreshold(state: ForgeState): number {
  return Math.max(15, state.settings.baseThreshold - state.penalty);
}

export function isLocked(state: ForgeState): boolean {
  if (state.today.dayUnlocked) return false;
  return state.today.entertainmentTime >= getThreshold(state)
    && state.today.workTime < state.today.entertainmentTime;
}

export function getUnlockWorkNeeded(state: ForgeState): number {
  return Math.max(0, state.today.entertainmentTime - state.today.workTime);
}

export function getFullUnlockWorkRemaining(state: ForgeState): number {
  return Math.max(0, state.settings.fullUnlockWork - state.today.workTime);
}

export async function addEntertainmentTime(minutes: number): Promise<ForgeState> {
  const state = await getState();
  state.today.entertainmentTime += minutes;

  const threshold = getThreshold(state);
  if (!state.today.dayUnlocked && state.today.entertainmentTime >= threshold
      && state.today.workTime < state.today.entertainmentTime) {
    state.today.locked = true;
  }

  await saveState(state);
  return state;
}

export async function addWorkTime(minutes: number): Promise<ForgeState> {
  const state = await getState();
  state.today.workTime += minutes;

  if (state.today.workTime >= state.settings.fullUnlockWork) {
    state.today.dayUnlocked = true;
    state.today.locked = false;
  } else if (state.today.locked && state.today.workTime >= state.today.entertainmentTime) {
    state.today.locked = false;
  }

  await saveState(state);
  return state;
}

export async function addSiteTime(hostname: string, seconds: number): Promise<void> {
  const state = await getState();
  if (!state.today.siteTime) state.today.siteTime = {};
  state.today.siteTime[hostname] = (state.today.siteTime[hostname] || 0) + seconds;
  await saveState(state);
}

export async function setPlan(plan: string): Promise<void> {
  const state = await getState();
  state.today.plan = plan;
  await saveState(state);
}

export function getHistory(state: ForgeState, count: number = 7): DayData[] {
  const result: DayData[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    if (dateStr === state.today.date) {
      result.push(state.today);
    } else if (state.days[dateStr]) {
      result.push(state.days[dateStr]);
    }
  }
  return result;
}

export function getStreak(state: ForgeState): number {
  const goal = state.settings.fullUnlockWork;
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
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
