import { addDays, formatDate } from "../utils/date";
import { DailyActionSummary, DailyCheckin, ProgressSummary } from "../types/manual";
import { createLocalId, readManualStore, writeManualStore } from "./manualStore";
import { calculateTodaySummary } from "./manualTask";

export function getProgressSummary(goalId: string, today = formatDate(new Date())): ProgressSummary {
  const tasks = readManualStore().tasks.filter((task) => task.goalId === goalId && task.status !== "rescheduled");
  const todayTasks = tasks.filter((task) => task.currentDate === today);
  const recentDays: DailyActionSummary[] = [];
  for (let offset = 0; offset >= -6; offset -= 1) {
    const date = formatDate(addDays(new Date(`${today}T00:00:00`), offset));
    const dayTasks = tasks.filter((task) => task.currentDate === date);
    recentDays.push({ date, label: offset === 0 ? "今天" : `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`, completedCount: dayTasks.filter((task) => task.status === "completed").length, partialCount: dayTasks.filter((task) => task.status === "partially_completed").length, totalCount: dayTasks.length, isToday: offset === 0 });
  }
  const actionDates = new Set(tasks.filter((task) => task.status === "completed" || task.status === "partially_completed").map((task) => task.currentDate));
  return { totalTasks: tasks.length, completedTasks: tasks.filter((task) => task.status === "completed").length, totalActualMinutes: tasks.reduce((sum, task) => sum + (task.actualMinutes || 0), 0), totalActionDays: actionDates.size, todayCompleted: todayTasks.filter((task) => task.status === "completed").length, todayTotal: todayTasks.length, recentDays, unfinishedTasks: tasks.filter((task) => task.status === "pending" || task.status === "partially_completed").sort((a, b) => a.currentDate.localeCompare(b.currentDate)).slice(0, 8) };
}

export function recordDailyCheckin(goalId: string, businessDate: string): DailyCheckin {
  const store = readManualStore();
  const existing = store.checkins.find((item) => item.goalId === goalId && item.businessDate === businessDate);
  const summary = calculateTodaySummary(store.tasks.filter((task) => task.goalId === goalId && task.currentDate === businessDate));
  const now = new Date().toISOString();
  if (existing) { existing.completedCount = summary.completedCount; existing.partialCount = summary.partialCount; existing.actualMinutes = summary.actualMinutes; existing.updatedAt = now; writeManualStore(store); return existing; }
  const checkin: DailyCheckin = { id: createLocalId("checkin"), goalId, businessDate, completedCount: summary.completedCount, partialCount: summary.partialCount, actualMinutes: summary.actualMinutes, createdAt: now, updatedAt: now };
  store.checkins.push(checkin); writeManualStore(store); return checkin;
}

export function hasCheckedIn(goalId: string, date: string): boolean { return readManualStore().checkins.some((item) => item.goalId === goalId && item.businessDate === date); }

