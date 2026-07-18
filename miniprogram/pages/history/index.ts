import { bootstrapAccount } from "../../services/account";
import {
  getArchivedGoals,
  getRecentlyDeletedGoals,
  purgeArchivedGoal,
  restoreArchivedGoal,
  softDeleteArchivedGoal,
} from "../../services/manualGoal";
import { syncManualData } from "../../services/manualSync";
import { MODAL_CONFIRM_COLORS, withAppTheme } from "../../services/theme";
import { ArchivedGoal } from "../../types/manual";

type HistoryStatus = "loading" | "ready" | "error";
type HistoryTab = "history" | "deleted";
type HistoryFilter = "all" | ArchivedGoal["status"];

interface HistoryGoalCard {
  id: string;
  title: string;
  status: ArchivedGoal["status"];
  statusText: string;
  dateRange: string;
  year: string;
  totalDays: number;
  completionRate: number;
  completedActions: number;
  actualMinutes: number;
  deletedAt: string;
}

interface HistoryGroup {
  year: string;
  goals: HistoryGoalCard[];
}

function shortDate(value?: string): string {
  return value ? value.slice(0, 10).replace(/-/g, ".") : "";
}

function statusText(status: ArchivedGoal["status"]): string {
  if (status === "completed") return "已完成";
  if (status === "ended") return "已终止";
  return "已归档";
}

function toCard(goal: ArchivedGoal): HistoryGoalCard {
  const start = shortDate(goal.startedAt || goal.createdAt);
  const end = shortDate(goal.endedAt || goal.archivedAt);
  return {
    id: goal.id,
    title: goal.title,
    status: goal.status,
    statusText: statusText(goal.status),
    dateRange: start && end ? `${start} - ${end}` : start || end || "日期未记录",
    year: String((goal.endedAt || goal.archivedAt || goal.createdAt).slice(0, 4) || "更早"),
    totalDays: goal.stats.totalDays || 1,
    completionRate: Math.max(0, Math.min(100, goal.stats.completionRate || 0)),
    completedActions: goal.stats.completedActions || 0,
    actualMinutes: goal.stats.actualMinutes || 0,
    deletedAt: shortDate(goal.deletedAt),
  };
}

function groupCards(cards: HistoryGoalCard[]): HistoryGroup[] {
  const map: Record<string, HistoryGoalCard[]> = {};
  cards.forEach((card) => {
    if (!map[card.year]) map[card.year] = [];
    map[card.year].push(card);
  });
  return Object.keys(map).sort((a, b) => b.localeCompare(a)).map((year) => ({ year, goals: map[year] }));
}

