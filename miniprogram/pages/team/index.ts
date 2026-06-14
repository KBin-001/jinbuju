type PageStatus = "loading" | "empty" | "error" | "ready";

Page({
  data: {
    status: "loading" as PageStatus,
    errorMessage: "",
  },

  onLoad() {
    this.loadTeam();
  },

  loadTeam() {
    this.setData({ status: "loading", errorMessage: "" });
    setTimeout(() => {
      this.setData({ status: "empty" });
    }, 300);
  },

  retry() {
    this.loadTeam();
  },

  findTeam() {
    wx.showToast({
      title: "小队模块即将接入",
      icon: "none",
    });
  },
});
