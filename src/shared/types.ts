export interface DayData {
  date: string;
  entertainmentTime: number;
  workTime: number;
  siteTime: Record<string, number>;
  locked: boolean;
  dayUnlocked: boolean;
  plan?: string;
}

export interface ForgeSettings {
  baseThreshold: number;
  blockedSites: string[];
  fullUnlockWork: number;
}

export interface ForgeState {
  schemaVersion: number;
  today: DayData;
  days: Record<string, DayData>;
  penalty: number;
  settings: ForgeSettings;
}

export const CURRENT_SCHEMA = 2;

export const DEFAULT_SETTINGS: ForgeSettings = {
  baseThreshold: 60,
  fullUnlockWork: 180,
  blockedSites: [
    'bilibili.com',
    'youtube.com',
    'douyin.com',
    'tiktok.com',
    'twitter.com',
    'x.com',
    'weibo.com',
    'v.qq.com',
    'iqiyi.com',
    'youku.com',
  ],
};
