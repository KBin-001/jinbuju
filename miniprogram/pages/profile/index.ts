import { getActiveGoal, getActiveGoals } from "../../services/manualGoal";
import { getProgressSummary } from "../../services/manualStats";
import { bootstrapAccount, getAccountRuntime, updateCloudProfile, uploadProfileAvatar } from "../../services/account";
import { getCurrentThemeId } from "../../services/theme";
import { Goal } from "../../types/manual";
import { UserDisplayProfile, UserProfileSource } from "../../types/profile";
import { getAchievementCollection } from "../../services/achievement";
import { readManualStore } from "../../services/manualStore";
import { buildProfileGrowthSummary, ProfileGrowthSummary } from "../../services/profileGrowth";
import { getCommunityEntry, resolveCommunityQrUrl } from "../../services/profile";
import { getSyncRuntime, SyncRuntimeState } from "../../services/syncStatus";
import { off, on } from "../../utils/eventBus";
import { getTabHeaderLayout } from "../../utils/tabHeader";
import { requirePlatformPrivacyAuthorization } from "../../services/platformPrivacy";
import { FEATURE_FLAGS } from "../../config/features";

type ProfilePageStatus = "loading" | "ready" | "error";
type CommunitySheetStatus = "loading" | "preparing" | "ready" | "expired" | "error";

interface GoalCardView {
  id: string;
  title: string;
  isCurrent: boolean;
  continuityText: string;
}

