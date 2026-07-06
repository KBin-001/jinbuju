import { getArchivedGoals } from "../../services/manualGoal";
import { withAppTheme } from "../../services/theme";
import { ActionIssueReason, ActionTask, ArchivedGoal } from "../../types/manual";

interface StatItem { label: string; value: string; unit: string; }
interface TrendDay { date: string; label: string; completed: number; minutes: number; completedHeight: number; minutesHeight: number; }
interface ActionView extends ActionTask { dateText: string; minutesText: string; }

const REASON_LABELS: Record<ActionIssueReason, string> = {
  not_enough_time: "时间不够",
  too_difficult: "难度偏高",
  resource_unavailable: "缺少资源",
  physical_condition: "身体或状态不适",
  temporary_event: "临时有事",
  not_practical: "行动不够贴合实际",
  other: "其他原因",
};

function shortDate(value?: string): string { return value ? value.slice(0, 10) : ""; }
function dateRange(goal: ArchivedGoal): string {
  const start = shortDate(goal.startedAt || goal.createdAt);
  const end = shortDate(goal.endedAt || goal.archivedAt);
  return start && end ? `${start} - ${end}` : start || end || "日期未记录";
}
function statusLabel(status: ArchivedGoal["status"]): string {
  if (status === "completed") return "已完成";
  if (status === "ended") return "已结束";
  return "已收进档案";
}

function buildTrend(actions: ActionTask[]): TrendDay[] {
  const grouped = new Map<string, ActionTask[]>();
  actions.filter((task) => task.status !== "rescheduled").forEach((task) => {
    const tasks = grouped.get(task.currentDate) || [];
    tasks.push(task);
    grouped.set(task.currentDate, tasks);
  });
  const raw = Array.from(grouped.keys()).sort().slice(-7).map((date) => {
    const tasks = grouped.get(date) || [];
    return {
      date,
      label: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`,
      completed: tasks.filter((task) => task.status === "completed").length,
      minutes: tasks.reduce((sum, task) => sum + (task.actualMinutes || 0), 0),
    };
  });
  const maxCompleted = Math.max(1, ...raw.map((day) => day.completed));
  const maxMinutes = Math.max(1, ...raw.map((day) => day.minutes));
  return raw.map((day) => ({
    ...day,
    completedHeight: day.completed ? Math.max(16, Math.round((day.completed / maxCompleted) * 100)) : 0,
    minutesHeight: day.minutes ? Math.max(16, Math.round((day.minutes / maxMinutes) * 100)) : 0,
  }));
}

function valuableActions(actions: ActionTask[]): ActionView[] {
  return actions.filter((task) => task.status === "completed")
    .sort((a, b) => (b.actualMinutes || b.estimatedMinutes) - (a.actualMinutes || a.estimatedMinutes))
    .slice(0, 4)
    .map((task) => ({
      ...task,
      dateText: shortDate(task.completedAt || task.currentDate),
      minutesText: `${task.actualMinutes || task.estimatedMinutes} 分钟`,
    }));
}

function reasonSummary(actions: ActionTask[]): string {
  const counts = new Map<string, number>();
  actions.filter((task) => task.status !== "completed" && task.issueReason).forEach((task) => {
    const label = REASON_LABELS[task.issueReason as ActionIssueReason] || "其他原因";
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return "这段目标没有留下明确的阻力记录，整体推进过程比较轻盈。";
  return `记录较多的是：${sorted.map(([label, count]) => `${label} ${count} 次`).join("、")}。这些记录可以帮助下一次把行动安排得更贴合实际。`;
}

function suggestion(goal: ArchivedGoal): string {
  const { completionRate, totalActions } = goal.stats;
  if (!totalActions) return "下一次可以先添加一个 15 到 30 分钟的小行动，让目标更容易启动。";
  if (completionRate >= 80) return "可以继续保留这套节奏，每周留一个轻量回顾时间，帮助稳定推进。";
  if (completionRate >= 40) return "可以把行动再拆小一点，并优先安排最容易开始的那一步。";
  return "下一次先保留一到两个核心行动，降低开始成本，比追求数量更重要。";
}

Page(withAppTheme({
  data: {
    status: "loading",
    errorMessage: "",
    goal: null as ArchivedGoal | null,
    dateRange: "",
    statusLabel: "",
    summaryText: "",
    completionRate: 0,
    stats: [] as StatItem[],
    trendDays: [] as TrendDay[],
    valuableActions: [] as ActionView[],
    reasonSummary: "",
    suggestion: "",
  },

  onLoad(query: Record<string, string>) { this.load(String(query.id || "")); },

  load(goalId: string) {
    try {
      const goal = getArchivedGoals().find((item) => item.id === goalId) || null;
      if (!goal) {
        this.setData({ status: "error", errorMessage: "这条历史目标暂时找不到了" });
        return;
      }
      this.setData({
        status: "ready",
        goal,
        dateRange: dateRange(goal),
        statusLabel: statusLabel(goal.status),
        summaryText: goal.stats.lastReviewSummary || "这段时间留下了属于你的行动记录，也看见了适合自己的节奏。",
        completionRate: Math.max(0, Math.min(100, goal.stats.completionRate || 0)),
        stats: [
          { label: "坚持天数", value: String(goal.stats.totalDays || 1), unit: "天" },
          { label: "完成行动", value: String(goal.stats.completedActions || 0), unit: "项" },
          { label: "实际投入", value: String(goal.stats.actualMinutes || 0), unit: "分钟" },
          { label: "完成率", value: String(goal.stats.completionRate || 0), unit: "%" },
        ],
        trendDays: buildTrend(goal.actions),
        valuableActions: valuableActions(goal.actions),
        reasonSummary: reasonSummary(goal.actions),
        suggestion: suggestion(goal),
      });
    } catch (error) {
      this.setData({ status: "error", errorMessage: error instanceof Error ? error.message : "成长回顾读取失败" });
    }
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack({ delta: 1 });
    else wx.redirectTo({ url: "/pages/history/index" });
  },
}));
