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

export function isValidBusinessDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() + 1 === month
    && parsed.getUTCDate() === day;
}

/** 只按日历字段运算业务日期，不受设备时区或夏令时影响。 */
export function addBusinessDays(value: string, days: number): string {
  if (!isValidBusinessDate(value) || !Number.isInteger(days)) throw new Error("无效的业务日期");
  const [year, month, day] = value.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return `${result.getUTCFullYear()}-${pad(result.getUTCMonth() + 1)}-${pad(result.getUTCDate())}`;
}

export function differenceInBusinessDays(start: string, end: string): number {
  if (!isValidBusinessDate(start) || !isValidBusinessDate(end)) return 0;
  const toUtc = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toUtc(end) - toUtc(start)) / DAY_MILLISECONDS);
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + days);
  return result;
}

export function getTomorrow(): string {
  return addBusinessDays(getTodayBusinessDate(), 1);
}

export function getDefaultDeadline(): string {
  return addBusinessDays(getTodayBusinessDate(), 30);
}

export function daysUntil(dateValue: string): number {
  return differenceInBusinessDays(getTodayBusinessDate(), dateValue);
}

export function formatDisplayDate(dateValue: string): string {
  return dateValue.replace(/-/g, "/");
}

/** 获取上海时区当前小时数（0-23），用于时段判断。 */
function getShanghaiHour(now: Date = new Date()): number {
  const shanghaiDate = new Date(now.getTime() + SHANGHAI_OFFSET_MILLISECONDS);
  return shanghaiDate.getUTCHours();
}

export interface TimeGreeting {
  greeting: string;
  subtitle: string;
}

/** 根据当前时间段返回问候语和副标题，使用上海时区保证一致性。 */
export function getTimeGreeting(now: Date = new Date()): TimeGreeting {
  const hour = getShanghaiHour(now);
  if (hour >= 5 && hour < 11) {
    return { greeting: "早上好", subtitle: "今天也从一小步开始" };
  }
  if (hour >= 11 && hour < 13) {
    return { greeting: "中午好", subtitle: "午间稍作休息，再继续推进" };
  }
  if (hour >= 13 && hour < 18) {
    return { greeting: "下午好", subtitle: "保持节奏，一件一件来" };
  }
  if (hour >= 18 && hour < 23) {
    return { greeting: "晚上好", subtitle: "回顾今天，收住节奏" };
  }
  return { greeting: "夜深了", subtitle: "早点休息，明天继续" };
}
