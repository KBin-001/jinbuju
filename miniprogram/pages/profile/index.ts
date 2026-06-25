import { getActiveGoals, getArchivedGoals } from "../../services/manualGoal";
import { getProgressSummary } from "../../services/manualStats";
import { getLocalUserProfile, saveLocalUserProfile } from "../../services/profile";
import { Goal, ProgressSummary } from "../../types/manual";
import { UserDisplayProfile, UserProfileSource } from "../../types/profile";

interface GoalCardView {
  id: string;
  title: string;
  days: number;
  progressPercent: number;
  isCurrent: boolean;
}

interface FunctionEntry {
  key: string;
  title: string;
  icon: string;
}

function shortDate(value?: string): string {
  return value ? value.slice(0, 10) : "";
}

function daysSince(value?: string): number {
  if (!value) return 1;
  const start = new Date(`${shortDate(value)}T00:00:00`).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (!Number.isFinite(start)) return 1;
  return Math.max(1, Math.floor((today - start) / (24 * 60 * 60 * 1000)) + 1);
}

function progressPercent(summary: ProgressSummary | null): number {
  if (!summary || summary.totalTasks <= 0) return 0;
  return Math.min(100, Math.round((summary.completedTasks / summary.totalTasks) * 100));
}

function toGoalCard(goal: Goal, currentGoalId: string): GoalCardView {
  const summary = getProgressSummary(goal.id);
  return {
    id: goal.id,
    title: goal.title,
    days: Math.max(daysSince(goal.startedAt || goal.createdAt), summary.totalActionDays || 0),
    progressPercent: progressPercent(summary),
    isCurrent: goal.id === currentGoalId,
  };
}

const FUNCTION_ENTRIES: FunctionEntry[] = [
  { key: "history", title: "历史数据", icon: "↺" },
  { key: "badges", title: "成就徽章", icon: "☆" },
  { key: "focus", title: "专注报告", icon: "▧" },
  { key: "settings", title: "数据设置", icon: "⚙" },
];

Page({
  data: {
    goals: [] as GoalCardView[],
    activeGoalCount: 0,
    userProfile: null as UserDisplayProfile | null,
    displayName: "阿岚",
    displayAvatarUrl: "",
    displayAvatarText: "岚",
    levelLabel: "Lv.2 自律新星",
    joinedDays: 1,
    functionEntries: FUNCTION_ENTRIES,
    profileEditorVisible: false,
    profileDraftNickname: "",
    profileDraftAvatarUrl: "",
    profileDraftAvatarText: "岚",
    profileDraftSource: "custom" as UserProfileSource,
    profileDraftUseInTeam: true,
  },

  onShow() {
    this.loadProfile();
  },

  loadProfile() {
    try {
      const activeGoals = getActiveGoals();
      const currentGoalId = activeGoals[0]?.id || "";
      const goals = activeGoals.map((goal) => toGoalCard(goal, currentGoalId));
      const userProfile = getLocalUserProfile();
      const firstGoal = activeGoals[activeGoals.length - 1];
      this.setData({
        goals,
        activeGoalCount: goals.length,
        userProfile,
        displayName: userProfile?.nickname || "阿岚",
        displayAvatarUrl: userProfile?.avatarUrl || "",
        displayAvatarText: userProfile?.nickname ? userProfile.nickname.slice(0, 1) : "岚",
        joinedDays: daysSince(userProfile?.updatedAt || firstGoal?.createdAt),
      });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "个人数据读取失败", icon: "none" });
    }
  },

  openProfileEditor() {
    const userProfile = this.data.userProfile;
    const nickname = userProfile?.nickname || this.data.displayName;
    this.setData({
      profileEditorVisible: true,
      profileDraftNickname: nickname,
      profileDraftAvatarUrl: userProfile?.avatarUrl || "",
      profileDraftAvatarText: nickname ? nickname.slice(0, 1) : "岚",
      profileDraftSource: userProfile?.profileSource || "custom",
      profileDraftUseInTeam: userProfile?.useProfileInTeam !== false,
    });
  },

  closeProfileEditor() {
    this.setData({ profileEditorVisible: false });
  },

  noop() {},

  onChooseAvatar(event: { detail: { avatarUrl?: string } }) {
    const avatarUrl = String(event.detail.avatarUrl || "");
    if (!avatarUrl) return;
    if (this.data.profileEditorVisible) {
      this.setData({ profileDraftAvatarUrl: avatarUrl, profileDraftSource: "wechat" });
      return;
    }

    try {
      const nickname = this.data.userProfile?.nickname || this.data.displayName;
      const userProfile = saveLocalUserProfile({
        nickname,
        avatarUrl,
        profileSource: "wechat",
        useProfileInTeam: this.data.userProfile?.useProfileInTeam !== false,
      });
      this.setData({
        userProfile,
        displayName: userProfile.nickname,
        displayAvatarUrl: userProfile.avatarUrl,
        displayAvatarText: userProfile.nickname.slice(0, 1) || "岚",
      });
      wx.showToast({ title: "头像已更新", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "头像保存失败", icon: "none" });
    }
  },

  inputProfileNickname(event: { detail: { value?: string } }) {
    const nickname = String(event.detail.value || "").slice(0, 16);
    this.setData({
      profileDraftNickname: nickname,
      profileDraftAvatarText: nickname ? nickname.slice(0, 1) : "岚",
    });
  },

  toggleProfileUseInTeam(event: { detail: { value?: boolean } }) {
    this.setData({ profileDraftUseInTeam: Boolean(event.detail.value) });
  },

  saveProfileEditor() {
    try {
      const userProfile = saveLocalUserProfile({
        nickname: this.data.profileDraftNickname || "阿岚",
        avatarUrl: this.data.profileDraftAvatarUrl,
        profileSource: this.data.profileDraftSource,
        useProfileInTeam: this.data.profileDraftUseInTeam,
      });
      this.setData({
        userProfile,
        displayName: userProfile.nickname,
        displayAvatarUrl: userProfile.avatarUrl,
        displayAvatarText: userProfile.nickname.slice(0, 1) || "岚",
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

  openGoal(event: { currentTarget: { dataset: { id?: string } } }) {
    const id = String(event.currentTarget.dataset.id || "");
    if (!id) return;
    wx.navigateTo({ url: `/pages/goal-detail/index?id=${id}` });
  },

  openFunction(event: { currentTarget: { dataset: { key?: string } } }) {
    const key = String(event.currentTarget.dataset.key || "");
    if (key === "settings") {
      wx.navigateTo({ url: "/pages/data-management/index" });
      return;
    }
    if (key === "history") {
      const archivedGoal = getArchivedGoals()[0];
      if (archivedGoal) wx.navigateTo({ url: `/pages/goal-review/index?id=${archivedGoal.id}` });
      else wx.showToast({ title: "暂无历史目标", icon: "none" });
      return;
    }
    if (key === "badges" || key === "focus") {
      wx.switchTab({ url: "/pages/plan/index" });
    }
  },
});
