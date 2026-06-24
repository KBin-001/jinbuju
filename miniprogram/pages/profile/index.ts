import { FEATURE_FLAGS } from "../../config/features";
import { endActiveGoal, getActiveGoal, getArchivedGoals } from "../../services/manualGoal";
import { getProgressSummary } from "../../services/manualStats";
import { getLocalUserProfile, saveLocalUserProfile } from "../../services/profile";
import { ActionTask, ArchivedGoal, Goal, ProgressSummary } from "../../types/manual";
import { UserDisplayProfile, UserProfileSource } from "../../types/profile";

interface ViewAction extends ActionTask {
  statusLabel: string;
  statusTone: "done" | "todo";
  createdDate: string;
  completedDate: string;
  actualMinutesText: string;
}

interface ViewArchivedGoal extends ArchivedGoal {
  dateRange: string;
  statusLabel: string;
  actions: ViewAction[];
}

function shortDate(value?: string): string {
  return value ? value.slice(0, 10) : "";
}

function getGoalDateRange(goal: ArchivedGoal): string {
  const start = shortDate(goal.startedAt || goal.createdAt);
  const end = shortDate(goal.endedAt || goal.archivedAt);
  return start && end ? `${start} ~ ${end}` : start || end || "未记录";
}

function getStatusLabel(status: ArchivedGoal["status"]): string {
  if (status === "completed") return "已完成";
  if (status === "ended") return "已结束";
  return "已归档";
}

function toViewAction(action: ActionTask): ViewAction {
  const isDone = action.status === "completed";
  return {
    ...action,
    statusLabel: isDone ? "已完成" : "未完成",
    statusTone: isDone ? "done" : "todo",
    createdDate: shortDate(action.createdAt),
    completedDate: shortDate(action.completedAt),
    actualMinutesText: action.actualMinutes === undefined ? "-" : `${action.actualMinutes} 分钟`,
  };
}

