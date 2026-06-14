export type BadgeCode =
  | "first_checkin"
  | "streak_3"
  | "streak_7"
  | "checkin_10"
  | "first_stage_completed";

export interface CloudFunctionResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface UserProfileSummary {
  nickname: string;
  avatarUrl: string;
  joinedDays: number;
  streakDays: number;
}

export interface CurrentGoalSummary {
  id: string;
  planId: string;
  title: string;
  category: string;
  categoryLabel: string;
  stageTitle: string;
  currentDay: number;
  totalDays: number;
  planStatus: "active" | "paused" | "completed";
  stageCompletionRate: number;
}

export interface UserStatistics {
  totalCheckinDays: number;
  longestStreak: number;
  completedTaskCount: number;
  totalActionMinutes: number;
  completedStageCount: number;
}

export interface BadgeSummary {
  code: BadgeCode;
  name: string;
  description: string;
  unlocked: boolean;
  unlockedAt: string;
  progressDescription: string;
}

export interface HistoryGoalSummary {
  id: string;
  title: string;
  category: string;
  categoryLabel: string;
  status: "completed" | "stopped";
  startedAt: string;
  endedAt: string;
  checkinDays: number;
  completedStageCount: number;
  completedTaskCount: number;
}

export interface CommunityEntry {
  unlocked: boolean;
  title: string;
  description: string;
  imageFileId?: string;
  expiresAt?: string;
}

export interface ProfilePageData {
  businessDate: string;
  user: UserProfileSummary;
  currentGoal: CurrentGoalSummary | null;
  statistics: UserStatistics;
  badges: BadgeSummary[];
  recentGoals: HistoryGoalSummary[];
  community: CommunityEntry;
}

export interface DeleteUserDataResult {
  deleted: boolean;
}
