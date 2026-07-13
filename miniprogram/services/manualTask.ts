import { addBusinessDays, getTodayBusinessDate, isValidBusinessDate } from "../utils/date";
import { ActionIssueReason, ActionTask, ActionTaskStatus, TodaySummary } from "../types/manual";
import { createLocalId, readManualStore, writeManualStore } from "./manualStore";

export interface SaveTaskInput { id?: string; goalId: string; title: string; description?: string; currentDate: string; estimatedMinutes: number; }
export interface SaveActionRecordInput { taskId: string; title: string; businessDate: string; time: string; actualMinutes: number; status: "completed" | "partially_completed" | "pending"; reflection?: string; }

function validate(input: SaveTaskInput): void {
  const title = input.title.trim();
  if (title.length < 2 || title.length > 40) throw new Error("行动标题请控制在 2～40 个字");
  if ((input.description || "").trim().length > 150) throw new Error("说明最多 150 个字");
  if (!isValidBusinessDate(input.currentDate)) throw new Error("请选择有效日期");
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
  return readManualStore().tasks.find((task) => task.id === taskId && !task.deletedAt) || null;
}

export function getTasksByGoal(goalId: string): ActionTask[] {
  return readManualStore().tasks
    .filter((task) => task.goalId === goalId && task.status !== "rescheduled" && !task.deletedAt)
    .sort((a, b) => b.currentDate.localeCompare(a.currentDate) || b.createdAt.localeCompare(a.createdAt));
}

export function updateTask(input: SaveTaskInput): ActionTask {
  validate(input);
  const store = readManualStore();
  const task = store.tasks.find((item) => item.id === input.id && item.goalId === input.goalId && !item.deletedAt);
  if (!task) throw new Error("行动不存在");
  if (!store.goals.some((goal) => goal.id === task.goalId && goal.status === "active")) throw new Error("目标已结束，不能修改行动");
  task.title = input.title.trim(); task.description = input.description?.trim() || undefined;
  task.currentDate = input.currentDate; task.estimatedMinutes = input.estimatedMinutes;
  task.updatedAt = new Date().toISOString();
  writeManualStore(store);
  return task;
}

