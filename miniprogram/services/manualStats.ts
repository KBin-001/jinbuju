import { addBusinessDays, getTodayBusinessDate } from "../utils/date";
import { ActionTask, DailyActionSummary, DailyCheckin, GrowthBadge, GrowthHeatmapDay, ProgressSummary } from "../types/manual";
import { createLocalId, readManualStore, writeManualStore } from "./manualStore";
import { calculateTodaySummary } from "./manualTask";

/** 真实推进判定：与 profileGrowth.ts hasRealProgress 保持一致。 */
function hasRealProgress(task: ActionTask): boolean {
  return task.status === "completed"
    || task.status === "partially_completed"
    || (task.status === "rescheduled" && task.statusBeforeReschedule === "partially_completed");
}

/** 统计归属日期：有真实推进的任务按 activityDate 归属，否则按 currentDate。与 recordDailyCheckin 和 plan/index.ts taskBusinessDate 口径一致。 */
function effectiveDate(task: ActionTask): string {
  return hasRealProgress(task) ? (task.activityDate || task.currentDate) : task.currentDate;
}

/** 统计完成状态：顺延的原行动按顺延前状态归属。 */
function effectiveStatus(task: ActionTask): ActionTask["status"] {
  if (task.status === "rescheduled" && task.statusBeforeReschedule === "partially_completed") {
    return "partially_completed";
  }
  return task.status;
}

