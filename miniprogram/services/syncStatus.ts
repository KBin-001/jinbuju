import { on, emit } from "../utils/eventBus";

export type SyncPhase = "idle" | "syncing" | "synced" | "cached" | "failed" | "offline";

export interface SyncRuntimeState {
  phase: SyncPhase;
  lastSuccessfulAt: string;
  usingCache: boolean;
  pendingWrites: number;
  errorCode: string;
  errorMessage: string;
}

const initialState = (): SyncRuntimeState => ({
  phase: "idle",
  lastSuccessfulAt: "",
  usingCache: false,
  pendingWrites: 0,
  errorCode: "",
  errorMessage: "",
});

let state = initialState();

function publish(next: Partial<SyncRuntimeState>): void {
  state = { ...state, ...next };
  emit("sync:state", { ...state });
}

export function getSyncRuntime(): SyncRuntimeState {
  return { ...state };
}

export function hydrateSyncRuntime(lastSuccessfulAt?: string, usingCache = false): void {
  publish({
    phase: usingCache ? "cached" : lastSuccessfulAt ? "synced" : "idle",
    lastSuccessfulAt: lastSuccessfulAt || state.lastSuccessfulAt,
    usingCache,
    errorCode: "",
    errorMessage: "",
  });
}

export function markSyncing(): void {
  publish({ phase: "syncing", usingCache: false, errorCode: "", errorMessage: "" });
}

export function markSyncCached(error?: { code?: string; message?: string }): void {
  publish({
    phase: "cached",
    usingCache: true,
    errorCode: String(error?.code || "NETWORK_ERROR"),
    errorMessage: String(error?.message || "当前展示上次同步数据。"),
  });
}

export function markSyncFailed(error?: { code?: string; message?: string }): void {
  publish({
    phase: "failed",
    usingCache: true,
    errorCode: String(error?.code || "NETWORK_ERROR"),
    errorMessage: String(error?.message || "这次同步没有完成，请稍后重试。"),
  });
}

export function resetSyncRuntime(): void {
  state = initialState();
  emit("sync:state", { ...state });
}

on("manual:cloud-saved", () => publish({
  phase: "synced",
  lastSuccessfulAt: new Date().toISOString(),
  usingCache: false,
  pendingWrites: 0,
  errorCode: "",
  errorMessage: "",
}));

on("manual:sync", () => publish({
  phase: "synced",
  lastSuccessfulAt: new Date().toISOString(),
  usingCache: false,
  pendingWrites: 0,
  errorCode: "",
  errorMessage: "",
}));

on("manual:cloud-error", (error?: any) => markSyncFailed(error));
