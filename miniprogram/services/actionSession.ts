import { ActionSession, ActionTask } from "../types/manual";
import { getTodayBusinessDate } from "../utils/date";
import { emit } from "../utils/eventBus";
import { createLocalId, readManualStore, writeManualStore } from "./manualStore";
import { recordProductEvent } from "./productEvents";

const MAX_SESSION_SECONDS = 48 * 60 * 60;

function materialize(session: ActionSession, now = new Date()): ActionSession {
  if (session.status !== "running") return { ...session };
  const updatedAt = Date.parse(session.updatedAt);
  const added = Number.isFinite(updatedAt) ? Math.max(0, Math.floor((now.getTime() - updatedAt) / 1000)) : 0;
  return { ...session, elapsedSeconds: Math.min(MAX_SESSION_SECONDS, session.elapsedSeconds + added) };
}

function activeSession(sessions: ActionSession[]): ActionSession | undefined {
  return sessions.find((session) => session.status === "running" || session.status === "paused");
}

export function getActionSession(sessionId: string, now = new Date()): ActionSession | null {
  const session = (readManualStore().actionSessions || []).find((item) => item.id === sessionId);
  return session ? materialize(session, now) : null;
}

export function getActiveActionSession(now = new Date()): ActionSession | null {
  const session = activeSession(readManualStore().actionSessions || []);
  return session ? materialize(session, now) : null;
}

export function startActionSession(taskId: string, mode: ActionSession["mode"] = "countdown", now = new Date()): ActionSession {
  const store = readManualStore();
  const task = store.tasks.find((item) => item.id === taskId && !item.deletedAt);
  if (!task || task.status === "completed" || task.status === "skipped" || task.status === "rescheduled") throw new Error("这项行动当前无法开始");
  const running = activeSession(store.actionSessions || []);
  if (running) {
    if (running.taskId === taskId) return materialize(running, now);
    throw new Error("已有一项行动正在进行，请先处理后再开始");
  }
  const timestamp = now.toISOString();
  const session: ActionSession = {
    id: createLocalId("session"),
    goalId: task.goalId,
    taskId: task.id,
    businessDate: getTodayBusinessDate(now),
    mode,
    targetSeconds: mode === "countdown" ? task.estimatedMinutes * 60 : undefined,
    elapsedSeconds: 0,
    status: "running",
    startedAt: timestamp,
    updatedAt: timestamp,
  };
  store.actionSessions = store.actionSessions || [];
  store.actionSessions.push(session);
  writeManualStore(store);
  emit("action-session:update", session);
  recordProductEvent("action_started", { mode });
  return { ...session };
}

export function pauseActionSession(sessionId: string, now = new Date()): ActionSession {
  const store = readManualStore();
  const session = (store.actionSessions || []).find((item) => item.id === sessionId);
  if (!session) throw new Error("行动计时不存在");
  if (session.status !== "running") return { ...session };
  const next = materialize(session, now);
  Object.assign(session, next, { status: "paused", updatedAt: now.toISOString() });
  writeManualStore(store);
  emit("action-session:update", session);
  recordProductEvent("action_paused", { elapsedSeconds: session.elapsedSeconds });
  return { ...session };
}

export function resumeActionSession(sessionId: string, now = new Date()): ActionSession {
  const store = readManualStore();
  const session = (store.actionSessions || []).find((item) => item.id === sessionId);
  if (!session || session.status !== "paused") throw new Error("当前计时无法继续");
  session.status = "running";
  session.updatedAt = now.toISOString();
  writeManualStore(store);
  emit("action-session:update", session);
  return { ...session };
}

/**
 * 结束一次计时，并由调用方决定是否同时完成行动。
 *
 * 与 completeActionSession 不同，这个入口面向首页的轻量计时条：
 * - 仅结束计时：保留真实投入，行动进入“完成一部分”，之后仍可继续计时；
 * - 标记完成：累加本次投入后完成行动。
 */
