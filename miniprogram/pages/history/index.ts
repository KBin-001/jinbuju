import { getArchivedGoals } from "../../services/manualGoal";
import { withAppTheme } from "../../services/theme";
import { ArchivedGoal } from "../../types/manual";

interface HistoryGoalCard {
  id: string;
  title: string;
  statusText: string;
  dateRange: string;
  totalDays: number;
  completionRate: number;
  completedActions: number;
  actualMinutes: number;
}

function shortDate(value?: string): string {
  return value ? value.slice(0, 10).replace(/-/g, ".") : "";
}

function statusText(status: ArchivedGoal["status"]): string {
  if (status === "completed") return "已完成";
  if (status === "ended") return "已结束";
  return "已收进档案";
}

function toCard(goal: ArchivedGoal): HistoryGoalCard {
  const start = shortDate(goal.startedAt || goal.createdAt);
  const end = shortDate(goal.endedAt || goal.archivedAt);
  return {
    id: goal.id,
    title: goal.title,
    statusText: statusText(goal.status),
    dateRange: start && end ? `${start} - ${end}` : start || end || "日期未记录",
    totalDays: goal.stats.totalDays || 1,
    completionRate: Math.max(0, Math.min(100, goal.stats.completionRate || 0)),
    completedActions: goal.stats.completedActions || 0,
    actualMinutes: goal.stats.actualMinutes || 0,
  };
}

Page(withAppTheme({
  data: {
    goals: [] as HistoryGoalCard[],
    summary: { goalCount: 0, completedActions: 0, actualMinutes: 0, averageRate: 0 },
  },

  onShow() {
    this.loadHistory();
  },

  loadHistory() {
    try {
      const archived = getArchivedGoals().slice().sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
      const cards = archived.map(toCard);
      const completedActions = cards.reduce((sum, goal) => sum + goal.completedActions, 0);
      const actualMinutes = cards.reduce((sum, goal) => sum + goal.actualMinutes, 0);
      const averageRate = cards.length
        ? Math.round(cards.reduce((sum, goal) => sum + goal.completionRate, 0) / cards.length)
        : 0;
      this.setData({
        goals: cards,
        summary: { goalCount: cards.length, completedActions, actualMinutes, averageRate },
      });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "历史数据读取失败", icon: "none" });
    }
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  backProfile() {
    wx.switchTab({ url: "/pages/profile/index" });
  },

  openReview(event: { currentTarget: { dataset: { id?: string } } }) {
    const id = String(event.currentTarget.dataset.id || "");
    if (id) wx.navigateTo({ url: `/pages/goal-review/index?id=${encodeURIComponent(id)}` });
  },
}));
