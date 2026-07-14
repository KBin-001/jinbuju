import { AccountRuntimeState, CloudDataOverview } from "../types/account";
import { clearTodayCheckinDraft } from "../utils/checkin-draft";
import { clearTransientStorageCaches } from "../utils/storage";
import { bootstrapAccount, getCloudDataOverview } from "./account";
import { clearManualStore } from "./manualStore";
import { markSyncing } from "./syncStatus";
import { clearTeamCaches } from "./team";

export interface LocalCacheOverview {
  currentSizeKb: number;
  limitSizeKb: number;
  label: string;
}

export function getLocalCacheOverview(): LocalCacheOverview {
  try {
    const info = wx.getStorageInfoSync();
    const currentSizeKb = Math.max(0, Number(info.currentSize || 0));
    const limitSizeKb = Math.max(0, Number(info.limitSize || 0));
    const label = currentSizeKb >= 1024
      ? `${(currentSizeKb / 1024).toFixed(1)} MB`
      : `${currentSizeKb} KB`;
    return { currentSizeKb, limitSizeKb, label };
  } catch (_) {
    return { currentSizeKb: 0, limitSizeKb: 0, label: "暂时无法读取" };
  }
}

export async function refreshCloudSnapshot(): Promise<{ account: AccountRuntimeState; overview: CloudDataOverview }> {
  markSyncing();
  const account = await bootstrapAccount(true);
  if (account.source !== "cloud") throw new Error("当前网络不可用，已继续展示上次同步数据。");
  const overview = await getCloudDataOverview();
  return { account, overview };
}

export async function clearLocalCachesAndRestore(): Promise<AccountRuntimeState> {
  clearManualStore();
  clearTeamCaches();
  clearTransientStorageCaches();
  clearTodayCheckinDraft();
  markSyncing();
  const account = await bootstrapAccount(true);
  if (account.source !== "cloud") throw new Error("本地缓存已清除，但云端恢复尚未完成，请联网后重试。");
  return account;
}
