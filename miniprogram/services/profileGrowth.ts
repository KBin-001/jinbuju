import { ActionTask, ManualDataStore } from "../types/manual";
import { addBusinessDays, getTodayBusinessDate } from "../utils/date";

export interface ProfileGrowthSummary {
  currentStreakDays: number;
  completedActions: number;
  totalMinutes: number;
}

function actionDate(task: ActionTask): string {
  return task.activityDate || task.currentDate;
}

function hasRealProgress(task: ActionTask): boolean {
  return task.status === "completed"
    || task.status === "partially_completed"
    || (task.status === "rescheduled" && task.statusBeforeReschedule === "partially_completed");
}

function currentStreak(dates: Set<string>, today: string): number {
  const anchor = dates.has(today) ? today : addBusinessDays(today, -1);
  let streak = 0;
  for (let offset = 0; offset > -3650; offset -= 1) {
    if (!dates.has(addBusinessDays(anchor, offset))) break;
    streak += 1;
  }
  return streak;
}

/**
 * “我的”页跨目标成长口径。
 *
 * - 已完成、部分完成，以及“部分完成后顺延”的原行动都属于真实推进；
 * - 行动日优先使用 activityDate，避免顺延改变历史发生日期；
 * - 最近删除中的目标不再进入页面统计，恢复后会重新计入；
 * - 未来日期、跳过、纯待办和已删除行动不计入成长。
 */
export function buildProfileGrowthSummary(
  store: ManualDataStore,
  today = getTodayBusinessDate(),
): ProfileGrowthSummary {
  const hiddenGoalIds = new Set(
    (store.archivedGoals || [])
      .filter((goal) => Boolean(goal.deletedAt) && !goal.restoredAt)
      .map((goal) => goal.id),
  );
  const progressed = (store.tasks || []).filter((task) =>
    !task.deletedAt
    && !hiddenGoalIds.has(task.goalId)
    && actionDate(task) <= today
    && hasRealProgress(task));
  const actionDates = new Set(progressed.map(actionDate));

  return {
    currentStreakDays: currentStreak(actionDates, today),
    completedActions: progressed.filter((task) => task.status === "completed").length,
    totalMinutes: progressed.reduce((sum, task) => sum + Math.max(0, task.actualMinutes || 0), 0),
  };
}
