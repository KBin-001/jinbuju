import { ProfileServiceError } from "../../services/profile";
import { clearManualStore } from "../../services/manualStore";
import { deleteCloudAccount } from "../../services/account";
import { getCurrentThemeId, withAppTheme } from "../../services/theme";
import { isMockSeeded, seedMockData } from "../../utils/mockData";

interface InputEvent {
  detail: {
    value?: string;
  };
}

Page(withAppTheme({
  data: {
    appTheme: getCurrentThemeId() as string,
    confirmedRisk: false,
    confirmation: "",
    deleting: false,
    errorMessage: "",
    mockSeeded: false,
  },

  onShow() {
    this.setData({ appTheme: getCurrentThemeId(), mockSeeded: isMockSeeded() });
  },

  loadMockData() {
    wx.showModal({
      title: "载入演示数据？",
      content: "会覆盖当前本地数据，写入 1 个目标、约 10 天行动记录和 20 位小队成员。仅用于预览体验。",
      confirmText: "载入",
      success: (result: { confirm: boolean }) => {
        if (!result.confirm) return;
        seedMockData();
        wx.showToast({ title: "演示数据已载入", icon: "success" });
        setTimeout(() => wx.switchTab({ url: "/pages/index/index" }), 350);
      },
    });
  },

  startDelete() {
    if (this.data.deleting) return;
    wx.showModal({
      title: "确认清除全部数据？",
      content:
        "目标、行动阶段、每日行动、打卡、小队关系和鼓励记录都会被清除，且无法恢复。",
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

  clearLocalData() {
    if (this.data.deleting) return;
    wx.showModal({
      title: "清除本地数据？",
      content: "只会清除当前设备上的目标、行动、打卡和历史复盘数据，不会操作线上数据库。清除后无法恢复。",
      confirmText: "确认清除",
      confirmColor: "#9B4B45",
      success: (result: { confirm: boolean }) => {
        if (!result.confirm) return;
        clearManualStore();
        wx.removeStorageSync("welcomeCompleted");
        wx.showToast({ title: "本地数据已清除", icon: "success" });
        setTimeout(() => wx.reLaunch({ url: "/pages/welcome/index" }), 350);
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
    deleteCloudAccount()
      .then(() => {
        clearManualStore();
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
}));
