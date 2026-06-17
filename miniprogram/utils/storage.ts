import { GoalDraft, NextWeekPreviewCache, PreviewCache } from "../types/goal";
import { ClarificationAnswer, GoalAnalysisResult, LongTermGoalDraft, StagePreviewCache } from "../types/stage";

export const GOAL_DRAFT_KEY = "GOAL_DRAFT_V1";
export const PLAN_PREVIEW_KEY = "PLAN_PREVIEW_V1";
const GOAL_EDIT_STEP_KEY = "GOAL_EDIT_STEP_V1";
const NEXT_WEEK_PREVIEW_KEY = "NEXT_WEEK_PREVIEW_V1";
const PREVIEW_MAX_AGE = 24 * 60 * 60 * 1000;
const LONG_TERM_GOAL_DRAFT_KEY = "LONG_TERM_GOAL_DRAFT_V2";
const OLD_LONG_TERM_GOAL_DRAFT_KEY = "LONG_TERM_GOAL_DRAFT_V1";
const STAGE_PREVIEW_KEY = "STAGE_PREVIEW_V2";
const OLD_STAGE_PREVIEW_KEY = "STAGE_PREVIEW_V1";
const GOAL_ANALYSIS_KEY = "GOAL_ANALYSIS_V1";
const GOAL_CLARIFICATION_ANSWERS_KEY = "GOAL_CLARIFICATION_ANSWERS_V1";

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

export function getNextWeekPreview(): NextWeekPreviewCache | null {
  const value = wx.getStorageSync(NEXT_WEEK_PREVIEW_KEY) as
    | NextWeekPreviewCache
    | undefined;
  if (!value || typeof value !== "object" || !value.generatedAt) {
    return null;
  }
  if (Date.now() - value.generatedAt > PREVIEW_MAX_AGE) {
    clearNextWeekPreview();
    return null;
  }
  return value;
}

export function saveNextWeekPreview(preview: NextWeekPreviewCache): void {
  wx.setStorageSync(NEXT_WEEK_PREVIEW_KEY, preview);
}

export function clearNextWeekPreview(): void {
  wx.removeStorageSync(NEXT_WEEK_PREVIEW_KEY);
}

export function getLongTermGoalDraft(): LongTermGoalDraft | null {
  wx.removeStorageSync(OLD_LONG_TERM_GOAL_DRAFT_KEY);
  const value = wx.getStorageSync(LONG_TERM_GOAL_DRAFT_KEY);
  return value && typeof value === "object" && value.version === 2
    ? (value as LongTermGoalDraft)
    : null;
}

export function saveLongTermGoalDraft(value: LongTermGoalDraft): void {
  wx.setStorageSync(LONG_TERM_GOAL_DRAFT_KEY, value);
}

export function clearLongTermGoalDraft(): void {
  wx.removeStorageSync(LONG_TERM_GOAL_DRAFT_KEY);
}

export function getStagePreviewCache(): StagePreviewCache | null {
  wx.removeStorageSync(OLD_STAGE_PREVIEW_KEY);
  const value = wx.getStorageSync(STAGE_PREVIEW_KEY) as StagePreviewCache | undefined;
  if (!value || typeof value !== "object" || !value.generatedAt) return null;
  if (Date.now() - value.generatedAt > PREVIEW_MAX_AGE) {
    clearStagePreviewCache();
    return null;
  }
  return value;
}

export function saveStagePreviewCache(value: StagePreviewCache): void {
  wx.setStorageSync(STAGE_PREVIEW_KEY, value);
}

export function clearStagePreviewCache(): void {
  wx.removeStorageSync(STAGE_PREVIEW_KEY);
}

export function getGoalAnalysisCache(): GoalAnalysisResult | null {
  const value = wx.getStorageSync(GOAL_ANALYSIS_KEY) as GoalAnalysisResult | undefined;
  if (!value || typeof value !== "object" || !value.analysisId) return null;
  if (value.expiresAt && Date.parse(value.expiresAt) <= Date.now()) {
    clearGoalAnalysisCache();
    return null;
  }
  return value;
}

export function saveGoalAnalysisCache(value: GoalAnalysisResult): void {
  wx.setStorageSync(GOAL_ANALYSIS_KEY, value);
}

export function clearGoalAnalysisCache(): void {
  wx.removeStorageSync(GOAL_ANALYSIS_KEY);
  wx.removeStorageSync(GOAL_CLARIFICATION_ANSWERS_KEY);
}

export function getClarificationAnswers(): Record<string, ClarificationAnswer["value"]> {
  const value = wx.getStorageSync(GOAL_CLARIFICATION_ANSWERS_KEY);
  return value && typeof value === "object" ? value as Record<string, ClarificationAnswer["value"]> : {};
}

export function saveClarificationAnswers(value: Record<string, ClarificationAnswer["value"]>): void {
  wx.setStorageSync(GOAL_CLARIFICATION_ANSWERS_KEY, value);
}
