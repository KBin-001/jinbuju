import { ActionTask, DailyCheckin, Goal, ManualDataStore } from "../types/manual";

const STORAGE_KEY = "JINBUJU_MANUAL_MVP_V1";

function emptyStore(): ManualDataStore {
  return { version: 1, goals: [], tasks: [], checkins: [] };
}

export function readManualStore(): ManualDataStore {
  const value = wx.getStorageSync(STORAGE_KEY) as Partial<ManualDataStore> | undefined;
  if (!value || value.version !== 1) return emptyStore();
  return {
    version: 1,
    goals: Array.isArray(value.goals) ? value.goals as Goal[] : [],
    tasks: Array.isArray(value.tasks) ? value.tasks as ActionTask[] : [],
    checkins: Array.isArray(value.checkins) ? value.checkins as DailyCheckin[] : [],
  };
}

export function writeManualStore(value: ManualDataStore): void {
  wx.setStorageSync(STORAGE_KEY, value);
}

export function clearManualStore(): void {
  wx.removeStorageSync(STORAGE_KEY);
}

export function createLocalId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

