import { getAchievementCollection, markAchievementCelebrated } from "../../services/achievement";
import { AchievementCategoryView, AchievementId, AchievementProgress } from "../../types/achievement";

type AchievementFilter = "all" | "unlocked" | "locked";

function getTopInset(): number {
  try { return wx.getWindowInfo().statusBarHeight || 0; } catch (_) { return 24; }
}

function formatUnlockedDate(value?: string): string {
  if (!value) return "";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function filterCategories(categories: AchievementCategoryView[], filter: AchievementFilter): AchievementCategoryView[] {
  if (filter === "all") return categories;
  return categories.map((category) => ({
    ...category,
    achievements: category.achievements.filter((item) => filter === "unlocked" ? item.unlocked : !item.unlocked),
  })).filter((category) => category.achievements.length > 0);
}

Page({
  data: {
    topInset: getTopInset(),
    unlockedCount: 0,
    totalCount: 18,
    progressPercent: 0,
    categories: [] as AchievementCategoryView[],
    visibleCategories: [] as AchievementCategoryView[],
    activeFilter: "all" as AchievementFilter,
    filterItems: [
      { key: "all", label: "全部" },
      { key: "unlocked", label: "已收藏" },
      { key: "locked", label: "待解锁" },
    ],
    nextAchievement: null as AchievementProgress | null,
    selected: null as AchievementProgress | null,
    selectedUnlockedDate: "",
    celebrating: null as AchievementProgress | null,
    celebrationDate: "",
  },

  pendingAchievementId: "",
  celebrationQueue: [] as AchievementProgress[],

  onLoad(options: { achievementId?: string }) {
    this.pendingAchievementId = decodeURIComponent(String(options?.achievementId || ""));
  },

  onShow() {
    this.loadAchievements();
    if (this.pendingAchievementId) {
      this.selectAchievement(this.pendingAchievementId);
      this.pendingAchievementId = "";
    }
  },

  loadAchievements() {
    const collection = getAchievementCollection();
    const locked = collection.achievements.filter((item) => !item.unlocked).sort((a, b) => b.progressPercent - a.progressPercent);
    const latest = collection.achievements.filter((item) => item.unlocked).sort((a, b) => String(b.unlockedAt).localeCompare(String(a.unlockedAt)));
    this.celebrationQueue = collection.newlyUnlocked.slice();
    this.setData({
      unlockedCount: collection.unlockedCount,
      totalCount: collection.totalCount,
      progressPercent: collection.progressPercent,
      categories: collection.categories,
      visibleCategories: filterCategories(collection.categories, this.data.activeFilter),
      nextAchievement: locked[0] || latest[0] || null,
    });
    if (!this.data.celebrating) this.showNextCelebration();
  },

  showNextCelebration() {
    const celebrating = this.celebrationQueue.shift() || null;
    if (!celebrating) return;
    this.setData({ celebrating, celebrationDate: formatUnlockedDate(celebrating.unlockedAt) });
    try { wx.vibrateShort({ type: "light" }); } catch (_) { /* vibration is optional */ }
  },

  closeCelebration() {
    const current = this.data.celebrating;
    if (current) markAchievementCelebrated(current.id as AchievementId);
    this.setData({ celebrating: null, celebrationDate: "" }, () => this.showNextCelebration());
  },

  changeFilter(event: { currentTarget: { dataset: { key?: AchievementFilter } } }) {
    const activeFilter = event.currentTarget.dataset.key || "all";
    this.setData({ activeFilter, visibleCategories: filterCategories(this.data.categories, activeFilter) });
  },

  goBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/profile/index" }) }); },
  goToday() { this.closeAchievement(); wx.switchTab({ url: "/pages/index/index" }); },

  openAchievement(event: { currentTarget: { dataset: { id?: string } } }) {
    this.selectAchievement(String(event.currentTarget.dataset.id || ""));
  },

  selectAchievement(id: string) {
    let selected: AchievementProgress | null = null;
    for (const category of this.data.categories) {
      selected = category.achievements.find((item) => item.id === id) || null;
      if (selected) break;
    }
    if (!selected) return;
    this.setData({ selected, selectedUnlockedDate: formatUnlockedDate(selected.unlockedAt) });
  },

  closeAchievement() { this.setData({ selected: null, selectedUnlockedDate: "" }); },
  noop() {},
});
