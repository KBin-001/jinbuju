import { endGoal, getActiveGoal, getActiveGoals, setCurrentGoal } from "../../services/manualGoal";
import { getProgressSummary } from "../../services/manualStats";
import { bindAccountPhone, bootstrapAccount, getAccountRuntime, updateCloudProfile, uploadProfileAvatar } from "../../services/account";
import { CloudAccount } from "../../types/account";
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
import { getAchievementCollection } from "../../services/achievement";
import { readManualStore } from "../../services/manualStore";
import { getTodayBusinessDate } from "../../utils/date";
import { AchievementProgress } from "../../types/achievement";

/** 前端主题换肤宏定义：与全局 FEATURE_FLAGS.ENABLE_THEME_SWITCHING 对齐 */
const THEME_SWITCHING_ENABLED = FEATURE_FLAGS.ENABLE_THEME_SWITCHING;
type ProfilePageStatus = "loading" | "ready" | "error";

function getProfileLayout(): { topInset: number; menuTop: number; menuHeight: number } {
  try {
    const windowInfo = wx.getWindowInfo();
    const menu = wx.getMenuButtonBoundingClientRect();
    return {
      topInset: windowInfo.statusBarHeight || 0,
      menuTop: Math.max(windowInfo.statusBarHeight || 0, menu.top || 0),
      menuHeight: menu.height || 32,
    };
  } catch (_) {
    return { topInset: 24, menuTop: 28, menuHeight: 32 };
  }
}

interface GoalCardView {
  id: string;
  title: string;
  days: number;
  progressPercent: number;
  isCurrent: boolean;
  suggestion: string;
  remainingActions: number;
  totalActions: number;
}

/** 成长概览统计 */
interface GrowthStats {
  streakDays: number;
  completedActions: number;
  totalMinutes: number;
}

interface WeeklyProfileSummary {
  actionDays: number;
  completedActions: number;
  actualMinutes: number;
}

interface AchievementPreview extends AchievementProgress {
  dateLabel: string;
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
  const today = getTodayBusinessDate();
  const todayTask = readManualStore().tasks.find((task) =>
    task.goalId === goal.id && task.currentDate === today &&
    (task.status === "pending" || task.status === "partially_completed"));
  return {
    id: goal.id,
    title: goal.title,
    days: Math.max(daysSince(goal.startedAt || goal.createdAt), summary.totalActionDays || 0),
    progressPercent: progressPercent(summary),
    isCurrent: goal.id === currentGoalId,
    suggestion: todayTask ? `今日建议 · ${todayTask.title}` : "今天先完成一小步",
    remainingActions: Math.max(0, summary.totalTasks - summary.completedTasks),
    totalActions: summary.totalTasks,
  };
}

