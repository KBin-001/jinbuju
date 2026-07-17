import { FEATURE_FLAGS } from "../../config/features";
import { getActiveGoal, getActiveGoals, setCurrentGoal } from "../../services/manualGoal";
import { getProgressSummary } from "../../services/manualStats";
import { getTaskHistoryByGoal } from "../../services/manualTask";
import { getCurrentThemeId, withAppTheme } from "../../services/theme";
import { ActionTask, Goal, ProgressSummary } from "../../types/manual";
import { addDays, formatDate, getTodayBusinessDate } from "../../utils/date";
import { off, on } from "../../utils/eventBus";
import { getTabHeaderLayout } from "../../utils/tabHeader";

type TrendRange = "week" | "month" | "year";
type HeatLevel = 0 | 1 | 2 | 3 | 4;

interface TrendRangeOption {
  key: TrendRange;
  label: string;
  active: boolean;
}

interface OverviewStat {
  label: string;
  value: string;
  unit: string;
}

interface GoalOption {
  id: string;
  title: string;
  periodText: string;
  active: boolean;
}

interface TrendBar {
  key: string;
  label: string;
  subLabel: string;
  minutes: number;
  actions: number;
  heightPercent: number;
  actionHeightPercent: number;
  tooltipBottomPercent: number;
  isMax: boolean;
  isToday: boolean;
  active: boolean;
  hasNext: boolean;
  labelsOverlap: boolean;
  lineClipPath: string;
  tooltipAlign: "left" | "center" | "right";
}

interface BarChartData {
  bars: TrendBar[];
  maxLabel: string;
  midLabel: string;
  lowLabel: string;
  maxValue: number;
  maxActions: number;
  midActions: number;
  lowActions: number;
  barWidth: number;
  insufficient: boolean;
}

interface TrendSummary {
  totalMinutes: number;
  totalActions: number;
  summaryText: string;
  insufficient: boolean;
}

interface TrendHighlight {
  value: number;
  unit: string;
  label: string;
}

interface TrendHighlights {
  maxMinutes: TrendHighlight;
  maxActions: TrendHighlight;
  streak: TrendHighlight;
}

interface HeatmapDay {
  date: string;
  minutes: number;
  actions: number;
  level: HeatLevel;
  isFuture: boolean;
  isEmpty: boolean;
  hasRecord: boolean;
  active: boolean;
}

interface HeatmapWeek {
  days: HeatmapDay[];
}

interface HeatmapMonthLabel {
  label: string;
  left: number;
}

interface YearSummary {
  checkinDays: number;
  totalMinutes: number;
  maxStreakDays: number;
  summaryText: string;
  insufficient: boolean;
}

interface YearHighlightDay {
  date: string;
  dateLabel: string;
  minutes: number;
}

interface YearHighlightStreak {
  date: string;
  dateLabel: string;
  days: number;
}

interface YearHighlightMonth {
  month: string;
  minutes: number;
}

interface YearHighlights {
  maxDay: YearHighlightDay | null;
  maxStreak: YearHighlightStreak | null;
  maxMonth: YearHighlightMonth | null;
}

interface SelectedHeatmapDay {
  date: string;
  dateLabel: string;
  minutes: number;
  actions: number;
  hasRecord: boolean;
}

const TREND_RANGES: Array<{ key: TrendRange; label: string }> = [
  { key: "week", label: "周" },
  { key: "month", label: "月" },
  { key: "year", label: "年" },
];

const HEATMAP_CELL_SIZE = 14;
const HEATMAP_CELL_GAP = 5;
const HEATMAP_COLUMN_WIDTH = HEATMAP_CELL_SIZE + HEATMAP_CELL_GAP;
const HEATMAP_WEEKDAY_WIDTH = 36;

const WEEK_BAR_WIDTH = 34;
const MONTH_BAR_WIDTH = 50;

