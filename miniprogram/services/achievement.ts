import {
  AchievementCategory,
  AchievementCategoryView,
  AchievementCollection,
  AchievementDefinition,
  AchievementId,
  AchievementMetric,
  AchievementProgress,
  AchievementUnlockRecord,
} from "../types/achievement";
import { ActionTask } from "../types/manual";
import { readManualStore, writeManualStore } from "./manualStore";

export const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] = [
  { id: "action_1", category: "action", title: "第一步", description: "完成第 1 项行动", metric: "completedActions", target: 1, unit: "项", icon: "/assets/achievements/action-1.svg", accent: "sprout" },
  { id: "action_10", category: "action", title: "渐入佳境", description: "累计完成 10 项行动", metric: "completedActions", target: 10, unit: "项", icon: "/assets/achievements/action-10.svg", accent: "jade" },
  { id: "action_50", category: "action", title: "步履成章", description: "累计完成 50 项行动", metric: "completedActions", target: 50, unit: "项", icon: "/assets/achievements/action-50.svg", accent: "gold" },
  { id: "streak_3", category: "streak", title: "三日新芽", description: "连续行动 3 天", metric: "longestStreak", target: 3, unit: "天", icon: "/assets/achievements/streak-3.svg", accent: "sprout" },
  { id: "streak_7", category: "streak", title: "一周常青", description: "连续行动 7 天", metric: "longestStreak", target: 7, unit: "天", icon: "/assets/achievements/streak-7.svg", accent: "jade" },
  { id: "streak_30", category: "streak", title: "月度恒心", description: "连续行动 30 天", metric: "longestStreak", target: 30, unit: "天", icon: "/assets/achievements/streak-30.svg", accent: "gold" },
  { id: "minutes_60", category: "focus", title: "专注初光", description: "累计投入 60 分钟", metric: "totalMinutes", target: 60, unit: "分钟", icon: "/assets/achievements/minutes-60.svg", accent: "sun" },
  { id: "minutes_600", category: "focus", title: "十时沉淀", description: "累计投入 600 分钟", metric: "totalMinutes", target: 600, unit: "分钟", icon: "/assets/achievements/minutes-600.svg", accent: "jade" },
  { id: "minutes_3000", category: "focus", title: "五十时远山", description: "累计投入 3000 分钟", metric: "totalMinutes", target: 3000, unit: "分钟", icon: "/assets/achievements/minutes-3000.svg", accent: "gold" },
  { id: "days_7", category: "footprint", title: "七日足迹", description: "在 7 个不同日期留下行动", metric: "actionDays", target: 7, unit: "天", icon: "/assets/achievements/days-7.svg", accent: "mist" },
  { id: "days_30", category: "footprint", title: "三十日历", description: "在 30 个不同日期留下行动", metric: "actionDays", target: 30, unit: "天", icon: "/assets/achievements/days-30.svg", accent: "jade" },
  { id: "days_100", category: "footprint", title: "百日年轮", description: "在 100 个不同日期留下行动", metric: "actionDays", target: 100, unit: "天", icon: "/assets/achievements/days-100.svg", accent: "gold" },
  { id: "week_actions_5", category: "weekly", title: "本周五步", description: "单周完成至少 5 项行动", metric: "weeklyCompletedActions", target: 5, unit: "项", icon: "/assets/achievements/week-actions-5.svg", accent: "sprout" },
  { id: "week_minutes_300", category: "weekly", title: "专注一周", description: "单周累计投入 300 分钟", metric: "weeklyMinutes", target: 300, unit: "分钟", icon: "/assets/achievements/week-minutes-300.svg", accent: "sun" },
  { id: "week_perfect", category: "weekly", title: "圆满一周", description: "单周安排至少 5 项行动并全部完成", metric: "weeklyCompletionRate", target: 100, unit: "%", icon: "/assets/achievements/week-perfect.svg", accent: "gold" },
];

