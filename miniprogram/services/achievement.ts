import {
  AchievementCategory,
  AchievementCategoryView,
  AchievementCollection,
  AchievementDefinition,
  AchievementId,
  AchievementMetric,
  AchievementProgress,
  AchievementTier,
  AchievementUnlockRecord,
} from "../types/achievement";
import { ActionTask } from "../types/manual";
import { getTodayBusinessDate } from "../utils/date";
import { readManualStore, writeManualStore } from "./manualStore";

export const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] = [
  { id: "action_1", category: "action", title: "第一步", description: "完成第 1 项行动", metric: "completedActions", target: 1, unit: "项", icon: "/assets/achievements/action-1.svg", accent: "sprout" },
  { id: "action_10", category: "action", title: "渐入佳境", description: "累计完成 10 项行动", metric: "completedActions", target: 10, unit: "项", icon: "/assets/achievements/action-10.svg", accent: "jade" },
  { id: "action_50", category: "action", title: "步履成章", description: "累计完成 50 项行动", metric: "completedActions", target: 50, unit: "项", icon: "/assets/achievements/action-50.svg", accent: "gold" },
  { id: "streak_3", category: "streak", title: "三日新芽", description: "连续行动 3 天", metric: "longestStreak", target: 3, unit: "天", icon: "/assets/achievements/streak-3.svg", accent: "sprout" },
  { id: "streak_7", category: "streak", title: "一周常青", description: "连续行动 7 天", metric: "longestStreak", target: 7, unit: "天", icon: "/assets/achievements/streak-7.svg", accent: "jade" },
  { id: "streak_30", category: "streak", title: "月度恒心", description: "连续行动 30 天", metric: "longestStreak", target: 30, unit: "天", icon: "/assets/achievements/streak-30.svg", accent: "gold" },
  { id: "minutes_60", category: "focus", title: "专注初光", description: "累计投入 60 分钟", metric: "totalMinutes", target: 60, unit: "分钟", icon: "/assets/achievements/minutes-60.svg", accent: "sun" },
  { id: "minutes_600", category: "focus", title: "十时沉潜", description: "累计投入 600 分钟", metric: "totalMinutes", target: 600, unit: "分钟", icon: "/assets/achievements/minutes-600.svg", accent: "jade" },
  { id: "minutes_3000", category: "focus", title: "五十时远山", description: "累计投入 3000 分钟", metric: "totalMinutes", target: 3000, unit: "分钟", icon: "/assets/achievements/minutes-3000.svg", accent: "gold" },
  { id: "days_7", category: "footprint", title: "七日足迹", description: "在 7 个不同日期留下行动", metric: "actionDays", target: 7, unit: "天", icon: "/assets/achievements/days-7.svg", accent: "mist" },
  { id: "days_30", category: "footprint", title: "三十日历", description: "在 30 个不同日期留下行动", metric: "actionDays", target: 30, unit: "天", icon: "/assets/achievements/days-30.svg", accent: "jade" },
  { id: "days_100", category: "footprint", title: "百日年轮", description: "在 100 个不同日期留下行动", metric: "actionDays", target: 100, unit: "天", icon: "/assets/achievements/days-100.svg", accent: "gold" },
  { id: "week_actions_5", category: "weekly", title: "本周五步", description: "单周完成至少 5 项行动", metric: "weeklyCompletedActions", target: 5, unit: "项", icon: "/assets/achievements/week-actions-5.svg", accent: "sprout" },
  { id: "week_minutes_300", category: "weekly", title: "专注一周", description: "单周累计投入 300 分钟", metric: "weeklyMinutes", target: 300, unit: "分钟", icon: "/assets/achievements/week-minutes-300.svg", accent: "sun" },
  { id: "week_perfect", category: "weekly", title: "圆满一周", description: "自然周安排至少 5 项行动并全部完成", metric: "weeklyCompletionRate", target: 100, unit: "%", icon: "/assets/achievements/week-perfect.svg", accent: "gold" },
  { id: "reflection_1", category: "reflection", title: "初次回望", description: "写下第 1 次行动感受", metric: "reflectionCount", target: 1, unit: "次", icon: "/assets/achievements/reflection-1.svg", accent: "mist" },
  { id: "reflection_10", category: "reflection", title: "拾光成册", description: "累计写下 10 次行动感受", metric: "reflectionCount", target: 10, unit: "次", icon: "/assets/achievements/reflection-10.svg", accent: "jade" },
  { id: "reflection_30", category: "reflection", title: "心得成林", description: "累计写下 30 次行动感受", metric: "reflectionCount", target: 30, unit: "次", icon: "/assets/achievements/reflection-30.svg", accent: "gold" },
];

