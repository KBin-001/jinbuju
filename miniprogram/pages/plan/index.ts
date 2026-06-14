type PageStatus = "loading" | "empty" | "error" | "ready";

Page({
  data: {
    status: "loading" as PageStatus,
    errorMessage: "",
  },

  onLoad() {
    this.loadPlan();
  },

  loadPlan() {
    this.setData({ status: "loading", errorMessage: "" });
    setTimeout(() => {
      this.setData({ status: "empty" });
    }, 300);
  },

  retry() {
    this.loadPlan();
  },

  createGoal() {
    wx.showToast({
      title: "目标创建模块即将接入",
      icon: "none",
    });
  },
});
