import { ActionTask, ArchivedGoal, ArchivedGoalStats, Goal, GoalCategory } from "../types/manual";
import { createLocalId, readManualStore, writeManualStore } from "./manualStore";

export interface CreateGoalInput {
  title: string;
  category: GoalCategory;
  description?: string;
}

export function getActiveGoal(): Goal | null {
  return readManualStore().goals.find((goal) => goal.status === "active") || null;
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

function normalizeArchivedStatus(status: Goal["status"]): ArchivedGoal["status"] {
  if (status === "completed") return "completed";
  if (status === "ended") return "ended";
  return "archived";
}

function createArchivedGoal(goal: Goal, actions: ActionTask[], now: string, status: ArchivedGoal["status"]): ArchivedGoal {
  return {
    id: goal.id,
    title: goal.title,
    status,
    createdAt: goal.createdAt,
    startedAt: goal.startedAt || goal.createdAt,
    endedAt: goal.endedAt || now,
    archivedAt: goal.archivedAt || now,
    actions: actions.map((task) => ({ ...task })),
    stats: buildStats(actions),
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
  if (store.goals.some((goal) => goal.status === "active")) {
    throw new Error("当前已有一个进行中的目标");
  }

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
  writeManualStore(store);
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
  writeManualStore(store);

  return archivedGoal;
}

export function endActiveGoal(): ArchivedGoal {
  const activeGoal = getActiveGoal();
  if (!activeGoal) throw new Error("当前没有进行中的目标");
  return archiveGoal(activeGoal.id, "ended");
}
