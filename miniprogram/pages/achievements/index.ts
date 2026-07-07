import { getAchievementCollection } from "../../services/achievement";
import { AchievementCategoryView, AchievementProgress } from "../../types/achievement";

function getTopInset(): number {
  try {
    return wx.getWindowInfo().statusBarHeight || 0;
  } catch (_) {
    return 24;
  }
}

function formatUnlockedDate(value?: string): string {
  if (!value) return "";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

Page({
  data: {
    topInset: getTopInset(),
    unlockedCount: 0,
    totalCount: 15,
    progressPercent: 0,
    categories: [] as AchievementCategoryView[],
    selected: null as AchievementProgress | null,
    selectedUnlockedDate: "",
  },

  onShow() {
    this.loadAchievements();
  },

  loadAchievements() {
    const collection = getAchievementCollection();
    this.setData({
      unlockedCount: collection.unlockedCount,
      totalCount: collection.totalCount,
      progressPercent: collection.progressPercent,
      categories: collection.categories,
    });
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/profile/index" }) });
  },

  openAchievement(event: { currentTarget: { dataset: { id?: string } } }) {
    const id = String(event.currentTarget.dataset.id || "");
    let selected: AchievementProgress | null = null;
    for (const category of this.data.categories) {
      selected = category.achievements.find((item) => item.id === id) || null;
      if (selected) break;
    }
    if (!selected) return;
    this.setData({ selected, selectedUnlockedDate: formatUnlockedDate(selected.unlockedAt) });
  },

  closeAchievement() {
    this.setData({ selected: null, selectedUnlockedDate: "" });
  },

  noop() {},
});
