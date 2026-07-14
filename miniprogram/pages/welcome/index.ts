import { bootstrapAccount, completeCloudOnboarding } from "../../services/account";
import { recordConsents } from "../../services/privacy";
import { withAppTheme } from "../../services/theme";

type WelcomeStatus = "loading" | "ready" | "error";
const WELCOME_COMPLETED_KEY = "welcomeCompleted";

Page(withAppTheme({
  data: {
    status: "loading" as WelcomeStatus,
    errorMessage: "",
    showExample: false,
    consentChecked: false,
    submitting: false,
  },

  onLoad() {
    this.checkWelcomeStatus();
  },

  checkWelcomeStatus() {
    this.setData({ status: "loading", errorMessage: "" });
    try {
      if (wx.getStorageSync(WELCOME_COMPLETED_KEY)) {
        wx.switchTab({
          url: "/pages/index/index",
          fail: () => this.setData({ status: "error", errorMessage: "暂时无法进入今日页，请稍后重试。" }),
        });
        return;
      }
      this.setData({ status: "ready" });
    } catch (_) {
      this.setData({ status: "error", errorMessage: "启动信息读取失败，请重试。" });
    }
  },

  onConsentChange(event: { detail?: { value?: string[] } }) {
    const values = event.detail && Array.isArray(event.detail.value) ? event.detail.value : [];
    this.setData({ consentChecked: values.includes("agree") });
  },

  startPlanning() {
    if (!this.data.consentChecked || this.data.submitting) return;
    this.setData({ submitting: true, errorMessage: "" });
    recordConsents(["privacy", "terms"], "welcome")
      .then(() => bootstrapAccount(true))
      .then((account) => {
        if (account.profile.welcomeCompleted) return { returning: true };
        return completeCloudOnboarding().then(() => ({ returning: false }));
      })
      .then(({ returning }) => {
        wx.setStorageSync(WELCOME_COMPLETED_KEY, true);
        if (returning) {
          wx.switchTab({ url: "/pages/index/index" });
          return;
        }
        wx.navigateTo({
          url: "/pages/goal-create/index",
          fail: () => wx.showToast({ title: "暂时无法进入目标创建页", icon: "none" }),
        });
      })
      .catch((error: Error) => {
        this.setData({ errorMessage: error.message || "同意记录暂时无法保存，请联网重试。" });
      })
      .then(() => this.setData({ submitting: false }));
  },

  openPrivacy() {
    wx.navigateTo({ url: "/pages/legal/privacy/index" });
  },

  openTerms() {
    wx.navigateTo({ url: "/pages/legal/terms/index" });
  },

  toggleExample() {
    this.setData({ showExample: !this.data.showExample });
  },

  retry() {
    this.checkWelcomeStatus();
  },
}));
