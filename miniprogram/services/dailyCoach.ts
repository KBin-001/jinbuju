import { ActionTask, Goal } from "../types/manual";
import { getActiveGoal, getGoal } from "./manualGoal";
import { getTasksByDate } from "./manualTask";

export interface DailyCoachTask {
  id: string;
  title: string;
  estimatedMinutes: number;
  actualMinutes: number;
  status: ActionTask["status"];
  statusLabel: string;
}

export interface DailyCoachAnalysis {
  date: string;
  dateLabel: string;
  goalId: string;
  goalTitle: string;
  completedCount: number;
  pendingCount: number;
  totalCount: number;
  actualMinutes: number;
  remainingEstimatedMinutes: number;
  completionPercent: number;
  completedTasks: DailyCoachTask[];
  pendingTasks: DailyCoachTask[];
  priorityTask: DailyCoachTask | null;
  judgement: string;
  bottlenecks: string[];
  suggestions: string[];
}

const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

function dateLabel(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return `${date.getMonth() + 1}月${date.getDate()}日 · ${WEEKDAYS[date.getDay()]}`;
}

function statusLabel(status: ActionTask["status"]): string {
  if (status === "completed") return "已完成";
  if (status === "partially_completed") return "完成一部分";
  if (status === "skipped") return "今天不做";
  if (status === "rescheduled") return "已顺延";
  return "待推进";
}

function toViewTask(task: ActionTask): DailyCoachTask {
  return {
    id: task.id,
    title: task.title,
    estimatedMinutes: task.estimatedMinutes,
    actualMinutes: task.actualMinutes || 0,
    status: task.status,
    statusLabel: statusLabel(task.status),
  };
}

function chooseGoal(requestedGoalId?: string): Goal | null {
  const requested = requestedGoalId ? getGoal(requestedGoalId) : null;
  return requested || getActiveGoal();
}

function choosePriority(tasks: DailyCoachTask[]): DailyCoachTask | null {
  return tasks.slice().sort((a, b) => {
    const partialOrder = Number(b.status === "partially_completed") - Number(a.status === "partially_completed");
    return partialOrder || a.estimatedMinutes - b.estimatedMinutes || a.title.localeCompare(b.title);
  })[0] || null;
}

function buildJudgement(total: number, completed: number, actualMinutes: number, priority: DailyCoachTask | null): string {
  if (!total) return "今天还没有行动数据。先添加一项足够具体的小行动，完成后再判断执行节奏。";
  if (completed === total) return "今天的基础行动已经完成。建议简单记录一次顺利完成的原因，为明天减少启动阻力。";
  if (!priority) return "今天的行动已经处理完毕或暂时不再推进。先保留当前记录，不需要继续增加任务。";
  const firstStep = Math.min(10, priority.estimatedMinutes);
  if (actualMinutes === 0) return `今天还没有投入时间。先处理“${priority.title}”的前 ${firstStep} 分钟，目标只是恢复执行节奏。`;
  if (completed > 0) return `今天已经完成 ${completed} 项，执行节奏已经启动。接下来先推进“${priority.title}”的前 ${firstStep} 分钟，不要求一次做完。`;
  return `今天已经有 ${actualMinutes} 分钟投入，但行动还没有收口。先把“${priority.title}”缩小到一个可以明确完成的步骤。`;
}

function buildBottlenecks(total: number, actualMinutes: number, pending: DailyCoachTask[]): string[] {
  if (!total) return ["今天的数据还不多，先完成一项行动后，AI 会给出更准确的判断。"];
  if (!pending.length) return ["今天没有明显卡点，当前更适合记录有效做法，而不是继续增加任务。"];
  const result: string[] = [];
  if (actualMinutes === 0) result.push("启动偏慢：今天还没有实际投入记录，可以先降低第一步的难度。");
  if (pending.some((task) => task.estimatedMinutes > 45)) result.push("行动拆分还可以更小：较长行动适合先拆成 10 分钟以内的部分。");
  if (pending.length >= 3) result.push("当前队列偏满：不建议继续加任务，先完成已有行动。");
  if (!result.length) result.push("主要卡点可能在行动收口：已有投入，但还需要明确一个完成标准。");
  return result.slice(0, 3);
}

