/**
 * 任务展示状态工具
 *
 * 严格区分三层状态：
 * 1. 任务执行状态 status：写入数据库，由用户操作决定（pending / completed / ...）
 * 2. 任务日期状态：由 currentDate 与 today 计算（today / future / past）
 * 3. 页面显示状态：由 status + 日期状态 + 顺延标记计算（待开始 / 待继续 / ...）
 *
 * 数据库中不保存 "待开始" 这类纯展示文案，它只用于页面渲染。
 */

import { ActionTaskStatus } from "../types/manual";

/** 任务日期状态 */
export type TaskDateStatus = "today" | "future" | "past";

/** 计算展示状态所需的任务输入（仅依赖展示层关心的字段） */
export interface DisplayStatusTask {
  /** 任务执行状态 */
  status?: ActionTaskStatus | string;
  /** 任务当前展示日期 YYYY-MM-DD（顺延后会同步更新为今天） */
  currentDate?: string;
  /** 任务最初计划的日期 YYYY-MM-DD（顺延后保持不变） */
  plannedDate?: string;
  /** 顺延次数，> 0 表示发生过顺延 */
  rolloverCount?: number;
}

/** 页面显示状态，不会写回数据库。 */
export interface ActionTaskDisplayStatus {
  text: "待开始" | "未到日期" | "待继续" | "已完成" | "完成一部分" | "今天不做" | "已顺延";
  tone: "neutral" | "success" | "warning" | "muted";
  badge?: "待继续";
}

/**
 * 比较 YYYY-MM-DD 业务日期字符串。
 * @returns 负数表示 a 早于 b，0 表示同一天，正数表示 a 晚于 b。
 *
 * 直接使用字符串字典序比较，因为 YYYY-MM-DD 的固定长度格式天然有序。
 */
export function compareBusinessDate(a: string, b: string): number {
  const left = String(a || "");
  const right = String(b || "");
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** 判断任务日期状态（默认无日期视为今天，避免老数据丢失分组） */
export function getTaskDateStatus(task: DisplayStatusTask, today: string): TaskDateStatus {
  const date = String(task.currentDate || task.plannedDate || today);
  const diff = compareBusinessDate(date, today);
  if (diff > 0) return "future";
  if (diff < 0) return "past";
  return "today";
}

/** 是否为顺延任务（顺延次数大于 0 或 plannedDate 早于 currentDate） */
export function isCarryOverTask(task: DisplayStatusTask): boolean {
  if (Number(task.rolloverCount || 0) > 0) return true;
  const planned = task.plannedDate;
  const current = task.currentDate;
  if (planned && current && compareBusinessDate(planned, current) < 0) {
    return true;
  }
  return false;
}

/**
 * 计算任务展示状态文案。
 *
 * 规则：
 * - completed                 → 已完成
 * - partially_completed       → 完成一部分（过去日期额外提示待继续）
 * - skipped                   → 今天不做
 * - rescheduled               → 已顺延
 * - pending
 *     · 今天                   → 待开始（不再显示 "未开始"）
 *     · 未来                   → 未到日期
 *     · 过去                   → 待继续（不再显示逾期/落后/失败）
 */
export function getActionTaskDisplayStatus(
  task: DisplayStatusTask,
  today: string,
): ActionTaskDisplayStatus {
  const status = String(task.status || "pending") as ActionTaskStatus;
  const dateStatus = getTaskDateStatus(task, today);

  switch (status) {
    case "completed":
      return { text: "已完成", tone: "success" };
    case "partially_completed":
      return {
        text: "完成一部分",
        tone: "neutral",
        badge: dateStatus === "past" ? "待继续" : undefined,
      };
    case "skipped":
      return { text: "今天不做", tone: "muted" };
    case "rescheduled":
      return { text: "已顺延", tone: "muted" };
    case "pending":
    default:
      if (dateStatus === "future") return { text: "未到日期", tone: "muted" };
      if (dateStatus === "past") return { text: "待继续", tone: "warning" };
      return { text: "待开始", tone: "success" };
  }
}

/** 今日页任务分组键 */
export type TodayGroupKey = "today" | "continue";

/** 今日页任务分组结果 */
export interface TodayTaskGroupEntry<T extends DisplayStatusTask> {
  key: TodayGroupKey;
  title: string;
  tasks: T[];
}

/**
 * 将任务分为「今日行动」和「待继续」两组。
 *
 * 规则：
 * - 今日行动：currentDate === today（含从过去顺延到今天的 carry_over 任务）
 * - 待继续：currentDate < today 且状态为 pending / partially_completed
 * - 未来任务不进入今日页主列表（由调用方在数据层过滤）
 */
export function groupTodayTasks<T extends DisplayStatusTask>(
  tasks: T[],
  today: string,
): TodayTaskGroupEntry<T>[] {
  const todayTasks: T[] = [];
  const continueTasks: T[] = [];

  for (const task of tasks) {
    const dateStatus = getTaskDateStatus(task, today);
    if (dateStatus === "today") {
      todayTasks.push(task);
      continue;
    }
    if (dateStatus === "past") {
      const status = String(task.status || "pending");
      if (status === "pending" || status === "partially_completed") {
        continueTasks.push(task);
      }
    }
  }

  const groups: TodayTaskGroupEntry<T>[] = [];
  if (todayTasks.length > 0) {
    groups.push({ key: "today", title: "今日行动", tasks: todayTasks });
  }
  if (continueTasks.length > 0) {
    groups.push({ key: "continue", title: "待继续", tasks: continueTasks });
  }
  return groups;
}
