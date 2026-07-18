import { clearCloudBusinessData, deleteCloudAccount } from "../../services/account";
import { clearLocalCachesAndRestore } from "../../services/dataSync";
import { clearManualStore } from "../../services/manualStore";
import { ProfileServiceError } from "../../services/profile";
import { getCurrentThemeId, MODAL_CONFIRM_COLORS, withAppTheme } from "../../services/theme";

type DangerMode = "" | "business" | "account";

interface InputEvent {
  detail: { value?: string };
}

const CONFIRM_TEXT: Record<Exclude<DangerMode, "">, string> = {
  business: "删除成长数据",
  account: "注销账号",
};

Page(withAppTheme({
  data: {
    appTheme: getCurrentThemeId() as string,
    dangerMode: "" as DangerMode,
    confirmation: "",
    processing: false,
    localClearing: false,
    errorMessage: "",
  },

  onShow() {
    this.setData({ appTheme: getCurrentThemeId() });
  },

  openSync() {
    wx.navigateTo({ url: "/pages/data-sync/index" });
  },

  clearLocalCache() {
    if (this.data.processing || this.data.localClearing) return;
    wx.showModal({
      title: "清除并从云端恢复？",
      content: "只清除当前设备缓存。目标、行动和收藏不会从云端删除；操作需要保持联网。",
      confirmText: "清除并恢复",
      success: (result) => {
        if (!result.confirm) return;
        this.setData({ localClearing: true, errorMessage: "" });
        clearLocalCachesAndRestore().then(() => {
          wx.showToast({ title: "已从云端恢复", icon: "success" });
        }).catch((error: Error) => {
          this.setData({ errorMessage: error.message || "云端恢复未完成，请联网重试" });
        }).then(() => this.setData({ localClearing: false }));
      },
    });
  },

  startBusinessDelete() {
    this.openDangerConfirmation("business");
  },

  startAccountDelete() {
    this.openDangerConfirmation("account");
  },

  openDangerConfirmation(mode: Exclude<DangerMode, "">) {
    if (this.data.processing) return;
    const isAccount = mode === "account";
    wx.showModal({
      title: isAccount ? "申请注销账号？" : "删除全部成长数据？",
      content: isAccount
        ? "账号资料、绑定关系和成长数据将永久删除；如你是小队队长，需要先转让或解散小队。"
        : "目标、行动、复盘和成长收藏将永久删除。账号资料、手机号绑定、协议记录和小队关系保留。",
      confirmText: "继续",
      confirmColor: MODAL_CONFIRM_COLORS.danger,
      success: (result) => {
        if (result.confirm) this.setData({ dangerMode: mode, confirmation: "", errorMessage: "" });
      },
    });
  },

  cancelDanger() {
    if (this.data.processing) return;
    this.setData({ dangerMode: "", confirmation: "", errorMessage: "" });
  },

  onConfirmationInput(event: InputEvent) {
    this.setData({ confirmation: String(event.detail.value || ""), errorMessage: "" });
  },

  submitDanger() {
    const mode = this.data.dangerMode as Exclude<DangerMode, "">;
    if (!mode || this.data.processing || this.data.confirmation !== CONFIRM_TEXT[mode]) return;
    this.setData({ processing: true, errorMessage: "" });
    const operation = mode === "business" ? clearCloudBusinessData() : deleteCloudAccount();
    operation.then(() => {
      clearManualStore();
      if (mode === "account") {
        wx.removeStorageSync("welcomeCompleted");
        wx.reLaunch({ url: "/pages/welcome/index?accountDeleted=1" });
        return;
      }
      wx.showToast({ title: "成长数据已删除", icon: "success" });
      setTimeout(() => wx.switchTab({ url: "/pages/profile/index" }), 450);
    }).catch((error: Error) => {
      const serviceError = error as ProfileServiceError;
      this.setData({
        processing: false,
        errorMessage: serviceError.message || (mode === "account" ? "账号暂时无法注销，请稍后重试" : "成长数据暂时无法删除，请稍后重试"),
      });
    });
  },
}));
