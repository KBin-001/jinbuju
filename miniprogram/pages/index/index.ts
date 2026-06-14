type PageStatus = "loading" | "empty" | "error" | "ready";

Page({
  data: {
    status: "loading" as PageStatus,
    errorMessage: "",
  },

  onLoad() {
    this.loadToday();
  },

  loadToday() {
    this.setData({ status: "loading", errorMessage: "" });
    setTimeout(() => {
      this.setData({ status: "empty" });
    }, 300);
  },

  retry() {
    this.loadToday();
  },

  goToPlan() {
    wx.switchTab({ url: "/pages/plan/index" });
  },
});
