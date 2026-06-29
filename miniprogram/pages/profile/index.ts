import { endGoal, getActiveGoal, getActiveGoals, getArchivedGoals, setCurrentGoal } from "../../services/manualGoal";
import { getProgressSummary } from "../../services/manualStats";
import { getLocalUserProfile, saveLocalUserProfile } from "../../services/profile";
import {
  getCurrentTheme,
  getCurrentThemeId,
  themeToProfileCssVars,
  DEFAULT_THEME_ID,
} from "../../services/theme";
// === 主题换肤宏定义（前端）===
// ENABLE_THEME_SWITCHING 为 false 时，下方换肤相关代码已被注释屏蔽。
// 启用方式：将 features.ts 中 ENABLE_THEME_SWITCHING 改为 true，
//           并取消本文件及 index.wxml 中「主题换肤」相关注释即可恢复。
import { FEATURE_FLAGS } from "../../config/features";
import { Goal, ProgressSummary } from "../../types/manual";
import { UserDisplayProfile, UserProfileSource } from "../../types/profile";

/** 前端主题换肤宏定义：与全局 FEATURE_FLAGS.ENABLE_THEME_SWITCHING 对齐 */
const THEME_SWITCHING_ENABLED = FEATURE_FLAGS.ENABLE_THEME_SWITCHING;

interface GoalCardView {
  id: string;
  title: string;
  days: number;
  progressPercent: number;
  isCurrent: boolean;
}

/** 成长概览统计 */
interface GrowthStats {
  streakDays: number;
  completedActions: number;
  totalMinutes: number;
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

/** 聚合所有 active 目标的统计数据 */
function buildGrowthStats(goals: Goal[]): GrowthStats {
  let maxStreak = 0;
  let completedActions = 0;
  let totalMinutes = 0;

  for (const goal of goals) {
    const summary = getProgressSummary(goal.id);
    if ((summary.currentStreakDays || 0) > maxStreak) {
      maxStreak = summary.currentStreakDays || 0;
    }
    completedActions += summary.completedTasks || 0;
    totalMinutes += summary.totalActualMinutes || 0;
  }

  return {
    streakDays: maxStreak,
    completedActions,
    totalMinutes,
  };
}

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
    stats: {
      streakDays: 0,
      completedActions: 0,
      totalMinutes: 0,
    } as GrowthStats,
    profileEditorVisible: false,
    profileDraftNickname: "",
    profileDraftAvatarUrl: "",
    profileDraftAvatarText: "岚",
    profileDraftSource: "custom" as UserProfileSource,
    profileDraftUseInTeam: true,
    endingGoalId: "",
    enableThemeSwitching: THEME_SWITCHING_ENABLED,
    currentThemeId: getCurrentThemeId() as string,
    previewThemeId: getCurrentThemeId() as string,
    themeStyle: themeToProfileCssVars(getCurrentTheme()),
  },

  onShow() {
    this.applyThemeFromStorage();
    this.loadProfile();
  },

  /** 从本地 storage 读取当前主题并应用到根节点 */
  applyThemeFromStorage() {
    const theme = getCurrentTheme();
    this.setData({
      currentThemeId: theme.id,
      previewThemeId: theme.id,
      themeStyle: themeToProfileCssVars(theme),
    });
  },

  loadProfile() {
    try {
      const activeGoals = getActiveGoals();
      const currentGoalId = getActiveGoal()?.id || activeGoals[0]?.id || "";
      const goals = activeGoals.map((goal) => toGoalCard(goal, currentGoalId));
      const userProfile = getLocalUserProfile();
      const firstGoal = activeGoals[activeGoals.length - 1];
      const stats = buildGrowthStats(activeGoals);

      this.setData({
        goals,
        activeGoalCount: goals.length,
        endingGoalId: "",
        userProfile,
        displayName: userProfile?.nickname || "阿岚",
        displayAvatarUrl: userProfile?.avatarUrl || "",
        displayAvatarText: userProfile?.nickname ? userProfile.nickname.slice(0, 1) : "岚",
        joinedDays: daysSince(userProfile?.updatedAt || firstGoal?.createdAt),
        stats,
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
    try {
      setCurrentGoal(id);
      wx.switchTab({ url: "/pages/plan/index" });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "目标切换失败", icon: "none" });
    }
  },

  /** 查看成长档案 — 跳转到进度 Tab */
  viewGoalArchive(event: { currentTarget: { dataset: { id?: string } } }) {
    const id = String(event.currentTarget.dataset.id || "");
    if (!id) return;
    try {
      setCurrentGoal(id);
      wx.switchTab({ url: "/pages/plan/index" });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "跳转失败", icon: "none" });
    }
  },

  endCurrentGoal(event: { currentTarget: { dataset: { id?: string } } }) {
    const id = String(event.currentTarget.dataset.id || "");
    const goal = this.data.goals.find((item) => item.id === id && item.isCurrent);
    if (!goal || this.data.endingGoalId) return;
    wx.showModal({
      title: "结束当前目标？",
      content: "结束后会保存到历史目标，行动记录和复盘数据都会保留。",
      cancelText: "取消",
      confirmText: "确认结束",
      confirmColor: "#3F8F72",
      success: (result) => {
        if (!result.confirm) return;
        this.setData({ endingGoalId: id });
        try {
          const archivedGoal = endGoal(id);
          wx.showToast({ title: "目标已保存到历史", icon: "success" });
          this.loadProfile();
          setTimeout(() => wx.navigateTo({ url: `/pages/goal-review/index?id=${archivedGoal.id}` }), 300);
        } catch (error) {
          wx.showToast({ title: error instanceof Error ? error.message : "结束失败", icon: "none" });
          this.setData({ endingGoalId: "" });
        }
      },
    });
  },

  /** 管理目标 — 跳转到目标创建 */
  manageGoals() {
    wx.navigateTo({ url: "/pages/goal-create/index" });
  },

  /** 查看全部统计 — 跳转到进度 Tab */
  viewAllStats() {
    wx.switchTab({ url: "/pages/plan/index" });
  },

  /** 工具箱入口 */
  openToolboxItem(event: { currentTarget: { dataset: { key?: string } } }) {
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
    if (key === "badges") {
      wx.showToast({ title: "成就系统开发中", icon: "none" });
      return;
    }
    if (key === "ai") {
      wx.showToast({ title: "AI 教练开发中", icon: "none" });
      return;
    }
  },
});
