export type AchievementCategory = "action" | "streak" | "focus" | "footprint" | "weekly";

export type AchievementId =
  | "action_1"
  | "action_10"
  | "action_50"
  | "streak_3"
  | "streak_7"
  | "streak_30"
  | "minutes_60"
  | "minutes_600"
  | "minutes_3000"
  | "days_7"
  | "days_30"
  | "days_100"
  | "week_actions_5"
  | "week_minutes_300"
  | "week_perfect";

export type AchievementMetric =
  | "completedActions"
  | "longestStreak"
  | "totalMinutes"
  | "actionDays"
  | "weeklyCompletedActions"
  | "weeklyMinutes"
  | "weeklyCompletionRate";

export interface AchievementDefinition {
  id: AchievementId;
  category: AchievementCategory;
  title: string;
  description: string;
  metric: AchievementMetric;
  target: number;
  unit: string;
  icon: string;
  accent: "sprout" | "jade" | "gold" | "sun" | "mist";
}

export interface AchievementUnlockRecord {
  achievementId: AchievementId;
  unlockedAt: string;
}

export interface AchievementProgress extends AchievementDefinition {
  unlocked: boolean;
  unlockedAt?: string;
  current: number;
  progressPercent: number;
  progressText: string;
  remainingText: string;
}

export interface AchievementCategoryView {
  key: AchievementCategory;
  title: string;
  subtitle: string;
  unlockedCount: number;
  achievements: AchievementProgress[];
}

export interface AchievementCollection {
  unlockedCount: number;
  totalCount: number;
  progressPercent: number;
  categories: AchievementCategoryView[];
  achievements: AchievementProgress[];
}
