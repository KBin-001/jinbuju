import { CloudFunctionResult as SharedCloudFunctionResult } from "./goal";

export type CloudFunctionResult<T> = SharedCloudFunctionResult<T>;
export type StageGeneratedBy = "ai" | "template";
export type LongTermGoalCategory =
  | "exam"
  | "skill"
  | "career"
  | "reading"
  | "fitness"
  | "habit"
  | "other";
export type TargetDuration =
  | "1_month"
  | "3_months"
  | "6_months"
  | "long_term";
export interface StagePlanGenerationInput {
  goalTitle: string;
  category: LongTermGoalCategory;
  desiredResult: string;
  dailyMinutes: number;
  targetDuration: TargetDuration;
  stageNumber: 1;
  durationDays: 7 | 10 | 14;
}

export interface AIStageAction {
  title: string;
  description: string;
  estimatedMinutes: number;
}

export interface AIStageDay {
  dayIndex: number;
  theme: string;
  totalMinutes: number;
  actions: AIStageAction[];
}

export interface AIStagePlan {
  stage: {
    title: string;
    summary: string;
    focus: string;
    durationDays: number;
  };
  days: AIStageDay[];
}

export interface StageGenerationResult {
  previewId: string;
  requestId: string;
  stageNumber: number;
  generatedBy: StageGeneratedBy;
  stagePlan: AIStagePlan;
  reused: boolean;
}

export interface LongTermGoalDraft {
  title: string;
  category: LongTermGoalCategory | "";
  desiredResult: string;
  dailyMinutes: number;
  targetDuration: TargetDuration;
}

export interface StagePreviewCache {
  input: StagePlanGenerationInput;
  result: StageGenerationResult;
  generatedAt: number;
}

export interface ConfirmStageResult {
  goalId: string;
  stageId: string;
  confirmed: boolean;
}

export interface StageReviewInput {
  stageId: string;
  difficulty: "easy" | "suitable" | "hard";
  nextPreference: "lighter" | "same" | "stronger" | "change_focus";
  focusAdjustment?: string;
}

export interface StageReviewData {
  stageId: string;
  completionRate: number;
  actionDays: number;
  streakDays: number;
  completedActionCount: number;
  totalActionCount: number;
  canReview: boolean;
  reviewed: boolean;
  previewId: string;
}
