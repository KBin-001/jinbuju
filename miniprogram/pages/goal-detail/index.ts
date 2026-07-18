import { endGoal, getActiveGoal, getGoal, setCurrentGoal } from "../../services/manualGoal";
import { getProgressSummary } from "../../services/manualStats";
import { getTasksByGoal } from "../../services/manualTask";
import { ActionTask, Goal, ProgressSummary } from "../../types/manual";
import { MODAL_CONFIRM_COLORS, withAppTheme } from "../../services/theme";
import { addBusinessDays, formatDisplayDate, getTodayBusinessDate } from "../../utils/date";
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

function completionRate(summary: ProgressSummary): number {
  if (summary.totalTasks <= 0) return 0;
  return Math.round((summary.completedTasks / summary.totalTasks) * 100);
}

function estimateFinish(summary: ProgressSummary): string {
  if (summary.totalTasks === 0) return "添加行动后估算";
  if (summary.completedTasks >= summary.totalTasks) return "本阶段已完成";
  if (summary.totalActionDays <= 0 || summary.completedTasks <= 0) return "开始行动后估算";
  const actionsPerDay = summary.completedTasks / summary.totalActionDays;
  const remainingDays = Math.max(1, Math.ceil((summary.totalTasks - summary.completedTasks) / actionsPerDay));
  return formatDisplayDate(addBusinessDays(getTodayBusinessDate(), remainingDays));
}

function continuityText(summary: ProgressSummary): string {
  if (summary.currentStreakDays > 0) return `${summary.currentStreakDays} 天连续`;
  if (summary.totalActionDays > 0) return `${summary.totalActionDays} 天累计`;
  return "尚未开始";
}

function toActionView(task: ActionTask, today: string): ActionView {
  const displayStatus = getActionTaskDisplayStatus(task, today);
  return {
    ...task,
    statusLabel: displayStatus.text,
    statusTone: displayStatus.tone,
    dateText: task.currentDate === today ? "今天" : formatDisplayDate(task.currentDate),
    actualText: (task.actualMinutes || 0) > 0 ? `${task.actualMinutes} 分钟` : "未记录",
  };
}

Page(withAppTheme({
  data: {
    status: "loading",
    errorMessage: "",
    requestedGoalId: "",
    goal: null as Goal | null,
    summary: null as ProgressSummary | null,
    isCurrentGoal: false,
    progressPercent: 0,
    progressText: "还没有行动记录",
    statItems: [] as StatItem[],
    actionRecords: [] as ActionView[],
    lifecycleSubmitting: false,
  },

  onLoad(query: Record<string, string>) {
    const goalId = String(query.id || "");
    this.setData({ requestedGoalId: goalId });
    this.load(goalId);
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
        this.setData({ status: "error", errorMessage: "目标不存在，或已进入历史目标" });
        return;
      }

      const today = getTodayBusinessDate();
      const summary = getProgressSummary(goal.id, today);
      const progressPercent = completionRate(summary);
      const actions = getTasksByGoal(goal.id)
        .map((task) => toActionView(task, today))
        .slice(0, 12);

      this.setData({
        status: "ready",
        goal,
        summary,
        isCurrentGoal: getActiveGoal()?.id === goal.id,
        progressPercent,
        progressText: summary.totalTasks > 0
          ? `已完成 ${summary.completedTasks} / ${summary.totalTasks} 项行动`
          : "还没有行动记录",
        statItems: [
          { label: "完成行动", value: `${summary.completedTasks}/${summary.totalTasks}` },
          { label: "行动节奏", value: continuityText(summary) },
          { label: "实际投入", value: `${summary.totalActualMinutes} 分钟` },
          { label: "预计完成", value: estimateFinish(summary) },
        ],
        actionRecords: actions,
        lifecycleSubmitting: false,
      });
    } catch (error) {
      this.setData({
        status: "error",
        errorMessage: error instanceof Error ? error.message : "目标详情读取失败",
      });
    }
  },

  retry() {
    const goalId = this.data.goal?.id || this.data.requestedGoalId;
    if (goalId) this.load(goalId);
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
    wx.navigateTo({ url: `/pages/action-edit/index?goalId=${encodeURIComponent(goal.id)}` });
  },

  viewProgress() {
    wx.switchTab({ url: "/pages/plan/index" });
  },

  viewAllActions() {
    const goal = this.data.goal;
    if (!goal) return;
    wx.navigateTo({ url: `/pages/action-records/index?goalId=${encodeURIComponent(goal.id)}` });
  },

  endGoal() {
    const goal = this.data.goal;
    if (this.data.lifecycleSubmitting || !goal) return;
    wx.showModal({
      title: "结束这个目标？",
      content: "结束后会进入历史目标，已有行动记录、投入时间和复盘数据都会保留。",
      cancelText: "暂不结束",
      confirmText: "确认结束",
      confirmColor: MODAL_CONFIRM_COLORS.danger,
      success: (result) => {
        if (!result.confirm) return;
        this.setData({ lifecycleSubmitting: true });
        try {
          const archivedGoal = endGoal(goal.id);
          wx.showToast({ title: "已保存到历史目标", icon: "success" });
          setTimeout(() => {
            wx.redirectTo({ url: `/pages/goal-review/index?id=${encodeURIComponent(archivedGoal.id)}` });
          }, 300);
        } catch (error) {
          wx.showToast({ title: error instanceof Error ? error.message : "结束失败", icon: "none" });
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
      content: "当前目标会完整保存到历史目标，再进入新目标创建流程，不会覆盖已有数据。",
      cancelText: "暂不更换",
      confirmText: "保留并更换",
      confirmColor: MODAL_CONFIRM_COLORS.confirm,
      success: (result) => {
        if (!result.confirm) return;
        this.setData({ lifecycleSubmitting: true });
        try {
          endGoal(goal.id);
          wx.showToast({ title: "原目标已归档", icon: "success" });
          setTimeout(() => wx.redirectTo({ url: "/pages/goal-create/index" }), 300);
        } catch (error) {
          wx.showToast({ title: error instanceof Error ? error.message : "更换失败", icon: "none" });
          this.setData({ lifecycleSubmitting: false });
        }
      },
    });
  },
}));
