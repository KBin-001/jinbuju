import { isValidBusinessDate } from "./date";

const STORAGE_KEY = "pendingTodayActionEditorRequest";

export type TodayActionEditorRequest =
  | { mode: "create"; goalId?: string; date?: string }
  | { mode: "edit"; taskId: string };

function isBusinessDate(value: unknown): value is string {
  return typeof value === "string" && isValidBusinessDate(value);
}

function normalizeRequest(value: unknown): TodayActionEditorRequest | null {
  if (!value || typeof value !== "object") return null;
  const request = value as Record<string, unknown>;
  if (request.mode === "edit") {
    const taskId = typeof request.taskId === "string" ? request.taskId.trim() : "";
    return taskId ? { mode: "edit", taskId } : null;
  }
  if (request.mode !== "create") return null;
  const goalId = typeof request.goalId === "string" ? request.goalId.trim() : "";
  const hasDate = Object.prototype.hasOwnProperty.call(request, "date");
  const date = hasDate ? (isBusinessDate(request.date) ? request.date : null) : undefined;
  if (hasDate && !date) return null;
  return { mode: "create", ...(goalId ? { goalId } : {}), ...(date ? { date } : {}) };
}

export function queueTodayActionEditor(request: TodayActionEditorRequest): void {
  const normalized = normalizeRequest(request);
  if (!normalized) throw new Error("行动编辑请求无效");
  wx.setStorageSync(STORAGE_KEY, normalized);
}

export function consumeTodayActionEditor(): TodayActionEditorRequest | null {
  let request: TodayActionEditorRequest | null = null;
  try {
    request = normalizeRequest(wx.getStorageSync(STORAGE_KEY));
  } finally {
    wx.removeStorageSync(STORAGE_KEY);
  }
  return request;
}

export function openTodayActionEditor(request: TodayActionEditorRequest): void {
  try {
    queueTodayActionEditor(request);
  } catch (error) {
    wx.showToast({ title: error instanceof Error ? error.message : "行动编辑器打开失败", icon: "none" });
    return;
  }
  wx.switchTab({
    url: "/pages/index/index",
    fail: () => {
      consumeTodayActionEditor();
      wx.showToast({ title: "今日页打开失败，请重试", icon: "none" });
    },
  });
}