function toDate(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

function shortDate(value?: string): string {
  return value ? value.slice(0, 10) : "";
}

function goalPeriod(goal: Goal | null): string {
  if (!goal) return "";
  const start = shortDate(goal.startedAt || goal.createdAt);
  if (!start) return "持续目标 · 已开始";
  const [year, month, day] = start.split("-").map(Number);
  return `持续目标 · ${year}年${month}月${day}日开始`;
}

function trendPeriodLabel(range: TrendRange, today: string): string {
  const date = new Date(`${today}T00:00:00`);
  if (range === "year") return `${date.getFullYear()} 年 1 月 1 日—12 月 31 日`;
  if (range === "month") {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    return `${formatDate(start).replace(/-/g, ".")}—${formatDate(end).replace(/-/g, ".")}`;
  }
  const mondayOffset = (date.getDay() + 6) % 7;
  const start = addDays(date, -mondayOffset);
  const end = addDays(start, 6);
  return `${formatDate(start).replace(/-/g, ".")}—${formatDate(end).replace(/-/g, ".")}`;
}

function buildTrendRanges(activeKey: TrendRange): TrendRangeOption[] {
  return TREND_RANGES.map((item) => ({ ...item, active: item.key === activeKey }));
}

function coachScopeLabel(range: TrendRange): string {
  return range === "year" ? "今年" : range === "month" ? "本月" : "本周";
}

function buildGoalOptions(goals: Goal[], activeGoalId: string): GoalOption[] {
  return goals.map((goal) => ({
    id: goal.id,
    title: goal.title,
    periodText: goalPeriod(goal),
    active: goal.id === activeGoalId,
  }));
}

function niceMaxMinutes(value: number): number {
  if (value <= 30) return 30;
  if (value <= 60) return 60;
  if (value <= 90) return 90;
  if (value <= 120) return 120;
  if (value <= 180) return 180;
  if (value <= 240) return 240;
  if (value <= 360) return 360;
  if (value <= 480) return 480;
  if (value <= 720) return 720;
  if (value <= 1080) return 1080;
  return Math.ceil(value / 60) * 60;
}

function niceMaxActions(value: number): number {
  if (value <= 3) return 3;
  if (value <= 6) return 6;
  return Math.ceil(value / 3) * 3;
}

function formatAxisLabel(minutes: number): string {
  if (minutes <= 0) return "0";
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

function getHeatLevel(minutes: number): HeatLevel {
  if (minutes <= 0) return 0;
  if (minutes <= 30) return 1;
  if (minutes <= 60) return 2;
  if (minutes <= 120) return 3;
  return 4;
}

function taskBusinessDate(task: ActionTask): string {
  return task.activityDate || task.currentDate;
}

function isTrendTask(task: ActionTask): boolean {
  if (task.deletedAt || task.status === "skipped") return false;
  if (task.status === "completed" || task.status === "partially_completed") return true;
  return task.status === "rescheduled"
    && task.statusBeforeReschedule === "partially_completed"
    && (task.actualMinutes || 0) > 0;
}

function inRange(task: ActionTask, start: string, end: string): boolean {
  const date = taskBusinessDate(task);
  if (!isTrendTask(task)) return false;
  return date >= start && date <= end;
}

function formatMonthDay(date: string): string {
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  return `${month}月${day}日`;
}

function formatShortDate(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

function sumRange(tasks: ActionTask[], start: string, end: string): { minutes: number; actions: number } {
  let minutes = 0;
  let actions = 0;
  for (const task of tasks) {
    if (!inRange(task, start, end)) continue;
    minutes += task.actualMinutes || 0;
    if (task.status === "completed") actions += 1;
  }
  return { minutes, actions };
}

interface WeekBucket {
  key: string;
  label: string;
  start: string;
  end: string;
  isToday: boolean;
}

interface MonthBucket {
  key: string;
  label: string;
  rangeLabel: string;
  start: string;
  end: string;
}

function buildWeekBuckets(today: string): WeekBucket[] {
  const todayDate = toDate(today);
  const mondayOffset = (todayDate.getDay() + 6) % 7;
  const monday = addDays(todayDate, -mondayOffset);
  return Array.from({ length: 7 }).map((_, index) => {
    const date = formatDate(addDays(monday, index));
    return {
      key: date,
      label: date === today ? "今天" : ["一", "二", "三", "四", "五", "六", "日"][index],
      start: date,
      end: date,
      isToday: date === today,
    };
  });
}

function buildMonthBuckets(today: string): MonthBucket[] {
  const todayDate = toDate(today);
  const monthStartDate = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);
  const monthEndDate = new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0);
  const startOffset = (monthStartDate.getDay() + 6) % 7;
  let cursor = addDays(monthStartDate, -startOffset);
  const buckets: MonthBucket[] = [];
  while (cursor <= monthEndDate) {
    const rawEnd = addDays(cursor, 6);
    const clippedStart = cursor < monthStartDate ? monthStartDate : cursor;
    const clippedEnd = rawEnd > monthEndDate ? monthEndDate : rawEnd;
    const start = formatDate(clippedStart);
    const end = formatDate(clippedEnd);
    buckets.push({
      key: `${start}-${end}`,
      label: `${buckets.length + 1}周`,
      rangeLabel: `${formatShortDate(start)}-${formatShortDate(end)}`,
      start,
      end,
    });
    cursor = addDays(cursor, 7);
  }
  return buckets;
}

function buildBarChart(
  bars: Array<{ key: string; label: string; subLabel: string; minutes: number; actions: number; isToday: boolean }>,
  selectedKey: string | undefined,
  barWidth: number,
): BarChartData {
  const maxValue = niceMaxMinutes(Math.max(30, ...bars.map((item) => item.minutes)));
  const maxActions = niceMaxActions(Math.max(1, ...bars.map((item) => item.actions)));
  const nonZeroCount = bars.filter((item) => item.minutes > 0 || item.actions > 0).length;
  const maxMinuteValue = Math.max(...bars.map((item) => item.minutes));
  const selected = selectedKey && bars.some((item) => item.key === selectedKey) ? selectedKey : "";

  const trendBars: TrendBar[] = bars.map((item, index) => {
    const heightPercent = item.minutes <= 0 ? 0 : Math.max(4, (item.minutes / maxValue) * 100);
    const actionHeightPercent = item.actions <= 0 ? 0 : Math.max(5, (item.actions / maxActions) * 100);
    const tooltipAlign: TrendBar["tooltipAlign"] = index === 0 ? "left" : index === bars.length - 1 ? "right" : "center";
    return {
      key: item.key,
      label: item.label,
      subLabel: item.subLabel,
      minutes: item.minutes,
      actions: item.actions,
      heightPercent,
      actionHeightPercent,
      tooltipBottomPercent: Math.min(88, heightPercent),
      isMax: item.minutes > 0 && item.minutes === maxMinuteValue,
      isToday: item.isToday,
      active: item.key === selected,
      hasNext: false,
      labelsOverlap: item.minutes > 0 && item.actions > 0 && Math.abs(heightPercent - actionHeightPercent) <= 9,
      lineClipPath: "",
      tooltipAlign,
    };
  });

  for (let index = 0; index < trendBars.length - 1; index += 1) {
    const current = trendBars[index];
    const next = trendBars[index + 1];
    const currentTop = 100 - current.actionHeightPercent;
    const nextTop = 100 - next.actionHeightPercent;
    const currentUpper = Math.max(0, currentTop - 1.15);
    const currentLower = Math.min(100, currentTop + 1.15);
    const nextUpper = Math.max(0, nextTop - 1.15);
    const nextLower = Math.min(100, nextTop + 1.15);
    current.hasNext = true;
    current.lineClipPath = `polygon(0 ${currentUpper}%,100% ${nextUpper}%,100% ${nextLower}%,0 ${currentLower}%)`;
  }

  return {
    bars: trendBars,
    maxLabel: formatAxisLabel(maxValue),
    midLabel: formatAxisLabel(Math.round(maxValue * 2 / 3)),
    lowLabel: formatAxisLabel(Math.round(maxValue / 3)),
    maxValue,
    maxActions,
    midActions: Math.round(maxActions * 2 / 3),
    lowActions: Math.round(maxActions / 3),
    barWidth,
    insufficient: nonZeroCount < 1,
  };
}

function buildWeekSummary(
  buckets: WeekBucket[],
  tasks: ActionTask[],
  today: string,
): TrendSummary {
  const perDay = buckets.map((bucket) => sumRange(tasks, bucket.start, bucket.end));
  const totalMinutes = perDay.reduce((sum, item) => sum + item.minutes, 0);
  const totalActions = perDay.reduce((sum, item) => sum + item.actions, 0);
  const activeDays = perDay.filter((item) => item.minutes > 0 || item.actions > 0).length;

  const todayIndex = buckets.findIndex((bucket) => bucket.key === today);
  const todayMinutes = todayIndex >= 0 ? perDay[todayIndex]?.minutes || 0 : 0;
  const yesterday = formatDate(addDays(toDate(today), -1));
  const yesterdayIndex = buckets.findIndex((bucket) => bucket.key === yesterday);
  const yesterdayMinutes = yesterdayIndex >= 0 ? perDay[yesterdayIndex]?.minutes || 0 : 0;
  let summaryText: string;
  if (activeDays < 1) {
    summaryText = "完成第一项行动后，今日投入会立即显示在趋势图上。";
  } else if (activeDays === 1) {
    summaryText = `今天已投入 ${todayMinutes} 分钟，继续保持就会形成稳定趋势。`;
  } else if (todayMinutes > 0 && yesterdayMinutes > 0) {
    const diff = todayMinutes - yesterdayMinutes;
    if (diff < 0) {
      summaryText = `今天投入 ${todayMinutes} 分钟，比昨天少 ${Math.abs(diff)} 分钟，保持节奏就好。`;
    } else if (diff > 0) {
      summaryText = `今天投入 ${todayMinutes} 分钟，比昨天多 ${diff} 分钟，状态正在变好。`;
    } else {
      summaryText = `最近一周累计投入 ${totalMinutes} 分钟，完成 ${totalActions} 项行动。`;
    }
  } else {
    summaryText = `最近一周累计投入 ${totalMinutes} 分钟，完成 ${totalActions} 项行动。`;
  }

  return {
    totalMinutes,
    totalActions,
    summaryText,
    insufficient: activeDays < 1,
  };
}

function buildMonthSummary(
  buckets: MonthBucket[],
  tasks: ActionTask[],
  today: string,
): TrendSummary {
  const perWeek = buckets.map((bucket) => bucket.start > today
    ? { minutes: 0, actions: 0 }
    : sumRange(tasks, bucket.start, bucket.end > today ? today : bucket.end));
  const totalMinutes = perWeek.reduce((sum, item) => sum + item.minutes, 0);
  const totalActions = perWeek.reduce((sum, item) => sum + item.actions, 0);
  const activeWeeks = perWeek.filter((item) => item.minutes > 0 || item.actions > 0).length;

  let summaryText: string;
  if (activeWeeks < 1) {
    summaryText = "完成第一项行动后，本周投入会立即显示在趋势图上。";
  } else if (activeWeeks === 1) {
    summaryText = `本周已投入 ${totalMinutes} 分钟，继续记录就会形成月度节奏。`;
  } else {
    summaryText = `本月累计投入 ${totalMinutes} 分钟，完成 ${totalActions} 项行动。`;
  }

  return {
    totalMinutes,
    totalActions,
    summaryText,
    insufficient: activeWeeks < 1,
  };
}

function buildYearHeatmap(
  year: number,
  today: string,
  tasks: ActionTask[],
  selectedDate?: string,
): { weeks: HeatmapWeek[]; monthLabels: HeatmapMonthLabel[] } {
  const jan1 = new Date(year, 0, 1);
  const dec31 = new Date(year, 11, 31);
  const todayDate = toDate(today);
  const isCurrentYear = todayDate.getFullYear() === year;

  const dayMap = new Map<string, { minutes: number; actions: number }>();
  for (const task of tasks) {
    const businessDate = taskBusinessDate(task);
    if (!businessDate.startsWith(String(year)) || !isTrendTask(task)) continue;
    const entry = dayMap.get(businessDate) || { minutes: 0, actions: 0 };
    entry.minutes += task.actualMinutes || 0;
    if (task.status === "completed") entry.actions += 1;
    dayMap.set(businessDate, entry);
  }

  const jan1Day = jan1.getDay();
  const mondayOffset = jan1Day === 0 ? -6 : 1 - jan1Day;
  const startMonday = addDays(jan1, mondayOffset);

  const weeks: HeatmapWeek[] = [];
  const monthLabels: HeatmapMonthLabel[] = [];
  let cursor = new Date(startMonday);
  let lastMonth = -1;
  let columnIndex = 0;

  while (cursor <= dec31) {
    const weekDays: HeatmapDay[] = [];
    for (let i = 0; i < 7; i += 1) {
      const dateStr = formatDate(cursor);
      const inYear = cursor >= jan1 && cursor <= dec31;
      const isFuture = isCurrentYear && cursor > todayDate && cursor <= dec31;
      const data = dayMap.get(dateStr);
      const minutes = data?.minutes || 0;
      const actions = data?.actions || 0;
      const hasRecord = !!data && minutes > 0;

      if (inYear && cursor.getMonth() !== lastMonth) {
        lastMonth = cursor.getMonth();
        monthLabels.push({
          label: `${lastMonth + 1}月`,
          left: columnIndex * HEATMAP_COLUMN_WIDTH,
        });
      }

      weekDays.push({
        date: dateStr,
        minutes,
        actions,
        level: getHeatLevel(minutes),
        isFuture,
        isEmpty: !inYear,
        hasRecord,
        active: selectedDate === dateStr,
      });

      cursor = addDays(cursor, 1);
    }
    weeks.push({ days: weekDays });
    columnIndex += 1;
  }

  return { weeks, monthLabels };
}

function buildYearSummary(year: number, today: string, tasks: ActionTask[]): YearSummary {
  const todayDate = toDate(today);
  const isCurrentYear = todayDate.getFullYear() === year;
  const dayOfYear = isCurrentYear
    ? Math.floor((todayDate.getTime() - new Date(year, 0, 1).getTime()) / (24 * 60 * 60 * 1000)) + 1
    : 365;

  let checkinDays = 0;
  let totalMinutes = 0;
  const activeDates: string[] = [];

  for (const task of tasks) {
    const businessDate = taskBusinessDate(task);
    if (!businessDate.startsWith(String(year)) || !isTrendTask(task)) continue;
    const minutes = task.actualMinutes || 0;
    if (minutes > 0 && !activeDates.includes(businessDate)) {
      activeDates.push(businessDate);
      checkinDays += 1;
    }
    totalMinutes += minutes;
  }

  const sortedDates = activeDates.sort();
  let maxStreakDays = 0;
  let currentStreak = 0;
  for (let i = 0; i < sortedDates.length; i += 1) {
    if (i === 0) {
      currentStreak = 1;
    } else {
      const prev = toDate(sortedDates[i - 1]);
      const curr = toDate(sortedDates[i]);
      const diff = Math.round((curr.getTime() - prev.getTime()) / (24 * 60 * 60 * 1000));
      currentStreak = diff === 1 ? currentStreak + 1 : 1;
    }
    if (currentStreak > maxStreakDays) maxStreakDays = currentStreak;
  }

  const insufficient = checkinDays < 1;
  let summaryText: string;
  if (insufficient) {
    summaryText = "完成第一次真实行动后，年度山色会从那一天开始留下记录。";
  } else if (checkinDays < 7) {
    summaryText = `今年已有 ${checkinDays} 天留下行动记录，继续积累后会更容易看见自己的节奏。`;
  } else {
    summaryText = `今年已有 ${checkinDays} 天留下行动记录，每一次投入都在形成自己的节奏。`;
  }

  return { checkinDays, totalMinutes, maxStreakDays, summaryText, insufficient };
}

function buildYearHighlights(year: number, tasks: ActionTask[]): YearHighlights {
  const dayMap = new Map<string, { minutes: number; actions: number }>();
  const monthMap = new Map<number, number>();

  for (const task of tasks) {
    const businessDate = taskBusinessDate(task);
    if (!businessDate.startsWith(String(year)) || !isTrendTask(task)) continue;
    const entry = dayMap.get(businessDate) || { minutes: 0, actions: 0 };
    entry.minutes += task.actualMinutes || 0;
    if (task.status === "completed") entry.actions += 1;
    dayMap.set(businessDate, entry);

    const month = Number(businessDate.slice(5, 7)) - 1;
    monthMap.set(month, (monthMap.get(month) || 0) + (task.actualMinutes || 0));
  }

  let maxDay: YearHighlightDay | null = null;
  for (const [date, data] of dayMap) {
    if (data.minutes > 0 && (!maxDay || data.minutes > maxDay.minutes)) {
      maxDay = { date, dateLabel: formatMonthDay(date), minutes: data.minutes };
    }
  }

  const sortedDates = [...dayMap.entries()]
    .filter(([, data]) => data.minutes > 0)
    .map(([date]) => date)
    .sort();
  let maxStreak: YearHighlightStreak | null = null;
  let currentStreak = 0;
  let streakStart = "";
  let maxStreakDays = 0;
  let maxStreakStart = "";
  for (let i = 0; i < sortedDates.length; i += 1) {
    if (i === 0) {
      currentStreak = 1;
      streakStart = sortedDates[i];
    } else {
      const prev = toDate(sortedDates[i - 1]);
      const curr = toDate(sortedDates[i]);
      const diff = Math.round((curr.getTime() - prev.getTime()) / (24 * 60 * 60 * 1000));
      if (diff === 1) {
        currentStreak += 1;
      } else {
        currentStreak = 1;
        streakStart = sortedDates[i];
      }
    }
    if (currentStreak > maxStreakDays) {
      maxStreakDays = currentStreak;
      maxStreakStart = streakStart;
    }
  }
  if (maxStreakDays > 0) {
    maxStreak = { date: maxStreakStart, dateLabel: formatMonthDay(maxStreakStart), days: maxStreakDays };
  }

  let maxMonth: YearHighlightMonth | null = null;
  for (const [month, minutes] of monthMap) {
    if (minutes > 0 && (!maxMonth || minutes > maxMonth.minutes)) {
      maxMonth = { month: `${month + 1}月`, minutes };
    }
  }

  return { maxDay, maxStreak, maxMonth };
}

function buildOverview(summary: ProgressSummary | null): OverviewStat[] {
  const completed = summary?.completedTasks || 0;
  return [
    { label: "行动天数", value: String(summary?.totalActionDays || 0), unit: "天" },
    { label: "完成行动", value: String(completed), unit: "项" },
    { label: "累计投入", value: String(summary?.totalActualMinutes || 0), unit: "分钟" },
  ];
}

function emptyTrendHighlights(): TrendHighlights {
  return {
    maxMinutes: { value: 0, unit: "分钟", label: "暂无记录" },
    maxActions: { value: 0, unit: "项", label: "暂无记录" },
    streak: { value: 0, unit: "天", label: "尚未连续" },
  };
}

function highlightBucketLabel(range: TrendRange, bar?: TrendBar): string {
  if (!bar) return "暂无记录";
  if (bar.isToday) return "今天";
  return range === "week" ? `周${bar.label}` : bar.label;
}

function weekdayLabel(date: string): string {
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][toDate(date).getDay()];
}

