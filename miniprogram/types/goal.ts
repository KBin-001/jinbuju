export type GoalCategory = "exam" | "skill" | "career";
export type GoalLevel = "zero" | "basic" | "intermediate" | "experienced" | "improve";
export type GoalIntensity = "light" | "normal" | "intensive";
export type PlanSource = "ai" | "fallback";

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

export interface CloudFunctionResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}
