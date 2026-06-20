export type GoalCategory = "exam" | "skill" | "career";
export type GoalLevel = "zero" | "basic" | "intermediate" | "experienced" | "improve";
export type GoalIntensity = "light" | "normal" | "intensive";
export type PlanSource = "ai" | "fallback";
export type PlanStatus = "draft" | "active" | "paused" | "completed" | "expired" | "extended" | "archived" | "reviewing";
export type PlanDayStatus =
  | "future"
  | "today"
  | "completed"
  | "partial"
  | "missed"
  | "rest"
  | "paused"
  | "not_started";
export type PlanTaskState = "pending" | "completed" | "postponed" | "expired" | "paused";

export interface GoalDraft {
  category: GoalCategory | "";
  goalTitle: string;
  goalTemplate: string;
  currentLevel: GoalLevel | "";
  deadline: string;
  weeklyDays: number;
  dailyMinutes: number;
  intensity: GoalIntensity;
  status: "draft";
}

export interface PlanTask {
  title: string;
  estimatedMinutes: number;
}

export interface PlanDay {
  day: number;
  date: string;
  title: string;
  isStudyDay: boolean;
  tasks: PlanTask[];
}

export interface PlanPreview {
  summary: string;
  weeklyGoal: string;
  days: PlanDay[];
  fallbackAdvice: string;
  source: PlanSource;
}

export interface PreviewCache {
  requestId: string;
  goal: GoalDraft;
  plan: PlanPreview;
  generatedAt: number;
}

export interface AdoptResult {
  goalId: string;
  planId: string;
  adopted: boolean;
}

export interface CurrentPlan {
  goalId: string;
  planId: string;
  goalTitle: string;
  summary: string;
  weeklyGoal: string;
  startDate: string;
  endDate: string;
  source: PlanSource;
}

export interface DeletePlanResult {
  deleted: boolean;
}

export interface PlanPageTask {
  id: string;
  planId: string;
  day: number;
  title: string;
  description: string;
  estimatedMinutes: number;
  scheduledDate: string;
  originalScheduledDate: string;
  completed: boolean;
  completedAt: unknown | null;
  postponed: boolean;
  state: PlanTaskState;
  canPostpone: boolean;
}

export interface PlanDaySummary {
  day: number;
  date: string;
  isToday: boolean;
  status: PlanDayStatus;
  completedCount: number;
  totalCount: number;
  tasks: PlanPageTask[];
}

export interface PlanPageData {
  businessDate: string;
  progress: {
    streakDays: number;
    totalActionDays: number;
  };
  goal: {
    id: string;
    title: string;
    category: string;
  } | null;
  plan: {
    id: string;
    status: PlanStatus;
    summary: string;
    stageTitle: string;
    focus: string;
    stageNumber: number;
    weeklyGoal: string;
    startDate: string;
    endDate: string;
    plannedEndDate: string;
    planDurationDays: number;
    currentDay: number;
    totalDays: number;
    dailyReminderTime: string;
    completedCount: number;
    totalCount: number;
    completionRate: number;
    nextWeekEligible: boolean;
    reviewEligible: boolean;
    pendingCount: number;
    rolloverCount: number;
    needsFullPlanCompletion: boolean;
  } | null;
  days: PlanDaySummary[];
  recentDays: PlanDaySummary[];
}

export interface PlanActionResult {
  planId: string;
  status?: PlanStatus;
  changed?: boolean;
  dailyReminderTime?: string;
  rolledOverCount?: number;
}

export interface PostponeTaskResult {
  taskId: string;
  planId: string;
  scheduledDate: string;
  postponed: boolean;
}

export interface NextWeekGenerateResult {
  requestId: string;
  previousPlanId: string;
  plan: PlanPreview;
}

export interface NextWeekPreviewCache extends NextWeekGenerateResult {
  generatedAt: number;
}

export interface CloudFunctionResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}
