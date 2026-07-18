import { endGoal, getActiveGoal, getActiveGoals, setCurrentGoal } from "../../services/manualGoal";
import { getProgressSummary } from "../../services/manualStats";
import { MODAL_CONFIRM_COLORS, withAppTheme } from "../../services/theme";
import { Goal, ProgressSummary } from "../../types/manual";

interface GoalManageCardView {
  id: string;
  title: string;
  description: string;
  progressPercent: number;
  isCurrent: boolean;
  statusText: "当前目标" | "可切换";
  continuityText: string;
  actionText: string;
  minutesText: string;
}

function progressPercent(summary: ProgressSummary): number {
  return summary.totalTasks > 0
    ? Math.min(100, Math.round((summary.completedTasks / summary.totalTasks) * 100))
    : 0;
}

function continuityText(summary: ProgressSummary): string {
  if (summary.currentStreakDays > 0) return `连续行动 ${summary.currentStreakDays} 天`;
  if (summary.totalActionDays > 0) return `累计行动 ${summary.totalActionDays} 天`;
  return "等待第一次行动";
}

function toCard(goal: Goal, currentGoalId: string): GoalManageCardView {
  const summary = getProgressSummary(goal.id);
  const isCurrent = goal.id === currentGoalId;
  return {
    id: goal.id,
    title: goal.title,
    description: goal.description || "把目标拆成每天可以完成的一小步",
    progressPercent: progressPercent(summary),
    isCurrent,
    statusText: isCurrent ? "当前目标" : "可切换",
    continuityText: continuityText(summary),
    actionText: summary.totalTasks > 0
      ? `已完成 ${summary.completedTasks} / ${summary.totalTasks} 项行动`
      : "还没有行动记录",
    minutesText: `累计投入 ${summary.totalActualMinutes} 分钟`,
  };
}

Page(withAppTheme({
  data: {
    goals: [] as GoalManageCardView[],
    activeGoalCount: 0,
    currentGoalTitle: "",
    endingGoalId: "",
    loading: true,
    errorMessage: "",
  },

  onShow() {
    this.loadGoals();
  },

  loadGoals() {
    try {
      const activeGoals = getActiveGoals();
      const currentGoal = getActiveGoal() || activeGoals[0] || null;
      this.setData({
        goals: activeGoals.map((goal) => toCard(goal, currentGoal?.id || "")),
        activeGoalCount: activeGoals.length,
        currentGoalTitle: currentGoal?.title || "",
        endingGoalId: "",
        loading: false,
        errorMessage: "",
      });
    } catch (error) {
      this.setData({
        loading: false,
        errorMessage: error instanceof Error ? error.message : "目标暂时无法读取",
      });
    }
  },

  retry() { this.setData({ loading: true, errorMessage: "" }); this.loadGoals(); },
  goBack() { wx.navigateBack({ delta: 1 }); },
  createGoal() { wx.navigateTo({ url: "/pages/goal-create/index" }); },

  openDetail(event: { currentTarget: { dataset: { id?: string } } }) {
    const id = String(event.currentTarget.dataset.id || "");
    if (id) wx.navigateTo({ url: `/pages/goal-detail/index?id=${encodeURIComponent(id)}` });
  },

  viewArchive(event: { currentTarget: { dataset: { id?: string } } }) {
    const id = String(event.currentTarget.dataset.id || "");
    if (!id) return;
    try {
      setCurrentGoal(id);
      wx.switchTab({ url: "/pages/plan/index" });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "成长数据暂时无法打开", icon: "none" });
    }
  },

  setAsCurrent(event: { currentTarget: { dataset: { id?: string } } }) {
    const id = String(event.currentTarget.dataset.id || "");
    if (!id) return;
    try {
      setCurrentGoal(id);
      this.loadGoals();
      wx.showToast({ title: "已设为当前目标", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "目标切换失败", icon: "none" });
    }
  },

  confirmEndGoal(event: { currentTarget: { dataset: { id?: string; title?: string } } }) {
    const id = String(event.currentTarget.dataset.id || "");
    const title = String(event.currentTarget.dataset.title || "这个目标");
    if (!id || this.data.endingGoalId) return;
    wx.showModal({
      title: "结束这个目标？",
      content: `“${title}”会进入历史目标，已有行动、投入和成长记录都会保留。`,
      cancelText: "再想想",
      confirmText: "确认结束",
      confirmColor: MODAL_CONFIRM_COLORS.danger,
      success: (result) => {
        if (!result.confirm) return;
        this.setData({ endingGoalId: id });
        try {
          endGoal(id);
          this.loadGoals();
          wx.showToast({ title: "已保存到历史目标", icon: "success" });
        } catch (error) {
          this.setData({ endingGoalId: "" });
          wx.showToast({ title: error instanceof Error ? error.message : "结束目标失败", icon: "none" });
        }
      },
    });
  },
}));
