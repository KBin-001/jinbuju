import {
  getCommunityEntry,
  getProfileData,
  ProfileServiceError,
} from "../../services/profile";
import {
  BadgeSummary,
  CommunityEntry,
  HistoryGoalSummary,
  ProfilePageData,
} from "../../types/profile";
import { formatActionMinutes } from "../../utils/format";

type PageStatus = "loading" | "error" | "ready";

interface BadgeView extends BadgeSummary {
  mark: string;
}

interface HistoryEvent {
  currentTarget: {
    dataset: {
      goalId?: string;
    };
  };
}

const DEFAULT_AVATAR = "/images/icons/usercenter.png";
const BADGE_MARKS: Record<string, string> = {
  first_checkin: "1",
  streak_3: "3",
  streak_7: "7",
  checkin_10: "10",
  first_stage_completed: "✓",
};

Page({
  data: {
    status: "loading" as PageStatus,
    errorMessage: "",
    profile: null as ProfilePageData | null,
    avatarDisplay: DEFAULT_AVATAR,
    actionDuration: "0 分钟",
    badges: [] as BadgeView[],
    loadingCommunity: false,
  },

  onShow() {
    this.loadProfile();
  },

  loadProfile() {
    this.setData({
      status: "loading",
      errorMessage: "",
    });
    getProfileData()
      .then((profile) => {
        this.setData({
          status: "ready",
          profile,
          avatarDisplay: profile.user.avatarUrl || DEFAULT_AVATAR,
          actionDuration: formatActionMinutes(
            profile.statistics.totalActionMinutes,
          ),
          badges: profile.badges.map((badge) => ({
            ...badge,
            mark: BADGE_MARKS[badge.code] || "·",
          })),
        });
      })
      .catch((error: Error) => {
        const serviceError = error as ProfileServiceError;
        this.setData({
          status: "error",
          errorMessage:
            serviceError.message || "个人数据加载失败，请稍后重试。",
        });
      });
  },

  retry() {
    if (this.data.status !== "loading") this.loadProfile();
  },

  goToPlan() {
    wx.switchTab({ url: "/pages/plan/index" });
  },

  createGoal() {
    wx.navigateTo({ url: "/pages/goal-create/index" });
  },

  showHistoryGoal(event: HistoryEvent) {
    const goalId = String(event.currentTarget.dataset.goalId || "");
    const profile = this.data.profile as ProfilePageData | null;
    const goal = profile?.recentGoals.find(
      (item: HistoryGoalSummary) => item.id === goalId,
    );
    if (!goal) return;
    wx.showModal({
      title: goal.title,
      content: `${goal.categoryLabel}\n行动 ${goal.checkinDays} 天 · 完成行动 ${goal.completedTaskCount} 项`,
      showCancel: false,
    });
  },

  showAllHistory() {
    wx.showModal({
      title: "历史目标",
      content: "V1 暂时展示最近 3 个目标，完整历史列表将在后续版本提供。",
      showCancel: false,
    });
  },

  openCommunity() {
    if (this.data.loadingCommunity) return;
    const profile = this.data.profile as ProfilePageData | null;
    if (!profile?.community.unlocked) {
      wx.showModal({
        title: "社群入口尚未解锁",
        content:
          profile?.community.description || "继续完成行动后再来看看。",
        showCancel: false,
      });
      return;
    }

    this.setData({ loadingCommunity: true });
    getCommunityEntry()
      .then((entry: CommunityEntry) => {
        if (!entry.imageFileId) {
          wx.showModal({
            title: entry.title,
            content: entry.description,
            showCancel: false,
          });
          return;
        }
        return wx.cloud
          .downloadFile({ fileID: entry.imageFileId })
          .then((result: { tempFilePath: string }) => {
            wx.previewImage({
              urls: [result.tempFilePath],
              current: result.tempFilePath,
            });
          });
      })
      .catch((error: Error) => {
        wx.showModal({
          title: "暂时无法打开",
          content: error.message || "社群入口暂时不可用，请稍后重试。",
          showCancel: false,
        });
      })
      .then(
        () => this.setData({ loadingCommunity: false }),
        () => this.setData({ loadingCommunity: false }),
      );
  },

  openPrivacy() {
    wx.navigateTo({ url: "/pages/legal/privacy/index" });
  },

  openTerms() {
    wx.navigateTo({ url: "/pages/legal/terms/index" });
  },

  openDataManagement() {
    wx.navigateTo({ url: "/pages/data-management/index" });
  },

  openAbout() {
    wx.navigateTo({ url: "/pages/about/index" });
  },
});