function buildTrendHighlights(
  range: TrendRange,
  bars: TrendBar[],
  tasks: ActionTask[],
  start: string,
  end: string,
): TrendHighlights {
  const maxMinutesBar = bars.reduce<TrendBar | undefined>((best, item) => item.minutes > (best?.minutes || 0) ? item : best, undefined);
  const maxActionsBar = bars.reduce<TrendBar | undefined>((best, item) => item.actions > (best?.actions || 0) ? item : best, undefined);
  const completedDates = Array.from(new Set(tasks
    .filter((task) => task.status === "completed" && inRange(task, start, end))
    .map(taskBusinessDate)))
    .sort();

  let bestStart = "";
  let bestEnd = "";
  let bestDays = 0;
  let runStart = "";
  let previous = "";
  let runDays = 0;
  for (const date of completedDates) {
    if (previous && formatDate(addDays(toDate(previous), 1)) === date) {
      runDays += 1;
    } else {
      runStart = date;
      runDays = 1;
    }
    if (runDays > bestDays) {
      bestDays = runDays;
      bestStart = runStart;
      bestEnd = date;
    }
    previous = date;
  }

  const streakLabel = bestDays <= 0
    ? "尚未连续"
    : bestDays === 1
      ? (range === "week" ? weekdayLabel(bestStart) : formatMonthDay(bestStart))
      : range === "week"
        ? `${weekdayLabel(bestStart)}—${weekdayLabel(bestEnd)}`
        : `${formatMonthDay(bestStart)}—${formatMonthDay(bestEnd)}`;

  return {
    maxMinutes: {
      value: maxMinutesBar?.minutes || 0,
      unit: "分钟",
      label: highlightBucketLabel(range, maxMinutesBar),
    },
    maxActions: {
      value: maxActionsBar?.actions || 0,
      unit: "项",
      label: highlightBucketLabel(range, maxActionsBar),
    },
    streak: { value: bestDays, unit: "天", label: streakLabel },
  };
}

