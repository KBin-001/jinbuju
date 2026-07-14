import { AccountBootstrapResult, AccountRuntimeState, CloudAccount, CloudDataOverview, CloudUserProfile } from "../types/account";
import { ManualDataStore } from "../types/manual";
import { UserDisplayProfile } from "../types/profile";
import { emit } from "../utils/eventBus";
import { clearLegacyManualStore, loadManualStoreIntoMemory, readLegacyManualStore, readManualStore } from "./manualStore";
import { hydrateSyncRuntime, markSyncCached, resetSyncRuntime } from "./syncStatus";

const LEGACY_PROFILE_KEY = "JINBUJU_USER_DISPLAY_PROFILE_V1";
const ACCOUNT_CACHE_KEY = "JINBUJU_ACCOUNT_CACHE_V1";
let runtime: AccountRuntimeState | null = null;
let bootPromise: Promise<AccountRuntimeState> | null = null;

interface CloudResult<T> { success: boolean; data?: T; error?: { code?: string; message?: string } }

function displayId(userId: string): string {
  const suffix = String(userId || "").replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase();
  return `JB-${suffix || "ACCOUNT"}`;
}

function normalizeBootstrap(value: AccountBootstrapResult): AccountBootstrapResult {
  const account = value.account || {} as CloudAccount;
  return {
    ...value,
    account: {
      ...account,
      displayId: account.displayId || displayId(account.userId),
      phoneBound: Boolean(account.phoneBound),
      phoneMasked: String(account.phoneMasked || ""),
    },
    sync: {
      lastSuccessfulAt: String(value.sync?.lastSuccessfulAt || ""),
      migrationVersion: Math.max(0, Number(value.sync?.migrationVersion || (value.migrationCompleted ? 1 : 0))),
    },
  };
}

function persistAccountCache(value: AccountRuntimeState): void {
  wx.setStorageSync(ACCOUNT_CACHE_KEY, value);
}

function readAccountCache(): AccountRuntimeState | null {
  const value = wx.getStorageSync(ACCOUNT_CACHE_KEY) as AccountRuntimeState | undefined;
  if (!value?.account?.userId || !value.profile) return null;
  const normalized = normalizeBootstrap(value);
  return { ...normalized, ready: true, source: "cache" };
}

function call<T>(action: string, data: Record<string, unknown> = {}, timeout = 20000): Promise<T> {
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error("网络连接较慢，请稍后重试。"), { code: "REQUEST_TIMEOUT" })), timeout);
    wx.cloud.callFunction({ name: "generatePlan", data: { action, ...data } }).then((response: any) => {
      clearTimeout(timer);
      resolve(response);
    }, (error: unknown) => { clearTimeout(timer); reject(error); });
  }).then((response) => {
    const result = response.result as CloudResult<T> | undefined;
    if (!result?.success || result.data === undefined) {
      throw Object.assign(new Error(result?.error?.message || "账号服务暂时不可用。"), { code: result?.error?.code || "NETWORK_ERROR" });
    }
    return result.data;
  });
}

function readLegacyProfile(): UserDisplayProfile | null {
  const value = wx.getStorageSync(LEGACY_PROFILE_KEY) as Partial<UserDisplayProfile> | undefined;
  if (!value || typeof value !== "object") return null;
  const nickname = String(value.nickname || "").trim();
  if (!nickname && !value.avatarUrl) return null;
  return {
    nickname,
    avatarUrl: String(value.avatarUrl || ""),
    profileSource: value.profileSource === "wechat" ? "wechat" : "custom",
    useProfileInTeam: value.useProfileInTeam !== false,
    updatedAt: String(value.updatedAt || ""),
  };
}

