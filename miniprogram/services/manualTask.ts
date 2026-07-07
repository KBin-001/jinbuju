import { addDays, formatDate, getTodayBusinessDate } from "../utils/date";
import { ActionIssueReason, ActionTask, ActionTaskStatus, TodaySummary } from "../types/manual";
import { createLocalId, readManualStore, writeManualStore } from "./manualStore";

export interface SaveTaskInput { id?: string; goalId: string; title: string; description?: string; currentDate: string; estimatedMinutes: number; }

function validate(input: SaveTaskInput): void {
  const title = input.title.trim();
  if (title.length < 2 || title.length > 40) throw new Error("行动标题请控制在 2～40 个字");
  if ((input.description || "").trim().length > 150) throw new Error("说明最多 150 个字");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.currentDate)) throw new Error("请选择有效日期");
  // 验证真实日历日期，防止 "2026-02-30" 等无效日期通过正则
  const parsed = new Date(`${input.currentDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error("请选择有效日期");
  const [y, m, d] = input.currentDate.split("-").map(Number);
  if (parsed.getFullYear() !== y || parsed.getMonth() + 1 !== m || parsed.getDate() !== d) throw new Error("请选择有效日期");
  if (!Number.isInteger(input.estimatedMinutes) || input.estimatedMinutes < 5 || input.estimatedMinutes > 240) throw new Error("预计时间应为 5～240 分钟");
}

export function createTask(input: SaveTaskInput): ActionTask {
  validate(input);
  const store = readManualStore();
  if (!store.goals.some((goal) => goal.id === input.goalId && goal.status === "active")) throw new Error("当前目标不存在");
  const now = new Date().toISOString();
  const task: ActionTask = { id: createLocalId("task"), goalId: input.goalId, title: input.title.trim(), description: input.description?.trim() || undefined, plannedDate: input.currentDate, currentDate: input.currentDate, estimatedMinutes: input.estimatedMinutes, status: "pending", source: "manual", createdAt: now, updatedAt: now };
  store.tasks.push(task);
  writeManualStore(store);
  return task;
}

export function getTask(taskId: string): ActionTask | null {
  return readManualStore().tasks.find((task) => task.id === taskId) || null;
}

export function getTasksByGoal(goalId: string): ActionTask[] {
  return readManualStore().tasks
    .filter((task) => task.goalId === goalId && task.status !== "rescheduled")
    .sort((a, b) => b.currentDate.localeCompare(a.currentDate) || b.createdAt.localeCompare(a.createdAt));
}

export function updateTask(input: SaveTaskInput): ActionTask {
  validate(input);
  const store = readManualStore();
  const task = store.tasks.find((item) => item.id === input.id && item.goalId === input.goalId);
  if (!task) throw new Error("行动不存在");
  task.title = input.title.trim(); task.description = input.description?.trim() || undefined;
  task.currentDate = input.currentDate; task.estimatedMinutes = input.estimatedMinutes;
  task.updatedAt = new Date().toISOString();
  writeManualStore(store);
  return task;
}

export function getTasksByDate(goalId: string, date: string): ActionTask[] {
  return readManualStore().tasks.filter((task) => task.goalId === goalId && task.currentDate === date && task.status !== "rescheduled").sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** 今日页只展示今天的行动，以及过去仍需继续的行动；未来行动不进入主列表。 */
export function getTodayPageTasks(goalId: string, selectedDate: string, realToday?: string): ActionTask[] {
  const today = realToday || selectedDate;
  return readManualStore().tasks
    .filter((task) => {
      if (task.goalId !== goalId) return false;
      if (task.currentDate === selectedDate) return true;
      if (selectedDate === today && task.currentDate < today && (task.status === "pending" || task.status === "partially_completed")) return true;
      return false;
    })
    .sort((a, b) => a.currentDate.localeCompare(b.currentDate) || a.createdAt.localeCompare(b.createdAt));
}

export function updateTaskStatus(taskId: string, status: ActionTaskStatus, actualMinutes?: number, issueReason?: ActionIssueReason): ActionTask {
  const store = readManualStore();
  const task = store.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("行动不存在");
  if (actualMinutes !== undefined) {
    if (!Number.isInteger(actualMinutes)) throw new Error("实际时间请输入整数分钟");
    if (actualMinutes < 1 || actualMinutes > 480) throw new Error("实际时间应在 1～480 分钟之间");
  }
  const now = new Date().toISOString();
  task.status = status; task.actualMinutes = actualMinutes; task.issueReason = issueReason; task.updatedAt = now;
  task.completedAt = status === "completed" ? now : undefined;
  writeManualStore(store);
  return task;
}

export function updateTaskCompletionTime(taskId: string, businessDate: string, time: string): ActionTask {
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error("完成时间格式应为 HH:mm");
  const [hour, minute] = time.split(":").map(Number);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error("请选择有效的完成时间");
  const store = readManualStore();
  const task = store.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("行动不存在");
  if (task.status !== "completed") throw new Error("只有已完成行动可以修改完成时间");
  if (task.currentDate !== businessDate) throw new Error("完成时间必须属于行动当天");
  const completedAt = new Date(`${businessDate}T${time}:00`);
  if (Number.isNaN(completedAt.getTime())) throw new Error("请选择有效的完成时间");
  if (businessDate === getTodayBusinessDate() && completedAt.getTime() > Date.now()) throw new Error("完成时间不能晚于当前时间");
  task.completedAt = completedAt.toISOString();
  task.updatedAt = new Date().toISOString();
  writeManualStore(store);
  return task;
}

export function rescheduleTask(taskId: string): ActionTask {
  const store = readManualStore();
  const task = store.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("行动不存在");
  if (task.status === "completed") throw new Error("已完成行动无需顺延");
  // 顺延到明天：基于今天业务日期 +1，确保时区一致。
  // 如果任务已在未来，则从任务当前日期 +1，避免把未来任务往回移。
  const today = getTodayBusinessDate();
  const baseDate = task.currentDate > today ? task.currentDate : today;
  task.currentDate = formatDate(addDays(new Date(`${baseDate}T00:00:00`), 1));
  task.status = "pending"; task.issueReason = undefined; task.updatedAt = new Date().toISOString();
  writeManualStore(store);
  return task;
}

export function deleteTask(taskId: string): void {
  const store = readManualStore();
  const next = store.tasks.filter((task) => task.id !== taskId);
  if (next.length === store.tasks.length) throw new Error("行动不存在");
  store.tasks = next;
  writeManualStore(store);
}

export function calculateTodaySummary(tasks: ActionTask[]): TodaySummary {
  const summary = tasks.reduce((acc, task) => {
    acc.totalCount += 1;
    acc.estimatedMinutes += task.estimatedMinutes;
    acc.actualMinutes += task.actualMinutes || 0;
    if (task.status === "completed") acc.completedCount += 1;
    else if (task.status === "partially_completed") acc.partialCount += 1;
    return acc;
  }, { estimatedMinutes: 0, actualMinutes: 0, completedCount: 0, partialCount: 0, totalCount: 0 });
  // unfinishedCount = 总数 - 已完成 - 完成一部分，避免 else 兜底将异常状态误计为未完成
  summary.unfinishedCount = summary.totalCount - summary.completedCount - summary.partialCount;
  return summary as TodaySummary;
}

