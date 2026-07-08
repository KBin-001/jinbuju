import { ActionTask, ArchivedGoal, DailyCheckin, Goal, ManualDataStore } from "../types/manual";
import { emit } from "../utils/eventBus";

const STORAGE_KEY = "JINBUJU_MANUAL_MVP_V1";

function emptyStore(): ManualDataStore {
  return { version: 1, goals: [], tasks: [], checkins: [], archivedGoals: [], achievementUnlocks: [], sparkCheckins: [] };
}

let memoryStore: ManualDataStore = emptyStore();
let persistTimer: number | undefined;
let lastPersistedJson = "";

function scheduleCloudPersist(): void {
  if (persistTimer !== undefined) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    const snapshot = JSON.stringify(memoryStore);
    if (snapshot === lastPersistedJson || !wx.cloud) return;
    wx.cloud.callFunction({ name: "generatePlan", data: { action: "syncManualData", store: memoryStore } })
      .then((response: any) => {
        if (!response?.result?.success) throw new Error(response?.result?.error?.message || "云端保存失败");
        if (JSON.stringify(memoryStore) === snapshot) lastPersistedJson = snapshot;
        emit("manual:cloud-saved", undefined);
      })
      .catch((error: Error) => emit("manual:cloud-error", error));
  }, 80) as unknown as number;
}

export function readLegacyManualStore(): ManualDataStore | null {
  const value = wx.getStorageSync(STORAGE_KEY) as Partial<ManualDataStore> | undefined;
  if (!value || value.version !== 1) return null;
  return normalizeStore(value);
}

function normalizeStore(value: Partial<ManualDataStore>): ManualDataStore {
  const goals = Array.isArray(value.goals) ? value.goals as Goal[] : [];
  const fallbackGoalId = goals.length === 1 ? goals[0].id : "";
  return {
    version: 1,
    activeGoalId: typeof value.activeGoalId === "string" ? value.activeGoalId : undefined,
    goals,
    tasks: Array.isArray(value.tasks) ? (value.tasks as ActionTask[]).map((task) => ({ ...task, goalId: task.goalId || fallbackGoalId })) : [],
    checkins: Array.isArray(value.checkins) ? value.checkins as DailyCheckin[] : [],
    archivedGoals: Array.isArray(value.archivedGoals) ? value.archivedGoals as ArchivedGoal[] : [],
    achievementUnlocks: Array.isArray(value.achievementUnlocks) ? value.achievementUnlocks : [],
    sparkCheckins: Array.isArray(value.sparkCheckins) ? value.sparkCheckins : [],
  };
}

export function loadManualStoreIntoMemory(value?: ManualDataStore): void {
  memoryStore = value ? normalizeStore(value) : emptyStore();
  lastPersistedJson = value ? JSON.stringify(memoryStore) : "";
}

export function clearLegacyManualStore(): void { wx.removeStorageSync(STORAGE_KEY); }

export function readManualStore(): ManualDataStore {
  return memoryStore;
}

export function writeManualStore(value: ManualDataStore): void {
  memoryStore = normalizeStore(value);
  scheduleCloudPersist();
}

export function clearManualStore(): void {
  memoryStore = emptyStore();
  lastPersistedJson = "";
  clearLegacyManualStore();
}

export function createLocalId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

