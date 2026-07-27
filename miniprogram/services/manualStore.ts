import { ActionSession, ActionTask, ArchivedGoal, DailyCheckin, Goal, ManualDataStore } from "../types/manual";
import { emit } from "../utils/eventBus";

const STORAGE_KEY = "JINBUJU_MANUAL_MVP_V1";
const SNAPSHOT_KEY = "JINBUJU_MANUAL_SNAPSHOT_V1";

function emptyStore(): ManualDataStore {
  return { version: 1, goals: [], tasks: [], checkins: [], archivedGoals: [], actionSessions: [], achievementUnlocks: [], sparkCheckins: [] };
}

let memoryStore: ManualDataStore = emptyStore();
let persistTimer: number | undefined;
let lastPersistedJson = "";
let hydrated = false;
let writeGeneration = 0;

function cloneStore(value: ManualDataStore): ManualDataStore {
  return JSON.parse(JSON.stringify(value)) as ManualDataStore;
}

function ensureHydrated(): void {
  if (hydrated) return;
  hydrated = true;
  const snapshot = wx.getStorageSync(SNAPSHOT_KEY) as Partial<ManualDataStore> | undefined;
  if (snapshot?.version === 1) {
    memoryStore = normalizeStore(snapshot);
    lastPersistedJson = JSON.stringify(memoryStore);
  }
}

function persistLocalSnapshot(): void {
  wx.setStorageSync(SNAPSHOT_KEY, cloneStore(memoryStore));
}

function scheduleCloudPersist(): void {
  const generation = ++writeGeneration;
  if (persistTimer !== undefined) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    const payload = cloneStore(memoryStore);
    const snapshot = JSON.stringify(payload);
    if (snapshot === lastPersistedJson || !wx.cloud) return;
    wx.cloud.callFunction({ name: "generatePlan", data: { action: "syncManualData", store: payload } })
      .then((response: any) => {
        if (!response?.result?.success) throw new Error(response?.result?.error?.message || "云端保存失败");
        if (generation === writeGeneration && JSON.stringify(memoryStore) === snapshot) lastPersistedJson = snapshot;
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
    tasks: Array.isArray(value.tasks) ? (value.tasks as ActionTask[]).map((task) => {
      const estimatedMinutes = Number(task.estimatedMinutes);
      const actualMinutes = Number(task.actualMinutes);
      const shouldUseEstimatedMinutes = task.status === "completed"
        && (!Number.isInteger(actualMinutes) || actualMinutes <= 0)
        && Number.isInteger(estimatedMinutes)
        && estimatedMinutes > 0;
      return {
        ...task,
        goalId: task.goalId || fallbackGoalId,
        executionMode: task.executionMode === "direct" ? "direct" : "focus",
        actualMinutes: shouldUseEstimatedMinutes ? estimatedMinutes : task.actualMinutes,
      };
    }) : [],
    checkins: Array.isArray(value.checkins) ? value.checkins as DailyCheckin[] : [],
    archivedGoals: Array.isArray(value.archivedGoals)
      ? (value.archivedGoals as ArchivedGoal[]).map((goal) => ({
        ...goal,
        updatedAt: goal.updatedAt || goal.archivedAt || goal.endedAt || goal.createdAt,
      }))
      : [],
    actionSessions: Array.isArray(value.actionSessions) ? value.actionSessions as ActionSession[] : [],
    achievementUnlocks: Array.isArray(value.achievementUnlocks) ? value.achievementUnlocks : [],
    sparkCheckins: Array.isArray(value.sparkCheckins) ? value.sparkCheckins : [],
  };
}

export function loadManualStoreIntoMemory(value?: ManualDataStore): void {
  memoryStore = value ? normalizeStore(value) : emptyStore();
  hydrated = true;
  lastPersistedJson = value ? JSON.stringify(memoryStore) : "";
  persistLocalSnapshot();
}

export function clearLegacyManualStore(): void { wx.removeStorageSync(STORAGE_KEY); }

export function readManualStore(): ManualDataStore {
  ensureHydrated();
  return cloneStore(memoryStore);
}

export function writeManualStore(value: ManualDataStore, options: { skipCloudPersist?: boolean } = {}): void {
  ensureHydrated();
  const previous = memoryStore;
  memoryStore = normalizeStore(cloneStore(value));
  try {
    persistLocalSnapshot();
  } catch (error) {
    memoryStore = previous;
    throw error;
  }
  if (!options.skipCloudPersist) scheduleCloudPersist();
}

export function clearManualStore(): void {
  memoryStore = emptyStore();
  lastPersistedJson = "";
  hydrated = true;
  writeGeneration += 1;
  if (persistTimer !== undefined) clearTimeout(persistTimer);
  persistTimer = undefined;
  clearLegacyManualStore();
  wx.removeStorageSync(SNAPSHOT_KEY);
}

export function createLocalId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

