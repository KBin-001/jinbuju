import { getArchivedGoals } from "../../services/manualGoal";
import { withAppTheme } from "../../services/theme";
import { ActionIssueReason, ActionTask, ArchivedGoal } from "../../types/manual";

interface StatItem {
  label: string;
  value: string;
  unit: string;
}

interface TrendDay {
  date: string;
  label: string;
  completed: number;
  minutes: number;
  completedWidth: number;
  minutesWidth: number;
}

interface ActionView extends ActionTask {
  dateText: string;
  actualText: string;
}

interface ReflectionView {
  id: string;
  title: string;
  dateText: string;
  reflection: string;
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

function displayDate(value?: string): string {
  const date = shortDate(value);
  if (!date) return "日期未记录";
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
}

function dateRange(goal: ArchivedGoal): string {
  const start = shortDate(goal.startedAt || goal.createdAt);
  const end = shortDate(goal.endedAt || goal.archivedAt);
  return start && end ? `${start} — ${end}` : start || end || "日期未记录";
}

function statusLabel(status: ArchivedGoal["status"]): string {
  if (status === "completed") return "已完成";
  if (status === "ended") return "已结束";
  return "已归档";
}

function validActions(actions: ActionTask[]): ActionTask[] {
  return actions.filter((task) => !task.deletedAt);
}

function trendDate(task: ActionTask): string {
  return shortDate(task.activityDate || task.currentDate);
}

function buildTrend(actions: ActionTask[]): TrendDay[] {
  const grouped = new Map<string, { completed: number; minutes: number }>();

  validActions(actions).forEach((task) => {
    const date = trendDate(task);
    if (!date) return;
    const current = grouped.get(date) || { completed: 0, minutes: 0 };

    if (task.status === "completed") current.completed += 1;
    if (task.status === "rescheduled") {
      if (task.statusBeforeReschedule === "partially_completed") {
        current.minutes += task.actualMinutes || 0;
      }
    } else {
      current.minutes += task.actualMinutes || 0;
    }
    grouped.set(date, current);
  });

  const raw = Array.from(grouped.entries())
    .filter(([, value]) => value.completed > 0 || value.minutes > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-7)
    .map(([date, value]) => ({
      date,
      label: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`,
      ...value,
    }));

  const maxCompleted = Math.max(1, ...raw.map((day) => day.completed));
  const maxMinutes = Math.max(1, ...raw.map((day) => day.minutes));
  return raw.map((day) => ({
    ...day,
    completedWidth: day.completed ? Math.max(8, Math.round((day.completed / maxCompleted) * 100)) : 0,
    minutesWidth: day.minutes ? Math.max(8, Math.round((day.minutes / maxMinutes) * 100)) : 0,
  }));
}

function importantActions(actions: ActionTask[]): ActionView[] {
  return validActions(actions)
    .filter((task) => task.status === "completed")
    .sort((left, right) => {
      const minutesDiff = (right.actualMinutes || 0) - (left.actualMinutes || 0);
      if (minutesDiff) return minutesDiff;
      return String(right.completedAt || right.currentDate).localeCompare(String(left.completedAt || left.currentDate));
    })
    .slice(0, 4)
    .map((task) => ({
      ...task,
      dateText: displayDate(task.completedAt || task.currentDate),
      actualText: (task.actualMinutes || 0) > 0 ? `实际 ${task.actualMinutes} 分钟` : "未记录实际投入",
    }));
}

function reflectionRecords(actions: ActionTask[]): ReflectionView[] {
  const seen = new Set<string>();
  return validActions(actions)
    .filter((task) => Boolean(task.reflection?.trim()))
    .sort((left, right) => {
      const leftTime = `${left.activityDate || left.currentDate}${left.completedAt || left.updatedAt}`;
      const rightTime = `${right.activityDate || right.currentDate}${right.completedAt || right.updatedAt}`;
      return rightTime.localeCompare(leftTime);
    })
    .filter((task) => {
      const reflection = task.reflection!.trim();
      const key = `${task.originTaskId || task.id}::${reflection}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((task) => ({
      id: task.id,
      title: task.title,
      dateText: displayDate(task.activityDate || task.completedAt || task.currentDate),
      reflection: task.reflection!.trim(),
    }));
}

function reasonSummary(actions: ActionTask[]): string {
  const counts = new Map<string, number>();
  validActions(actions)
    .filter((task) => task.status !== "completed" && task.issueReason)
    .forEach((task) => {
      const label = REASON_LABELS[task.issueReason as ActionIssueReason] || "其他原因";
      counts.set(label, (counts.get(label) || 0) + 1);
    });

  const sorted = Array.from(counts.entries()).sort((left, right) => right[1] - left[1]);
  if (!sorted.length) return "这段目标没有记录具体阻力，暂时无法判断主要卡点。";
  return `记录较多的是：${sorted.map(([label, count]) => `${label} ${count} 次`).join("、")}。这些记录可以帮助下一次把行动安排得更贴合实际。`;
}

function suggestion(goal: ArchivedGoal): string {
  const { completionRate, totalActions } = goal.stats;
  if (!totalActions) return "下一次可以先添加一个 15—30 分钟的小行动，让目标更容易启动。";
  if (completionRate >= 80) return "可以保留这次的行动节奏，并每周留出一次轻量回顾，让推进更稳定。";
  if (completionRate >= 40) return "可以把行动再拆小一点，优先安排最容易开始、最关键的那一步。";
  return "下一次先保留一到两个核心行动，降低启动成本，比追求行动数量更重要。";
}

Page(withAppTheme({
  data: {
    status: "loading",
    errorMessage: "",
    requestedGoalId: "",
    goal: null as ArchivedGoal | null,
    dateRange: "",
    statusLabel: "",
    factSummary: "",
    guidanceSummary: "",
    completionRate: 0,
    stats: [] as StatItem[],
    trendDays: [] as TrendDay[],
    importantActions: [] as ActionView[],
    reflectionRecords: [] as ReflectionView[],
    visibleReflections: [] as ReflectionView[],
    reflectionExpanded: false,
    hasReviewEvidence: false,
    reasonSummary: "",
    suggestion: "",
  },

  onLoad(query: Record<string, string>) {
    const goalId = String(query.id || "");
    this.setData({ requestedGoalId: goalId });
    this.load(goalId);
  },

  load(goalId: string) {
    this.setData({ status: "loading", errorMessage: "" });
    try {
      const goal = getArchivedGoals().find((item) => item.id === goalId) || null;
      if (!goal) {
        this.setData({ status: "error", errorMessage: "这条历史目标暂时找不到了" });
        return;
      }

      const reflections = reflectionRecords(goal.actions);
      const trendDays = buildTrend(goal.actions);
      const important = importantActions(goal.actions);
      const activeRecords = validActions(goal.actions).filter((task) => task.status !== "rescheduled" && task.status !== "skipped");
      const completedActions = goal.stats.completedActions || 0;
      const totalActions = goal.stats.totalActions || 0;

      this.setData({
        status: "ready",
        goal,
        dateRange: dateRange(goal),
        statusLabel: statusLabel(goal.status),
        factSummary: totalActions > 0
          ? `完成 ${completedActions} / ${totalActions} 项行动，实际投入 ${goal.stats.actualMinutes || 0} 分钟。`
          : "这段目标还没有留下可统计的行动记录。",
        guidanceSummary: goal.stats.lastReviewSummary || suggestion(goal),
        completionRate: Math.max(0, Math.min(100, goal.stats.completionRate || 0)),
        stats: [
          { label: "目标历时", value: String(goal.stats.totalDays || 1), unit: "天" },
          { label: "完成行动", value: `${completedActions}/${totalActions}`, unit: "" },
          { label: "实际投入", value: String(goal.stats.actualMinutes || 0), unit: "分钟" },
          { label: "行动完成率", value: String(goal.stats.completionRate || 0), unit: "%" },
        ],
        trendDays,
        importantActions: important,
        reflectionRecords: reflections,
        visibleReflections: reflections.slice(0, 4),
        reflectionExpanded: false,
        hasReviewEvidence: activeRecords.length > 0 || trendDays.length > 0 || reflections.length > 0,
        reasonSummary: reasonSummary(goal.actions),
        suggestion: suggestion(goal),
      });
    } catch (error) {
      this.setData({
        status: "error",
        errorMessage: error instanceof Error ? error.message : "成长回顾读取失败",
      });
    }
  },

  retry() {
    if (this.data.requestedGoalId) this.load(this.data.requestedGoalId);
  },

  toggleReflections() {
    const expanded = !this.data.reflectionExpanded;
    this.setData({
      reflectionExpanded: expanded,
      visibleReflections: expanded ? this.data.reflectionRecords : this.data.reflectionRecords.slice(0, 4),
    });
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack({ delta: 1 });
    else wx.redirectTo({ url: "/pages/history/index" });
  },
}));
