import { getAchievementCollection, markAchievementCelebrated } from "../../services/achievement";
import { AchievementCategoryView, AchievementId, AchievementProgress } from "../../types/achievement";

type AchievementFilter = "all" | "unlocked" | "locked";
type AchievementView = AchievementProgress & { unlockedDateLabel: string };
type AchievementCategoryDisplay = Omit<AchievementCategoryView, "achievements"> & {
  achievements: AchievementView[];
  totalCount: number;
  iconPath: string;
  expanded: boolean;
};

const CATEGORY_ICON: Record<string, string> = {
  action: "/assets/achievements/category-action.svg",
  streak: "/assets/achievements/category-streak.svg",
  focus: "/assets/achievements/category-focus.svg",
  footprint: "/assets/achievements/category-footprint.svg",
  weekly: "/assets/achievements/category-weekly.svg",
  reflection: "/assets/achievements/category-reflection.svg",
};

function getTopInset(): number {
  try { return wx.getWindowInfo().statusBarHeight || 0; } catch (_) { return 24; }
}

function formatUnlockedDate(value?: string): string {
  if (!value) return "";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${year}.${String(Number(month)).padStart(2, "0")}.${String(Number(day)).padStart(2, "0")}`;
}

function withDisplayData(item: AchievementProgress): AchievementView {
  return { ...item, unlockedDateLabel: formatUnlockedDate(item.unlockedAt) };
}

function decorateCategories(categories: AchievementCategoryView[]): AchievementCategoryDisplay[] {
  return categories.map((category) => ({
    ...category,
    totalCount: category.achievements.length,
    iconPath: CATEGORY_ICON[category.key] || "/assets/achievements/category-action.svg",
    expanded: true,
    achievements: category.achievements.map(withDisplayData),
  }));
}

function filterCategories(categories: AchievementCategoryDisplay[], filter: AchievementFilter): AchievementCategoryDisplay[] {
  if (filter === "all") return categories;
  return categories.map((category) => ({
    ...category,
    achievements: category.achievements.filter((item) => filter === "unlocked" ? item.unlocked : !item.unlocked),
  })).filter((category) => category.achievements.length > 0);
}

function stageLabel(progressPercent: number): string {
  if (progressPercent >= 84) return "自成节奏";
  if (progressPercent >= 60) return "步履成章";
  if (progressPercent >= 34) return "渐入佳境";
  if (progressPercent > 0) return "新芽初生";
  return "等待启程";
}

function achievementMeaning(item?: AchievementProgress | null): string {
  if (!item) return "每一次真实行动，都会成为未来回望时的坐标。";
  const copyByCategory: Record<string, string> = {
    action: "这是你把行动变成节奏的证明。",
    streak: "稳定不是从不间断，而是愿意一次次回来。",
    focus: "投入过的时间，正在变成你的底气。",
    footprint: "普通的日子，也因为行动留下了坐标。",
    weekly: "你把一周的愿望，认真走成了结果。",
    reflection: "愿意回望的人，会走得越来越清楚。",
  };
  return copyByCategory[item.category] || "这份收藏，来自你真实完成的每一步。";
}

Page({
  data: {
    topInset: getTopInset(),
    status: "loading" as "loading" | "ready" | "error",
    errorMessage: "",
    unlockedCount: 0,
    totalCount: 18,
    progressPercent: 0,
    stageLabel: "等待启程",
    heroCopy: "你认真走过的每一步，都会被好好收藏。",
    categories: [] as AchievementCategoryDisplay[],
    visibleCategories: [] as AchievementCategoryDisplay[],
    activeFilter: "all" as AchievementFilter,
    filterItems: [
      { key: "all", label: "全部" },
      { key: "unlocked", label: "已收藏" },
      { key: "locked", label: "待解锁" },
    ],
    heroAchievement: null as AchievementView | null,
    latestAchievement: null as AchievementView | null,
    latestMeaning: "",
    nextAchievement: null as AchievementView | null,
    selected: null as AchievementView | null,
    selectedUnlockedDate: "",
    celebrating: null as AchievementView | null,
    celebrationDate: "",
  },

  pendingAchievementId: "",
  celebrationQueue: [] as AchievementView[],

  onLoad(options: { achievementId?: string }) {
    this.pendingAchievementId = decodeURIComponent(String(options?.achievementId || ""));
  },

  onShow() {
    this.loadAchievements();
  },

  loadAchievements() {
    this.setData({ status: "loading", errorMessage: "" });
    try {
      const collection = getAchievementCollection();
      const categories = decorateCategories(collection.categories);
      const locked = collection.achievements
        .filter((item) => !item.unlocked)
        .sort((a, b) => b.progressPercent - a.progressPercent || a.target - b.target)
        .map(withDisplayData);
      const latest = collection.achievements
        .filter((item) => item.unlocked)
        .sort((a, b) => String(b.unlockedAt).localeCompare(String(a.unlockedAt)))
        .map(withDisplayData);
      const latestAchievement = latest[0] || null;
      const nextAchievement = locked[0] || null;
      this.celebrationQueue = collection.newlyUnlocked.map(withDisplayData);
      this.setData({
        status: "ready",
        unlockedCount: collection.unlockedCount,
        totalCount: collection.totalCount,
        progressPercent: collection.progressPercent,
        stageLabel: stageLabel(collection.progressPercent),
        heroCopy: collection.unlockedCount > 0
          ? `你认真走过的 ${collection.unlockedCount} 步，都被好好收藏。`
          : "第一份收藏，会从一次真实行动开始。",
        categories,
        visibleCategories: filterCategories(categories, this.data.activeFilter),
        heroAchievement: latestAchievement || nextAchievement,
        latestAchievement,
        latestMeaning: achievementMeaning(latestAchievement),
        nextAchievement,
      }, () => {
        if (this.pendingAchievementId) {
          this.selectAchievement(this.pendingAchievementId);
          this.pendingAchievementId = "";
        }
        if (!this.data.celebrating) this.showNextCelebration();
      });
    } catch (error) {
      this.setData({
        status: "error",
        errorMessage: error instanceof Error ? error.message : "成长收藏暂时无法读取",
      });
    }
  },

  showNextCelebration() {
    const celebrating = this.celebrationQueue.shift() || null;
    if (!celebrating) return;
    this.setData({ celebrating, celebrationDate: formatUnlockedDate(celebrating.unlockedAt) });
  },

  closeCelebration() {
    const current = this.data.celebrating;
    if (current) markAchievementCelebrated(current.id as AchievementId);
    this.setData({ celebrating: null, celebrationDate: "" }, () => this.showNextCelebration());
  },

  changeFilter(event: { currentTarget: { dataset: { key?: AchievementFilter } } }) {
    const activeFilter = event.currentTarget.dataset.key || "all";
    this.setData({
      activeFilter,
      visibleCategories: filterCategories(this.data.categories, activeFilter),
    });
  },

  toggleCategory(event: { currentTarget: { dataset: { key?: string } } }) {
    const key = String(event.currentTarget.dataset.key || "");
    if (!key) return;
    const categories = this.data.categories.map((category) => category.key === key
      ? { ...category, expanded: !category.expanded }
      : category);
    this.setData({
      categories,
      visibleCategories: filterCategories(categories, this.data.activeFilter),
    });
  },

  goBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/profile/index" }) }); },

  goToday() {
    this.closeAchievement();
    wx.switchTab({ url: "/pages/index/index" });
  },

  generateGrowthCard() {
    wx.navigateTo({
      url: "/pages/share-card/index?mode=streak",
      fail: () => wx.showToast({ title: "纪念卡暂时无法打开", icon: "none" }),
    });
  },

  openAchievement(event: { currentTarget: { dataset: { id?: string } } }) {
    this.selectAchievement(String(event.currentTarget.dataset.id || ""));
  },

  selectAchievement(id: string) {
    let selected: AchievementView | null = null;
    for (const category of this.data.categories) {
      selected = category.achievements.find((item) => item.id === id) || null;
      if (selected) break;
    }
    if (!selected) return;
    this.setData({ selected, selectedUnlockedDate: selected.unlockedDateLabel });
  },

  closeAchievement() { this.setData({ selected: null, selectedUnlockedDate: "" }); },
  noop() {},
});
