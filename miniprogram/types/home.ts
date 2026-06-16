import {
  CloudFunctionResult as SharedCloudFunctionResult,
  PlanStatus,
} from "./goal";

export type CloudFunctionResult<T> = SharedCloudFunctionResult<T>;

export interface UserProgress {
  nickname: string;
  streakDays: number;
}

export interface GoalSummary {
  id: string;
  planId: string;
  title: string;
  category: string;
  currentDay: number;
  totalDays: number;
  planCompletionRate: number;
  planStatus: PlanStatus;
  stageTitle: string;
}

export interface TodayTask {
  id: string;
  title: string;
  description: string;
  estimatedMinutes: number;
  timePeriod: "morning" | "afternoon" | "evening" | "anytime";
  source: "manual" | "ai" | "template" | "carry_over";
  sourceLabel: string;
  planId: string;
  planTitle: string;
  completed: boolean;
}

export interface TodayTaskGroup {
  key: "morning" | "afternoon" | "evening" | "anytime";
  title: string;
  tasks: TodayTask[];
}

export interface TaskSourceSummary {
  key: string;
  label: string;
  count: number;
}

export interface HomeData {
  businessDate: string;
  user: UserProgress;
  goal: GoalSummary | null;
  todayTasks: TodayTask[];
  taskGroups: TodayTaskGroup[];
  sourceSummary: TaskSourceSummary[];
  completedCount: number;
  totalCount: number;
  completionRate: number;
  checkedInToday: boolean;
  todayRest: boolean;
}

export interface TodayCheckinDraft {
  goalId: string;
  planId: string;
  businessDate: string;
  tasks: TodayTask[];
  completedTaskIds: string[];
  completedCount: number;
  totalCount: number;
  preparedAt: number;
}

export type CheckinFeeling = "easy" | "normal" | "challenging" | "rewarding";

export interface SubmitCheckinParams {
  goalId: string;
  planId: string;
  completedTaskIds: string[];
  feeling: CheckinFeeling;
  note?: string;
}

export interface SubmitCheckinResult {
  businessDate: string;
  completedCount: number;
  totalCount: number;
  completionRate: number;
  streakDays: number;
  isFirstCheckinToday: boolean;
}

export interface CheckinStatusData {
  checkedInToday: boolean;
  tasks: TodayTask[];
  completedCount: number;
  totalCount: number;
  planStatus: PlanStatus | null;
}