function buildSuggestions(priority: DailyCoachTask | null, pendingCount: number, completedAll: boolean): string[] {
  if (completedAll) return ["记录一个今天顺利完成的原因", "为明天提前设置一个低启动成本任务", "保持当前节奏，不要临时加码"];
  if (!priority) return ["先添加一项今天能够完成的小行动", "把预计投入控制在 10～30 分钟"];
  const firstStep = Math.min(10, priority.estimatedMinutes);
  const suggestions = [
    `先推进“${priority.title}”的前 ${firstStep} 分钟`,
    "完成后只记录一个遇到的问题",
  ];
  if (pendingCount > 1) suggestions.push("暂时不要新增大任务，先处理当前队列");
  return suggestions;
}

export function getDailyCoachAnalysis(date: string, requestedGoalId?: string): DailyCoachAnalysis {
  if (!validDate(date)) throw new Error("日期参数无效");
  const goal = chooseGoal(requestedGoalId);
  // 与今日页统一口径：明确标记“今天不做”的行动不进入完成率分母。
  const tasks = goal ? getTasksByDate(goal.id, date).filter((task) => task.status !== "skipped") : [];
  const completedTasks = tasks.filter((task) => task.status === "completed").map(toViewTask);
  const pendingTasks = tasks
    .filter((task) => task.status === "pending" || task.status === "partially_completed")
    .map(toViewTask);
  const allTasks = tasks.map(toViewTask);
  const priorityTask = choosePriority(pendingTasks);
  const actualMinutes = tasks.reduce((sum, task) => sum + (task.actualMinutes || 0), 0);
  const remainingEstimatedMinutes = pendingTasks.reduce((sum, task) => sum + task.estimatedMinutes, 0);
  const totalCount = tasks.length;
  const completedCount = completedTasks.length;

  return {
    date,
    dateLabel: dateLabel(date),
    goalId: goal?.id || "",
    goalTitle: goal?.title || "暂未设置目标",
    completedCount,
    pendingCount: pendingTasks.length,
    totalCount,
    actualMinutes,
    remainingEstimatedMinutes,
    completionPercent: totalCount ? Math.round((completedCount / totalCount) * 100) : 0,
    completedTasks,
    pendingTasks,
    priorityTask,
    judgement: buildJudgement(totalCount, completedCount, actualMinutes, priorityTask),
    bottlenecks: buildBottlenecks(totalCount, actualMinutes, pendingTasks),
    suggestions: buildSuggestions(priorityTask, pendingTasks.length, totalCount > 0 && completedCount === totalCount),
  };
}

export function buildDailyCoachReply(question: string, analysis: DailyCoachAnalysis): string {
  const content = question.trim();
  const priority = analysis.priorityTask;
  const firstStep = priority ? Math.min(10, priority.estimatedMinutes) : 10;
  if (/不想|没动力|不想学|累/.test(content)) {
    return priority
      ? `先不要求自己完成整项。只做“${priority.title}”的前 ${firstStep} 分钟，时间到后再决定是否继续。`
      : "今天先不增加压力。写下一项 10 分钟以内的小行动，完成它就算恢复了节奏。";
  }
  if (/效率|很慢|做题慢|调整/.test(content)) {
    return "先缩小任务范围，并记录最耗时的一个环节。今天只解决这个环节，不同时调整多件事。";
  }
  if (/一半|要不要继续|没做完|未完成/.test(content)) {
    return priority
      ? `可以继续，但只推进一个明确的小段：先做“${priority.title}”的前 ${firstStep} 分钟，完成后就停止加码。`
      : "先保留今天的真实记录，不需要为了完整而额外加任务。";
  }
  return priority
    ? `结合今天的数据，优先处理“${priority.title}”。先完成前 ${firstStep} 分钟，并记录一个具体卡点。`
    : "今天的数据不足以做复杂判断。先完成一项小行动，再回来复盘会更准确。";
}
