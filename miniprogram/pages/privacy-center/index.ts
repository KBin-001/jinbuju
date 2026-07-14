import { ConsentStatus, getConsentStatus, recordConsents, withdrawConsent } from "../../services/privacy";
import { withAppTheme } from "../../services/theme";

Page(withAppTheme({
  data: {
    loading: true,
    saving: false,
    consentChecked: false,
    status: null as ConsentStatus | null,
    errorMessage: "",
  },

  onShow() { this.load(); },

  async load() {
    this.setData({ loading: true, errorMessage: "" });
    try {
      const status = await getConsentStatus();
      this.setData({ loading: false, status });
    } catch (error) {
      this.setData({ loading: false, errorMessage: error instanceof Error ? error.message : "隐私设置加载失败" });
    }
  },

  onConsentChange(event: { detail?: { value?: string[] } }) {
    this.setData({ consentChecked: Array.isArray(event.detail?.value) && event.detail!.value!.includes("agree") });
  },

  async confirmAgreements() {
    if (!this.data.consentChecked || this.data.saving) return;
    this.setData({ saving: true, errorMessage: "" });
    try {
      const status = await recordConsents(["privacy", "terms"], "settings");
      this.setData({ saving: false, status, consentChecked: false });
      wx.showToast({ title: "同意记录已保存", icon: "success" });
    } catch (error) {
      this.setData({ saving: false, errorMessage: error instanceof Error ? error.message : "保存失败" });
    }
  },

  withdrawOptionalConsent() {
    if (this.data.saving) return;
    wx.showModal({
      title: "撤回手机号处理同意？",
      content: "撤回后不会自动删除已绑定手机号。请先到“账号与安全”解除绑定，目标与行动功能不受影响。",
      cancelText: "取消",
      confirmText: "撤回同意",
      confirmColor: "#B86152",
      success: async (result) => {
        if (!result.confirm) return;
        this.setData({ saving: true });
        try {
          const status = await withdrawConsent("phone_binding");
          this.setData({ saving: false, status });
          wx.showToast({ title: "已记录撤回", icon: "success" });
        } catch (error) {
          this.setData({ saving: false, errorMessage: error instanceof Error ? error.message : "撤回失败" });
        }
      },
    });
  },

  openPrivacy() { wx.navigateTo({ url: "/pages/legal/privacy/index" }); },
  openTerms() { wx.navigateTo({ url: "/pages/legal/terms/index" }); },
  openAccountSecurity() { wx.navigateTo({ url: "/pages/account-security/index" }); },
  openDataManagement() { wx.navigateTo({ url: "/pages/data-management/index" }); },
}));