const CATEGORY_META: Array<{ key: AchievementCategory; title: string; subtitle: string }> = [
  { key: "action", title: "行动里程碑", subtitle: "每一次完成，都让目标更近一步" },
  { key: "streak", title: "连续坚持", subtitle: "让行动慢慢成为稳定节奏" },
  { key: "focus", title: "时间投入", subtitle: "真实投入，会留下清晰刻度" },
  { key: "footprint", title: "成长足迹", subtitle: "把行动写进每一个普通日子" },
  { key: "weekly", title: "每周荣誉", subtitle: "用一周完成一次温和闭环" },
  { key: "reflection", title: "复盘沉淀", subtitle: "把感受变成下一次的方法" },
];

interface MetricSnapshot {
  values: Record<AchievementMetric, number>;
  earnedDates: Partial<Record<AchievementId, string>>;
}

interface WeekBucket {
  key: string;
  tasks: ActionTask[];
  completed: ActionTask[];
  active: ActionTask[];
  minutes: number;
}

function businessDate(task: ActionTask): string {
  return String(task.activityDate || task.currentDate || task.plannedDate).slice(0, 10);
}

function earnedDate(task: ActionTask): string {
  return String(task.completedAt || task.updatedAt || businessDate(task)).slice(0, 10) || businessDate(task);
}

function parseDate(value: string): Date { return new Date(`${value}T00:00:00`); }
function dayNumber(value: string): number { return Math.floor(parseDate(value).getTime() / 86400000); }

function weekKey(value: string): string {
  const date = parseDate(value);
  const weekday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - weekday);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isEffective(task: ActionTask): boolean {
  return task.status === "completed" || (task.status === "partially_completed" && Math.max(0, task.actualMinutes || 0) > 0);
}

function dateAtThreshold(tasks: ActionTask[], target: number, value: (task: ActionTask) => number): string | undefined {
  let total = 0;
  for (const task of tasks) {
    total += value(task);
    if (total >= target) return earnedDate(task);
  }
  return undefined;
}

