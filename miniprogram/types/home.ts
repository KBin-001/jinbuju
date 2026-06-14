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
  weeklyCompletionRate: number;
  planStatus: PlanStatus;
}

export interface TodayTask {
  id: string;
  title: string;
  description: string;
  estimatedMinutes: number;
  completed: boolean;
}

export interface HomeData {
  businessDate: string;
  user: UserProgress;
  goal: GoalSummary | null;
  todayTasks: TodayTask[];
  completedCount: number;
  totalCount: number;
  completionRate: number;
  checkedInToday: boolean;
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
