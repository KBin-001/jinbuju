import {
  getProfileData,
  ProfileServiceError,
} from "../../services/profile";
import {
  BadgeSummary,
  HistoryGoalSummary,
  ProfilePageData,
} from "../../types/profile";
import { formatActionMinutes } from "../../utils/format";

type PageStatus = "loading" | "error" | "ready";

/** Cache TTL in ms – data within this window is considered fresh. */
const CACHE_TTL = 30_000;

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
    showQrcodePopup: false,
  },

  // ── In-memory cache metadata ──
  _lastFetchTime: 0,
  _loading: false,

  onShow() {
    this.loadProfile();
  },

  /**
   * @param force  true = always refetch (after mutations); false = use cache if fresh.
   */
  loadProfile(force = false) {
    if (this._loading) return;

    const now = Date.now();
    const hasFreshCache = !force && this._lastFetchTime > 0 && (now - this._lastFetchTime < CACHE_TTL);
    if (hasFreshCache) return;

    const silent = this._lastFetchTime > 0;
    this._loading = true;

    if (!silent) {
      this.setData({
        status: "loading",
        errorMessage: "",
      });
    }

    getProfileData()
      .then((profile) => {
        this._lastFetchTime = Date.now();
        this._loading = false;
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
        this._loading = false;
        if (!silent) {
          const serviceError = error as ProfileServiceError;
          this.setData({
            status: "error",
            errorMessage:
              serviceError.message || "个人数据加载失败，请稍后重试。",
          });
        }
      });
  },

  retry() {
    if (this._loading) return;
    this._lastFetchTime = 0;
    this.loadProfile(true);
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
    this.setData({ showQrcodePopup: true });
  },

  closeQrcodePopup() {
    this.setData({ showQrcodePopup: false });
  },

  preventClose() {
    // 阻止点击浮窗内容区域时关闭浮窗
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