function buildSnapshot(tasks: ActionTask[]): MetricSnapshot {
  const today = getTodayBusinessDate();
  const visible = tasks
    .filter((task) => !task.deletedAt && task.status !== "rescheduled" && businessDate(task) <= today)
    .slice()
    .sort((a, b) => businessDate(a).localeCompare(businessDate(b)) || a.createdAt.localeCompare(b.createdAt));
  const completed = visible.filter((task) => task.status === "completed");
  const active = visible.filter(isEffective);
  const reflectionTasks = active.filter((task) => Boolean(String(task.reflection || "").trim()));
  const actionDates = Array.from(new Set(active.map(businessDate))).sort();
  const weeks = new Map<string, WeekBucket>();

  visible.forEach((task) => {
    const key = weekKey(businessDate(task));
    const bucket = weeks.get(key) || { key, tasks: [], completed: [], active: [], minutes: 0 };
    bucket.tasks.push(task);
    if (task.status === "completed") bucket.completed.push(task);
    if (isEffective(task)) {
      bucket.active.push(task);
      bucket.minutes += Math.max(0, task.actualMinutes || 0);
    }
    weeks.set(key, bucket);
  });

  let longestStreak = 0;
  let streakStart = 0;
  const streakDates = new Map<number, string>();
  for (let index = 0; index < actionDates.length; index += 1) {
    if (index === 0 || dayNumber(actionDates[index]) - dayNumber(actionDates[index - 1]) !== 1) streakStart = index;
    const length = index - streakStart + 1;
    longestStreak = Math.max(longestStreak, length);
    if (!streakDates.has(length)) streakDates.set(length, actionDates[index]);
  }

  const totalMinutes = active.reduce((sum, task) => sum + Math.max(0, task.actualMinutes || 0), 0);
  const weekValues = Array.from(weeks.values());
  const closedWeeks = weekValues.filter((week) => week.key < weekKey(today));
  const maxWeekActions = Math.max(0, ...weekValues.map((week) => week.completed.length));
  const maxWeekMinutes = Math.max(0, ...weekValues.map((week) => week.minutes));
  const eligiblePerfectWeeks = closedWeeks.filter((week) => week.tasks.length >= 5);
  const maxWeekCompletionRate = Math.max(0, ...eligiblePerfectWeeks.map((week) => Math.round((week.completed.length / week.tasks.length) * 100)));
  const earnedDates: Partial<Record<AchievementId, string>> = {};

  ([1, 10, 50] as const).forEach((target) => { earnedDates[`action_${target}`] = completed[target - 1] ? earnedDate(completed[target - 1]) : undefined; });
  ([3, 7, 30] as const).forEach((target) => { earnedDates[`streak_${target}`] = streakDates.get(target); });
  ([60, 600, 3000] as const).forEach((target) => { earnedDates[`minutes_${target}`] = dateAtThreshold(active, target, (task) => Math.max(0, task.actualMinutes || 0)); });
  ([7, 30, 100] as const).forEach((target) => { earnedDates[`days_${target}`] = actionDates[target - 1]; });
  ([1, 10, 30] as const).forEach((target) => { earnedDates[`reflection_${target}`] = reflectionTasks[target - 1] ? earnedDate(reflectionTasks[target - 1]) : undefined; });

  weekValues.forEach((week) => {
    const sortedCompleted = week.completed.slice().sort((a, b) => earnedDate(a).localeCompare(earnedDate(b)));
    const sortedActive = week.active.slice().sort((a, b) => earnedDate(a).localeCompare(earnedDate(b)));
    if (!earnedDates.week_actions_5 && sortedCompleted.length >= 5) earnedDates.week_actions_5 = earnedDate(sortedCompleted[4]);
    if (!earnedDates.week_minutes_300 && week.minutes >= 300) earnedDates.week_minutes_300 = dateAtThreshold(sortedActive, 300, (task) => Math.max(0, task.actualMinutes || 0));
    if (week.key < weekKey(today) && !earnedDates.week_perfect && week.tasks.length >= 5 && week.completed.length === week.tasks.length) {
      earnedDates.week_perfect = earnedDate(sortedCompleted[sortedCompleted.length - 1]);
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
      reflectionCount: reflectionTasks.length,
    },
    earnedDates,
  };
}

function tierFor(definition: AchievementDefinition): AchievementTier {
  const index = ACHIEVEMENT_DEFINITIONS.filter((item) => item.category === definition.category).findIndex((item) => item.id === definition.id);
  return index === 0 ? "mist" : index === 1 ? "jade" : "gold";
}

function dataNote(metric: AchievementMetric): string {
  const notes: Record<AchievementMetric, string> = {
    completedActions: "只统计状态为已完成的真实行动。",
    longestStreak: "已完成，或部分完成且有真实投入，计为一个行动日。",
    totalMinutes: "只累计已完成或部分完成行动的实际投入。",
    actionDays: "同一天多项行动只计为一个行动日。",
    weeklyCompletedActions: "按自然周统计已完成行动，取历史最高值。",
    weeklyMinutes: "按自然周累计实际投入，取历史最高值。",
    weeklyCompletionRate: "仅在自然周结束后结算，且该周至少安排 5 项行动。",
    reflectionCount: "行动有真实推进并写下感受，计为一次复盘。",
  };
  return notes[metric];
}

function formatProgress(definition: AchievementDefinition, current: number, unlocked: boolean): { progressText: string; remainingText: string } {
  if (unlocked) return { progressText: "已收藏", remainingText: `已达成 ${definition.target}${definition.unit}` };
  const safeCurrent = Math.min(current, definition.target);
  return { progressText: `${safeCurrent}/${definition.target}${definition.unit}`, remainingText: `还差 ${Math.max(0, definition.target - safeCurrent)}${definition.unit}` };
}

export function markAchievementCelebrated(id: AchievementId): void {
  const store = readManualStore();
  const records = store.achievementUnlocks || [];
  const record = records.find((item) => item.achievementId === id);
  if (!record || record.celebratedAt) return;
  record.celebratedAt = new Date().toISOString();
  store.achievementUnlocks = records;
  writeManualStore(store);
}

export function getAchievementCollection(): AchievementCollection {
  const store = readManualStore();
  const today = getTodayBusinessDate();
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
    const progressPercent = record ? 100 : Math.min(100, Math.round((current / definition.target) * 100));
    return {
      ...definition,
      unlocked: Boolean(record),
      unlockedAt: record?.unlockedAt,
      current,
      progressPercent,
      tier: tierFor(definition),
      dataNote: dataNote(definition.metric),
      nearUnlock: !record && progressPercent >= 70,
      ariaLabel: record ? `${definition.title}，已于 ${record.unlockedAt} 获得` : `${definition.title}，当前 ${Math.min(current, definition.target)}，目标 ${definition.target}${definition.unit}`,
      ...formatProgress(definition, current, Boolean(record)),
    };
  });

  const categories: AchievementCategoryView[] = CATEGORY_META.map((category) => {
    const categoryAchievements = achievements.filter((item) => item.category === category.key);
    return { ...category, unlockedCount: categoryAchievements.filter((item) => item.unlocked).length, achievements: categoryAchievements };
  });
  const unlockedCount = achievements.filter((item) => item.unlocked).length;
  return {
    unlockedCount,
    totalCount: achievements.length,
    progressPercent: Math.round((unlockedCount / achievements.length) * 100),
    categories,
    achievements,
    newlyUnlocked: achievements.filter((item) => {
      const record = recordMap.get(item.id);
      return item.unlocked && record?.unlockedAt === today && !record.celebratedAt;
    }),
  };
}