Page(withAppTheme({
  data: {
    status: "loading" as HistoryStatus,
    activeTab: "history" as HistoryTab,
    activeFilter: "all" as HistoryFilter,
    groups: [] as HistoryGroup[],
    summary: { goalCount: 0, completedActions: 0, actualMinutes: 0, averageRate: 0 },
    operatingId: "",
    errorMessage: "",
  },

  onShow() {
    this.loadHistory(false);
  },

  onPullDownRefresh() {
    this.loadHistory(true);
  },

  loadHistory(forceCloud: boolean) {
    this.setData({ status: "loading", errorMessage: "" });
    const ready = forceCloud ? bootstrapAccount(true) : Promise.resolve();
    ready.then(() => {
      this.renderHistory();
    }).catch((error: Error) => {
      this.setData({ status: "error", errorMessage: error.message || "历史目标暂时无法读取" });
    }).then(() => wx.stopPullDownRefresh());
  },

  renderHistory() {
    const allHistory = getArchivedGoals().slice().sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
    const source = this.data.activeTab === "deleted" ? getRecentlyDeletedGoals() : allHistory;
    const filtered = this.data.activeTab === "history" && this.data.activeFilter !== "all"
      ? source.filter((goal) => goal.status === this.data.activeFilter)
      : source;
    const cards = filtered.map(toCard);
    const completedActions = allHistory.reduce((sum, goal) => sum + (goal.stats.completedActions || 0), 0);
    const actualMinutes = allHistory.reduce((sum, goal) => sum + (goal.stats.actualMinutes || 0), 0);
    const averageRate = allHistory.length
      ? Math.round(allHistory.reduce((sum, goal) => sum + (goal.stats.completionRate || 0), 0) / allHistory.length)
      : 0;
    this.setData({
      status: "ready",
      groups: groupCards(cards),
      summary: { goalCount: allHistory.length, completedActions, actualMinutes, averageRate },
    });
  },

  switchTab(event: { currentTarget: { dataset: { tab?: HistoryTab } } }) {
    const tab = event.currentTarget.dataset.tab;
    if (!tab || tab === this.data.activeTab) return;
    this.setData({ activeTab: tab, activeFilter: "all" });
    this.renderHistory();
  },

  changeFilter(event: { currentTarget: { dataset: { filter?: HistoryFilter } } }) {
    const filter = event.currentTarget.dataset.filter;
    if (!filter || filter === this.data.activeFilter) return;
    this.setData({ activeFilter: filter });
    this.renderHistory();
  },

  retry() {
    this.loadHistory(true);
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  backProfile() {
    wx.switchTab({ url: "/pages/profile/index" });
  },

  openReview(event: { currentTarget: { dataset: { id?: string } } }) {
    const id = String(event.currentTarget.dataset.id || "");
    if (id && this.data.activeTab === "history") {
      wx.navigateTo({ url: `/pages/goal-review/index?id=${encodeURIComponent(id)}` });
    }
  },

  deleteGoal(event: { currentTarget: { dataset: { id?: string; title?: string } } }) {
    const id = String(event.currentTarget.dataset.id || "");
    const title = String(event.currentTarget.dataset.title || "该目标");
    if (!id || this.data.operatingId) return;
    wx.showModal({
      title: "移到最近删除？",
      content: `“${title}”会离开历史列表，之后仍可恢复或彻底删除。`,
      confirmText: "移到最近删除",
      confirmColor: MODAL_CONFIRM_COLORS.danger,
      success: (result) => {
        if (!result.confirm) return;
        softDeleteArchivedGoal(id);
        this.finishOperation(id, "已移到最近删除");
      },
    });
  },

  restoreGoal(event: { currentTarget: { dataset: { id?: string } } }) {
    const id = String(event.currentTarget.dataset.id || "");
    if (!id || this.data.operatingId) return;
    wx.showModal({
      title: "恢复这个目标？",
      content: "目标会回到目标管理；若已有当前目标，它会先以非当前状态保留。",
      confirmText: "恢复",
      success: (result) => {
        if (!result.confirm) return;
        restoreArchivedGoal(id);
        this.finishOperation(id, "目标已恢复");
      },
    });
  },

  purgeGoal(event: { currentTarget: { dataset: { id?: string; title?: string } } }) {
    const id = String(event.currentTarget.dataset.id || "");
    const title = String(event.currentTarget.dataset.title || "该目标");
    if (!id || this.data.operatingId) return;
    wx.showModal({
      title: "彻底删除？",
      content: `“${title}”的目标内容、行动与复盘将无法恢复。`,
      confirmText: "继续",
      confirmColor: MODAL_CONFIRM_COLORS.danger,
      success: (first) => {
        if (!first.confirm) return;
        wx.showModal({
          title: "最后一次确认",
          content: "此操作不可撤销。确定永久删除吗？",
          confirmText: "彻底删除",
          confirmColor: MODAL_CONFIRM_COLORS.danger,
          success: (second) => {
            if (!second.confirm) return;
            purgeArchivedGoal(id);
            this.finishOperation(id, "已彻底删除");
          },
        });
      },
    });
  },

  finishOperation(id: string, successTitle: string) {
    this.setData({ operatingId: id });
    syncManualData().then(() => {
      wx.showToast({ title: successTitle, icon: "success" });
    }).catch(() => {
      wx.showToast({ title: "已保存在本机，联网后将重试同步", icon: "none", duration: 2600 });
    }).then(() => {
      this.setData({ operatingId: "" });
      this.renderHistory();
    });
  },
}));
