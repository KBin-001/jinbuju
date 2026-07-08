const ITEMS = [
  { path: "/pages/index/index", text: "今日", icon: "/images/icons/tab-today-line.svg", activeIcon: "/images/icons/tab-today-solid.svg" },
  { path: "/pages/plan/index", text: "进度", icon: "/images/icons/tab-progress-line.svg", activeIcon: "/images/icons/tab-progress-solid.svg" },
  { path: "/pages/team/index", text: "小队", icon: "/images/icons/tab-team-line.svg", activeIcon: "/images/icons/tab-team-solid.svg" },
  { path: "/pages/profile/index", text: "我的", icon: "/images/icons/tab-profile-line.svg", activeIcon: "/images/icons/tab-profile-solid.svg" },
];

Component({
  data: { selected: 0, items: ITEMS },
  lifetimes: {
    attached() { this.syncSelected(); },
  },
  pageLifetimes: {
    show() { this.syncSelected(); },
  },
  methods: {
    syncSelected() {
      const pages = getCurrentPages();
      const route = `/${pages[pages.length - 1]?.route || ""}`;
      const selected = ITEMS.findIndex((item) => item.path === route);
      if (selected >= 0 && selected !== this.data.selected) this.setData({ selected });
    },
    switchTab(event: { currentTarget: { dataset: { index?: number } } }) {
      const index = Number(event.currentTarget.dataset.index);
      const item = ITEMS[index];
      if (!item || index === this.data.selected) return;
      this.setData({ selected: index });
      wx.switchTab({ url: item.path });
    },
  },
});