interface TrendViewData {
  barChart: BarChartData;
  trendSummary: TrendSummary;
  trendHighlights: TrendHighlights;
  heatmapWeeks: HeatmapWeek[];
  heatmapMonthLabels: HeatmapMonthLabel[];
  yearSummary: YearSummary;
  yearHighlights: YearHighlights;
}

function buildTrendView(
  range: TrendRange,
  tasks: ActionTask[],
  today: string,
  selectedBarKey?: string,
  selectedHeatDate?: string,
): TrendViewData {
  const year = toDate(today).getFullYear();

  if (range === "week") {
    const buckets = buildWeekBuckets(today);
    const bars = buckets.map((bucket) => {
      const data = bucket.start > today ? { minutes: 0, actions: 0 } : sumRange(tasks, bucket.start, bucket.end);
      return {
        key: bucket.key,
        label: bucket.label,
        subLabel: "",
        minutes: data.minutes,
        actions: data.actions,
        isToday: bucket.isToday,
      };
    });
    const barChart = buildBarChart(bars, selectedBarKey, WEEK_BAR_WIDTH);
    return {
      barChart,
      trendSummary: buildWeekSummary(buckets, tasks, today),
      trendHighlights: buildTrendHighlights("week", barChart.bars, tasks, buckets[0].start, today),
      heatmapWeeks: [],
      heatmapMonthLabels: [],
      yearSummary: { checkinDays: 0, totalMinutes: 0, maxStreakDays: 0, summaryText: "", insufficient: false },
      yearHighlights: { maxDay: null, maxStreak: null, maxMonth: null },
    };
  }

  if (range === "month") {
    const buckets = buildMonthBuckets(today);
    const bars = buckets.map((bucket) => {
      const data = bucket.start > today
        ? { minutes: 0, actions: 0 }
        : sumRange(tasks, bucket.start, bucket.end > today ? today : bucket.end);
      return {
        key: bucket.key,
        label: bucket.label,
        subLabel: bucket.rangeLabel,
        minutes: data.minutes,
        actions: data.actions,
        isToday: false,
      };
    });
    const barChart = buildBarChart(bars, selectedBarKey, MONTH_BAR_WIDTH);
    return {
      barChart,
      trendSummary: buildMonthSummary(buckets, tasks, today),
      trendHighlights: buildTrendHighlights("month", barChart.bars, tasks, buckets[0].start, today),
      heatmapWeeks: [],
      heatmapMonthLabels: [],
      yearSummary: { checkinDays: 0, totalMinutes: 0, maxStreakDays: 0, summaryText: "", insufficient: false },
      yearHighlights: { maxDay: null, maxStreak: null, maxMonth: null },
    };
  }

  const { weeks, monthLabels } = buildYearHeatmap(year, today, tasks, selectedHeatDate);
  return {
    barChart: { bars: [], maxLabel: "", midLabel: "", lowLabel: "", maxValue: 0, maxActions: 0, midActions: 0, lowActions: 0, barWidth: 0, insufficient: false },
    trendSummary: { totalMinutes: 0, totalActions: 0, summaryText: "", insufficient: false },
    trendHighlights: emptyTrendHighlights(),
    heatmapWeeks: weeks,
    heatmapMonthLabels: monthLabels,
    yearSummary: buildYearSummary(year, today, tasks),
    yearHighlights: buildYearHighlights(year, tasks),
  };
}

