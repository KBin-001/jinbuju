import { ConsentStatus, getConsentStatus, recordConsents, withdrawConsent } from "../../services/privacy";
import {
  getNotificationPreference,
  getWechatSubscriptionSetting,
  NotificationPreference,
  openWechatNotificationSettings,
  requestNotificationAuthorization,
  updateNotificationPreference,
} from "../../services/notification";
import { NotificationScene, NOTIFICATION_DEFINITIONS } from "../../config/notification";
import { MODAL_CONFIRM_COLORS, withAppTheme } from "../../services/theme";
import { FEATURE_FLAGS } from "../../config/features";

Page(withAppTheme({
  data: {
    loading: true,
    saving: false,
    consentChecked: false,
    agreementsAccepted: false,
    status: null as ConsentStatus | null,
    errorMessage: "",
    notificationLoading: true,
    notificationErrorMessage: "",
    notificationSavingScene: "" as NotificationScene | "",
    notificationPreference: null as NotificationPreference | null,
    wechatNotificationMainSwitch: true,
    phoneBindingEnabled: FEATURE_FLAGS.ENABLE_PHONE_BINDING,
  },

  onShow() { this.load(); this.loadNotificationSettings(); },

  async load() {
    this.setData({ loading: true, errorMessage: "" });
    try {
      const status = await getConsentStatus();
      this.setData({
        loading: false,
        status,
        agreementsAccepted: Boolean(status.consents.privacy.agreed && status.consents.terms.agreed),
      });
    } catch (error) {
      this.setData({ loading: false, errorMessage: error instanceof Error ? error.message : "隐私设置加载失败" });
    }
  },

  async loadNotificationSettings() {
    this.setData({ notificationLoading: true, notificationErrorMessage: "" });
    try {
      const [preference, setting] = await Promise.all([
        getNotificationPreference(),
        getWechatSubscriptionSetting(),
      ]);
      this.setData({
        notificationLoading: false,
        notificationPreference: preference,
        wechatNotificationMainSwitch: setting.mainSwitch,
        notificationErrorMessage: "",
      });
    } catch (error) {
      this.setData({
        notificationLoading: false,
        notificationErrorMessage: error instanceof Error ? error.message : "通知设置加载失败，请重试。",
      });
    }
  },

  async onNotificationChange(event: { currentTarget?: { dataset?: { scene?: NotificationScene } }; detail?: { value?: boolean } | boolean }) {
    const scene = event.currentTarget?.dataset?.scene;
    if (!scene || this.data.notificationSavingScene) return;
    const rawDetail = event.detail;
    const enabled = typeof rawDetail === "boolean" ? rawDetail : Boolean(rawDetail?.value);
    const current = this.data.notificationPreference?.scenes[scene];
    if (enabled && !current?.configured) {
      wx.showToast({ title: "通知模板审核完成后开放", icon: "none" });
      return;
    }
    this.setData({ notificationSavingScene: scene, notificationErrorMessage: "" });
    try {
      if (enabled) {
        const authorizationResult = await requestNotificationAuthorization(scene, "privacy_center");
        await this.loadNotificationSettings();
        this.setData({ notificationSavingScene: "" });
        wx.showToast({
          title: authorizationResult === "accept" ? "已获得一次提醒额度" : "未获得订阅授权",
          icon: authorizationResult === "accept" ? "success" : "none",
        });
        return;
      }
      await updateNotificationPreference(scene, false);
      await this.loadNotificationSettings();
      this.setData({ notificationSavingScene: "" });
      wx.showToast({ title: "已关闭并清除未用额度", icon: "success" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "通知设置保存失败，请重试。";
      this.setData({ notificationSavingScene: "" });
      await this.loadNotificationSettings();
      this.setData({ notificationErrorMessage: message });
    }
  },

  openWechatNotificationSettings() { openWechatNotificationSettings(); },

  onConsentChange(event: { detail?: { value?: string[] } }) {
    this.setData({ consentChecked: Array.isArray(event.detail?.value) && event.detail!.value!.includes("agree") });
  },

  async confirmAgreements() {
    if (!this.data.consentChecked || this.data.saving) return;
    this.setData({ saving: true, errorMessage: "" });
    try {
      const status = await recordConsents(["privacy", "terms"], "settings");
      this.setData({
        saving: false,
        status,
        consentChecked: false,
        agreementsAccepted: Boolean(status.consents.privacy.agreed && status.consents.terms.agreed),
      });
      wx.showToast({ title: "同意记录已保存", icon: "success" });
    } catch (error) {
      this.setData({ saving: false, errorMessage: error instanceof Error ? error.message : "保存失败" });
    }
  },

  withdrawOptionalConsent() {
    if (!FEATURE_FLAGS.ENABLE_PHONE_BINDING || this.data.saving) return;
    wx.showModal({
      title: "撤回手机号处理同意？",
      content: "撤回后不会自动删除已绑定手机号。请先到“账号与安全”解除绑定，目标与行动功能不受影响。",
      cancelText: "取消",
      confirmText: "撤回同意",
      confirmColor: MODAL_CONFIRM_COLORS.danger,
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
