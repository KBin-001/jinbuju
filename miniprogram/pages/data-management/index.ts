import {
  deleteUserData,
  ProfileServiceError,
} from "../../services/profile";

interface InputEvent {
  detail: {
    value?: string;
  };
}

Page({
  data: {
    confirmedRisk: false,
    confirmation: "",
    deleting: false,
    errorMessage: "",
  },

  startDelete() {
    if (this.data.deleting) return;
    wx.showModal({
      title: "确认清除全部数据？",
      content:
        "目标、计划、任务、打卡、小队关系和鼓励记录都会被清除，且无法恢复。",
      confirmText: "继续",
      confirmColor: "#B44C43",
      success: (result: { confirm: boolean }) => {
        if (result.confirm) {
          this.setData({
            confirmedRisk: true,
            confirmation: "",
            errorMessage: "",
          });
        }
      },
    });
  },

  onConfirmationInput(event: InputEvent) {
    this.setData({
      confirmation: String(event.detail.value || ""),
      errorMessage: "",
    });
  },

  submitDelete() {
    if (this.data.deleting || this.data.confirmation !== "确认清除") return;
    this.setData({ deleting: true, errorMessage: "" });
    deleteUserData(this.data.confirmation)
      .then(() => {
        wx.clearStorageSync();
        wx.reLaunch({
          url: "/pages/welcome/index?dataCleared=1",
          success: () => {
            wx.showToast({
              title: "数据已清除",
              icon: "success",
            });
          },
        });
      })
      .catch((error: Error) => {
        const serviceError = error as ProfileServiceError;
        this.setData({
          deleting: false,
          errorMessage:
            serviceError.message || "数据暂时未能清除，请稍后重试。",
        });
      });
  },
});