function syncTimeLabel(value?: string): string {
  if (!value) return "等待首次同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "同步时间待刷新";
  const now = new Date();
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return date.toDateString() === now.toDateString()
    ? `今天 ${time}`
    : `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

function toGoalCard(goal: Goal, currentGoalId: string): GoalCardView {
  const summary = getProgressSummary(goal.id);
  return {
    id: goal.id,
    title: goal.title,
    isCurrent: goal.id === currentGoalId,
    continuityText: summary.currentStreakDays > 0
      ? `已连续行动 ${summary.currentStreakDays} 天`
      : "当前连续行动 0 天",
  };
}

function syncPresentation(sync: SyncRuntimeState, usingAccountCache: boolean) {
  const usingCache = usingAccountCache || sync.usingCache || sync.phase === "cached" || sync.phase === "failed" || sync.phase === "offline";
  if (usingCache) {
    return {
      syncTone: "warning",
      syncTitle: sync.phase === "failed" ? "同步未完成" : "当前使用缓存",
      showSyncNotice: true,
      syncNoticeText: sync.phase === "failed"
        ? "这次同步没有完成，当前仍展示本机和上次同步记录。"
        : "当前展示本机和上次同步记录，联网后可重新同步。",
    };
  }
  if (sync.phase === "syncing") {
    return { syncTone: "neutral", syncTitle: "正在同步", showSyncNotice: false, syncNoticeText: "" };
  }
  if (sync.phase === "synced") {
    return { syncTone: "success", syncTitle: "云端已同步", showSyncNotice: false, syncNoticeText: "" };
  }
  return { syncTone: "neutral", syncTitle: "等待首次同步", showSyncNotice: false, syncNoticeText: "" };
}

function isCommunityEntryExpired(expiresAt?: string): boolean {
  if (!expiresAt) return false;
  const expiresAtTime = new Date(expiresAt).getTime();
  return Number.isFinite(expiresAtTime) && expiresAtTime <= Date.now();
}

Page({
  data: {
    ...getTabHeaderLayout(),
    activeGoalCount: 0,
    userProfile: null as UserDisplayProfile | null,
    accountAvailable: false,
    profileSaving: false,
    status: "loading" as ProfilePageStatus,
    errorMessage: "",
    displayName: "行动伙伴",
    displayAvatarUrl: "",
    displayId: "",
    phoneBindingEnabled: FEATURE_FLAGS.ENABLE_PHONE_BINDING,
    phoneStatusText: "待联网",
    syncTone: "neutral",
    syncTitle: "等待首次同步",
    syncLabel: "等待首次同步",
    showSyncNotice: false,
    syncNoticeText: "",
    growth: {
      currentStreakDays: 0,
      completedActions: 0,
      totalMinutes: 0,
    } as ProfileGrowthSummary,
    currentGoal: null as GoalCardView | null,
    achievementSummary: "0 / 18",
    profileEditorVisible: false,
    platformPrivacyAuthorized: false,
    profileDraftNickname: "",
    profileDraftAvatarUrl: "",
    profileDraftSource: "custom" as UserProfileSource,
    profileDraftUseInTeam: true,
    customerServiceVisible: false,
    currentThemeId: getCurrentThemeId() as string,
    communitySheetVisible: false,
    communitySheetStatus: "loading" as CommunitySheetStatus,
    communityBusy: false,
    communityTitle: "成长社区",
    communityDescription: "找到同频伙伴，一起持续行动",
    communityQrUrl: "",
    communityErrorMessage: "",
  },

  syncStateHandler: null as null | ((state?: SyncRuntimeState) => void),
  communityRequestSerial: 0,
  communityRequestActive: false,

  onLoad() {
    this.syncStateHandler = () => this.refreshSyncPresentation();
    on("sync:state", this.syncStateHandler);
  },

  onUnload() {
    if (this.syncStateHandler) off("sync:state", this.syncStateHandler);
    this.syncStateHandler = null;
    this.communityRequestSerial += 1;
    this.communityRequestActive = false;
  },

  onShow() {
    (this as any).getTabBar?.()?.syncSelected?.();
    this.applyThemeFromStorage();
    this.loadProfile();
    bootstrapAccount().then(() => this.loadProfile()).catch((error) => {
      this.loadProfile(error);
    });
  },

  onPullDownRefresh() {
    bootstrapAccount(true).then(() => this.loadProfile()).catch((error) => {
      this.loadProfile(error);
      wx.showToast({ title: error instanceof Error ? error.message : "刷新失败", icon: "none" });
    }).then(() => wx.stopPullDownRefresh(), () => wx.stopPullDownRefresh());
  },

  retry() {
    this.setData({ syncTitle: "正在同步" });
    bootstrapAccount(true).then(() => this.loadProfile()).catch((error) => {
      this.loadProfile(error);
      wx.showToast({ title: error instanceof Error ? error.message : "同步失败", icon: "none" });
    });
  },

  applyThemeFromStorage() {
    this.setData({ currentThemeId: getCurrentThemeId() });
  },

  refreshSyncPresentation() {
    const accountState = getAccountRuntime();
    const sync = getSyncRuntime();
    const presentation = syncPresentation(sync, accountState?.source === "cache");
    this.setData({
      ...presentation,
      syncLabel: syncTimeLabel(accountState?.sync.lastSuccessfulAt || sync.lastSuccessfulAt),
    });
  },

  loadProfile(accountError?: unknown) {
    try {
      const activeGoals = getActiveGoals();
      const currentGoalId = getActiveGoal()?.id || activeGoals[0]?.id || "";
      const goals = activeGoals.map((goal) => toGoalCard(goal, currentGoalId));
      const accountState = getAccountRuntime();
      const userProfile = accountState?.profile || null;
      const store = readManualStore();
      const growth = buildProfileGrowthSummary(store);
      const achievementCollection = getAchievementCollection();
      const sync = getSyncRuntime();
      const presentation = syncPresentation(sync, accountState?.source === "cache");
      const currentGoal = goals.find((goal) => goal.isCurrent) || goals[0] || null;
      const accountUnavailable = !accountState && Boolean(accountError);

      this.setData({
        activeGoalCount: goals.length,
        userProfile,
        accountAvailable: Boolean(accountState),
        status: "ready",
        errorMessage: "",
        displayName: userProfile?.nickname || "行动伙伴",
        displayAvatarUrl: userProfile?.avatarUrl || "",
        displayId: accountState?.account.displayId || "",
        phoneStatusText: FEATURE_FLAGS.ENABLE_PHONE_BINDING && accountState
          ? (accountState.account.phoneBound ? "已绑定" : "未绑定")
          : "",
        ...presentation,
        showSyncNotice: accountUnavailable || presentation.showSyncNotice,
        syncNoticeText: accountUnavailable
          ? "暂时无法连接账号，当前仍可查看本机目标和成长记录。"
          : presentation.syncNoticeText,
        syncLabel: syncTimeLabel(accountState?.sync.lastSuccessfulAt || sync.lastSuccessfulAt),
        growth,
        currentGoal,
        achievementSummary: `${achievementCollection.unlockedCount} / ${achievementCollection.totalCount}`,
      });
    } catch (error) {
      this.setData({
        status: "error",
        errorMessage: error instanceof Error ? error.message : "个人数据读取失败，请稍后重试。",
      });
    }
  },

  openProfileEditor() {
    if (!this.data.accountAvailable) {
      wx.showToast({ title: "联网后可编辑资料", icon: "none" });
      return;
    }
    const userProfile = this.data.userProfile;
    const nickname = userProfile?.nickname || this.data.displayName || "行动伙伴";
    this.setData({
      profileEditorVisible: true,
      profileDraftNickname: nickname,
      profileDraftAvatarUrl: userProfile?.avatarUrl || "",
      profileDraftSource: userProfile?.profileSource || "custom",
      profileDraftUseInTeam: userProfile?.useProfileInTeam !== false,
    });
  },

  async authorizePlatformPrivacy() {
    try {
      await requirePlatformPrivacyAuthorization();
      this.setData({ platformPrivacyAuthorized: true });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "请先完成隐私授权", icon: "none" });
    }
  },

  closeProfileEditor() {
    this.setData({ profileEditorVisible: false });
  },

  noop() {},

  useDefaultAvatar() {
    this.setData({ displayAvatarUrl: "" });
  },

  useDefaultDraftAvatar() {
    this.setData({ profileDraftAvatarUrl: "" });
  },

  async onChooseAvatar(event: { detail: { avatarUrl?: string } }) {
    const avatarUrl = String(event.detail.avatarUrl || "");
    if (!avatarUrl) return;
    if (!this.data.platformPrivacyAuthorized) return;
    if (this.data.profileEditorVisible) {
      this.setData({ profileDraftAvatarUrl: avatarUrl, profileDraftSource: "wechat" });
      return;
    }

    try {
      const nickname = this.data.userProfile?.nickname || this.data.displayName;
      const cloudAvatarUrl = await uploadProfileAvatar(avatarUrl);
      const userProfile = await updateCloudProfile({
        nickname,
        avatarUrl: cloudAvatarUrl,
        profileSource: "wechat",
        useProfileInTeam: this.data.userProfile?.useProfileInTeam !== false,
      });
      this.setData({
        userProfile,
        displayName: userProfile.nickname,
        displayAvatarUrl: userProfile.avatarUrl,
      });
      wx.showToast({ title: "头像已更新", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "头像保存失败", icon: "none" });
    }
  },

  inputProfileNickname(event: { detail: { value?: string } }) {
    const nickname = String(event.detail.value || "").slice(0, 16);
    this.setData({ profileDraftNickname: nickname });
  },

  toggleProfileUseInTeam(event: { detail: { value?: boolean } }) {
    this.setData({ profileDraftUseInTeam: Boolean(event.detail.value) });
  },

  async saveProfileEditor() {
    if (this.data.profileSaving) return;
    const nickname = this.data.profileDraftNickname.trim();
    if (!nickname) {
      wx.showToast({ title: "请输入展示名称", icon: "none" });
      return;
    }
    this.setData({ profileSaving: true });
    try {
      let avatarUrl = this.data.profileDraftAvatarUrl;
      if (avatarUrl && !avatarUrl.startsWith("cloud://") && !avatarUrl.startsWith("https://")) {
        avatarUrl = await uploadProfileAvatar(avatarUrl);
      }
      const userProfile = await updateCloudProfile({
        nickname,
        avatarUrl,
        profileSource: this.data.profileDraftSource,
        useProfileInTeam: this.data.profileDraftUseInTeam,
      });
      this.setData({
        userProfile,
        displayName: userProfile.nickname,
        displayAvatarUrl: userProfile.avatarUrl,
        profileEditorVisible: false,
        profileSaving: false,
      });
      wx.showToast({ title: "资料已保存", icon: "success" });
    } catch (error) {
      this.setData({ profileSaving: false });
      wx.showToast({ title: error instanceof Error ? error.message : "保存失败", icon: "none" });
    }
  },

  createGoal() {
    wx.navigateTo({ url: "/pages/goal-create/index" });
  },

  /** 管理目标 — 进入目标总览 */
  manageGoals() {
    wx.navigateTo({ url: "/pages/goal-manage/index" });
  },

  /** 查看完整成长记录 */
  viewAllStats() {
    wx.navigateTo({ url: "/pages/growth-records/index?from=profile" });
  },

  openGrowthCommunity() {
    if (this.data.communitySheetVisible) return;
    this.setData({
      communitySheetVisible: true,
      communitySheetStatus: "loading",
      communityBusy: false,
      communityTitle: "成长社区",
      communityDescription: "找到同频伙伴，一起持续行动",
      communityQrUrl: "",
      communityErrorMessage: "",
    }, () => this.loadGrowthCommunity());
  },

  closeGrowthCommunity() {
    this.communityRequestSerial += 1;
    this.communityRequestActive = false;
    this.setData({ communitySheetVisible: false, communityBusy: false });
  },

  async loadGrowthCommunity() {
    if (this.communityRequestActive) return;
    this.communityRequestActive = true;
    const requestSerial = ++this.communityRequestSerial;
    this.setData({
      communitySheetStatus: "loading",
      communityBusy: true,
      communityQrUrl: "",
      communityErrorMessage: "",
    });
    try {
      const entry = await getCommunityEntry();
      if (requestSerial !== this.communityRequestSerial || !this.data.communitySheetVisible) return;
      const communityTitle = entry.title.trim() || "成长社区";
      const communityDescription = entry.description.trim() || "找到同频伙伴，一起持续行动";
      if (entry.status === "expired" || isCommunityEntryExpired(entry.expiresAt)) {
        this.communityRequestActive = false;
        this.setData({
          communitySheetStatus: "expired",
          communityBusy: false,
          communityTitle,
          communityDescription,
          communityQrUrl: "",
        });
        return;
      }
      if (entry.status === "preparing" || !entry.imageFileId) {
        this.communityRequestActive = false;
        this.setData({
          communitySheetStatus: "preparing",
          communityBusy: false,
          communityTitle,
          communityDescription,
          communityQrUrl: "",
        });
        return;
      }
      this.setData({ communitySheetStatus: "preparing", communityTitle, communityDescription });
      const communityQrUrl = await resolveCommunityQrUrl(entry.imageFileId);
      if (requestSerial !== this.communityRequestSerial || !this.data.communitySheetVisible) return;
      if (!communityQrUrl) throw new Error("社区二维码暂时无法打开，请稍后重试。");
      this.communityRequestActive = false;
      this.setData({ communitySheetStatus: "ready", communityBusy: false, communityQrUrl });
    } catch (error) {
      if (requestSerial !== this.communityRequestSerial || !this.data.communitySheetVisible) return;
      this.communityRequestActive = false;
      this.setData({
        communitySheetStatus: "error",
        communityBusy: false,
        communityQrUrl: "",
        communityErrorMessage: error instanceof Error ? error.message : "社区入口暂时无法读取，请稍后重试。",
      });
    }
  },

  retryGrowthCommunity() {
    if (this.communityRequestActive) return;
    this.loadGrowthCommunity();
  },

  previewGrowthCommunityQr() {
    if (this.data.communitySheetStatus !== "ready" || !this.data.communityQrUrl) return;
    wx.previewImage({
      current: this.data.communityQrUrl,
      urls: [this.data.communityQrUrl],
      showmenu: true,
      fail: () => {
        wx.showToast({ title: "二维码预览失败，请稍后重试", icon: "none" });
      },
    });
  },

  handleGrowthCommunityQrError() {
    if (this.data.communitySheetStatus !== "ready") return;
    this.setData({
      communitySheetStatus: "error",
      communityQrUrl: "",
      communityErrorMessage: "社区二维码加载失败，请检查网络后重试。",
    });
  },

  openCustomerService() {
    this.setData({ customerServiceVisible: true });
  },

  closeCustomerService() {
    this.setData({ customerServiceVisible: false });
  },

  previewCustomerServiceQr() {
    const qrUrl = "/assets/customer-service-qr.jpg";
    wx.previewImage({
      current: qrUrl,
      urls: [qrUrl],
      showmenu: true,
      fail: () => wx.showToast({ title: "客服二维码预览失败，请稍后重试", icon: "none" }),
    });
  },

  /** 工具箱入口 */
  openToolboxItem(event: { currentTarget: { dataset: { key?: string } } }) {
    const key = String(event.currentTarget.dataset.key || "");
    if (key === "sync") {
      wx.navigateTo({ url: "/pages/data-sync/index" });
      return;
    }
    if (key === "history") {
      wx.navigateTo({ url: "/pages/history/index" });
      return;
    }
    if (key === "badges") {
      wx.navigateTo({ url: "/pages/achievements/index" });
      return;
    }
    if (key === "goals") {
      wx.navigateTo({ url: "/pages/goal-manage/index" });
      return;
    }
    if (key === "privacy") {
      wx.navigateTo({ url: "/pages/privacy-center/index" });
      return;
    }
    if (key === "about") {
      wx.navigateTo({ url: "/pages/about/index" });
      return;
    }
    if (key === "account") {
      wx.navigateTo({ url: "/pages/account-security/index" });
      return;
    }
  },
});
