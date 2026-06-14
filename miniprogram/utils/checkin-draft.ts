import { TodayCheckinDraft } from "../types/home";

export const TODAY_CHECKIN_DRAFT_KEY = "TODAY_CHECKIN_DRAFT_V1";

export function saveTodayCheckinDraft(draft: TodayCheckinDraft): void {
  wx.setStorageSync(TODAY_CHECKIN_DRAFT_KEY, draft);
}

export function getTodayCheckinDraft(): TodayCheckinDraft | null {
  const value = wx.getStorageSync(TODAY_CHECKIN_DRAFT_KEY);
  return value && typeof value === "object" ? (value as TodayCheckinDraft) : null;
}

export function clearTodayCheckinDraft(): void {
  wx.removeStorageSync(TODAY_CHECKIN_DRAFT_KEY);
}
