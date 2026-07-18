import { bindAccountPhone, bootstrapAccount, getAccountRuntime, unbindAccountPhone } from "../../services/account";
import { ConsentStatus, getConsentStatus, recordConsents, withdrawConsent } from "../../services/privacy";
import { MODAL_CONFIRM_COLORS, withAppTheme } from "../../services/theme";
import { CloudAccount } from "../../types/account";
import { requirePlatformPrivacyAuthorization } from "../../services/platformPrivacy";
import { FEATURE_FLAGS } from "../../config/features";

Page(withAppTheme({
  data: {
    loading: true,
    operating: false,
    account: null as CloudAccount | null,
    consent: null as ConsentStatus | null,
    phoneConsentChecked: false,
    platformPrivacyAuthorized: false,
    phoneBindingEnabled: FEATURE_FLAGS.ENABLE_PHONE_BINDING,
    errorMessage: "",
  },

  onLoad() { this.load(); },

  async load() {
    this.setData({ loading: true, errorMessage: "" });
    try {
      await bootstrapAccount();
      const consent = FEATURE_FLAGS.ENABLE_PHONE_BINDING ? await getConsentStatus() : null;
      this.setData({
        loading: false,
        account: getAccountRuntime()?.account || null,
        consent,
        phoneConsentChecked: Boolean(consent?.consents.phone_binding.agreed),
      });
    } catch (error) {
      this.setData({ loading: false, errorMessage: error instanceof Error ? error.message : "账号信息加载失败" });
    }
  },

  onPhoneConsentChange(event: { detail?: { value?: string[] } }) {
    if (!FEATURE_FLAGS.ENABLE_PHONE_BINDING) return;
    this.setData({ phoneConsentChecked: Array.isArray(event.detail?.value) && event.detail!.value!.includes("agree") });
  },

  async authorizePlatformPrivacy() {
    if (!FEATURE_FLAGS.ENABLE_PHONE_BINDING) return;
    try {
      await requirePlatformPrivacyAuthorization();
      this.setData({ platformPrivacyAuthorized: true, errorMessage: "" });
    } catch (error) {
      this.setData({ errorMessage: error instanceof Error ? error.message : "请先完成隐私授权" });
    }
  },

  async onGetPhoneNumber(event: { detail?: { code?: string } }) {
    if (!FEATURE_FLAGS.ENABLE_PHONE_BINDING || this.data.operating) return;
    const code = String(event.detail?.code || "");
    if (!code) {
      wx.showToast({ title: "已取消手机号授权，其他功能仍可使用", icon: "none" });
      return;
    }
    if (!this.data.phoneConsentChecked) {
      wx.showToast({ title: "请先阅读并勾选绑定说明", icon: "none" });
      return;
    }
    if (!this.data.platformPrivacyAuthorized) return;
    this.setData({ operating: true, errorMessage: "" });
    try {
      const consent = await recordConsents(["phone_binding"], "phone_bind");
      const account = await bindAccountPhone(code);
      this.setData({ operating: false, account, consent, phoneConsentChecked: true });
      wx.showToast({ title: "手机号已绑定", icon: "success" });
    } catch (error) {
      this.setData({ operating: false, errorMessage: error instanceof Error ? error.message : "手机号绑定失败" });
    }
  },

  unbindPhone() {
    if (!FEATURE_FLAGS.ENABLE_PHONE_BINDING || this.data.operating || !this.data.account?.phoneBound) return;
    wx.showModal({
      title: "解除手机号绑定？",
      content: "解除后不会删除目标、行动或微信身份账号；需要手机号的后续能力将不可用。",
      cancelText: "取消",
      confirmText: "解除绑定",
      confirmColor: MODAL_CONFIRM_COLORS.danger,
      success: async (result) => {
        if (!result.confirm) return;
        this.setData({ operating: true, errorMessage: "" });
        try {
          const account = await unbindAccountPhone();
          const consent = await withdrawConsent("phone_binding");
          this.setData({ operating: false, account, consent, phoneConsentChecked: false });
          wx.showToast({ title: "已解除绑定", icon: "success" });
        } catch (error) {
          this.setData({ operating: false, errorMessage: error instanceof Error ? error.message : "解除绑定失败" });
        }
      },
    });
  },

  openPrivacyCenter() { wx.navigateTo({ url: "/pages/privacy-center/index" }); },
  openDataSync() { wx.navigateTo({ url: "/pages/data-sync/index" }); },
  openDataManagement() { wx.navigateTo({ url: "/pages/data-management/index" }); },
}));
