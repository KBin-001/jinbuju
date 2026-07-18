import { addBusinessDays, differenceInBusinessDays, getTodayBusinessDate, isValidBusinessDate } from "./date";

const FIVE_MINUTES = 5 * 60 * 1000;
const MINIMUM_LEAD = 10 * 60 * 1000;

function pad(value: number): string { return String(value).padStart(2, "0"); }

export function nextReminderTime(now = new Date()): string {
  const shanghai = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const rounded = Math.ceil((shanghai.getTime() + MINIMUM_LEAD) / FIVE_MINUTES) * FIVE_MINUTES;
  const value = new Date(rounded);
  return `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;
}

export function normalizeReminderTime(value: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) throw new Error("请选择有效提醒时间");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error("请选择有效提醒时间");
  const rounded = Math.floor(minute / 5) * 5;
  return `${pad(hour)}:${pad(rounded)}`;
}

export function reminderDateRange(now = new Date()): { start: string; end: string } {
  const start = getTodayBusinessDate(now);
  return { start, end: addBusinessDays(start, 7) };
}

export function buildReminderAt(businessDate: string, time: string, now = new Date()): string {
  if (!isValidBusinessDate(businessDate)) throw new Error("请选择有效行动日期");
  const range = reminderDateRange(now);
  const days = differenceInBusinessDays(range.start, businessDate);
  if (days < 0 || days > 7) throw new Error("提醒日期只能选择今天起 7 天内");
  const normalized = normalizeReminderTime(time);
  const remindAt = new Date(`${businessDate}T${normalized}:00+08:00`);
  if (Number.isNaN(remindAt.getTime())) throw new Error("请选择有效提醒时间");
  if (remindAt.getTime() < now.getTime() + MINIMUM_LEAD) throw new Error("当天提醒至少要比现在晚 10 分钟");
  return remindAt.toISOString();
}
