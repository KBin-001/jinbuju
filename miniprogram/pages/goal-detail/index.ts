import { endGoal, getActiveGoal, getGoal, setCurrentGoal } from "../../services/manualGoal";
import { getProgressSummary } from "../../services/manualStats";
import { getTasksByGoal } from "../../services/manualTask";
import { ActionTask, Goal, ProgressSummary } from "../../types/manual";
import { addDays, formatDate, formatDisplayDate } from "../../utils/date";
import { getActionTaskDisplayStatus } from "../../utils/taskStatus";

interface StatItem {
  label: string;
  value: string;
}

interface ActionView extends ActionTask {
  statusLabel: string;
  statusTone: string;
  dateText: string;
  actualText: string;
}

function shortDate(value?: string): string {
  return value ? value.slice(0, 10) : "";
}

function daysSince(value?: string): number {
  if (!value) return 1;
  const start = new Date(`${shortDate(value)}T00:00:00`).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (!Number.isFinite(start)) return 1;
  return Math.max(1, Math.floor((today - start) / (24 * 60 * 60 * 1000)) + 1);
}

function completionRate(summary: ProgressSummary | null): number {
  if (!summary || summary.totalTasks <= 0) return 0;
  return Math.round((summary.completedTasks / summary.totalTasks) * 100);
}

function estimateFinish(summary: ProgressSummary | null): string {
  if (!summary || summary.totalTasks === 0) return "添加行动后估算";
  if (summary.completedTasks >= summary.totalTasks) return "已完成当前行动";
  if (summary.totalActionDays <= 0 || summary.completedTasks <= 0) return "开始行动后估算";
  const speed = summary.completedTasks / summary.totalActionDays;
  const days = Math.max(1, Math.ceil((summary.totalTasks - summary.completedTasks) / speed));
  return formatDate(addDays(new Date(), days));
}

function toActionView(task: ActionTask, today: string): ActionView {
  const status = getActionTaskDisplayStatus(task, today);
  return {
    ...task,
    statusLabel: status.text,
    statusTone: status.tone,
    dateText: task.currentDate === today ? "今天" : formatDisplayDate(task.currentDate),
    actualText: task.actualMinutes === undefined ? "未记录" : `${task.actualMinutes} 分钟`,
  };
}

Page({
  data: {
    status: "loading",
    errorMessage: "",
    goal: null as Goal | null,
    summary: null as ProgressSummary | null,
    isCurrentGoal: false,
    progressPercent: 0,
    persistedDays: 1,
    expectedFinishText: "添加行动后估算",
    actualMinutesText: "0 分钟",
    statItems: [] as StatItem[],
    dailyActions: [] as ActionView[],
    completedActions: [] as ActionView[],
    lifecycleSubmitting: false,
  },

  onLoad(query: Record<string, string>) {
    this.load(String(query.id || ""));
  },

  onShow() {
    const goalId = this.data.goal?.id;
    if (goalId) this.load(goalId);
  },

  load(goalId: string) {
    this.setData({ status: "loading", errorMessage: "" });
    try {
      const goal = getGoal(goalId);
      if (!goal || goal.status !== "active") {
        this.setData({ status: "error", errorMessage: "目标不存在或已进入历史目标" });
        return;
      }
      const today = formatDate(new Date());
      const summary = getProgressSummary(goal.id, today);
      const actions = getTasksByGoal(goal.id).map((task) => toActionView(task, today));
      const percent = completionRate(summary);
      const persistedDays = Math.max(daysSince(goal.startedAt || goal.createdAt), summary.totalActionDays || 0);
      const statItems: StatItem[] = [
        { label: "当前进度", value: `${percent}%` },
        { label: "已坚持", value: `${persistedDays} 天` },
        { label: "预计完成", value: estimateFinish(summary) },
        { label: "实际投入", value: `${summary.totalActualMinutes} 分钟` },
      ];
      this.setData({
        status: "ready",
        goal,
        summary,
        isCurrentGoal: getActiveGoal()?.id === goal.id,
        progressPercent: percent,
        persistedDays,
        expectedFinishText: estimateFinish(summary),
        actualMinutesText: `${summary.totalActualMinutes} 分钟`,
        statItems,
        dailyActions: actions.slice(0, 12),
        completedActions: actions.filter((task) => task.status === "completed").slice(0, 12),
        lifecycleSubmitting: false,
      });
    } catch (error) {
      this.setData({ status: "error", errorMessage: error instanceof Error ? error.message : "目标详情读取失败" });
    }
  },

  retry() {
    if (this.data.goal?.id) this.load(this.data.goal.id);
  },

  setAsCurrentGoal() {
    const goal = this.data.goal;
    if (!goal) return;
    try {
      setCurrentGoal(goal.id);
      wx.showToast({ title: "已设为当前目标", icon: "success" });
      this.load(goal.id);
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "切换失败", icon: "none" });
    }
  },

  addAction() {
    const goal = this.data.goal;
    if (!goal) return;
    wx.navigateTo({ url: `/pages/action-edit/index?goalId=${goal.id}` });
  },

  openReview() {
    wx.showToast({ title: "结束目标后可查看复盘", icon: "none" });
  },

  endGoal() {
    const goal = this.data.goal;
    if (this.data.lifecycleSubmitting || !goal) return;
    wx.showModal({
      title: "终止当前目标？",
      content: "终止后会进入历史目标，行动记录和复盘数据都会保留。",
      cancelText: "取消",
      confirmText: "确认终止",
      confirmColor: "#356859",
      success: (result) => {
        if (!result.confirm) return;
        this.setData({ lifecycleSubmitting: true });
        try {
          const archivedGoal = endGoal(goal.id);
          wx.showToast({ title: "目标已保存到历史", icon: "success" });
          setTimeout(() => wx.redirectTo({ url: `/pages/goal-review/index?id=${archivedGoal.id}` }), 300);
        } catch (error) {
          wx.showToast({ title: error instanceof Error ? error.message : "终止失败", icon: "none" });
          this.setData({ lifecycleSubmitting: false });
        }
      },
    });
  },

  replaceGoal() {
    const goal = this.data.goal;
    if (this.data.lifecycleSubmitting || !goal) return;
    wx.showModal({
      title: "更换目标？",
      content: "旧目标会保存到历史目标，可继续查看复盘；不会覆盖旧目标数据。",
      cancelText: "取消",
      confirmText: "保留并更换",
      confirmColor: "#356859",
      success: (result) => {
        if (!result.confirm) return;
        this.setData({ lifecycleSubmitting: true });
        try {
          endGoal(goal.id);
          wx.showToast({ title: "旧目标已归档", icon: "success" });
          setTimeout(() => wx.redirectTo({ url: "/pages/goal-create/index" }), 300);
        } catch (error) {
          wx.showToast({ title: error instanceof Error ? error.message : "更换失败", icon: "none" });
          this.setData({ lifecycleSubmitting: false });
        }
      },
    });
  },
});
