import { NotificationScene } from "../config/notification";

const STORAGE_KEY = "notification_prompt_cooldowns_v1";
const COOLDOWN_MS = 6 * 60 * 60 * 1000;

type PromptCache = Partial<Record<NotificationScene, number>>;

function readCache(): PromptCache {
  try {
    const value = wx.getStorageSync(STORAGE_KEY);
    return value && typeof value === "object" ? value as PromptCache : {};
  } catch (_error) {
    return {};
  }
}

export function canShowNotificationPrompt(scene: NotificationScene, now = Date.now()): boolean {
  return now - Number(readCache()[scene] || 0) >= COOLDOWN_MS;
}

export function recordNotificationPrompt(scene: NotificationScene, now = Date.now()): void {
  const cache = readCache();
  cache[scene] = now;
  try { wx.setStorageSync(STORAGE_KEY, cache); } catch (_error) { /* 本地冷却失败不影响授权真相 */ }
}
