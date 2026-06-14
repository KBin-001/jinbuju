type WelcomeStatus = "loading" | "ready" | "error";

const WELCOME_COMPLETED_KEY = "welcomeCompleted";

Page({
  data: {
    status: "loading" as WelcomeStatus,
    errorMessage: "",
    showExample: false,
  },

  onLoad() {
    this.checkWelcomeStatus();
  },

  checkWelcomeStatus() {
    this.setData({
      status: "loading",
      errorMessage: "",
    });

    try {
      const hasCompletedWelcome = wx.getStorageSync(WELCOME_COMPLETED_KEY);

      if (hasCompletedWelcome) {
        wx.switchTab({
          url: "/pages/index/index",
          fail: () => {
            this.setData({
              status: "error",
              errorMessage: "暂时无法进入首页，请稍后重试。",
            });
          },
        });
        return;
      }

      this.setData({ status: "ready" });
    } catch (error) {
      console.error("读取首次启动状态失败", error);
      this.setData({
        status: "error",
        errorMessage: "启动信息读取失败，请重试。",
      });
    }
  },

  startPlanning() {
    try {
      wx.setStorageSync(WELCOME_COMPLETED_KEY, true);
      wx.switchTab({
        url: "/pages/plan/index",
        fail: () => {
          wx.removeStorageSync(WELCOME_COMPLETED_KEY);
          wx.showToast({
            title: "暂时无法进入计划页",
            icon: "none",
          });
        },
      });
    } catch (error) {
      console.error("保存首次启动状态失败", error);
      wx.showToast({
        title: "操作失败，请重试",
        icon: "none",
      });
    }
  },

  toggleExample() {
    this.setData({
      showExample: !this.data.showExample,
    });
  },

  retry() {
    this.checkWelcomeStatus();
  },
});
