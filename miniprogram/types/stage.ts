import { CloudFunctionResult as SharedCloudFunctionResult } from "./goal";

export type CloudFunctionResult<T> = SharedCloudFunctionResult<T>;
export type StageGeneratedBy = "ai" | "ai_repaired" | "template" | "regenerated_ai" | "regenerated_ai_repaired";
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
export type GoalCategoryGroup = "learning" | "career" | "health" | "habit" | "creative" | "project" | "life" | "other";
export type GoalType = "skill" | "habit" | "outcome" | "project";
export type ClarificationQuestionType = "single_choice" | "multiple_choice" | "number" | "short_text" | "boolean";
export type PlanDurationDays = 1 | 2 | 3 | 4 | 5 | 6 | 7;
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

export interface AnalyzeGoalInput {
  title: string;
  description?: string;
  dailyMinutes?: number;
  durationDays?: number;
  currentLevel?: string;
  intensity?: string;
  deadline?: string;
}

export interface ClarificationQuestion {
  id: string;
  dimension:
    | "desired_outcome"
    | "current_level"
    | "target_horizon"
    | "daily_time"
    | "weekly_frequency"
    | "available_resources"
    | "constraints"
    | "preferences"
    | "environment"
    | "safety";
  question: string;
  type: ClarificationQuestionType;
  required: boolean;
  options?: string[];
  placeholder?: string;
  min?: number;
  max?: number;
  maxLength?: number;
}

export interface GoalAnalysisResult {
  analysisId: string;
  normalizedGoal: string;
  categoryGroup: GoalCategoryGroup;
  domainLabel: string;
  goalType: GoalType;
  ambiguityScore: number;
  confidenceScore: number;
  needsClarification: boolean;
  missingDimensions: string[];
  questions: ClarificationQuestion[];
  safetyContext: {
    riskLevel: "low" | "moderate" | "high";
    requiresProfessionalGuidance: boolean;
    boundaries: string[];
  };
  analysisSource: "ai" | "ai_repaired" | "fallback";
  status: "analyzing" | "needs_clarification" | "ready" | "consumed" | "failed" | "expired";
  expiresAt: string;
}

export interface ClarificationAnswer {
  questionId: string;
  value: string | number | boolean | string[];
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
  actionType?: "practice" | "learning" | "preparation" | "reflection" | "recovery" | "creation" | "execution";
  description: string;
  completionCriteria?: string;
  estimatedMinutes: number;
  requiredResources?: string[];
  safetyNotes?: string[];
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
    objective?: string;
    focus: string;
    durationDays: number;
    successMetrics?: string[];
    assumptions?: string[];
  };
  days: AIStageDay[];
}

export interface StageGenerationResult {
  previewId: string;
  requestId: string;
  stageNumber: number;
  generatedBy: StageGeneratedBy;
  generationSource?: StageGeneratedBy;
  stagePlan: AIStagePlan;
  reused: boolean;
  revision: number;
  editedSlotIds: string[];
  optimizationStatus: StageOptimizationStatus;
  optimizationAttempts: number;
  fallbackReason?: string;
  modelId?: string;
  providerGroup?: string;
  currentVersion: number;
  regenerationCount: number;
  maxRegenerationCount: number;
  generationStatus: "ready" | "regenerating" | "failed" | "confirmed";
  lastFeedback: StageFeedback | null;
}

export interface StagePreviewCache {
  input: CreateStagePreviewInput | StagePlanGenerationInput | null;
  analysisId?: string;
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

export type StageFeedbackType =
  | "too_many_tasks"
  | "too_few_tasks"
  | "too_difficult"
  | "too_easy"
  | "too_theoretical"
  | "not_enough_practice"
  | "time_unreasonable"
  | "resource_unavailable"
  | "direction_mismatch"
  | "too_repetitive"
  | "other";

export interface StageFeedback {
  types: StageFeedbackType[];
  note?: string;
}

export interface RegenerateStagePreviewInput {
  previewId: string;
  feedbackTypes: StageFeedbackType[];
  feedbackNote?: string;
  requestId: string;
}

export const STAGE_FEEDBACK_OPTIONS: {
  type: StageFeedbackType;
  label: string;
}[] = [
  { type: "too_many_tasks", label: "任务太多" },
  { type: "too_few_tasks", label: "任务太少" },
  { type: "too_difficult", label: "难度太高" },
  { type: "too_easy", label: "难度太低" },
  { type: "too_theoretical", label: "太偏理论" },
  { type: "not_enough_practice", label: "缺少实践" },
  { type: "time_unreasonable", label: "时间安排不合理" },
  { type: "resource_unavailable", label: "需要的资源我没有" },
  { type: "direction_mismatch", label: "方向不符合预期" },
  { type: "too_repetitive", label: "任务内容太重复" },
  { type: "other", label: "其他" },
];
