import { getPlanPreview } from "../../utils/storage";

type PageStatus = "loading" | "empty" | "error" | "ready";

Page({
  data: {
    status: "loading" as PageStatus,
    errorMessage: "",
  },

  onLoad() {
    this.loadPlan();
  },

  onShow() {
    this.loadPlan();
  },

  loadPlan() {
    this.setData({ status: "loading", errorMessage: "" });
    setTimeout(() => {
      this.setData({ status: getPlanPreview() ? "ready" : "empty" });
    }, 300);
  },

  retry() {
    this.loadPlan();
  },

  createGoal() {
    wx.navigateTo({ url: "/pages/goal-create/index" });
  },

  continuePreview() {
    wx.navigateTo({ url: "/pages/plan-preview/index" });
  },
});