export function getTasksByDate(goalId: string, date: string): ActionTask[] {
  return readManualStore().tasks.filter((task) => task.goalId === goalId && task.currentDate === date && task.status !== "rescheduled" && !task.deletedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** 今日页只展示今天的行动，以及过去仍需继续的行动；未来行动不进入主列表。 */
export function getTodayPageTasks(goalId: string, selectedDate: string, realToday?: string): ActionTask[] {
  const today = realToday || selectedDate;
  return readManualStore().tasks
    .filter((task) => {
      if (task.goalId !== goalId) return false;
      if (task.deletedAt || task.status === "rescheduled") return false;
      if (task.currentDate === selectedDate) return true;
      if (selectedDate === today && task.currentDate < today && (task.status === "pending" || task.status === "partially_completed")) return true;
      return false;
    })
    .sort((a, b) => a.currentDate.localeCompare(b.currentDate) || a.createdAt.localeCompare(b.createdAt));
}

export function updateTaskStatus(taskId: string, status: ActionTaskStatus, actualMinutes?: number, issueReason?: ActionIssueReason): ActionTask {
  const store = readManualStore();
  const task = store.tasks.find((item) => item.id === taskId && !item.deletedAt);
  if (!task) throw new Error("行动不存在");
  if (!store.goals.some((goal) => goal.id === task.goalId && goal.status === "active")) throw new Error("目标已结束，不能修改行动");
  const validStatuses: ActionTaskStatus[] = ["pending", "completed", "partially_completed", "skipped", "rescheduled"];
  if (!validStatuses.includes(status)) throw new Error("行动状态无效");
  if (status === "rescheduled") throw new Error("请使用顺延操作");
  const nextActualMinutes = actualMinutes === undefined ? task.actualMinutes : actualMinutes;
  if (status === "completed" || status === "partially_completed") {
    if (!Number.isInteger(nextActualMinutes)) throw new Error("实际时间请输入整数分钟");
    // 完成动作可以先只记录完成事实，实际投入由历史记录补充；部分完成仍必须有真实投入。
    const minimumMinutes = status === "completed" ? 0 : 1;
    if ((nextActualMinutes as number) < minimumMinutes || (nextActualMinutes as number) > 480) throw new Error("实际时间应在 0～480 分钟之间");
  }
  const now = new Date().toISOString();
  task.status = status;
  task.actualMinutes = status === "completed" || status === "partially_completed" ? nextActualMinutes : undefined;
  task.issueReason = status === "partially_completed" || status === "skipped" ? issueReason : undefined;
  task.activityDate = status === "completed" || status === "partially_completed" ? getTodayBusinessDate() : undefined;
  task.updatedAt = now;
  task.completedAt = status === "completed" ? now : undefined;
  writeManualStore(store);
  return task;
}

export function updateTaskCompletionTime(taskId: string, businessDate: string, time: string): ActionTask {
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error("完成时间格式应为 HH:mm");
  const [hour, minute] = time.split(":").map(Number);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error("请选择有效的完成时间");
  const store = readManualStore();
  const task = store.tasks.find((item) => item.id === taskId && !item.deletedAt);
  if (!task) throw new Error("行动不存在");
  if (task.status !== "completed") throw new Error("只有已完成行动可以修改完成时间");
  if (task.currentDate !== businessDate) throw new Error("完成时间必须属于行动当天");
  const completedAt = new Date(`${businessDate}T${time}:00+08:00`);
  if (Number.isNaN(completedAt.getTime())) throw new Error("请选择有效的完成时间");
  if (businessDate === getTodayBusinessDate() && completedAt.getTime() > Date.now()) throw new Error("完成时间不能晚于当前时间");
  task.completedAt = completedAt.toISOString();
  task.activityDate = businessDate;
  task.updatedAt = new Date().toISOString();
  writeManualStore(store);
  return task;
}

export function rescheduleTask(taskId: string, businessToday = getTodayBusinessDate()): ActionTask {
  const store = readManualStore();
  const task = store.tasks.find((item) => item.id === taskId && !item.deletedAt);
  if (!task) throw new Error("行动不存在");
  if (task.status === "rescheduled" && task.rescheduledToTaskId) {
    const existing = store.tasks.find((item) => item.id === task.rescheduledToTaskId && !item.deletedAt);
    if (existing) return existing;
  }
  if (task.status === "completed") throw new Error("已完成行动无需顺延");
  if (task.status === "rescheduled") throw new Error("行动已经顺延");
  if (!store.goals.some((goal) => goal.id === task.goalId && goal.status === "active")) throw new Error("目标已结束，不能顺延行动");
  // 顺延到明天：基于今天业务日期 +1，确保时区一致。
  // 如果任务已在未来，则从任务当前日期 +1，避免把未来任务往回移。
  const baseDate = task.currentDate > businessToday ? task.currentDate : businessToday;
  const nextDate = addBusinessDays(baseDate, 1);
  const now = new Date().toISOString();
  const successor: ActionTask = {
    ...task,
    id: createLocalId("task"),
    currentDate: nextDate,
    status: "pending",
    actualMinutes: undefined,
    issueReason: undefined,
    completedAt: undefined,
    activityDate: undefined,
    deletedAt: undefined,
    originTaskId: task.originTaskId || task.id,
    rolloverCount: Number(task.rolloverCount || 0) + 1,
    rescheduledAt: undefined,
    rescheduledToTaskId: undefined,
    statusBeforeReschedule: undefined,
    createdAt: now,
    updatedAt: now,
  };
  task.statusBeforeReschedule = task.status as "pending" | "partially_completed" | "skipped";
  task.status = "rescheduled";
  task.rescheduledAt = now;
  task.rescheduledToTaskId = successor.id;
  task.updatedAt = now;
  store.tasks.push(successor);
  writeManualStore(store);
  return successor;
}

export function updateActionRecord(input: SaveActionRecordInput): ActionTask {
  const title = String(input.title || "").trim();
  const reflection = String(input.reflection || "").trim();
  if (title.length < 2 || title.length > 40) throw new Error("行动标题请控制在 2～40 个字");
  if (reflection.length > 200) throw new Error("今日感受最多 200 个字");
  if (!isValidBusinessDate(input.businessDate)) throw new Error("请选择有效日期");
  if (!/^\d{2}:\d{2}$/.test(input.time)) throw new Error("请选择有效时间");
  const [hour, minute] = input.time.split(":").map(Number);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error("请选择有效时间");
  if (!Number.isInteger(input.actualMinutes) || input.actualMinutes < 0 || input.actualMinutes > 480) throw new Error("实际投入应为 0～480 分钟");
  if (input.status === "partially_completed" && input.actualMinutes < 1) throw new Error("部分完成需要记录实际投入");
  const recordedAt = new Date(`${input.businessDate}T${input.time}:00+08:00`);
  if (Number.isNaN(recordedAt.getTime())) throw new Error("请选择有效完成时间");
  if (recordedAt.getTime() > Date.now()) throw new Error("完成时间不能晚于当前时间");

  const store = readManualStore();
  const task = store.tasks.find((item) => item.id === input.taskId && !item.deletedAt);
  if (!task) throw new Error("行动不存在");
  if (!store.goals.some((goal) => goal.id === task.goalId && goal.status === "active")) throw new Error("目标已结束，不能修改行动");
  const now = new Date().toISOString();
  task.title = title;
  task.currentDate = input.businessDate;
  task.status = input.status;
  task.reflection = reflection || undefined;
  task.actualMinutes = input.status === "pending" ? undefined : input.actualMinutes;
  task.activityDate = input.status === "pending" ? undefined : input.businessDate;
  task.completedAt = input.status === "pending" ? undefined : recordedAt.toISOString();
  task.issueReason = input.status === "partially_completed" ? task.issueReason : undefined;
  task.updatedAt = now;
  writeManualStore(store);
  return task;
}

export function deleteTask(taskId: string): void {
  const store = readManualStore();
  const task = store.tasks.find((item) => item.id === taskId && !item.deletedAt);
  if (!task) throw new Error("行动不存在");
  const now = new Date().toISOString();
  task.deletedAt = now;
  // 兼容仍按 status 过滤的历史统计读取方；deletedAt 仍是同步删除的唯一事实字段。
  task.status = "rescheduled";
  task.updatedAt = now;
  writeManualStore(store);
}

export function calculateTodaySummary(tasks: ActionTask[]): TodaySummary {
  const eligibleTasks = tasks.filter((task) => !task.deletedAt && task.status !== "rescheduled" && task.status !== "skipped");
  const summary = eligibleTasks.reduce<TodaySummary>((acc, task) => {
    acc.totalCount += 1;
    acc.estimatedMinutes += task.estimatedMinutes;
    if (task.status === "completed" || task.status === "partially_completed") acc.actualMinutes += task.actualMinutes || 0;
    if (task.status === "completed") acc.completedCount += 1;
    else if (task.status === "partially_completed") acc.partialCount += 1;
    return acc;
  }, { estimatedMinutes: 0, actualMinutes: 0, completedCount: 0, partialCount: 0, unfinishedCount: 0, totalCount: 0 });
  // unfinishedCount = 总数 - 已完成 - 完成一部分，避免 else 兜底将异常状态误计为未完成
  summary.unfinishedCount = summary.totalCount - summary.completedCount - summary.partialCount;
  return summary;
}

