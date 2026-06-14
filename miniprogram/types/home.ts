import { CloudFunctionResult as SharedCloudFunctionResult } from "./goal";

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
