import { getTeamActivityFeed } from "../../services/team";
import { getCurrentThemeId, withAppTheme } from "../../services/theme";
import { TeamActivity, TeamActivityType } from "../../types/team";

interface ActivityView extends TeamActivity {
  avatarClass: string;
  typeLabel: string;
  typeClass: string;
  /** 是否显示日期分组标题（与上一条不同日期时为 true） */
  showHeader: boolean;
}

const PAGE_SIZE = 10;
const AVATAR_GRADIENTS = ["grad-1", "grad-2", "grad-3", "grad-4", "grad-5", "grad-6"];

const TYPE_LABEL: Record<TeamActivityType, string> = {
  completed: "已完成",
  partial: "进行中",
  not_started: "已开始",
  joined: "加入小队",
  streak: "连续打卡",
  encouraged: "收到鼓励",
};

const TYPE_CLASS: Record<TeamActivityType, string> = {
  completed: "tag-completed",
  partial: "tag-partial",
  not_started: "tag-started",
  joined: "tag-joined",
  streak: "tag-streak",
  encouraged: "tag-encouraged",
};

function hashSeed(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function pickAvatarClass(seed: string): string {
  return AVATAR_GRADIENTS[hashSeed(seed) % AVATAR_GRADIENTS.length];
}

function toActivityView(item: TeamActivity, prevDateLabel: string | null): ActivityView {
  return {
    ...item,
    avatarClass: pickAvatarClass(item.memberId || item.id),
    typeLabel: TYPE_LABEL[item.type],
    typeClass: TYPE_CLASS[item.type],
    showHeader: prevDateLabel !== item.dateLabel,
  };
}

function rebuildViews(list: TeamActivity[]): ActivityView[] {
  const views: ActivityView[] = [];
  let prevDateLabel: string | null = null;
  list.forEach((item) => {
    const view = toActivityView(item, prevDateLabel);
    views.push(view);
    prevDateLabel = item.dateLabel;
  });
  return views;
}

Page(withAppTheme({
  data: {
    appTheme: getCurrentThemeId() as string,
    statusBarHeight: 20,
    navBarHeight: 44,
    navTotalHeight: 64,
    navRightPad: 110,
    activities: [] as ActivityView[],
    loading: true,
    loadingMore: false,
    hasMore: true,
    isEmpty: false,
    total: 0,
    page: 1,
    noTeam: false,
    detailVisible: false,
    selectedDetail: null as ActivityView | null,
  },

  onLoad() {
    const windowInfo = wx.getWindowInfo();
    const menuRect = wx.getMenuButtonBoundingClientRect();
    const statusBarHeight = windowInfo.statusBarHeight || 20;
    const navBarHeight = menuRect && menuRect.height
      ? (menuRect.top - statusBarHeight) * 2 + menuRect.height
      : 44;
    const navRightPad = menuRect && menuRect.left
      ? windowInfo.windowWidth - menuRect.left + 8
      : 110;
    this.setData({
      statusBarHeight,
      navBarHeight,
      navTotalHeight: statusBarHeight + navBarHeight,
      navRightPad,
    });
    this.refresh();
  },

  onShow() {
    this.setData({ appTheme: getCurrentThemeId() });
    if (this.data.navTotalHeight > 0 && !this.data.loading) this.refresh();
  },

  onReachBottom() {
    this.loadMore();
  },

  async refresh() {
    this.setData({ loading: true, page: 1, hasMore: true, isEmpty: false, noTeam: false });
    try {
      const result = await getTeamActivityFeed({ page: 1, pageSize: PAGE_SIZE });
      const views = rebuildViews(result.list);
      this.setData({
        activities: views,
        loading: false,
        hasMore: result.hasMore,
        total: result.total,
        isEmpty: views.length === 0 && result.pageSize > 0,
        noTeam: result.pageSize === 0,
      });
    } catch (error) {
      this.setData({ loading: false, isEmpty: true });
      wx.showToast({ title: error instanceof Error ? error.message : "动态加载失败", icon: "none" });
    }
  },

  async loadMore() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return;
    this.setData({ loadingMore: true });
    try {
      const nextPage = this.data.page + 1;
      const result = await getTeamActivityFeed({ page: nextPage, pageSize: PAGE_SIZE });
      const merged = this.data.activities.concat(rebuildViews(result.list));
      this.setData({
        activities: merged,
        page: nextPage,
        hasMore: result.hasMore,
        loadingMore: false,
        total: result.total,
      });
    } catch (error) {
      this.setData({ loadingMore: false });
      wx.showToast({ title: error instanceof Error ? error.message : "加载更多失败", icon: "none" });
    }
  },

  openDetail(event: { currentTarget: { dataset: { id?: string } } }) {
    const id = String(event.currentTarget.dataset.id || "");
    const target = this.data.activities.find((item) => item.id === id);
    if (!target) return;
    this.setData({ selectedDetail: target, detailVisible: true });
  },

  closeDetail() {
    this.setData({ detailVisible: false, selectedDetail: null });
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.switchTab({ url: "/pages/team/index" });
    }
  },

  noop() {},
}));