const CATEGORY_META: Array<{ key: AchievementCategory; title: string; subtitle: string }> = [
  { key: "action", title: "行动里程碑", subtitle: "每一步都算数" },
  { key: "streak", title: "连续坚持", subtitle: "让节奏慢慢稳定下来" },
  { key: "focus", title: "时间投入", subtitle: "专注会留下清晰的刻度" },
  { key: "footprint", title: "成长足迹", subtitle: "把行动写进日历" },
  { key: "weekly", title: "每周荣誉", subtitle: "用一周完成一次温和闭环" },
];

interface MetricSnapshot {
  values: Record<AchievementMetric, number>;
  earnedDates: Partial<Record<AchievementId, string>>;
}

interface WeekBucket {
  tasks: ActionTask[];
  completed: ActionTask[];
  minutes: number;
}

function taskDate(task: ActionTask): string {
  return String(task.completedAt || task.updatedAt || task.currentDate).slice(0, 10) || task.currentDate;
}

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

function dayNumber(value: string): number {
  return Math.floor(parseDate(value).getTime() / 86400000);
}

function weekKey(value: string): string {
  const date = parseDate(value);
  const weekday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - weekday);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateAtThreshold(tasks: ActionTask[], target: number, value: (task: ActionTask) => number): string | undefined {
  let total = 0;
  for (const task of tasks) {
    total += value(task);
    if (total >= target) return taskDate(task);
  }
  return undefined;
}

function buildSnapshot(tasks: ActionTask[]): MetricSnapshot {
  const visible = tasks
    .filter((task) => task.status !== "rescheduled")
    .slice()
    .sort((a, b) => taskDate(a).localeCompare(taskDate(b)) || a.createdAt.localeCompare(b.createdAt));
  const completed = visible.filter((task) => task.status === "completed");
  const active = visible.filter((task) => task.status === "completed" || task.status === "partially_completed");
  const actionDates = Array.from(new Set(active.map((task) => task.currentDate))).sort();
  const completedDates = Array.from(new Set(completed.map((task) => task.currentDate))).sort();
  const weeks = new Map<string, WeekBucket>();

  visible.forEach((task) => {
    const key = weekKey(task.currentDate);
    const bucket = weeks.get(key) || { tasks: [], completed: [], minutes: 0 };
    bucket.tasks.push(task);
    if (task.status === "completed") bucket.completed.push(task);
    bucket.minutes += Math.max(0, task.actualMinutes || 0);
    weeks.set(key, bucket);
  });

  let longestStreak = 0;
  let streakStart = 0;
  const streakDates = new Map<number, string>();
  for (let index = 0; index < completedDates.length; index += 1) {
    if (index === 0 || dayNumber(completedDates[index]) - dayNumber(completedDates[index - 1]) !== 1) streakStart = index;
    const length = index - streakStart + 1;
    longestStreak = Math.max(longestStreak, length);
    if (!streakDates.has(length)) streakDates.set(length, completedDates[index]);
  }

  const totalMinutes = visible.reduce((sum, task) => sum + Math.max(0, task.actualMinutes || 0), 0);
  const maxWeekActions = Math.max(0, ...Array.from(weeks.values()).map((week) => week.completed.length));
  const maxWeekMinutes = Math.max(0, ...Array.from(weeks.values()).map((week) => week.minutes));
  const eligiblePerfectWeeks = Array.from(weeks.values()).filter((week) => week.tasks.length >= 5);
  const maxWeekCompletionRate = Math.max(0, ...eligiblePerfectWeeks.map((week) => Math.round((week.completed.length / week.tasks.length) * 100)));
  const earnedDates: Partial<Record<AchievementId, string>> = {};

  ([1, 10, 50] as const).forEach((target) => {
    earnedDates[`action_${target}`] = completed[target - 1] ? taskDate(completed[target - 1]) : undefined;
  });
  ([3, 7, 30] as const).forEach((target) => { earnedDates[`streak_${target}`] = streakDates.get(target); });
  ([60, 600, 3000] as const).forEach((target) => {
    earnedDates[`minutes_${target}`] = dateAtThreshold(visible, target, (task) => Math.max(0, task.actualMinutes || 0));
  });
  ([7, 30, 100] as const).forEach((target) => { earnedDates[`days_${target}`] = actionDates[target - 1]; });

  Array.from(weeks.values()).forEach((week) => {
    const sortedCompleted = week.completed.slice().sort((a, b) => taskDate(a).localeCompare(taskDate(b)));
    if (!earnedDates.week_actions_5 && sortedCompleted.length >= 5) earnedDates.week_actions_5 = taskDate(sortedCompleted[4]);
    if (!earnedDates.week_minutes_300 && week.minutes >= 300) {
      earnedDates.week_minutes_300 = dateAtThreshold(week.tasks.slice().sort((a, b) => taskDate(a).localeCompare(taskDate(b))), 300, (task) => Math.max(0, task.actualMinutes || 0));
    }
    if (!earnedDates.week_perfect && week.tasks.length >= 5 && week.completed.length === week.tasks.length) {
      earnedDates.week_perfect = taskDate(sortedCompleted[sortedCompleted.length - 1]);
    }
  });

  return {
    values: {
      completedActions: completed.length,
      longestStreak,
      totalMinutes,
      actionDays: actionDates.length,
      weeklyCompletedActions: maxWeekActions,
      weeklyMinutes: maxWeekMinutes,
      weeklyCompletionRate: maxWeekCompletionRate,
    },
    earnedDates,
  };
}

