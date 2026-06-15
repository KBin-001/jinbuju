import { CloudFunctionResult as SharedCloudFunctionResult } from "./goal";

export type CloudFunctionResult<T> = SharedCloudFunctionResult<T>;
export type StageGeneratedBy = "ai" | "template";
export type StageOptimizationStatus = "idle" | "processing" | "ready" | "failed";
export type GoalTemplateId =
  | "cet4"
  | "teacher_exam"
  | "python"
  | "ai_tools"
  | "video_editing"
  | "resume"
  | "interview"
  | "custom";
export type GoalLevel = "zero" | "basic" | "intermediate";
export type GoalIntensity = "light" | "normal" | "intensive";
export type PlanDurationDays = 7 | 21 | 30;
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

export interface CreateStagePreviewInput {
  templateId: GoalTemplateId;
  customGoalTitle?: string;
  currentLevel: GoalLevel;
  dailyMinutes: 15 | 30 | 45 | 60 | 90;
  weeklyDays: 3 | 5 | 7;
  intensity: GoalIntensity;
  durationDays: PlanDurationDays;
  deadline?: string;
}

export interface LongTermGoalDraft extends CreateStagePreviewInput {
  version: 2;
}

export interface StagePlanGenerationInput {
  goalTitle: string;
  category: LongTermGoalCategory;
  desiredResult: string;
  dailyMinutes: number;
  targetDuration: TargetDuration;
  stageNumber: number;
  durationDays: number;
  templateId?: GoalTemplateId | "";
  currentLevel?: GoalLevel;
  weeklyDays?: 3 | 5 | 7;
  intensity?: GoalIntensity;
  deadline?: string;
}

export interface AIStageAction {
  slotId?: string;
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
  revision: number;
  editedSlotIds: string[];
  optimizationStatus: StageOptimizationStatus;
  optimizationAttempts: number;
}

export interface StagePreviewCache {
  input: CreateStagePreviewInput | StagePlanGenerationInput | null;
  result: StageGenerationResult;
  generatedAt: number;
}

export interface UpdateStagePreviewTaskInput {
  previewId: string;
  revision: number;
  mutationId: string;
  slotId: string;
  task: {
    title: string;
    description: string;
    estimatedMinutes: number;
  };
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