function startOfCurrentWeek(): string {
  const today = new Date(`${getTodayBusinessDate()}T00:00:00`);
  const offset = (today.getDay() + 6) % 7;
  today.setDate(today.getDate() - offset);
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${today.getFullYear()}-${month}-${day}`;
}

function buildWeeklySummary(): WeeklyProfileSummary {
  const weekStart = startOfCurrentWeek();
  const today = getTodayBusinessDate();
  const tasks = readManualStore().tasks.filter((task) =>
    task.status !== "rescheduled" && task.currentDate >= weekStart && task.currentDate <= today);
  const active = tasks.filter((task) => task.status === "completed" || task.status === "partially_completed");
  return {
    actionDays: new Set(active.map((task) => task.currentDate)).size,
    completedActions: tasks.filter((task) => task.status === "completed").length,
    actualMinutes: tasks.reduce((sum, task) => sum + Math.max(0, task.actualMinutes || 0), 0),
  };
}

function buildAchievementPreviews(): AchievementPreview[] {
  const achievements = getAchievementCollection().achievements.slice().sort((a, b) => {
    if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
    if (a.unlocked && b.unlocked) return String(b.unlockedAt || "").localeCompare(String(a.unlockedAt || ""));
    return b.progressPercent - a.progressPercent;
  });
  return achievements.slice(0, 3).map((item) => ({
    ...item,
    dateLabel: item.unlockedAt ? item.unlockedAt.slice(0, 10).replace(/-/g, ".") : item.progressText,
  }));
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
    ...getProfileLayout(),
    goals: [] as GoalCardView[],
    activeGoalCount: 0,
    userProfile: null as UserDisplayProfile | null,
    cloudAccount: null as CloudAccount | null,
    accountLoading: true,
    phoneBinding: false,
    accountSheetVisible: false,
    status: "loading" as ProfilePageStatus,
    errorMessage: "",
    displayName: "行动伙伴",
    displayAvatarUrl: "",
    displayAvatarText: "",
    joinedDays: 1,
    stats: {
      streakDays: 0,
      completedActions: 0,
      totalMinutes: 0,
    } as GrowthStats,
    weeklySummary: { actionDays: 0, completedActions: 0, actualMinutes: 0 } as WeeklyProfileSummary,
    currentGoal: null as GoalCardView | null,
    achievementPreviews: [] as AchievementPreview[],
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
    if (this.data.status !== "ready") this.setData({ status: "loading", errorMessage: "" });
    bootstrapAccount().then(() => this.loadProfile()).catch((error) => {
      this.setData({
        accountLoading: false,
        status: "error",
        errorMessage: error instanceof Error ? error.message : "账号加载失败，请检查网络后重试。",
      });
    });
  },

  retry() {
    this.setData({ status: "loading", errorMessage: "" });
    bootstrapAccount(true).then(() => this.loadProfile()).catch((error) => {
      this.setData({
        status: "error",
        errorMessage: error instanceof Error ? error.message : "账号加载失败，请检查网络后重试。",
      });
    });
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
      const accountState = getAccountRuntime();
      const userProfile = accountState?.profile || null;
      const stats = buildGrowthStats(activeGoals);
      const store = readManualStore();
      const earliestGoalDate = store.goals.concat(store.archivedGoals as unknown as Goal[])
        .map((goal) => goal.createdAt).filter(Boolean).sort()[0];
      const joinedAt = accountState?.profile.joinedAt || earliestGoalDate;

      this.setData({
        goals,
        activeGoalCount: goals.length,
        endingGoalId: "",
        userProfile,
        cloudAccount: accountState?.account || null,
        accountLoading: false,
        status: "ready",
        errorMessage: "",
        displayName: userProfile?.nickname || "行动伙伴",
        displayAvatarUrl: userProfile?.avatarUrl || "",
        displayAvatarText: "",
        stats,
        weeklySummary: buildWeeklySummary(),
        currentGoal: goals.find((goal) => goal.isCurrent) || goals[0] || null,
        achievementPreviews: buildAchievementPreviews(),
        joinedDays: daysSince(joinedAt),
      });
    } catch (error) {
      this.setData({
        status: "error",
        errorMessage: error instanceof Error ? error.message : "个人数据读取失败，请稍后重试。",
      });
    }
  },

  openProfileEditor() {
    const userProfile = this.data.userProfile;
      const nickname = userProfile?.nickname || this.data.displayName || "行动伙伴";
    this.setData({
      profileEditorVisible: true,
      profileDraftNickname: nickname,
      profileDraftAvatarUrl: userProfile?.avatarUrl || "",
      profileDraftAvatarText: nickname ? nickname.slice(0, 1) : "行",
      profileDraftSource: userProfile?.profileSource || "custom",
      profileDraftUseInTeam: userProfile?.useProfileInTeam !== false,
    });
  },

  closeProfileEditor() {
    this.setData({ profileEditorVisible: false });
  },

  openAccountSheet() {
    this.setData({ accountSheetVisible: true });
  },

  closeAccountSheet() {
    this.setData({ accountSheetVisible: false });
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

  async saveProfileEditor() {
    try {
      let avatarUrl = this.data.profileDraftAvatarUrl;
      if (avatarUrl && !avatarUrl.startsWith("cloud://") && !avatarUrl.startsWith("https://")) {
        avatarUrl = await uploadProfileAvatar(avatarUrl);
      }
      const userProfile = await updateCloudProfile({
        nickname: this.data.profileDraftNickname || "行动伙伴",
        avatarUrl,
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

  async onGetPhoneNumber(event: { detail?: { code?: string } }) {
    const code = String(event.detail?.code || "");
    if (!code) {
      wx.showToast({ title: "未授权手机号", icon: "none" });
      return;
    }
    this.setData({ phoneBinding: true });
    try {
      const cloudAccount = await bindAccountPhone(code);
      this.setData({ cloudAccount });
      wx.showToast({ title: "手机号已绑定", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "手机号绑定失败", icon: "none" });
    } finally {
      this.setData({ phoneBinding: false });
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

  /** 管理目标 — 进入目标总览 */
  manageGoals() {
    wx.navigateTo({ url: "/pages/goal-manage/index" });
  },

  /** 查看全部统计 — 跳转到进度 Tab */
  viewAllStats() {
    wx.switchTab({ url: "/pages/plan/index" });
  },

  /** 工具箱入口 */
  openToolboxItem(event: { currentTarget: { dataset: { key?: string } } }) {
    const key = String(event.currentTarget.dataset.key || "");
    if (key === "profile") {
      this.openProfileEditor();
      return;
    }
    if (key === "backup") {
      this.openAccountSheet();
      return;
    }
    if (key === "settings") {
      wx.navigateTo({ url: "/pages/data-management/index" });
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
      wx.navigateTo({ url: "/pages/legal/privacy/index" });
      return;
    }
    if (key === "terms") {
      wx.navigateTo({ url: "/pages/legal/terms/index" });
      return;
    }
    if (key === "about") {
      wx.navigateTo({ url: "/pages/about/index" });
      return;
    }
    if (key === "ai") {
      wx.navigateTo({ url: "/pages/ai-coach/index?scope=overall" });
      return;
    }
  },

  openAchievementPreview(event: { currentTarget: { dataset: { id?: string } } }) {
    const id = String(event.currentTarget.dataset.id || "");
    if (!id) return;
    wx.navigateTo({ url: `/pages/achievements/index?achievementId=${encodeURIComponent(id)}` });
  },
});
