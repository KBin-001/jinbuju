type PageStatus = "loading" | "empty" | "error" | "ready";

Page({
  data: {
    status: "loading" as PageStatus,
    errorMessage: "",
  },

  onLoad() {
    this.loadProfile();
  },

  loadProfile() {
    this.setData({ status: "loading", errorMessage: "" });
    setTimeout(() => {
      this.setData({ status: "empty" });
    }, 300);
  },

  retry() {
    this.loadProfile();
  },

  goToToday() {
    wx.switchTab({ url: "/pages/index/index" });
  },
});