function formatProgress(definition: AchievementDefinition, current: number, unlocked: boolean): { progressText: string; remainingText: string } {
  if (unlocked) return { progressText: "已获得", remainingText: `已达成 ${definition.target}${definition.unit}` };
  const safeCurrent = Math.min(current, definition.target);
  const remaining = Math.max(0, definition.target - safeCurrent);
  return {
    progressText: `${safeCurrent}/${definition.target}${definition.unit}`,
    remainingText: `还差 ${remaining}${definition.unit}`,
  };
}

export function getAchievementCollection(): AchievementCollection {
  const store = readManualStore();
  const snapshot = buildSnapshot(store.tasks || []);
  const records = (store.achievementUnlocks || []).slice();
  const recordMap = new Map(records.map((record) => [record.achievementId, record]));
  let changed = false;

  ACHIEVEMENT_DEFINITIONS.forEach((definition) => {
    if (recordMap.has(definition.id)) return;
    const unlockedAt = snapshot.earnedDates[definition.id];
    if (!unlockedAt) return;
    const record: AchievementUnlockRecord = { achievementId: definition.id, unlockedAt };
    records.push(record);
    recordMap.set(definition.id, record);
    changed = true;
  });

  if (changed) {
    store.achievementUnlocks = records;
    writeManualStore(store);
  }

  const achievements: AchievementProgress[] = ACHIEVEMENT_DEFINITIONS.map((definition) => {
    const record = recordMap.get(definition.id);
    const current = snapshot.values[definition.metric] || 0;
    const copy = formatProgress(definition, current, Boolean(record));
    return {
      ...definition,
      unlocked: Boolean(record),
      unlockedAt: record?.unlockedAt,
      current,
      progressPercent: record ? 100 : Math.min(100, Math.round((current / definition.target) * 100)),
      ...copy,
    };
  });

  const categories: AchievementCategoryView[] = CATEGORY_META.map((category) => {
    const categoryAchievements = achievements.filter((item) => item.category === category.key);
    return {
      ...category,
      unlockedCount: categoryAchievements.filter((item) => item.unlocked).length,
      achievements: categoryAchievements,
    };
  });
  const unlockedCount = achievements.filter((item) => item.unlocked).length;
  return {
    unlockedCount,
    totalCount: achievements.length,
    progressPercent: Math.round((unlockedCount / achievements.length) * 100),
    categories,
    achievements,
  };
}