function toViewArchivedGoal(goal: ArchivedGoal): ViewArchivedGoal {
  return {
    ...goal,
    dateRange: getGoalDateRange(goal),
    statusLabel: getStatusLabel(goal.status),
    actions: goal.actions
      .filter((action) => action.status !== "rescheduled")
      .map(toViewAction)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}

Page({
  data: {
    goal: null as Goal | null,
    goalCreatedDate: "",
    summary: null as ProgressSummary | null,
    archivedGoals: [] as ViewArchivedGoal[],
    historyCount: 0,
    historyVisible: false,
    historyDetailVisible: false,
    selectedArchivedGoal: null as ViewArchivedGoal | null,
    historyEmptyTitle: "暂无历史目标",
    historyEmptyDescription: "创建并完成一个目标后，这里会展示你的目标复盘。",
    hasGrowthData: false,
    lifecycleSubmitting: false,
    teamEnabled: FEATURE_FLAGS.ENABLE_TEAM,
    userProfile: null as UserDisplayProfile | null,
    displayName: "未设置展示名称",
    displayAvatarUrl: "",
    displayAvatarText: "进",
    profileEditorVisible: false,
    profileDraftNickname: "",
    profileDraftAvatarUrl: "",
    profileDraftAvatarText: "进",
    profileDraftSource: "custom" as UserProfileSource,
    profileDraftUseInTeam: true,
  },

  onShow() {
    this.loadProfile();
  },

  loadProfile() {
    try {
      const goal = getActiveGoal();
      const archivedGoals = getArchivedGoals().map(toViewArchivedGoal);
      const summary = goal ? getProgressSummary(goal.id) : null;
      const userProfile = getLocalUserProfile();
      this.setData({
        goal,
        goalCreatedDate: goal ? shortDate(goal.createdAt) : "",
        summary,
        archivedGoals,
        historyCount: archivedGoals.length,
        hasGrowthData: Boolean(summary && (summary.totalActionDays > 0 || summary.completedTasks > 0 || summary.totalActualMinutes > 0)),
        userProfile,
        displayName: userProfile?.nickname || "未设置展示名称",
        displayAvatarUrl: userProfile?.avatarUrl || "",
        displayAvatarText: userProfile?.nickname ? userProfile.nickname.slice(0, 1) : "进",
        historyEmptyDescription: goal
          ? "当前目标仍在进行中。结束或更换目标后，它会保存到这里用于复盘。"
          : "创建并完成一个目标后，这里会展示你的目标复盘。",
        lifecycleSubmitting: false,
      });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "个人数据读取失败", icon: "none" });
      this.setData({ lifecycleSubmitting: false });
    }
  },

  openProfileEditor() {
    const userProfile = this.data.userProfile;
    this.setData({
      profileEditorVisible: true,
      profileDraftNickname: userProfile?.nickname || "",
      profileDraftAvatarUrl: userProfile?.avatarUrl || "",
      profileDraftAvatarText: userProfile?.nickname ? userProfile.nickname.slice(0, 1) : "进",
      profileDraftSource: userProfile?.profileSource || "custom",
      profileDraftUseInTeam: userProfile?.useProfileInTeam !== false,
    });
  },

  closeProfileEditor() {
    this.setData({ profileEditorVisible: false });
  },

  onChooseAvatar(event: { detail: { avatarUrl?: string } }) {
    const avatarUrl = String(event.detail.avatarUrl || "");
    if (!avatarUrl) return;
    this.setData({ profileDraftAvatarUrl: avatarUrl, profileDraftSource: "wechat" });
  },

  inputProfileNickname(event: { detail: { value?: string } }) {
    const nickname = String(event.detail.value || "").slice(0, 16);
    this.setData({
      profileDraftNickname: nickname,
      profileDraftAvatarText: nickname ? nickname.slice(0, 1) : "进",
    });
  },

  toggleProfileUseInTeam(event: { detail: { value?: boolean } }) {
    this.setData({ profileDraftUseInTeam: Boolean(event.detail.value) });
  },

  saveProfileEditor() {
    try {
      const userProfile = saveLocalUserProfile({
        nickname: this.data.profileDraftNickname,
        avatarUrl: this.data.profileDraftAvatarUrl,
        profileSource: this.data.profileDraftSource,
        useProfileInTeam: this.data.profileDraftUseInTeam,
      });
      this.setData({
        userProfile,
        displayName: userProfile.nickname,
        displayAvatarUrl: userProfile.avatarUrl,
        displayAvatarText: userProfile.nickname.slice(0, 1) || "进",
        profileEditorVisible: false,
      });
      wx.showToast({ title: "资料已保存", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "保存失败", icon: "none" });
    }
  },

  createGoal() {
    wx.navigateTo({ url: "/pages/goal-create/index" });
  },

  goProgress() {
    wx.switchTab({ url: "/pages/plan/index" });
  },

  openDataSettings() {
    wx.navigateTo({ url: "/pages/data-management/index" });
  },

  showHistory() {
    this.setData({ historyVisible: true, historyDetailVisible: false, selectedArchivedGoal: null });
  },

  closeHistory() {
    this.setData({ historyVisible: false, historyDetailVisible: false, selectedArchivedGoal: null });
  },

  noop() {},

  openArchivedGoal(event: { currentTarget: { dataset: { id?: string } } }) {
    const id = String(event.currentTarget.dataset.id || "");
    const selectedArchivedGoal = this.data.archivedGoals.find((goal) => goal.id === id) || null;
    if (!selectedArchivedGoal) return;
    this.setData({ selectedArchivedGoal, historyDetailVisible: true });
  },

  backToHistoryList() {
    this.setData({ historyDetailVisible: false, selectedArchivedGoal: null });
  },

  endCurrentGoal() {
    if (this.data.lifecycleSubmitting || !this.data.goal) return;
    wx.showModal({
      title: "结束当前目标？",
      content: "结束后，该目标会保存到历史目标中，你可以在历史目标里查看行动记录和复盘数据。",
      cancelText: "取消",
      confirmText: "确认结束",
      confirmColor: "#356859",
      success: (result) => {
        if (!result.confirm) return;
        this.setData({ lifecycleSubmitting: true });
        try {
          endActiveGoal();
          wx.showToast({ title: "目标已保存到历史", icon: "success" });
          this.loadProfile();
        } catch (error) {
          wx.showToast({ title: error instanceof Error ? error.message : "结束目标失败", icon: "none" });
          this.setData({ lifecycleSubmitting: false });
        }
      },
    });
  },

  replaceCurrentGoal() {
    if (this.data.lifecycleSubmitting || !this.data.goal) return;
    wx.showModal({
      title: "更换目标？",
      content: "更换目标会结束当前目标，并将它保存到历史目标中，之后你可以创建新的当前目标。",
      cancelText: "取消",
      confirmText: "确认更换",
      confirmColor: "#356859",
      success: (result) => {
        if (!result.confirm) return;
        this.setData({ lifecycleSubmitting: true });
        try {
          endActiveGoal();
          wx.showToast({ title: "旧目标已归档", icon: "success" });
          this.loadProfile();
          setTimeout(() => wx.navigateTo({ url: "/pages/goal-create/index" }), 300);
        } catch (error) {
          wx.showToast({ title: error instanceof Error ? error.message : "更换目标失败", icon: "none" });
          this.setData({ lifecycleSubmitting: false });
        }
      },
    });
  },

  openPrivacy() {
    wx.navigateTo({ url: "/pages/legal/privacy/index" });
  },

  openTerms() {
    wx.navigateTo({ url: "/pages/legal/terms/index" });
  },

  openAbout() {
    wx.navigateTo({ url: "/pages/about/index" });
  },
});
