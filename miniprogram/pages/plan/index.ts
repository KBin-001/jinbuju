import { getActiveGoal } from "../../services/manualGoal";
import { getProgressSummary } from "../../services/manualStats";
import { Goal, ProgressSummary } from "../../types/manual";
import { formatDate } from "../../utils/date";

Page({
  data: { status: "loading", errorMessage: "", goal: null as Goal | null, summary: null as ProgressSummary | null, completionRate: 0 },
  onShow() { this.load(); },
  load() { this.setData({ status: "loading", errorMessage: "" }); try { const goal = getActiveGoal(); const summary = goal ? getProgressSummary(goal.id, formatDate(new Date())) : null; this.setData({ status: "ready", goal, summary, completionRate: summary && summary.totalTasks ? Math.round(summary.completedTasks / summary.totalTasks * 100) : 0 }); } catch (error) { this.setData({ status: "error", errorMessage: error instanceof Error ? error.message : "进度读取失败" }); } },
  retry() { this.load(); },
  createGoal() { wx.navigateTo({ url: "/pages/goal-create/index" }); },
  addTask() { wx.navigateTo({ url: "/pages/action-edit/index" }); },
  editTask(event: { currentTarget: { dataset: { id?: string } } }) { const id = String(event.currentTarget.dataset.id || ""); if (id) wx.navigateTo({ url: `/pages/action-edit/index?id=${id}` }); },
});
