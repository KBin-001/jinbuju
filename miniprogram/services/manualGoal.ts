import { Goal, GoalCategory } from "../types/manual";
import { createLocalId, readManualStore, writeManualStore } from "./manualStore";

export interface CreateGoalInput { title: string; category: GoalCategory; description?: string; }

export function getActiveGoal(): Goal | null {
  return readManualStore().goals.find((goal) => goal.status === "active") || null;
}

export function getGoals(): Goal[] {
  return readManualStore().goals.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createGoal(input: CreateGoalInput): Goal {
  const title = input.title.trim();
  if (title.length < 2 || title.length > 30) throw new Error("目标名称请控制在 2～30 个字");
  const store = readManualStore();
  if (store.goals.some((goal) => goal.status === "active")) throw new Error("当前已有一个进行中的目标");
  const now = new Date().toISOString();
  const goal: Goal = { id: createLocalId("goal"), title, category: input.category, description: input.description?.trim() || undefined, status: "active", createdAt: now, updatedAt: now };
  store.goals.push(goal);
  writeManualStore(store);
  return goal;
}

export function archiveGoal(goalId: string): void {
  const store = readManualStore();
  const goal = store.goals.find((item) => item.id === goalId);
  if (!goal) throw new Error("目标不存在");
  goal.status = "archived";
  goal.updatedAt = new Date().toISOString();
  writeManualStore(store);
}

