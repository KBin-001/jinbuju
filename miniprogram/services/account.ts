import { AccountBootstrapResult, AccountRuntimeState, CloudAccount, CloudDataOverview, CloudUserProfile } from "../types/account";
import { ManualDataStore } from "../types/manual";
import { UserDisplayProfile } from "../types/profile";
import { emit } from "../utils/eventBus";
import { clearLegacyManualStore, loadManualStoreIntoMemory, readLegacyManualStore, readManualStore } from "./manualStore";
import { hydrateSyncRuntime, markSyncCached, resetSyncRuntime } from "./syncStatus";

const LEGACY_PROFILE_KEY = "JINBUJU_USER_DISPLAY_PROFILE_V1";
const ACCOUNT_CACHE_KEY = "JINBUJU_ACCOUNT_CACHE_V1";
const AVATAR_SIZE_LIMIT = 2 * 1024 * 1024;
const AVATAR_EXTENSIONS = new Set(["jpg", "jpeg", "png"]);
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

function avatarExtension(localPath: string): string {
  const pathname = String(localPath || "").split(/[?#]/)[0];
  const extension = /\.([a-zA-Z0-9]+)$/.exec(pathname)?.[1]?.toLowerCase() || "";
  if (!AVATAR_EXTENSIONS.has(extension)) {
    throw Object.assign(new Error("头像仅支持 JPG 或 PNG 图片。"), { code: "AVATAR_TYPE_INVALID" });
  }
  return extension;
}

function getLocalFileSize(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const getFileInfo = (wx as any).getFileInfo;
    if (typeof getFileInfo !== "function") {
      reject(Object.assign(new Error("当前微信版本无法校验头像文件，请升级微信后重试。"), { code: "AVATAR_CHECK_UNAVAILABLE" }));
      return;
    }
    getFileInfo({
      filePath,
      success: (result: { size?: number }) => resolve(Number(result.size || 0)),
      fail: () => reject(Object.assign(new Error("无法读取头像文件，请重新选择。"), { code: "AVATAR_FILE_INVALID" })),
    });
  });
}

async function uploadCheckedAvatar(localPath: string, userId: string): Promise<string> {
  const extension = avatarExtension(localPath);
  const size = await getLocalFileSize(localPath);
  if (!Number.isFinite(size) || size <= 0) {
    throw Object.assign(new Error("头像文件无效，请重新选择。"), { code: "AVATAR_FILE_INVALID" });
  }
  if (size > AVATAR_SIZE_LIMIT) {
    throw Object.assign(new Error("头像不能超过 2MB，请压缩后重试。"), { code: "AVATAR_SIZE_EXCEEDED" });
  }
  const cloudPath = `user-avatars/${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
  const uploaded = await wx.cloud.uploadFile({ cloudPath, filePath: localPath });
  const fileId = String(uploaded.fileID || "");
  if (!fileId) throw Object.assign(new Error("头像上传失败，请重试。"), { code: "AVATAR_UPLOAD_FAILED" });
  try {
    const checked = await call<{ fileId: string }>("validateAvatarUpload", { fileId }, 30000);
    return String(checked.fileId || fileId);
  } catch (error) {
    await wx.cloud.deleteFile({ fileList: [fileId] }).catch(() => undefined);
    throw error;
  }
}

async function migrateLegacy(base: AccountBootstrapResult): Promise<ManualDataStore | undefined> {
  const legacyStore = readLegacyManualStore();
  const legacyProfile = readLegacyProfile();
  if (legacyProfile?.avatarUrl && !legacyProfile.avatarUrl.startsWith("cloud://") && !legacyProfile.avatarUrl.startsWith("https://")) {
    try {
      legacyProfile.avatarUrl = await uploadCheckedAvatar(legacyProfile.avatarUrl, base.account.userId);
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
  return uploadCheckedAvatar(localPath, state.account.userId);
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