export function finishActionSession(sessionId: string, markTaskCompleted: boolean, now = new Date()): ActionSession {
  const store = readManualStore();
  const session = (store.actionSessions || []).find((item) => item.id === sessionId);
  if (!session) throw new Error("行动计时不存在");
  if (session.status === "completed" || session.status === "abandoned") return { ...session };
  const task = store.tasks.find((item) => item.id === session.taskId && !item.deletedAt);
  if (!task) throw new Error("关联行动不存在");

  const timestamp = now.toISOString();
  const next = materialize(session, now);
  const sessionMinutes = Math.max(1, Math.round(next.elapsedSeconds / 60));
  const previousMinutes = Number.isInteger(task.actualMinutes) ? Number(task.actualMinutes) : 0;
  const totalMinutes = Math.min(480, previousMinutes + sessionMinutes);

  Object.assign(session, next, { status: "completed", endedAt: timestamp, updatedAt: timestamp });
  task.status = markTaskCompleted ? "completed" : "partially_completed";
  task.actualMinutes = totalMinutes;
  task.activityDate = session.businessDate;
  task.updatedAt = timestamp;
  task.completedAt = markTaskCompleted ? timestamp : undefined;
  task.issueReason = undefined;
  updateCheckin(store, task, timestamp);
  writeManualStore(store);
  emit("action-session:update", session);
  recordProductEvent(markTaskCompleted ? "action_completed" : "action_timer_finished", {
    actualMinutes: totalMinutes,
    sessionMinutes,
  });
  return { ...session };
}

function updateCheckin(store: ReturnType<typeof readManualStore>, task: ActionTask, now: string): void {
  const businessDate = task.activityDate || task.currentDate;
  const eligible = store.tasks.filter((item) => item.goalId === task.goalId && !item.deletedAt && item.status !== "rescheduled" && (item.activityDate || item.currentDate) === businessDate);
  const completed = eligible.filter((item) => item.status === "completed").length;
  const partial = eligible.filter((item) => item.status === "partially_completed").length;
  const actualMinutes = eligible.reduce((sum, item) => sum + ((item.status === "completed" || item.status === "partially_completed") ? item.actualMinutes || 0 : 0), 0);
  const existing = store.checkins.find((item) => item.goalId === task.goalId && item.businessDate === businessDate);
  if (existing) Object.assign(existing, { completedCount: completed, partialCount: partial, actualMinutes, updatedAt: now });
  else store.checkins.push({ id: createLocalId("checkin"), goalId: task.goalId, businessDate, completedCount: completed, partialCount: partial, actualMinutes, createdAt: now, updatedAt: now });
}

export function completeActionSession(sessionId: string, actualMinutes: number, reflection = "", partial = false, now = new Date()): ActionSession {
  if (!Number.isInteger(actualMinutes) || actualMinutes < 1 || actualMinutes > 480) throw new Error("实际投入需为 1～480 分钟的整数");
  const store = readManualStore();
  const session = (store.actionSessions || []).find((item) => item.id === sessionId);
  if (!session) throw new Error("行动计时不存在");
  if (session.status === "completed") return { ...session };
  if (session.status === "abandoned") throw new Error("这次行动已经放弃");
  const task = store.tasks.find((item) => item.id === session.taskId && !item.deletedAt);
  if (!task) throw new Error("关联行动不存在");
  const timestamp = now.toISOString();
  const next = materialize(session, now);
  Object.assign(session, next, { status: "completed", endedAt: timestamp, updatedAt: timestamp });
  task.status = partial ? "partially_completed" : "completed";
  task.actualMinutes = actualMinutes;
  task.reflection = reflection.trim().slice(0, 200) || undefined;
  task.activityDate = session.businessDate;
  task.updatedAt = timestamp;
  task.completedAt = partial ? undefined : timestamp;
  updateCheckin(store, task, timestamp);
  writeManualStore(store);
  emit("action-session:update", session);
  recordProductEvent("action_completed", { actualMinutes, partial });
  return { ...session };
}

export function abandonActionSession(sessionId: string, keepTime: boolean, now = new Date()): ActionSession {
  const store = readManualStore();
  const session = (store.actionSessions || []).find((item) => item.id === sessionId);
  if (!session) throw new Error("行动计时不存在");
  if (session.status === "abandoned" || session.status === "completed") return { ...session };
  const timestamp = now.toISOString();
  const next = materialize(session, now);
  Object.assign(session, next, { elapsedSeconds: keepTime ? next.elapsedSeconds : 0, status: "abandoned", endedAt: timestamp, updatedAt: timestamp });
  const task = store.tasks.find((item) => item.id === session.taskId && !item.deletedAt);
  if (keepTime && task && next.elapsedSeconds >= 60) {
    task.status = "partially_completed";
    task.actualMinutes = Math.max(1, Math.round(next.elapsedSeconds / 60));
    task.activityDate = session.businessDate;
    task.updatedAt = timestamp;
    updateCheckin(store, task, timestamp);
  }
  writeManualStore(store);
  emit("action-session:update", session);
  return { ...session };
}
