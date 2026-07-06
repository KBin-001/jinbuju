import { endGoal, getActiveGoal, getActiveGoals, setCurrentGoal } from "../../services/manualGoal";
import { getProgressSummary } from "../../services/manualStats";
import { withAppTheme } from "../../services/theme";
import { Goal, ProgressSummary } from "../../types/manual";

interface GoalManageCardView {
  id: string;
  title: string;
  days: number;
  progressPercent: number;
  isCurrent: boolean;
  statusText: "当前目标" | "待继续";
}

function daysSince(value?: string): number {
  if (!value) return 1;
  const start = new Date(`${value.slice(0, 10)}T00:00:00`).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Number.isFinite(start) ? Math.max(1, Math.floor((today - start) / 86400000) + 1) : 1;
}

function progressPercent(summary: ProgressSummary): number {
  return summary.totalTasks > 0
    ? Math.min(100, Math.round((summary.completedTasks / summary.totalTasks) * 100))
    : 0;
}

function toCard(goal: Goal, currentGoalId: string): GoalManageCardView {
  const summary = getProgressSummary(goal.id);
  const isCurrent = goal.id === currentGoalId;
  return {
    id: goal.id,
    title: goal.title,
    days: Math.max(daysSince(goal.startedAt || goal.createdAt), summary.totalActionDays || 0),
    progressPercent: progressPercent(summary),
    isCurrent,
    statusText: isCurrent ? "当前目标" : "待继续",
  };
}

Page(withAppTheme({
  data: {
    goals: [] as GoalManageCardView[],
    activeGoalCount: 0,
    endingGoalId: "",
  },

  onShow() {
    this.loadGoals();
  },

  loadGoals() {
    try {
      const activeGoals = getActiveGoals();
      const currentGoalId = getActiveGoal()?.id || activeGoals[0]?.id || "";
      this.setData({
        goals: activeGoals.map((goal) => toCard(goal, currentGoalId)),
        activeGoalCount: activeGoals.length,
        endingGoalId: "",
      });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "目标读取失败", icon: "none" });
    }
  },

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
      wx.showToast({ title: error instanceof Error ? error.message : "成长档案打开失败", icon: "none" });
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
      content: `“${title}”会保存到历史目标，已有行动和成长记录都会保留。`,
      cancelText: "再想想",
      confirmText: "确认结束",
      confirmColor: "#356859",
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
