import { getAccountRuntime } from "../../services/account";
import { clearLocalCachesAndRestore, getLocalCacheOverview, refreshCloudSnapshot } from "../../services/dataSync";
import { getSyncRuntime } from "../../services/syncStatus";
import { MODAL_CONFIRM_COLORS, withAppTheme } from "../../services/theme";
import { CloudDataOverview } from "../../types/account";

type PageStatus = "loading" | "ready" | "error";

function formatSyncTime(value?: string): string {
  if (!value) return "尚无成功记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间待刷新";
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return sameDay ? `今天 ${time}` : `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")} ${time}`;
}

Page(withAppTheme({
  data: {
    status: "loading" as PageStatus,
    syncing: false,
    clearingCache: false,
    errorMessage: "",
    syncTitle: "正在连接云端",
    syncDescription: "正在核对目标、行动和成长记录。",
    lastSyncLabel: "尚无成功记录",
    usingCache: false,
    cacheLabel: "读取中",
    overview: null as CloudDataOverview | null,
  },

  onLoad() { this.load(false); },

  onPullDownRefresh() {
    this.load(true).then(() => wx.stopPullDownRefresh(), () => wx.stopPullDownRefresh());
  },

  async load(force: boolean) {
    if (this.data.syncing) return;
    this.setData({ status: this.data.overview ? "ready" : "loading", syncing: true, errorMessage: "" });
    try {
      let overview = this.data.overview;
      if (force || !overview) overview = (await refreshCloudSnapshot()).overview;
      const sync = getSyncRuntime();
      const account = getAccountRuntime();
      const usingCache = account?.source === "cache" || sync.usingCache;
      this.setData({
        status: "ready",
        syncing: false,
        overview,
        usingCache,
        cacheLabel: getLocalCacheOverview().label,
        lastSyncLabel: formatSyncTime(overview?.lastSuccessfulAt || sync.lastSuccessfulAt),
        syncTitle: usingCache ? "当前展示上次同步数据" : "云端数据已连接",
        syncDescription: usingCache ? "联网后可手动重试，当前设备上的记录仍会保留。" : "清除本机缓存或更换设备后，可重新从云端恢复。",
      });
    } catch (error) {
      this.setData({
        status: this.data.overview ? "ready" : "error",
        syncing: false,
        usingCache: true,
        cacheLabel: getLocalCacheOverview().label,
        syncTitle: "这次同步没有完成",
        syncDescription: "当前设备上的记录仍在，请检查网络后重试。",
        errorMessage: error instanceof Error ? error.message : "同步失败，请稍后重试。",
      });
    }
  },

  retrySync() { return this.load(true); },

  clearLocalCache() {
    if (this.data.clearingCache || this.data.syncing) return;
    wx.showModal({
      title: "清除本机缓存？",
      content: "只清除当前设备的快照、草稿和预览，不会删除云端目标、行动或收藏。清除后会立即尝试从云端恢复。",
      cancelText: "取消",
      confirmText: "清除恢复",
      confirmColor: MODAL_CONFIRM_COLORS.confirm,
      success: async (result) => {
        if (!result.confirm) return;
        this.setData({ clearingCache: true, errorMessage: "" });
        try {
          await clearLocalCachesAndRestore();
          const overview = (await refreshCloudSnapshot()).overview;
          this.setData({ clearingCache: false, overview, cacheLabel: getLocalCacheOverview().label });
          wx.showToast({ title: "已从云端恢复", icon: "success" });
          await this.load(false);
        } catch (error) {
          this.setData({ clearingCache: false, errorMessage: error instanceof Error ? error.message : "恢复失败" });
          wx.showToast({ title: "云端恢复尚未完成", icon: "none" });
        }
      },
    });
  },

  openDataManagement() { wx.navigateTo({ url: "/pages/data-management/index" }); },

  explainExport() {
    wx.showModal({
      title: "数据导出评估中",
      content: "当前版本尚未开放可验证的数据导出文件。正式开放前会明确导出范围、格式、身份校验和下载有效期。",
      showCancel: false,
      confirmText: "知道了",
    });
  },
}));
