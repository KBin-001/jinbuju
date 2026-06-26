import { ActionTask, ArchivedGoal, ArchivedGoalStats, Goal, GoalCategory } from "../types/manual";
import { emit } from "../utils/eventBus";
import { createLocalId, readManualStore, writeManualStore } from "./manualStore";

export interface CreateGoalInput {
  title: string;
  category: GoalCategory;
  description?: string;
}

function sortActiveGoals(goals: Goal[]): Goal[] {
  return goals
    .filter((goal) => goal.status === "active")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt));
}

export function getActiveGoal(): Goal | null {
  const store = readManualStore();
  const current = store.goals.find((goal) => goal.id === store.activeGoalId && goal.status === "active");
  return current || sortActiveGoals(store.goals)[0] || null;
}

export function getActiveGoals(): Goal[] {
  return sortActiveGoals(readManualStore().goals);
}

export function getGoal(goalId: string): Goal | null {
  return readManualStore().goals.find((goal) => goal.id === goalId) || null;
}

export function getGoals(): Goal[] {
  return readManualStore().goals.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function buildStats(actions: ActionTask[]): ArchivedGoalStats {
  const visibleActions = actions.filter((task) => task.status !== "rescheduled");
  const completedActions = visibleActions.filter((task) => task.status === "completed").length;
  const totalActions = visibleActions.length;

  return {
    totalActions,
    completedActions,
    estimatedMinutes: visibleActions.reduce((sum, task) => sum + (task.estimatedMinutes || 0), 0),
    actualMinutes: visibleActions.reduce((sum, task) => sum + (task.actualMinutes || 0), 0),
    completionRate: totalActions ? Math.round((completedActions / totalActions) * 100) : 0,
  };
}

function daysBetween(startValue?: string, endValue?: string): number {
  if (!startValue || !endValue) return 1;
  const start = new Date(`${startValue.slice(0, 10)}T00:00:00`).getTime();
  const end = new Date(`${endValue.slice(0, 10)}T00:00:00`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 1;
  return Math.max(1, Math.floor((end - start) / (24 * 60 * 60 * 1000)) + 1);
}

function reviewSummary(stats: ArchivedGoalStats): string {
  if (stats.totalActions === 0) return "这段目标已经被好好保存下来，下一次可以先从一个很小的行动开始。";
  if (stats.completionRate >= 80) return "这段时间推进得很稳定，很多行动都被扎实完成了。";
  if (stats.completionRate >= 40) return "这段目标留下了不少有效行动，也看见了可以继续调整的地方。";
  return "这次记录说明你已经开始尝试，后面可以把行动再拆小一点，降低启动压力。";
}

function normalizeArchivedStatus(status: Goal["status"]): ArchivedGoal["status"] {
  if (status === "completed") return "completed";
  if (status === "ended") return "ended";
  return "archived";
}

function createArchivedGoal(goal: Goal, actions: ActionTask[], now: string, status: ArchivedGoal["status"]): ArchivedGoal {
  const stats = buildStats(actions);
  stats.totalDays = daysBetween(goal.startedAt || goal.createdAt, goal.endedAt || now);
  stats.lastReviewSummary = reviewSummary(stats);
  return {
    id: goal.id,
    title: goal.title,
    status,
    createdAt: goal.createdAt,
    startedAt: goal.startedAt || goal.createdAt,
    endedAt: goal.endedAt || now,
    archivedAt: goal.archivedAt || now,
    actions: actions.map((task) => ({ ...task })),
    stats,
  };
}

export function getArchivedGoals(): ArchivedGoal[] {
  const store = readManualStore();
  const archivedFromSnapshots = store.archivedGoals || [];
  const snapshotIds = new Set(archivedFromSnapshots.map((goal) => goal.id));
  const legacyArchived = store.goals
    .filter((goal) => goal.status !== "active" && !snapshotIds.has(goal.id))
    .map((goal) => {
      const fallbackTime = goal.archivedAt || goal.endedAt || goal.updatedAt || goal.createdAt;
      const actions = store.tasks.filter((task) => task.goalId === goal.id);
      return createArchivedGoal(goal, actions, fallbackTime, normalizeArchivedStatus(goal.status));
    });

  return archivedFromSnapshots
    .concat(legacyArchived)
    .sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
}

export function createGoal(input: CreateGoalInput): Goal {
  const title = input.title.trim();
  if (title.length < 2 || title.length > 30) {
    throw new Error("目标名称请控制在 2 到 30 个字");
  }

  const store = readManualStore();
  const now = new Date().toISOString();
  const goal: Goal = {
    id: createLocalId("goal"),
    title,
    category: input.category,
    description: input.description?.trim() || undefined,
    status: "active",
    createdAt: now,
    startedAt: now,
    updatedAt: now,
  };

  store.goals.push(goal);
  store.activeGoalId = goal.id;
  writeManualStore(store);
  emit("goal:focus:update", { goalId: goal.id });
  return goal;
}

export function setCurrentGoal(goalId: string): Goal {
  const store = readManualStore();
  const goal = store.goals.find((item) => item.id === goalId && item.status === "active");
  if (!goal) throw new Error("目标不存在或已结束");
  goal.updatedAt = new Date().toISOString();
  store.activeGoalId = goal.id;
  writeManualStore(store);
  emit("goal:focus:update", { goalId: goal.id });
  return goal;
}

export function archiveGoal(goalId: string, nextStatus: ArchivedGoal["status"] = "archived"): ArchivedGoal {
  const store = readManualStore();
  const goal = store.goals.find((item) => item.id === goalId);
  if (!goal) throw new Error("目标不存在");

  const now = new Date().toISOString();
  goal.status = nextStatus;
  goal.endedAt = goal.endedAt || now;
  goal.archivedAt = goal.archivedAt || now;
  goal.updatedAt = now;

  const actions = store.tasks.filter((task) => task.goalId === goalId);
  const archivedGoal = createArchivedGoal(goal, actions, now, nextStatus);
  store.archivedGoals = (store.archivedGoals || []).filter((item) => item.id !== goalId);
  store.archivedGoals.push(archivedGoal);
  if (store.activeGoalId === goalId) {
    const nextActive = sortActiveGoals(store.goals).find((item) => item.id !== goalId);
    store.activeGoalId = nextActive?.id;
  }
  writeManualStore(store);
  emit("goal:focus:update", { goalId: store.activeGoalId });

  return archivedGoal;
}

export function endActiveGoal(): ArchivedGoal {
  const activeGoal = getActiveGoal();
  if (!activeGoal) throw new Error("当前没有进行中的目标");
  return archiveGoal(activeGoal.id, "ended");
}

export function endGoal(goalId: string): ArchivedGoal {
  return archiveGoal(goalId, "ended");
}