function trendHasData(range: TrendRange, trendView: TrendViewData): boolean {
  return range === "year"
    ? !trendView.yearSummary.insufficient
    : !trendView.trendSummary.insufficient;
}

Page(withAppTheme({
  data: {
    ...getTabHeaderLayout(),
    appTheme: getCurrentThemeId() as string,
    status: "loading",
    errorMessage: "",
    goal: null as Goal | null,
    goalOptions: [] as GoalOption[],
    canSwitchGoal: false,
    goalPickerVisible: false,
    completionDotsEnabled: FEATURE_FLAGS.ENABLE_TREND_LINE,
    goalPeriod: "",
    overviewStats: [] as OverviewStat[],
    trendRange: "week" as TrendRange,
    trendPeriodLabel: "",
    trendRanges: buildTrendRanges("week"),
    coachScopeLabel: "本周",
    barChart: { bars: [], maxLabel: "", midLabel: "", lowLabel: "", maxValue: 0, maxActions: 0, midActions: 0, lowActions: 0, barWidth: WEEK_BAR_WIDTH, insufficient: false } as BarChartData,
    trendSummary: { totalMinutes: 0, totalActions: 0, summaryText: "", insufficient: false } as TrendSummary,
    trendHighlights: emptyTrendHighlights() as TrendHighlights,
    selectedTrendItem: null as TrendBar | null,
    heatmapWeeks: [] as HeatmapWeek[],
    heatmapMonthLabels: [] as HeatmapMonthLabel[],
    yearSummary: { checkinDays: 0, totalMinutes: 0, maxStreakDays: 0, summaryText: "", insufficient: false } as YearSummary,
    yearHighlights: { maxDay: null, maxStreak: null, maxMonth: null } as YearHighlights,
    selectedHeatmapDay: null as SelectedHeatmapDay | null,
    growthRecordSummary: "还没有真实行动记录",
    hasAnyTask: false,
    hasActionData: false,
    hasTrendData: false,
  },
  focusGoalHandler: null as null | (() => void),
  manualSyncHandler: null as null | (() => void),

  onLoad() {
    this.focusGoalHandler = () => this.load();
    this.manualSyncHandler = () => this.load();
    on("goal:focus:update", this.focusGoalHandler);
    on("manual:sync", this.manualSyncHandler);
  },

  onUnload() {
    if (this.focusGoalHandler) {
      off("goal:focus:update", this.focusGoalHandler);
      this.focusGoalHandler = null;
    }
    if (this.manualSyncHandler) {
      off("manual:sync", this.manualSyncHandler);
      this.manualSyncHandler = null;
    }
  },

  onShow() {
    (this as any).getTabBar?.()?.syncSelected?.();
    this.setData({ appTheme: getCurrentThemeId() });
    this.load();
  },

  load() {
    if (this.data.status !== "ready") this.setData({ status: "loading", errorMessage: "" });
    try {
      const today = getTodayBusinessDate();
      const goal = getActiveGoal();
      const activeGoals = getActiveGoals();
      const summary = goal ? getProgressSummary(goal.id, today) : null;
      const allTasks = goal ? getTaskHistoryByGoal(goal.id) : [];
      const trendView = buildTrendView(this.data.trendRange, allTasks, today);

      const hasAnyTask = allTasks.some((task) => task.status !== "skipped" && task.status !== "rescheduled");
      const hasActionData = allTasks.some((task) => task.status !== "skipped" && (
        task.status === "completed"
        || task.status === "partially_completed"
        || (task.status === "rescheduled" && task.statusBeforeReschedule === "partially_completed" && (task.actualMinutes || 0) > 0)
      ));
      this.setData({
        status: "ready",
        goal,
        goalOptions: buildGoalOptions(activeGoals, goal?.id || ""),
        canSwitchGoal: activeGoals.length > 1,
        goalPickerVisible: false,
        goalPeriod: goalPeriod(goal),
        overviewStats: buildOverview(summary),
        trendRanges: buildTrendRanges(this.data.trendRange),
        trendPeriodLabel: trendPeriodLabel(this.data.trendRange, today),
        coachScopeLabel: coachScopeLabel(this.data.trendRange),
        barChart: trendView.barChart,
        trendSummary: trendView.trendSummary,
        trendHighlights: trendView.trendHighlights,
        selectedTrendItem: trendView.barChart.bars.find((bar) => bar.active) || null,
        heatmapWeeks: trendView.heatmapWeeks,
        heatmapMonthLabels: trendView.heatmapMonthLabels,
        yearSummary: trendView.yearSummary,
        yearHighlights: trendView.yearHighlights,
        selectedHeatmapDay: null,
        growthRecordSummary: summary && (summary.completedTasks > 0 || summary.totalActualMinutes > 0)
          ? `完成 ${summary.completedTasks} 项 · 投入 ${summary.totalActualMinutes} 分钟 · 行动 ${summary.totalActionDays} 天`
          : "还没有真实行动记录，完成后会在这里沉淀",
        hasAnyTask,
        hasActionData,
        hasTrendData: trendHasData(this.data.trendRange, trendView),
      });
    } catch (error) {
      this.setData({
        status: "error",
        errorMessage: error instanceof Error ? error.message : "进度读取失败",
      });
    }
  },

  retry() {
    this.load();
  },

  noop() {},

  createGoal() {
    wx.navigateTo({ url: "/pages/goal-create/index" });
  },

  addTodayAction() {
    const goalId = this.data.goal?.id;
    if (!goalId) {
      this.createGoal();
      return;
    }
    wx.navigateTo({ url: `/pages/action-edit/index?goalId=${encodeURIComponent(goalId)}&date=${getTodayBusinessDate()}` });
  },

  goToday() {
    wx.switchTab({ url: "/pages/index/index" });
  },

  openGrowthRecords() {
    const goalId = this.data.goal?.id;
    if (!goalId) return;
    wx.navigateTo({ url: `/pages/growth-records/index?from=progress&goalId=${encodeURIComponent(goalId)}` });
  },

  openGoalPicker() {
    if (this.data.goalOptions.length <= 1) {
      if (this.data.goal?.id) wx.navigateTo({ url: `/pages/goal-detail/index?id=${this.data.goal.id}` });
      return;
    }
    this.setData({ goalPickerVisible: true });
  },

  closeGoalPicker() {
    this.setData({ goalPickerVisible: false });
  },

  switchGoal(event: { currentTarget: { dataset: { id?: string } } }) {
    const id = String(event.currentTarget.dataset.id || "");
    if (!id || id === this.data.goal?.id) {
      this.closeGoalPicker();
      return;
    }
    try {
      this.setData({ goalPickerVisible: false, trendRange: "week", trendRanges: buildTrendRanges("week") });
      setCurrentGoal(id);
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "目标切换失败", icon: "none" });
    }
  },

  switchTrendRange(event: { currentTarget: { dataset: { key?: TrendRange } } }) {
    const range = event.currentTarget.dataset.key || "week";
    if (range === this.data.trendRange) return;
    const today = getTodayBusinessDate();
    const tasks = this.data.goal ? getTaskHistoryByGoal(this.data.goal.id) : [];
    const trendView = buildTrendView(range, tasks, today);
    this.setData({
      trendRange: range,
      trendRanges: buildTrendRanges(range),
      trendPeriodLabel: trendPeriodLabel(range, today),
      coachScopeLabel: coachScopeLabel(range),
      barChart: trendView.barChart,
      trendSummary: trendView.trendSummary,
      trendHighlights: trendView.trendHighlights,
      heatmapWeeks: trendView.heatmapWeeks,
      heatmapMonthLabels: trendView.heatmapMonthLabels,
      yearSummary: trendView.yearSummary,
      yearHighlights: trendView.yearHighlights,
      hasTrendData: trendHasData(range, trendView),
      selectedTrendItem: null,
      selectedHeatmapDay: null,
    });
  },

  openAiCoach() {
    if (!this.data.hasTrendData) return;
    const goalId = this.data.goal?.id || "";
    const scope = this.data.trendRange === "year" ? "overall" : this.data.trendRange;
    const query = [`scope=${scope}`];
    if (goalId) query.push(`goalId=${encodeURIComponent(goalId)}`);
    wx.navigateTo({ url: `/pages/ai-coach/index?${query.join("&")}` });
  },

  onBarTap(event: { currentTarget: { dataset: { key?: string } } }) {
    const key = String(event.currentTarget.dataset.key || "");
    const today = getTodayBusinessDate();
    const tasks = this.data.goal ? getTaskHistoryByGoal(this.data.goal.id) : [];
    const currentKey = this.data.selectedTrendItem?.key;
    const nextKey = currentKey === key ? undefined : key;
    const trendView = buildTrendView(this.data.trendRange, tasks, today, nextKey);
    this.setData({
      barChart: trendView.barChart,
      selectedTrendItem: trendView.barChart.bars.find((bar) => bar.active) || null,
    });
  },

  onChartBackdropTap() {
    if (!this.data.selectedTrendItem) return;
    const bars = this.data.barChart.bars.map((bar) => ({ ...bar, active: false }));
    this.setData({
      barChart: { ...this.data.barChart, bars },
      selectedTrendItem: null,
    });
  },

  onHeatmapDayTap(event: { currentTarget: { dataset: { date?: string } } }) {
    const date = String(event.currentTarget.dataset.date || "");
    if (!date) return;
    const today = getTodayBusinessDate();
    const tasks = this.data.goal ? getTaskHistoryByGoal(this.data.goal.id) : [];
    const year = toDate(today).getFullYear();
    const current = this.data.selectedHeatmapDay;
    const nextDate = current && current.date === date ? undefined : date;
    const { weeks } = buildYearHeatmap(year, today, tasks, nextDate);

    let selected: SelectedHeatmapDay | null = null;
    if (nextDate) {
      for (const week of weeks) {
        for (const day of week.days) {
          if (day.date === nextDate) {
            selected = {
              date: nextDate,
              dateLabel: formatMonthDay(nextDate),
              minutes: day.minutes,
              actions: day.actions,
              hasRecord: day.hasRecord,
            };
            break;
          }
        }
        if (selected) break;
      }
    }

    this.setData({
      heatmapWeeks: weeks,
      selectedHeatmapDay: selected,
    });
  },

  openHistoryReview() {
    if (!this.data.goal) return;
    // 当前目标的每日行动、投入和完成记录由日历详情页承接；
    // 历史目标复盘仍保留在“我的 - 历史目标”，两者不再混用。
    wx.navigateTo({ url: "/pages/today-data/index" });
  },
}));
