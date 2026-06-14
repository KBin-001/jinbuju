import { GoalDraft, PreviewCache } from "../types/goal";

export const GOAL_DRAFT_KEY = "GOAL_DRAFT_V1";
export const PLAN_PREVIEW_KEY = "PLAN_PREVIEW_V1";
const GOAL_EDIT_STEP_KEY = "GOAL_EDIT_STEP_V1";
const PREVIEW_MAX_AGE = 24 * 60 * 60 * 1000;

export function getGoalDraft(): GoalDraft | null {
  const value = wx.getStorageSync(GOAL_DRAFT_KEY);
  return value && typeof value === "object" ? (value as GoalDraft) : null;
}

export function saveGoalDraft(goal: GoalDraft): void {
  wx.setStorageSync(GOAL_DRAFT_KEY, goal);
}

export function clearGoalDraft(): void {
  wx.removeStorageSync(GOAL_DRAFT_KEY);
}

export function getPlanPreview(): PreviewCache | null {
  const value = wx.getStorageSync(PLAN_PREVIEW_KEY) as PreviewCache | undefined;
  if (!value || typeof value !== "object" || !value.generatedAt) {
    return null;
  }

  if (Date.now() - value.generatedAt > PREVIEW_MAX_AGE) {
    clearPlanPreview();
    return null;
  }

  return value;
}

export function savePlanPreview(preview: PreviewCache): void {
  wx.setStorageSync(PLAN_PREVIEW_KEY, preview);
}

export function clearPlanPreview(): void {
  wx.removeStorageSync(PLAN_PREVIEW_KEY);
}

export function setGoalEditStep(step: number): void {
  wx.setStorageSync(GOAL_EDIT_STEP_KEY, step);
}

export function consumeGoalEditStep(): number | null {
  const step = Number(wx.getStorageSync(GOAL_EDIT_STEP_KEY));
  wx.removeStorageSync(GOAL_EDIT_STEP_KEY);
  return step >= 1 && step <= 6 ? step : null;
}
