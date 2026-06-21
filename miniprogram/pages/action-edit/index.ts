import { createManualTask, getHomeData } from "../../services/home";
import { GoalSummary } from "../../types/home";
import { formatDate } from "../../utils/date";

type PageStatus = "loading" | "ready" | "empty" | "error";
type TimePeriod = "morning" | "afternoon" | "evening" | "anytime";

function createRequestId(): string {
  return `manual_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

Page({
  data: {
    status: "loading" as PageStatus,
    errorMessage: "",
    goal: null as GoalSummary | null,
    title: "",
    description: "",
    taskDate: formatDate(new Date()),
    estimatedMinutes: 30,
    timePeriod: "anytime" as TimePeriod,
    submitting: false,
    timeOptions: [
      { label: "随时", value: "anytime" },
      { label: "上午", value: "morning" },
      { label: "下午", value: "afternoon" },
      { label: "晚上", value: "evening" },
    ],
  },

  onLoad() {
    this.loadContext();
  },

  loadContext() {
    this.setData({ status: "loading", errorMessage: "" });
    getHomeData()
      .then((data) => {
        if (!data.goal || !data.goal.planId) {
          this.setData({ status: "empty", goal: data.goal || null });
          return;
        }
        this.setData({ status: "ready", goal: data.goal });
      })
      .catch((error: Error) => {
        this.setData({
          status: "error",
          errorMessage: error.message || "行动信息加载失败，请稍后重试。",
        });
      });
  },

  retry() {
    this.loadContext();
  },

  inputTitle(event: { detail: { value?: string } }) {
    this.setData({ title: String(event.detail.value || "").slice(0, 40) });
  },

  inputDescription(event: { detail: { value?: string } }) {
    this.setData({ description: String(event.detail.value || "").slice(0, 150) });
  },

  inputMinutes(event: { detail: { value?: string } }) {
    this.setData({ estimatedMinutes: Number(event.detail.value) });
  },

  changeDate(event: { detail: { value?: string } }) {
    this.setData({ taskDate: String(event.detail.value || "") });
  },

  selectTime(event: { currentTarget: { dataset: { value?: string } } }) {
    const value = String(event.currentTarget.dataset.value || "anytime") as TimePeriod;
    this.setData({ timePeriod: value });
  },

  goCreateGoal() {
    wx.redirectTo({ url: "/pages/goal-create/index" });
  },

  submit() {
    if (this.data.submitting) return;
    const goal = this.data.goal as GoalSummary | null;
    const title = this.data.title.trim();
    const minutes = Number(this.data.estimatedMinutes);
    if (!goal?.planId) {
      wx.showToast({ title: "请先创建并确认行动计划", icon: "none" });
      return;
    }
    if (title.length < 2 || title.length > 40) {
      wx.showToast({ title: "标题请控制在 2～40 个字", icon: "none" });
      return;
    }
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 180) {
      wx.showToast({ title: "预计时间应为 5～180 分钟", icon: "none" });
      return;
    }
    this.setData({ submitting: true });
    createManualTask({
      requestId: createRequestId(),
      title,
      description: this.data.description.trim(),
      taskDate: this.data.taskDate,
      timePeriod: this.data.timePeriod,
      estimatedMinutes: minutes,
      planId: goal.planId,
      repeatType: "none",
      priority: "normal",
      taskType: "required",
    })
      .then(() => {
        wx.showToast({ title: "行动已添加", icon: "success" });
        setTimeout(() => wx.navigateBack(), 300);
      })
      .catch((error: Error) => {
        this.setData({ submitting: false });
        wx.showToast({ title: error.message || "行动添加失败", icon: "none" });
      });
  },
});
