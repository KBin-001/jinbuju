const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
const SHANGHAI_OFFSET_MILLISECONDS = 8 * 60 * 60 * 1000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 按 Asia/Shanghai 时区生成 YYYY-MM-DD 业务日期。 */
export function getTodayBusinessDate(now: Date = new Date()): string {
  const shanghaiDate = new Date(now.getTime() + SHANGHAI_OFFSET_MILLISECONDS);
  const year = shanghaiDate.getUTCFullYear();
  const month = shanghaiDate.getUTCMonth() + 1;
  const day = shanghaiDate.getUTCDate();
  // 校验构造的日期是否合法，防止时区转换临界时刻产生非法日期
  const verify = new Date(Date.UTC(year, month - 1, day));
  if (verify.getUTCFullYear() !== year || verify.getUTCMonth() + 1 !== month || verify.getUTCDate() !== day) {
    // 极端情况下回退到本地日期
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + days);
  return result;
}

export function getTomorrow(): string {
  return formatDate(addDays(new Date(), 1));
}

export function getDefaultDeadline(): string {
  return formatDate(addDays(new Date(), 30));
}

export function daysUntil(dateValue: string): number {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const target = new Date(`${dateValue}T00:00:00`).getTime();
  return Math.round((target - start) / DAY_MILLISECONDS);
}

export function formatDisplayDate(dateValue: string): string {
  return dateValue.replace(/-/g, "/");
}