async function migrateLegacy(base: AccountBootstrapResult): Promise<ManualDataStore | undefined> {
  const legacyStore = readLegacyManualStore();
  const legacyProfile = readLegacyProfile();
  if (legacyProfile?.avatarUrl && !legacyProfile.avatarUrl.startsWith("cloud://") && !legacyProfile.avatarUrl.startsWith("https://")) {
    try {
      const extension = /\.([a-zA-Z0-9]+)$/.exec(legacyProfile.avatarUrl)?.[1] || "jpg";
      const uploaded = await wx.cloud.uploadFile({
        cloudPath: `user-avatars/${base.account.userId}/legacy-${Date.now()}.${extension}`,
        filePath: legacyProfile.avatarUrl,
      });
      legacyProfile.avatarUrl = String(uploaded.fileID || "");
    } catch (_) {
      legacyProfile.avatarUrl = "";
    }
  }
  if (legacyProfile) await call("importLegacyProfile", { profile: legacyProfile });
  if (legacyStore) loadManualStoreIntoMemory(legacyStore);
  const source = readManualStore();
  const merged = await call<ManualDataStore>("syncManualData", {
    store: source,
    migration: Boolean(legacyStore || legacyProfile),
  }, 30000);
  merged.archivedGoals = merged.archivedGoals || source.archivedGoals;
  merged.achievementUnlocks = merged.achievementUnlocks || source.achievementUnlocks;
  merged.sparkCheckins = merged.sparkCheckins || source.sparkCheckins;
  loadManualStoreIntoMemory(merged);
  if (legacyStore) {
    clearLegacyManualStore();
  }
  if (legacyProfile) wx.removeStorageSync(LEGACY_PROFILE_KEY);
  return merged;
}

export function bootstrapAccount(force = false): Promise<AccountRuntimeState> {
  if (runtime?.ready && !force) return Promise.resolve(runtime);
  if (bootPromise && !force) return bootPromise;
  const pending = call<AccountBootstrapResult>("bootstrapAccount").then(async (rawBase) => {
    const base = normalizeBootstrap(rawBase);
    await migrateLegacy(base);
    const refreshed = normalizeBootstrap(await call<AccountBootstrapResult>("bootstrapAccount"));
    runtime = { ...refreshed, ready: true, source: "cloud" };
    persistAccountCache(runtime);
    hydrateSyncRuntime(refreshed.sync.lastSuccessfulAt, false);
    emit("account:update", runtime);
    return runtime;
  }).catch((error) => {
    const cached = readAccountCache();
    if (!cached) throw error;
    runtime = cached;
    hydrateSyncRuntime(cached.sync.lastSuccessfulAt, true);
    markSyncCached(error as { code?: string; message?: string });
    emit("account:update", runtime);
    return runtime;
  });
  bootPromise = pending.then((value) => { bootPromise = null; return value; }, (error) => { bootPromise = null; throw error; });
  return bootPromise;
}

export function getAccountRuntime(): AccountRuntimeState | null { return runtime; }

export async function updateCloudProfile(profile: Omit<CloudUserProfile, "updatedAt">): Promise<CloudUserProfile> {
  const updated = await call<CloudUserProfile>("updateCloudProfile", { profile });
  if (runtime) runtime = { ...runtime, profile: updated };
  emit("profile:update", updated);
  return updated;
}

export async function uploadProfileAvatar(localPath: string): Promise<string> {
  const state = await bootstrapAccount();
  const extension = /\.([a-zA-Z0-9]+)$/.exec(localPath)?.[1] || "jpg";
  const cloudPath = `user-avatars/${state.account.userId}/${Date.now()}.${extension}`;
  const result = await wx.cloud.uploadFile({ cloudPath, filePath: localPath });
  return String(result.fileID || "");
}

export async function bindAccountPhone(code: string): Promise<CloudAccount> {
  const account = await call<CloudAccount>("bindPhone", { code });
  if (runtime) runtime = { ...runtime, account };
  emit("account:update", runtime);
  return account;
}

export async function unbindAccountPhone(): Promise<CloudAccount> {
  const account = await call<CloudAccount>("unbindPhone");
  if (runtime) {
    runtime = { ...runtime, account };
    persistAccountCache(runtime);
  }
  emit("account:update", runtime);
  return account;
}

export async function getCloudDataOverview(): Promise<CloudDataOverview> {
  return call<CloudDataOverview>("getDataOverview", {}, 30000);
}

export async function clearCloudBusinessData(): Promise<void> {
  await call("clearUserBusinessData", { confirmation: "CLEAR_BUSINESS_DATA" }, 30000);
  loadManualStoreIntoMemory();
}

export async function completeCloudOnboarding(): Promise<void> {
  await call("completeOnboarding");
  if (runtime) {
    runtime = { ...runtime, profile: { ...runtime.profile, welcomeCompleted: true } };
    persistAccountCache(runtime);
  }
}

export async function deleteCloudAccount(): Promise<void> {
  await call("deleteCloudAccount", { confirmation: "DELETE" }, 30000);
  runtime = null;
  loadManualStoreIntoMemory();
  wx.removeStorageSync(ACCOUNT_CACHE_KEY);
  resetSyncRuntime();
  emit("account:update", null);
}
