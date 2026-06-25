export type GoalCategory = "cet" | "teacher" | "postgraduate" | "civil_service" | "ai_learning" | "custom";
export type GoalStatus = "active" | "completed" | "ended" | "archived";

export interface Goal {
  id: string;
  title: string;
  category: GoalCategory;
  description?: string;
  status: GoalStatus;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  archivedAt?: string;
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

export interface GrowthHeatmapDay {
  date: string;
  label: string;
  completedCount: number;
  partialCount: number;
  totalCount: number;
  completionRate: number;
  level: 0 | 1 | 2 | 3;
  isToday: boolean;
}

export interface GrowthBadge {
  key: string;
  title: string;
  description: string;
  unlocked: boolean;
  progressText: string;
}

export interface ProgressSummary {
  totalTasks: number;
  completedTasks: number;
  totalActualMinutes: number;
  totalActionDays: number;
  todayCompleted: number;
  todayTotal: number;
  currentStreakDays: number;
  recentDays: DailyActionSummary[];
  heatmapWeeks: GrowthHeatmapDay[][];
  badges: GrowthBadge[];
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

export interface ArchivedGoalStats {
  totalActions: number;
  completedActions: number;
  estimatedMinutes: number;
  actualMinutes: number;
  completionRate: number;
}

export interface ArchivedGoal {
  id: string;
  title: string;
  status: "completed" | "ended" | "archived";
  createdAt: string;
  startedAt?: string;
  endedAt: string;
  archivedAt: string;
  actions: ActionTask[];
  stats: ArchivedGoalStats;
}

export interface ManualDataStore {
  version: 1;
  goals: Goal[];
  tasks: ActionTask[];
  checkins: DailyCheckin[];
  archivedGoals: ArchivedGoal[];
}