export function getProgressSummary(goalId: string, today = getTodayBusinessDate()): ProgressSummary {
  const allTasks = readManualStore().tasks.filter((task) => task.goalId === goalId && !task.deletedAt);
  // 统计口径：排除 skipped 和纯顺延（无真实投入）任务；
  // “完成一部分后顺延”的原行动仍属于历史真实推进，纳入行动天数与连续天数。
  const tasks = allTasks.filter((task) => task.status !== "skipped" && (task.status !== "rescheduled" || hasRealProgress(task)));
  // 今日统计口径：已完成/部分完成的任务按 activityDate 归属（含顺延后今天完成的行动），待开始按 currentDate。
  const todayTasks = tasks.filter((task) => effectiveDate(task) === today);
  const recentDays: DailyActionSummary[] = [];
  for (let offset = 0; offset >= -6; offset -= 1) {
    const date = addBusinessDays(today, offset);
    const dayTasks = tasks.filter((task) => effectiveDate(task) === date);
    recentDays.push({ date, label: offset === 0 ? "今天" : `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`, completedCount: dayTasks.filter((task) => effectiveStatus(task) === "completed").length, partialCount: dayTasks.filter((task) => effectiveStatus(task) === "partially_completed").length, totalCount: dayTasks.length, isToday: offset === 0 });
  }
  // 行动天数：有真实推进的任务都算有行动记录
  const actionDateOf = (task: ActionTask) => task.activityDate || task.currentDate;
  const actionDates = new Set(tasks.filter(hasRealProgress).map(actionDateOf));
  // 低压力连续行动：完成或完成一部分都算真实推进。
  const streakDates = new Set(actionDates);
  const completedTasks = tasks.filter((task) => task.status === "completed").length;
  const totalActualMinutes = allTasks.reduce((sum, task) => sum + (hasRealProgress(task) ? (task.actualMinutes || 0) : 0), 0);
  let currentStreakDays = 0;
  const streakAnchor = streakDates.has(today) ? today : addBusinessDays(today, -1);
  for (let offset = 0; offset > -365; offset -= 1) {
    const date = addBusinessDays(streakAnchor, offset);
    if (!streakDates.has(date)) break;
    currentStreakDays += 1;
  }
  let longestStreakDays = 0;
  let runningStreakDays = 0;
  let previousActionDate = "";
  Array.from(streakDates).sort().forEach((date) => {
    runningStreakDays = previousActionDate && addBusinessDays(previousActionDate, 1) === date
      ? runningStreakDays + 1
      : 1;
    longestStreakDays = Math.max(longestStreakDays, runningStreakDays);
    previousActionDate = date;
  });
  const heatmapDays: GrowthHeatmapDay[] = [];
  for (let offset = -27; offset <= 0; offset += 1) {
    const date = addBusinessDays(today, offset);
    const dayTasks = tasks.filter((task) => effectiveDate(task) === date);
    const dayCompleted = dayTasks.filter((task) => effectiveStatus(task) === "completed").length;
    const dayPartial = dayTasks.filter((task) => effectiveStatus(task) === "partially_completed").length;
    const activeCount = dayCompleted + dayPartial;
    // 热力图完成率：completed 权重 1，partially_completed 权重 0.5
    const completionRate = dayTasks.length ? Math.round(((dayCompleted + dayPartial * 0.5) / dayTasks.length) * 100) : 0;
    let level: GrowthHeatmapDay["level"] = 0;
    if (dayTasks.length > 0) {
      if (completionRate >= 100) level = 3;
      else if (completionRate >= 50) level = 2;
      else if (activeCount > 0) level = 1;
      else level = 0;
    }
    heatmapDays.push({ date, label: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`, completedCount: dayCompleted, partialCount: dayPartial, totalCount: dayTasks.length, completionRate, level, isToday: date === today });
  }
  const heatmapWeeks: GrowthHeatmapDay[][] = [];
  for (let index = 0; index < heatmapDays.length; index += 7) {
    const week = heatmapDays.slice(index, index + 7);
    // 为每周第一天标记月份，便于 UI 在周边界显示月份标签
    if (week.length > 0) {
      const firstDay = week[0];
      const monthNum = Number(firstDay.date.slice(5, 7));
      firstDay.monthLabel = `${monthNum}月`;
    }
    heatmapWeeks.push(week);
  }
  const badges: GrowthBadge[] = [
    { key: "first_action", title: "开局行动", description: "完成第 1 件行动", unlocked: completedTasks >= 1, progressText: completedTasks >= 1 ? "已解锁" : `${completedTasks}/1` },
    { key: "streak_3", title: "三天不断", description: "连续行动 3 天", unlocked: currentStreakDays >= 3, progressText: currentStreakDays >= 3 ? "已解锁" : `${currentStreakDays}/3 天` },
    { key: "streak_7", title: "一周稳住", description: "连续行动 7 天", unlocked: currentStreakDays >= 7, progressText: currentStreakDays >= 7 ? "已解锁" : `${currentStreakDays}/7 天` },
    { key: "minutes_600", title: "十小时养成", description: "累计投入 600 分钟", unlocked: totalActualMinutes >= 600, progressText: totalActualMinutes >= 600 ? "已解锁" : `${Math.min(totalActualMinutes, 600)}/600 分钟` },
  ];
  return { totalTasks: tasks.length, completedTasks, totalActualMinutes, totalActionDays: actionDates.size, todayCompleted: todayTasks.filter((task) => effectiveStatus(task) === "completed").length, todayTotal: todayTasks.length, currentStreakDays, longestStreakDays, recentDays, heatmapWeeks, badges, unfinishedTasks: tasks.filter((task) => task.status === "pending" || task.status === "partially_completed").sort((a, b) => a.currentDate.localeCompare(b.currentDate)).slice(0, 8) };
}

export function recordDailyCheckin(goalId: string, businessDate: string): DailyCheckin {
  const store = readManualStore();
  const existing = store.checkins.find((item) => item.goalId === goalId && item.businessDate === businessDate);
  const summary = calculateTodaySummary(store.tasks.filter((task) => {
    if (task.goalId !== goalId || task.deletedAt || task.status === "rescheduled") return false;
    const effectiveDate = task.status === "completed" || task.status === "partially_completed"
      ? task.activityDate || task.currentDate
      : task.currentDate;
    return effectiveDate === businessDate;
  }));
  const now = new Date().toISOString();
  if (existing) { existing.completedCount = summary.completedCount; existing.partialCount = summary.partialCount; existing.actualMinutes = summary.actualMinutes; existing.updatedAt = now; writeManualStore(store); return existing; }
  const checkin: DailyCheckin = { id: createLocalId("checkin"), goalId, businessDate, completedCount: summary.completedCount, partialCount: summary.partialCount, actualMinutes: summary.actualMinutes, createdAt: now, updatedAt: now };
  store.checkins.push(checkin); writeManualStore(store); return checkin;
}

export function hasCheckedIn(goalId: string, date: string): boolean { return readManualStore().checkins.some((item) => item.goalId === goalId && item.businessDate === date); }
