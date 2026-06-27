import { endGoal, getActiveGoal, getActiveGoals, getArchivedGoals, setCurrentGoal } from "../../services/manualGoal";
import { getProgressSummary } from "../../services/manualStats";
import { getLocalUserProfile, saveLocalUserProfile } from "../../services/profile";
import {
  getCurrentTheme,
  getCurrentThemeId,
  getThemeById,
  setCurrentTheme,
  themeToProfileCssVars,
  THEME_PRESETS,
  DEFAULT_THEME_ID,
  ThemeId,
  ThemePreset,
} from "../../services/theme";
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
  emoji: string;
  iconClass: string;
}

interface ThemeCardView {
  id: ThemeId;
  name: string;
  desc: string;
  primary: string;
  primaryDeep: string;
  primaryLight: string;
  primarySoft: string;
  accent: string;
  bg: string;
  heroGradient: string;
  progressGradient: string;
  tags: string[];
  swatches: string[];
}

/** 成长概览统计 */
interface GrowthStats {
  streakDays: number;
  completedActions: number;
  totalMinutes: number;
}

/** 本周小结 */
interface WeekSummary {
  beatPercent: number;
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

const FUNCTION_ENTRIES: FunctionEntry[] = [
  { key: "history", title: "历史数据", emoji: "📊", iconClass: "func-icon-wrap--history" },
  { key: "badges",  title: "成就徽章", emoji: "🏆", iconClass: "func-icon-wrap--badges" },
  { key: "ai",      title: "AI 教练", emoji: "✦", iconClass: "func-icon-wrap--ai" },
  { key: "theme",   title: "主题皮肤", emoji: "🎨", iconClass: "func-icon-wrap--theme" },
  { key: "settings",title: "数据设置", emoji: "⚙️", iconClass: "func-icon-wrap--settings" },
];

function toThemeCard(theme: ThemePreset): ThemeCardView {
  return {
    id: theme.id,
    name: theme.name,
    desc: theme.desc,
    primary: theme.primary,
    primaryDeep: theme.primaryDeep,
    primaryLight: theme.primaryLight,
    primarySoft: theme.primarySoft,
    accent: theme.accent,
    bg: theme.bg,
    heroGradient: theme.heroGradient,
    progressGradient: theme.progressGradient,
    tags: theme.tags,
    swatches: [theme.primary, theme.primaryLight, theme.accent, theme.primaryDeep],
  };
}

/** 主题弹窗筛选标签 */
const THEME_FILTERS: string[] = ["全部", "柔和", "沉稳", "清新", "活力"];

function filterThemes(list: ThemeCardView[], filter: string): ThemeCardView[] {
  if (filter === "全部") return list;
  return list.filter((t) => t.tags.indexOf(filter) >= 0);
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
    functionEntries: FUNCTION_ENTRIES,
    stats: {
      streakDays: 0,
      completedActions: 0,
      totalMinutes: 0,
    } as GrowthStats,
    weekSummary: {
      beatPercent: 72, // TODO: 接入真实排名数据后替换
    } as WeekSummary,
    profileEditorVisible: false,
    profileDraftNickname: "",
    profileDraftAvatarUrl: "",
    profileDraftAvatarText: "岚",
    profileDraftSource: "custom" as UserProfileSource,
    profileDraftUseInTeam: true,
    endingGoalId: "",
    themeList: THEME_PRESETS.map(toThemeCard) as ThemeCardView[],
    themeFilters: THEME_FILTERS,
    themeFilterActive: "全部",
    filteredThemeList: filterThemes(THEME_PRESETS.map(toThemeCard), "全部") as ThemeCardView[],
    currentThemeId: getCurrentThemeId() as ThemeId,
    previewThemeId: getCurrentThemeId() as ThemeId,
    themeStyle: themeToProfileCssVars(getCurrentTheme()),
    themePickerVisible: false,
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

  /** 管理目标 — 跳转到目标创建（复用原有 createGoal 路由） */
  manageGoals() {
    wx.navigateTo({ url: "/pages/goal-create/index" });
  },

  /** 查看全部统计（暂时跳转到进度 Tab） */
  viewAllStats() {
    // TODO: 后续可跳转专属统计页
    wx.switchTab({ url: "/pages/plan/index" });
  },

  /** 查看本周小结详情 */
  viewWeekDetail() {
    // TODO: 接入真实周报页面
    wx.showToast({ title: "功能开发中", icon: "none" });
  },

  openFunction(event: { currentTarget: { dataset: { key?: string } } }) {
    const key = String(event.currentTarget.dataset.key || "");
    if (key === "settings") {
      wx.navigateTo({ url: "/pages/data-management/index" });
      return;
    }
    if (key === "theme") {
      this.openThemePicker();
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

  /* ======= 主题皮肤弹窗 ======= */

  openThemePicker() {
    const id = getCurrentThemeId();
    this.setData({
      themePickerVisible: true,
      previewThemeId: id,
      themeFilterActive: "全部",
      filteredThemeList: filterThemes(this.data.themeList, "全部"),
      themeStyle: themeToProfileCssVars(getCurrentTheme()),
    });
  },

  closeThemePicker() {
    // 关闭时若未保存，回退到当前已保存主题，避免预览残留
    const theme = getCurrentTheme();
    this.setData({
      themePickerVisible: false,
      previewThemeId: theme.id,
      themeStyle: themeToProfileCssVars(theme),
    });
  },

  /** 切换筛选标签 */
  switchThemeFilter(event: { currentTarget: { dataset: { filter?: string } } }) {
    const filter = String(event.currentTarget.dataset.filter || "全部");
    this.setData({
      themeFilterActive: filter,
      filteredThemeList: filterThemes(this.data.themeList, filter),
    });
  },

  /** 点击主题卡片：实时预览，不写入 storage */
  previewTheme(event: { currentTarget: { dataset: { id?: string } } }) {
    const id = String(event.currentTarget.dataset.id || "") as ThemeId;
    if (!id) return;
    const theme = getThemeById(id);
    this.setData({
      previewThemeId: id,
      themeStyle: themeToProfileCssVars(theme),
    });
  },

  /** 底部「恢复默认」：预览默认主题（不写入 storage，需再用「预览当前主题」确认） */
  restoreDefaultTheme() {
    const theme = getThemeById(DEFAULT_THEME_ID);
    this.setData({
      previewThemeId: DEFAULT_THEME_ID,
      themeStyle: themeToProfileCssVars(theme),
    });
    wx.showToast({ title: "已恢复默认预览", icon: "none" });
  },

  /** 底部「应用当前主题」：把当前预览的主题正式写入 storage 并全局生效 */
  applyPreviewTheme() {
    const id = this.data.previewThemeId;
    const theme = setCurrentTheme(id);
    this.setData({
      currentThemeId: id,
      themeStyle: themeToProfileCssVars(theme),
    });
    wx.showToast({ title: "已应用当前主题", icon: "success" });
  },

  /** 卡片内「设为当前主题」：保存到 storage 并全局生效（保留原入口） */
  applyTheme(event: { currentTarget: { dataset: { id?: string } } }) {
    const id = String(event.currentTarget.dataset.id || "") as ThemeId;
    if (!id) return;
    const theme = setCurrentTheme(id);
    this.setData({
      currentThemeId: id,
      previewThemeId: id,
      themeStyle: themeToProfileCssVars(theme),
    });
    wx.showToast({ title: "已设为当前主题", icon: "success" });
  },
});
