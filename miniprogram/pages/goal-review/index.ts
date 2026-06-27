import { getArchivedGoals } from "../../services/manualGoal";
import { ActionIssueReason, ActionTask, ArchivedGoal } from "../../types/manual";
import { withAppTheme } from "../../services/theme";

interface StatItem {
  label: string;
  value: string;
}

interface TrendDay {
  date: string;
  label: string;
  total: number;
  completed: number;
  height: number;
}

interface ActionView extends ActionTask {
  dateText: string;
  minutesText: string;
}

const REASON_LABELS: Record<ActionIssueReason, string> = {
  not_enough_time: "时间不够",
  too_difficult: "难度偏高",
  resource_unavailable: "缺少资源",
  physical_condition: "身体或状态不适",
  temporary_event: "临时有事",
  not_practical: "行动不够贴合实际",
  other: "其他原因",
};

function shortDate(value?: string): string {
  return value ? value.slice(0, 10) : "";
}

function dateRange(goal: ArchivedGoal): string {
  const start = shortDate(goal.startedAt || goal.createdAt);
  const end = shortDate(goal.endedAt || goal.archivedAt);
  return start && end ? `${start} - ${end}` : start || end || "未记录";
}

function statusLabel(status: ArchivedGoal["status"]): string {
  if (status === "completed") return "已完成";
  if (status === "ended") return "已终止";
  return "已归档";
}

function buildTrend(actions: ActionTask[]): TrendDay[] {
  const grouped = new Map<string, ActionTask[]>();
  actions
    .filter((task) => task.status !== "rescheduled")
    .forEach((task) => {
      const tasks = grouped.get(task.currentDate) || [];
      tasks.push(task);
      grouped.set(task.currentDate, tasks);
    });
  const dates = Array.from(grouped.keys()).sort().slice(-7);
  return dates.map((date) => {
    const tasks = grouped.get(date) || [];
    const completed = tasks.filter((task) => task.status === "completed").length;
    const total = tasks.length;
    return {
      date,
      label: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`,
      total,
      completed,
      height: total ? Math.max(20, Math.round((completed / total) * 100)) : 0,
    };
  });
}

function valuableActions(actions: ActionTask[]): ActionView[] {
  return actions
    .filter((task) => task.status === "completed")
    .sort((a, b) => (b.actualMinutes || b.estimatedMinutes) - (a.actualMinutes || a.estimatedMinutes))
    .slice(0, 3)
    .map((task) => ({
      ...task,
      dateText: shortDate(task.completedAt || task.currentDate),
      minutesText: `${task.actualMinutes || task.estimatedMinutes} 分钟`,
    }));
}

function reasonSummary(actions: ActionTask[]): string {
  const counts = new Map<string, number>();
  actions
    .filter((task) => task.status !== "completed" && task.issueReason)
    .forEach((task) => {
      const label = REASON_LABELS[task.issueReason as ActionIssueReason] || "其他原因";
      counts.set(label, (counts.get(label) || 0) + 1);
    });
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return "没有记录明确的未完成原因，这也说明这段目标没有留下太多负担。";
  return sorted.map(([label, count]) => `${label} ${count} 次`).join(" · ");
}

function improvementSuggestion(goal: ArchivedGoal): string {
  const rate = goal.stats.completionRate;
  if (goal.stats.totalActions === 0) return "下一次可以先添加 1 个 15 到 30 分钟的小行动，让目标更容易启动。";
  if (rate >= 80) return "下一次可以保留这套节奏，并在每周末做一次轻量回看。";
  if (rate >= 40) return "下一次可以把行动拆得更短，并优先安排最容易启动的任务。";
  return "下一次建议先只保留 1 到 2 个核心行动，降低开始成本，比追求数量更重要。";
}

Page(withAppTheme({
  data: {
    status: "loading",
    errorMessage: "",
    goal: null as ArchivedGoal | null,
    dateRange: "",
    statusLabel: "",
    summaryText: "",
    stats: [] as StatItem[],
    trendDays: [] as TrendDay[],
    valuableActions: [] as ActionView[],
    reasonSummary: "",
    suggestion: "",
  },

  onLoad(query: Record<string, string>) {
    this.load(String(query.id || ""));
  },

  load(goalId: string) {
    try {
      const goal = getArchivedGoals().find((item) => item.id === goalId) || null;
      if (!goal) {
        this.setData({ status: "error", errorMessage: "历史目标不存在" });
        return;
      }
      const stats: StatItem[] = [
        { label: "总坚持天数", value: `${goal.stats.totalDays || 1} 天` },
        { label: "完成行动数", value: `${goal.stats.completedActions} 项` },
        { label: "总投入时间", value: `${goal.stats.actualMinutes} 分钟` },
        { label: "完成率", value: `${goal.stats.completionRate}%` },
      ];
      this.setData({
        status: "ready",
        goal,
        dateRange: dateRange(goal),
        statusLabel: statusLabel(goal.status),
        summaryText: goal.stats.lastReviewSummary || "这段目标已经被保存为成长记录。",
        stats,
        trendDays: buildTrend(goal.actions),
        valuableActions: valuableActions(goal.actions),
        reasonSummary: reasonSummary(goal.actions),
        suggestion: improvementSuggestion(goal),
      });
    } catch (error) {
      this.setData({ status: "error", errorMessage: error instanceof Error ? error.message : "复盘读取失败" });
    }
  },

  backProfile() {
    wx.switchTab({ url: "/pages/profile/index" });
  },
}));
