export type GoalCategory = "cet" | "teacher" | "postgraduate" | "civil_service" | "ai_learning" | "custom";
export type GoalStatus = "active" | "completed" | "archived";

export interface Goal {
  id: string;
  title: string;
  category: GoalCategory;
  description?: string;
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
}

export type ActionTaskStatus = "pending" | "completed" | "partially_completed" | "skipped" | "rescheduled";
export type ActionIssueReason = "not_enough_time" | "too_difficult" | "resource_unavailable" | "physical_condition" | "temporary_event" | "not_practical" | "other";

export interface ActionTask {
  id: string;
  goalId: string;
  title: string;
  description?: string;
  plannedDate: string;
  currentDate: string;
  estimatedMinutes: number;
  actualMinutes?: number;
  status: ActionTaskStatus;
  source: "manual" | "ai";
  issueReason?: ActionIssueReason;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface DailyCheckin {
  id: string;
  goalId: string;
  businessDate: string;
  completedCount: number;
  partialCount: number;
  actualMinutes: number;
  createdAt: string;
  updatedAt: string;
}

export interface DailyActionSummary {
  date: string;
  label: string;
  completedCount: number;
  partialCount: number;
  totalCount: number;
  isToday: boolean;
}

export interface ProgressSummary {
  totalTasks: number;
  completedTasks: number;
  totalActualMinutes: number;
  totalActionDays: number;
  todayCompleted: number;
  todayTotal: number;
  recentDays: DailyActionSummary[];
  unfinishedTasks: ActionTask[];
}

export interface TodaySummary {
  estimatedMinutes: number;
  actualMinutes: number;
  completedCount: number;
  partialCount: number;
  unfinishedCount: number;
  totalCount: number;
}

export interface ManualDataStore {
  version: 1;
  goals: Goal[];
  tasks: ActionTask[];
  checkins: DailyCheckin[];
}

