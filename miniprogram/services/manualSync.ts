import { ManualDataStore } from "../types/manual";
import { CoachActionResult, CoachActionStatusResult } from "../types/progressCoach";
import { emit } from "../utils/eventBus";
import { readManualStore, writeManualStore } from "./manualStore";
import { CloudRequestError, createCloudRequestId, logCloudRequest } from "../utils/cloudRequest";

interface CloudResult<T> { success: boolean; data?: T; error?: { code?: string; message?: string } }

function call<T>(data: Record<string, unknown>, timeout = 20000): Promise<T> {
  const action = String(data.action || "manualAction");
  const requestId = createCloudRequestId(action);
  const startedAt = Date.now();
  return new Promise<{ result?: CloudResult<T> }>((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error("云端同步超时，请稍后重试。"), { code: "FUNCTION_TIMEOUT", requestId })), timeout);
    wx.cloud.callFunction({ name: "generatePlan", data: { ...data, requestId } }).then((response: any) => {
      clearTimeout(timer);
      resolve(response);
    }, (error: unknown) => {
      clearTimeout(timer);
      reject(error);
    });
  }).then((response) => {
    const result = response.result;
    if (!result?.success || result.data === undefined) throw Object.assign(new Error(result?.error?.message || "云端任务操作失败。"), { code: result?.error?.code || "NETWORK_ERROR", requestId });
    logCloudRequest(action, requestId, startedAt);
    return result.data;
  }).catch((rawError: CloudRequestError) => {
    const error = rawError || new Error("云端任务操作失败。") as CloudRequestError;
    error.requestId = requestId;
    logCloudRequest(action, requestId, startedAt, error);
    throw error;
  });
}

const EXPECTED_COACH_RUNTIME_VERSION = "coach-actions-2026-07-07.3";
let verifiedRuntime: Promise<void> | undefined;

export function verifyCoachRuntime(): Promise<void> {
  if (!verifiedRuntime) {
    verifiedRuntime = call<{ version: string }>({ action: "getCoachRuntimeInfo" }, 10000).then((runtime) => {
      if (runtime.version !== EXPECTED_COACH_RUNTIME_VERSION) {
        throw Object.assign(new Error("云端 AI 教练版本与本地代码不一致，请重新上传 generatePlan 云函数。"), { code: "COACH_RUNTIME_MISMATCH" });
      }
    }).catch((error) => {
      verifiedRuntime = undefined;
      if (error?.code === "INVALID_ARGUMENT") {
        throw Object.assign(new Error("云端 AI 教练版本与本地代码不一致，请重新上传 generatePlan 云函数。"), { code: "COACH_RUNTIME_MISMATCH", requestId: error.requestId });
      }
      throw error;
    });
  }
  return verifiedRuntime;
}

function mergeRecords<T>(remote: T[], local: T[], keyOf: (item: T) => string, updatedAtOf: (item: T) => string): T[] {
  const map = new Map(remote.map((item) => [keyOf(item), item]));
  local.forEach((item) => {
    const key = keyOf(item);
    const existing = map.get(key);
    const localTime = updatedAtOf(item);
    const remoteTime = existing ? updatedAtOf(existing) : "";
    const remoteDeleteWinsTie = existing
      && localTime === remoteTime
      && Boolean((existing as any).deletedAt)
      && !Boolean((item as any).deletedAt);
    if (!existing || localTime > remoteTime || (localTime === remoteTime && !remoteDeleteWinsTie)) map.set(key, item);
  });
  return Array.from(map.values());
}

let pendingManualSync: Promise<ManualDataStore> | undefined;

export function syncManualData(): Promise<ManualDataStore> {
  if (pendingManualSync) return pendingManualSync;
  const requestSnapshot = JSON.parse(JSON.stringify(readManualStore())) as ManualDataStore;
  const pending = call<ManualDataStore>({ action: "syncManualData", store: requestSnapshot }).then((remote) => {
    // 请求期间可能发生本地写入；以响应到达时的本地状态再次合并，避免旧响应覆盖新操作。
    const current = readManualStore();
    const merged: ManualDataStore = {
      version: 1,
      activeGoalId: current.activeGoalId || remote.activeGoalId,
      goals: mergeRecords(remote.goals || [], current.goals || [], (item) => item.id, (item) => item.updatedAt || item.createdAt || ""),
      tasks: mergeRecords(remote.tasks || [], current.tasks || [], (item) => item.id, (item) => item.updatedAt || item.createdAt || ""),
      checkins: mergeRecords(remote.checkins || [], current.checkins || [], (item) => item.id, (item) => item.updatedAt || item.createdAt || ""),
      archivedGoals: mergeRecords(remote.archivedGoals || [], current.archivedGoals || [], (item) => item.id, (item) => item.archivedAt || item.endedAt || ""),
      achievementUnlocks: mergeRecords(remote.achievementUnlocks || [], current.achievementUnlocks || [], (item) => item.achievementId, (item) => item.unlockedAt || ""),
      sparkCheckins: mergeRecords(remote.sparkCheckins || [], current.sparkCheckins || [], (item) => item.businessDate, (item) => item.checkedAt || "")
        .sort((a, b) => a.businessDate.localeCompare(b.businessDate)),
    };
    if (!merged.goals.some((goal) => goal.id === merged.activeGoalId && goal.status === "active")) {
      merged.activeGoalId = merged.goals.find((goal) => goal.status === "active")?.id;
    }
    writeManualStore(merged, { skipCloudPersist: true });
    emit("manual:sync", merged);
    return merged;
  });
  pendingManualSync = pending.then(
    (value) => { pendingManualSync = undefined; return value; },
    (error) => { pendingManualSync = undefined; throw error; },
  );
  return pendingManualSync;
}

function cacheCoachActionResult(result: CoachActionResult): CoachActionResult {
  const store = readManualStore();
  const index = store.tasks.findIndex((task) => task.id === result.task.id);
  if (index >= 0) store.tasks[index] = result.task;
  else store.tasks.push(result.task);
  writeManualStore(store);
  emit("manual:sync", store);
  return result;
}

export function getCoachActionStatus(proposalId: string): Promise<CoachActionStatusResult> {
  return call<CoachActionStatusResult>({ action: "getCoachActionStatus", proposalId });
}

export async function executeCoachAction(proposalId: string): Promise<CoachActionResult> {
  try {
    return cacheCoachActionResult(await call<CoachActionResult>({ action: "executeCoachAction", proposalId }));
  } catch (error) {
    const ambiguousCodes = new Set(["FUNCTION_TIMEOUT", "NETWORK_ERROR", "INTERNAL_ERROR"]);
    if (!ambiguousCodes.has(String((error as CloudRequestError)?.code || ""))) throw error;
    try {
      const status = await getCoachActionStatus(proposalId);
      if (status.status === "executed" && status.result) return cacheCoachActionResult(status.result);
      if (status.status === "expired") {
        throw Object.assign(new Error("操作确认已过期，请重新告诉 AI。"), { code: "COACH_ACTION_EXPIRED" });
      }
    } catch (statusError) {
      if ((statusError as CloudRequestError)?.code === "COACH_ACTION_EXPIRED") throw statusError;
      console.error("[coach action] status check failed", {
        proposalIdSuffix: proposalId.slice(-8),
        code: (statusError as CloudRequestError)?.code || "",
      });
    }
    throw error;
  }
}
