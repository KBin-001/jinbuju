import { FEATURE_FLAGS } from "../../config/features";
import { getActiveGoal, getGoals } from "../../services/manualGoal";
import { clearManualStore } from "../../services/manualStore";
import { getProgressSummary } from "../../services/manualStats";
import { Goal, ProgressSummary } from "../../types/manual";

Page({
  data: { goal: null as Goal | null, goalCreatedDate: "", summary: null as ProgressSummary | null, historyCount: 0, teamEnabled: FEATURE_FLAGS.ENABLE_TEAM },
  onShow() { try { const goal = getActiveGoal(); this.setData({ goal, goalCreatedDate: goal ? goal.createdAt.slice(0, 10) : "", summary: goal ? getProgressSummary(goal.id) : null, historyCount: getGoals().filter((item) => item.status !== "active").length }); } catch (error) { wx.showToast({ title: "个人数据读取失败", icon: "none" }); } },
  createGoal() { wx.navigateTo({ url: "/pages/goal-create/index" }); },
  goProgress() { wx.switchTab({ url: "/pages/plan/index" }); },
  showHistory() { wx.showModal({ title: "历史目标", content: this.data.historyCount ? `已保存 ${this.data.historyCount} 个历史目标。完整管理将在后续版本提供。` : "还没有历史目标。", showCancel: false }); },
  clearLocalData() { wx.showModal({ title: "清除本地数据？", content: "只会清除本基础版保存在当前设备上的目标、行动和记录，不会操作线上数据库。清除后无法恢复。", confirmText: "确认清除", confirmColor: "#9B4B45", success: (result) => { if (!result.confirm) return; clearManualStore(); wx.removeStorageSync("welcomeCompleted"); wx.showToast({ title: "本地数据已清除", icon: "success" }); setTimeout(() => wx.reLaunch({ url: "/pages/welcome/index" }), 350); } }); },
  openPrivacy() { wx.navigateTo({ url: "/pages/legal/privacy/index" }); }, openTerms() { wx.navigateTo({ url: "/pages/legal/terms/index" }); }, openAbout() { wx.navigateTo({ url: "/pages/about/index" }); },
});
