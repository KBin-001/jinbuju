export const BUNDLED_COMMUNITY_QR_URL = "/assets/community-qr-20260727.jpg";
export const BUNDLED_COMMUNITY_QR_EXPIRES_AT = "2026-07-27T23:59:59+08:00";

export function isCommunityEntryExpired(expiresAt?: string): boolean {
  if (!expiresAt) return false;
  const expiresAtTime = new Date(expiresAt).getTime();
  return Number.isFinite(expiresAtTime) && expiresAtTime <= Date.now();
}

export function communityExpiryText(expiresAt?: string): string {
  if (!expiresAt) return "";
  const value = new Date(expiresAt);
  if (Number.isNaN(value.getTime())) return "";
  return `二维码有效至 ${value.getMonth() + 1}月${value.getDate()}日，失效后将更新`;
}

export function getBundledCommunityQr() {
  if (isCommunityEntryExpired(BUNDLED_COMMUNITY_QR_EXPIRES_AT)) return null;
  return {
    title: "成长社区",
    description: "长按识别二维码，加入群聊和同行伙伴一起行动。",
    url: BUNDLED_COMMUNITY_QR_URL,
    expiryText: communityExpiryText(BUNDLED_COMMUNITY_QR_EXPIRES_AT),
  };
}
