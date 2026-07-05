import { FEATURE_FLAGS } from "../../config/features";
import { getActiveGoal, getActiveGoals, getArchivedGoals, setCurrentGoal } from "../../services/manualGoal";
import { getProgressSummary } from "../../services/manualStats";
import { getTasksByDate, getTasksByGoal } from "../../services/manualTask";
import { prepareProgressCoach } from "../../services/progressCoach";
import { getCurrentThemeId, withAppTheme } from "../../services/theme";
import { ActionTask, Goal, ProgressSummary } from "../../types/manual";
import { addDays, formatDate, getTodayBusinessDate } from "../../utils/date";
import { off, on } from "../../utils/eventBus";

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

interface AiCoachView {
  periodLabel: string;
  summary: string;
  suggestion: string;
}

interface GoalOption {
  id: string;
  title: string;
  progressPercent: number;
  statusText: string;
  active: boolean;
}

interface TrendBar {
  key: string;
  label: string;
  subLabel: string;
  minutes: number;
  actions: number;
  heightPercent: number;
  tooltipBottomPercent: number;
  isMax: boolean;
  isToday: boolean;
  active: boolean;
  tooltipAlign: "left" | "center" | "right";
}

interface BarChartData {
  bars: TrendBar[];
  maxLabel: string;
  midLabel: string;
  maxValue: number;
  maxActions: number;
  midActions: number;
  barWidth: number;
  insufficient: boolean;
}

interface TrendSummary {
  totalMinutes: number;
  totalActions: number;
  avgMinutes: number;
  streakDays: number;
  completionRate: number;
  compareText: string;
  compareTone: "up" | "down" | "flat";
  bestInvestLabel: string;
  adviceText: string;
  adviceTitle: string;
  adviceDetail: string;
  vsYesterdayText: string;
  summaryText: string;
  insufficient: boolean;
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

type MilestoneState = "achieved" | "current" | "locked";

interface MilestoneView {
  days: number;
  label: string;
  state: MilestoneState;
  statusText: string;
}

interface RecentRecord {
  id: string;
  title: string;
  statusText: string;
  minutesText: string;
}

interface MedalState {
  achieved: boolean;
  current: boolean;
}

const TREND_RANGES: Array<{ key: TrendRange; label: string }> = [
  { key: "week", label: "周" },
  { key: "month", label: "月" },
  { key: "year", label: "年" },
];

const MILESTONE_DAYS = [7, 14, 30, 60];

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

function completionRate(summary: ProgressSummary | null): number {
  if (!summary || summary.totalTasks <= 0) return 0;
  return Math.round((summary.completedTasks / summary.totalTasks) * 100);
}

function levelLabel(actionDays: number): string {
  if (actionDays >= 60) return "Lv.5 · 长期主义者";
  if (actionDays >= 30) return "Lv.4 · 稳定推进者";
  if (actionDays >= 14) return "Lv.3 · 行动熟手";
  if (actionDays >= 7) return "Lv.2 · 自律新星";
  return "Lv.1 · 自律新兵";
}

function goalStatusText(rate: number, totalTasks: number): string {
  if (totalTasks <= 0) return "添加行动后开始记录";
  if (rate >= 100) return "当前行动已完成";
  if (rate >= 70) return "接近完成";
  if (rate >= 30) return "稳定推进";
  return "刚开始";
}

function goalPeriod(goal: Goal | null): string {
  if (!goal) return "";
  const start = shortDate(goal.startedAt || goal.createdAt);
  return start ? `目标周期 · ${start} 起` : "目标周期 · 已开始";
}

function growthConclusionTitle(range: TrendRange): string {
  if (range === "month") return "本月成长结论";
  if (range === "year") return "年度成长结论";
  return "本周成长结论";
}

function buildTrendRanges(activeKey: TrendRange): TrendRangeOption[] {
  return TREND_RANGES.map((item) => ({ ...item, active: item.key === activeKey }));
}

function buildAiCoachView(goal: Goal | null, trendRange: TrendRange, trendSummary: TrendSummary): AiCoachView {
  const periodLabel = trendRange === "month" ? "本月复盘" : trendRange === "year" ? "年度复盘" : "本周复盘";
  const goalTitle = goal?.title || "当前目标";
  if (trendSummary.insufficient || trendSummary.totalActions <= 0) {
    return {
      periodLabel,
      summary: `当前「${goalTitle}」的数据还在积累中，先保持每天一小步。`,
      suggestion: "等完成更多行动后，这里会展示节奏变化、薄弱时段和下一步建议。",
    };
  }
  return {
    periodLabel,
    summary: `${periodLabel}显示，${trendSummary.compareText}，累计完成 ${trendSummary.totalActions} 项行动。`,
    suggestion: trendSummary.adviceText || `继续围绕「${goalTitle}」保持稳定输出，优先安排最容易启动的一小步。`,
  };
}

function buildGoalOptions(goals: Goal[], activeGoalId: string, today: string): GoalOption[] {
  return goals.map((goal) => {
    const summary = getProgressSummary(goal.id, today);
    const rate = completionRate(summary);
    return {
      id: goal.id,
      title: goal.title,
      progressPercent: rate,
      statusText: goalStatusText(rate, summary.totalTasks),
      active: goal.id === activeGoalId,
    };
  });
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
  if (value <= 4) return 4;
  if (value <= 8) return 8;
  return Math.ceil(value / 5) * 5;
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

function inRange(task: ActionTask, start: string, end: string): boolean {
  return task.currentDate >= start && task.currentDate <= end && task.status !== "rescheduled";
}

function formatMonthDay(date: string): string {
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  return `${month}月${day}日`;
}

function formatShortDate(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

function sumRange(tasks: ActionTask[], start: string, end: string): { minutes: number; actions: number; totalActions: number } {
  let minutes = 0;
  let actions = 0;
  let totalActions = 0;
  for (const task of tasks) {
    if (!inRange(task, start, end)) continue;
    totalActions += 1;
    minutes += task.actualMinutes || 0;
    if (task.status === "completed") actions += 1;
  }
  return { minutes, actions, totalActions };
}

function compareText(current: number, previous: number, label: string): { text: string; tone: TrendSummary["compareTone"] } {
  if (previous <= 0 && current <= 0) return { text: `${label}暂无对比`, tone: "flat" };
  if (previous <= 0) return { text: `${label}新增记录`, tone: "up" };
  const rate = Math.round(((current - previous) / previous) * 100);
  if (rate > 0) return { text: `${label} +${rate}%`, tone: "up" };
  if (rate < 0) return { text: `${label} ${rate}%`, tone: "down" };
  return { text: `${label} 持平`, tone: "flat" };
}

function buildAdviceText(todayMinutes: number, avgMinutes: number, range: TrendRange): string {
  if (todayMinutes <= 0 && avgMinutes <= 0) return "先记录一次投入，趋势线就会开始出现。建议明天保持 30 分钟以上。";
  if (todayMinutes >= avgMinutes && todayMinutes > 0) {
    const target = Math.max(45, Math.ceil(todayMinutes / 5) * 5);
    return `今日已投入 ${todayMinutes} 分钟，达到${range === "week" ? "本周" : "本月"}日均水平。建议明天保持 ${target} 分钟以上。`;
  }
  const target = Math.max(45, avgMinutes ? Math.ceil(avgMinutes / 5) * 5 : 45);
  return `今日投入 ${todayMinutes} 分钟，低于${range === "week" ? "本周" : "本月"}日均 ${avgMinutes} 分钟。建议明天保持 ${target} 分钟以上。`;
}

/** 将建议拆分为「主句（加粗）」和「补充说明（常规）」两段，供 AI 教练气泡分层展示 */
function buildAdviceParts(todayMinutes: number, avgMinutes: number, range: TrendRange): { adviceTitle: string; adviceDetail: string } {
  const rangeLabel = range === "week" ? "本周" : "本月";
  if (todayMinutes <= 0 && avgMinutes <= 0) {
    return { adviceTitle: "还没有投入记录", adviceDetail: "先记录一次投入，趋势线就会开始出现。" };
  }
  if (todayMinutes >= avgMinutes && todayMinutes > 0) {
    const target = Math.max(45, Math.ceil(todayMinutes / 5) * 5);
    return {
      adviceTitle: `今日投入 ${todayMinutes} 分钟，达到${rangeLabel}平均水平。`,
      adviceDetail: `建议明天继续保持 ${target} 分钟以上，连续性会更好。`,
    };
  }
  const target = Math.max(45, avgMinutes ? Math.ceil(avgMinutes / 5) * 5 : 45);
  return {
    adviceTitle: `今日投入 ${todayMinutes} 分钟，低于${rangeLabel}平均 ${avgMinutes} 分钟。`,
    adviceDetail: `建议明天保持 ${target} 分钟以上，逐步追回节奏。`,
  };
}

/** 对比昨日投入差值文案
 * 传入 periodHasData 用于区分"整个周期无数据"与"今日/昨日恰好无记录"两种场景，
 * 避免本周平均/连续投入有数据时，对比昨日却显示"暂无数据"造成信息不一致。
 */
function buildVsYesterdayText(todayMinutes: number, yesterdayMinutes: number, periodHasData: boolean = true): string {
  if (todayMinutes <= 0 && yesterdayMinutes <= 0) {
    return periodHasData ? "今日暂未记录" : "暂无数据";
  }
  if (todayMinutes <= 0) return `-${yesterdayMinutes} 分钟`;
  if (yesterdayMinutes <= 0) return `+${todayMinutes} 分钟`;
  const diff = todayMinutes - yesterdayMinutes;
  if (diff > 0) return `+${diff} 分钟`;
  if (diff < 0) return `${diff} 分钟`;
  return "持平";
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
  return Array.from({ length: 7 }).map((_, index) => {
    const date = formatDate(addDays(todayDate, index - 6));
    return {
      key: date,
      label: index === 6 ? "今天" : formatShortDate(date),
      start: date,
      end: date,
      isToday: index === 6,
    };
  });
}

function buildMonthBuckets(today: string): MonthBucket[] {
  const todayDate = toDate(today);
  const todayDay = todayDate.getDay();
  const mondayOffset = todayDay === 0 ? -6 : 1 - todayDay;
  const currentMonday = addDays(todayDate, mondayOffset);

  const buckets: MonthBucket[] = [];
  for (let i = 4; i >= 0; i -= 1) {
    const start = formatDate(addDays(currentMonday, -7 * i));
    const end = formatDate(addDays(currentMonday, -7 * i + 6));
    buckets.push({
      key: `${start}-${end}`,
      label: formatShortDate(start),
      rangeLabel: `${formatShortDate(start)}-${formatShortDate(end)}`,
      start,
      end,
    });
  }
  return buckets;
}

function computeStreakDays(taskDates: string[], endDate: string): number {
  const set = new Set(taskDates);
  let streak = 0;
  let cursor = toDate(endDate);
  while (true) {
    const dateStr = formatDate(cursor);
    if (!set.has(dateStr)) break;
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function buildBarChart(
  bars: Array<{ key: string; label: string; subLabel: string; minutes: number; actions: number; isToday: boolean }>,
  selectedKey: string | undefined,
  barWidth: number,
): BarChartData {
  const maxValue = niceMaxMinutes(Math.max(30, ...bars.map((item) => item.minutes)));
  const maxActions = niceMaxActions(Math.max(1, ...bars.map((item) => item.actions)));
  const nonZeroCount = bars.filter((item) => item.minutes > 0).length;
  const maxMinuteValue = Math.max(...bars.map((item) => item.minutes));
  const selected = selectedKey && bars.some((item) => item.key === selectedKey)
    ? selectedKey
    : [...bars].reverse().find((item) => item.minutes > 0)?.key || bars[bars.length - 1]?.key || "";

  const trendBars: TrendBar[] = bars.map((item, index) => {
    const heightPercent = item.minutes <= 0 ? 0 : Math.max(4, (item.minutes / maxValue) * 78);
    const tooltipAlign: TrendBar["tooltipAlign"] = index === 0 ? "left" : index === bars.length - 1 ? "right" : "center";
    return {
      key: item.key,
      label: item.label,
      subLabel: item.subLabel,
      minutes: item.minutes,
      actions: item.actions,
      heightPercent,
      tooltipBottomPercent: Math.min(68, heightPercent),
      isMax: item.minutes > 0 && item.minutes === maxMinuteValue,
      isToday: item.isToday,
      active: item.key === selected,
      tooltipAlign,
    };
  });

  return {
    bars: trendBars,
    maxLabel: formatAxisLabel(maxValue),
    midLabel: formatAxisLabel(Math.round(maxValue / 2)),
    maxValue,
    maxActions,
    midActions: Math.round(maxActions / 2),
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
  const totalActionCount = perDay.reduce((sum, item) => sum + item.totalActions, 0);
  const activeDays = perDay.filter((item) => item.minutes > 0).length;
  const avgMinutes = activeDays > 0 ? Math.round(totalMinutes / activeDays) : 0;
  const completionRate = totalActionCount > 0 ? Math.round((totalActions / totalActionCount) * 100) : 0;

  const taskDates = tasks
    .filter((task) => task.status === "completed" || task.status === "partially_completed")
    .map((task) => task.currentDate);
  const streakDays = computeStreakDays(taskDates, today);

  const todayMinutes = perDay[perDay.length - 1]?.minutes || 0;
  const yesterdayMinutes = perDay[perDay.length - 2]?.minutes || 0;
  const previousStart = formatDate(addDays(toDate(buckets[0].start), -7));
  const previousEnd = formatDate(addDays(toDate(buckets[0].start), -1));
  const compare = compareText(totalMinutes, sumRange(tasks, previousStart, previousEnd).minutes, "较上周");
  const maxIndex = perDay.reduce((best, item, index) => item.minutes > perDay[best].minutes ? index : best, 0);
  const bestInvestLabel = perDay[maxIndex]?.minutes > 0 ? buckets[maxIndex].label : "-";

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
    avgMinutes,
    streakDays,
    completionRate,
    compareText: compare.text,
    compareTone: compare.tone,
    bestInvestLabel,
    adviceText: buildAdviceText(todayMinutes, avgMinutes, "week"),
    ...buildAdviceParts(todayMinutes, avgMinutes, "week"),
    vsYesterdayText: buildVsYesterdayText(todayMinutes, yesterdayMinutes, activeDays > 0),
    summaryText,
    insufficient: activeDays < 1,
  };
}

function buildMonthSummary(
  buckets: MonthBucket[],
  tasks: ActionTask[],
  today: string,
): TrendSummary {
  const perWeek = buckets.map((bucket) => sumRange(tasks, bucket.start, bucket.end));
  const totalMinutes = perWeek.reduce((sum, item) => sum + item.minutes, 0);
  const totalActions = perWeek.reduce((sum, item) => sum + item.actions, 0);
  const totalActionCount = perWeek.reduce((sum, item) => sum + item.totalActions, 0);
  const activeWeeks = perWeek.filter((item) => item.minutes > 0).length;
  const completionRate = totalActionCount > 0 ? Math.round((totalActions / totalActionCount) * 100) : 0;
  const dayCount = buckets.reduce((sum, bucket) => {
    const start = toDate(bucket.start);
    const end = toDate(bucket.end);
    return sum + Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  }, 0);
  const avgMinutes = dayCount > 0 ? Math.round(totalMinutes / dayCount) : 0;

  const taskDates = tasks
    .filter((task) => task.status === "completed" || task.status === "partially_completed")
    .map((task) => task.currentDate);
  const streakDays = computeStreakDays(taskDates, today);
  const previousStart = formatDate(addDays(toDate(buckets[0].start), -35));
  const previousEnd = formatDate(addDays(toDate(buckets[0].start), -1));
  const compare = compareText(totalMinutes, sumRange(tasks, previousStart, previousEnd).minutes, "较上月");
  const maxIndex = perWeek.reduce((best, item, index) => item.minutes > perWeek[best].minutes ? index : best, 0);
  const bestInvestLabel = perWeek[maxIndex]?.minutes > 0 ? buckets[maxIndex].label : "-";

  const todayMinutes = sumRange(tasks, today, today).minutes;
  const yesterdayDate = formatDate(addDays(toDate(today), -1));
  const yesterdayMinutes = sumRange(tasks, yesterdayDate, yesterdayDate).minutes;

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
    avgMinutes,
    streakDays,
    completionRate,
    compareText: compare.text,
    compareTone: compare.tone,
    bestInvestLabel,
    adviceText: buildAdviceText(totalMinutes, avgMinutes, "month"),
    ...buildAdviceParts(todayMinutes, avgMinutes, "month"),
    vsYesterdayText: buildVsYesterdayText(todayMinutes, yesterdayMinutes, activeWeeks > 0),
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
    if (!task.currentDate.startsWith(String(year))) continue;
    if (task.status === "rescheduled") continue;
    const entry = dayMap.get(task.currentDate) || { minutes: 0, actions: 0 };
    entry.minutes += task.actualMinutes || 0;
    if (task.status === "completed") entry.actions += 1;
    dayMap.set(task.currentDate, entry);
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
    if (!task.currentDate.startsWith(String(year))) continue;
    if (task.status === "rescheduled") continue;
    const minutes = task.actualMinutes || 0;
    if (minutes > 0 && !activeDates.includes(task.currentDate)) {
      activeDates.push(task.currentDate);
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

  const insufficient = checkinDays < 7;
  let summaryText: string;
  if (insufficient) {
    summaryText = "今年的记录还不多，继续打卡后颜色会慢慢变深。";
  } else {
    const percentile = Math.min(95, Math.round((checkinDays / Math.max(1, dayOfYear)) * 100));
    summaryText = `今年你有 ${checkinDays} 天坚持了投入，超过了 ${percentile}% 的用户 🎉`;
  }

  return { checkinDays, totalMinutes, maxStreakDays, summaryText, insufficient };
}

function buildYearHighlights(year: number, tasks: ActionTask[]): YearHighlights {
  const dayMap = new Map<string, { minutes: number; actions: number }>();
  const monthMap = new Map<number, number>();

  for (const task of tasks) {
    if (!task.currentDate.startsWith(String(year))) continue;
    if (task.status === "rescheduled") continue;
    const entry = dayMap.get(task.currentDate) || { minutes: 0, actions: 0 };
    entry.minutes += task.actualMinutes || 0;
    if (task.status === "completed") entry.actions += 1;
    dayMap.set(task.currentDate, entry);

    const month = Number(task.currentDate.slice(5, 7)) - 1;
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
    { label: "坚持天数", value: String(summary?.totalActionDays || 0), unit: "天" },
    { label: "完成项数", value: String(completed), unit: "项" },
    { label: "累计投入", value: String(summary?.totalActualMinutes || 0), unit: "分钟" },
  ];
}

function buildMilestones(actionDays: number): { milestones: MilestoneView[]; nextText: string; medalState: MedalState } {
  const nextTarget = MILESTONE_DAYS.find((days) => actionDays < days);
  const milestones = MILESTONE_DAYS.map((days) => {
    const state: MilestoneState = actionDays >= days ? "achieved" : days === nextTarget ? "current" : "locked";
    return {
      days,
      label: `${days} 天`,
      state,
      statusText: state === "achieved" ? "已达成" : state === "current" ? "进行中" : "未达成",
    };
  });
  return {
    milestones,
    nextText: nextTarget ? `距离下个里程碑还差 ${nextTarget - actionDays} 天` : "60 天里程碑已达成",
    medalState: { achieved: !nextTarget, current: Boolean(nextTarget) },
  };
}

function buildRecentRecords(tasks: ActionTask[]): RecentRecord[] {
  return tasks
    .filter((task) => task.status === "completed" || task.status === "partially_completed")
    .slice(0, 3)
    .map((task) => ({
      id: task.id,
      title: task.title,
      statusText: task.status === "completed" ? "已完成" : "完成一部分",
      minutesText: `${task.actualMinutes || task.estimatedMinutes} 分钟`,
    }));
}

interface TrendViewData {
  barChart: BarChartData;
  trendSummary: TrendSummary;
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
      const data = sumRange(tasks, bucket.start, bucket.end);
      return {
        key: bucket.key,
        label: bucket.label,
        subLabel: "",
        minutes: data.minutes,
        actions: data.actions,
        isToday: bucket.isToday,
      };
    });
    return {
      barChart: buildBarChart(bars, selectedBarKey, WEEK_BAR_WIDTH),
      trendSummary: buildWeekSummary(buckets, tasks, today),
      heatmapWeeks: [],
      heatmapMonthLabels: [],
      yearSummary: { checkinDays: 0, totalMinutes: 0, maxStreakDays: 0, summaryText: "", insufficient: false },
      yearHighlights: { maxDay: null, maxStreak: null, maxMonth: null },
    };
  }

  if (range === "month") {
    const buckets = buildMonthBuckets(today);
    const bars = buckets.map((bucket) => {
      const data = sumRange(tasks, bucket.start, bucket.end);
      return {
        key: bucket.key,
        label: bucket.label,
        subLabel: bucket.rangeLabel,
        minutes: data.minutes,
        actions: data.actions,
        isToday: false,
      };
    });
    return {
      barChart: buildBarChart(bars, selectedBarKey, MONTH_BAR_WIDTH),
      trendSummary: buildMonthSummary(buckets, tasks, today),
      heatmapWeeks: [],
      heatmapMonthLabels: [],
      yearSummary: { checkinDays: 0, totalMinutes: 0, maxStreakDays: 0, summaryText: "", insufficient: false },
      yearHighlights: { maxDay: null, maxStreak: null, maxMonth: null },
    };
  }

  const { weeks, monthLabels } = buildYearHeatmap(year, today, tasks, selectedHeatDate);
  return {
    barChart: { bars: [], maxLabel: "", midLabel: "", maxValue: 0, maxActions: 0, midActions: 0, barWidth: 0, insufficient: false },
    trendSummary: { totalMinutes: 0, totalActions: 0, avgMinutes: 0, streakDays: 0, completionRate: 0, compareText: "", compareTone: "flat", bestInvestLabel: "-", adviceText: "", adviceTitle: "", adviceDetail: "", vsYesterdayText: "暂无数据", summaryText: "", insufficient: false },
    heatmapWeeks: weeks,
    heatmapMonthLabels: monthLabels,
    yearSummary: buildYearSummary(year, today, tasks),
    yearHighlights: buildYearHighlights(year, tasks),
  };
}

Page(withAppTheme({
  data: {
    appTheme: getCurrentThemeId() as string,
    status: "loading",
    errorMessage: "",
    goal: null as Goal | null,
    goalOptions: [] as GoalOption[],
    canSwitchGoal: false,
    goalPickerVisible: false,
    trendLineEnabled: FEATURE_FLAGS.ENABLE_TREND_LINE,
    chartCanvasVisible: true,
    summary: null as ProgressSummary | null,
    levelLabel: "Lv.1 · 自律新兵",
    levelNumber: "Lv.1",
    levelName: "自律新兵",
    goalPeriod: "",
    goalStatusText: "添加行动后开始记录",
    goalProgressPercent: 0,
    overviewStats: [] as OverviewStat[],
    growthConclusionTitle: "本周成长结论",
    trendRange: "week" as TrendRange,
    trendRanges: buildTrendRanges("week"),
    aiCoach: { periodLabel: "本周复盘", summary: "数据正在整理中。", suggestion: "完成更多行动后，这里会展示 AI 进度教练建议。" } as AiCoachView,
    barChart: { bars: [], maxLabel: "", midLabel: "", maxValue: 0, maxActions: 0, midActions: 0, barWidth: WEEK_BAR_WIDTH, insufficient: false } as BarChartData,
    trendSummary: { totalMinutes: 0, totalActions: 0, avgMinutes: 0, streakDays: 0, completionRate: 0, compareText: "", compareTone: "flat", bestInvestLabel: "-", adviceText: "", adviceTitle: "", adviceDetail: "", vsYesterdayText: "暂无数据", summaryText: "", insufficient: false } as TrendSummary,
    selectedTrendItem: null as TrendBar | null,
    heatmapWeeks: [] as HeatmapWeek[],
    heatmapMonthLabels: [] as HeatmapMonthLabel[],
    yearSummary: { checkinDays: 0, totalMinutes: 0, maxStreakDays: 0, summaryText: "", insufficient: false } as YearSummary,
    yearHighlights: { maxDay: null, maxStreak: null, maxMonth: null } as YearHighlights,
    selectedHeatmapDay: null as SelectedHeatmapDay | null,
    milestones: [] as MilestoneView[],
    nextMilestoneText: "距离下个里程碑还差 7 天",
    medalState: { achieved: false, current: true } as MedalState,
    recentRecords: [] as RecentRecord[],
    latestRecord: null as RecentRecord | null,
    hasRecentRecords: false,
    hasHistoryReview: false,
  },
  focusGoalHandler: null as null | (() => void),
  chartCanvasTimer: null as ReturnType<typeof setTimeout> | null,

  onLoad() {
    this.focusGoalHandler = () => this.load();
    on("goal:focus:update", this.focusGoalHandler);
  },

  onUnload() {
    if (this.chartCanvasTimer) {
      clearTimeout(this.chartCanvasTimer);
      this.chartCanvasTimer = null;
    }
    if (this.focusGoalHandler) {
      off("goal:focus:update", this.focusGoalHandler);
      this.focusGoalHandler = null;
    }
  },

  onShow() {
    if (this.chartCanvasTimer) clearTimeout(this.chartCanvasTimer);
    this.setData({ appTheme: getCurrentThemeId(), chartCanvasVisible: false });
    this.load();
    this.chartCanvasTimer = setTimeout(() => {
      this.setData({ chartCanvasVisible: true }, () => wx.nextTick(() => { this.drawGoalRing(); this.drawTrendLine(); }));
      this.chartCanvasTimer = null;
    }, 220);
  },

  onHide() {
    if (this.chartCanvasTimer) {
      clearTimeout(this.chartCanvasTimer);
      this.chartCanvasTimer = null;
    }
    this.setData({ chartCanvasVisible: false });
  },

  load() {
    this.setData({ status: "loading", errorMessage: "" });
    try {
      const today = getTodayBusinessDate();
      const goal = getActiveGoal();
      const activeGoals = getActiveGoals();
      const summary = goal ? getProgressSummary(goal.id, today) : null;
      const allTasks = goal ? getTasksByGoal(goal.id) : [];
      const todayTasks = goal ? getTasksByDate(goal.id, today) : [];
      const rate = completionRate(summary);
      const trendView = buildTrendView(this.data.trendRange, allTasks, today);
      const milestoneResult = buildMilestones(summary?.totalActionDays || 0);

      const recentRecords = buildRecentRecords(todayTasks);
      const currentLevelLabel = levelLabel(summary?.totalActionDays || 0);
      const [levelNumber, levelName] = currentLevelLabel.split(" · ");
      this.setData({
        status: "ready",
        goal,
        goalOptions: buildGoalOptions(activeGoals, goal?.id || "", today),
        canSwitchGoal: activeGoals.length > 1,
        goalPickerVisible: false,
        summary,
        levelLabel: currentLevelLabel,
        levelNumber,
        levelName,
        goalPeriod: goalPeriod(goal),
        goalStatusText: goalStatusText(rate, summary?.totalTasks || 0),
        goalProgressPercent: rate,
        overviewStats: buildOverview(summary),
        growthConclusionTitle: growthConclusionTitle(this.data.trendRange),
        trendRanges: buildTrendRanges(this.data.trendRange),
        aiCoach: buildAiCoachView(goal, this.data.trendRange, trendView.trendSummary),
        barChart: trendView.barChart,
        trendSummary: trendView.trendSummary,
        selectedTrendItem: trendView.barChart.bars.find((bar) => bar.active) || null,
        heatmapWeeks: trendView.heatmapWeeks,
        heatmapMonthLabels: trendView.heatmapMonthLabels,
        yearSummary: trendView.yearSummary,
        yearHighlights: trendView.yearHighlights,
        selectedHeatmapDay: null,
        milestones: milestoneResult.milestones,
        nextMilestoneText: milestoneResult.nextText,
        medalState: milestoneResult.medalState,
        recentRecords,
        latestRecord: recentRecords[0] || null,
        hasRecentRecords: recentRecords.length > 0,
        hasHistoryReview: getArchivedGoals().length > 0,
      }, () => {
        this.drawGoalRing();
        this.drawTrendLine();
        if (goal?.id && this.data.trendRange !== "year") {
          prepareProgressCoach(this.data.trendRange, goal.id).catch(() => undefined);
        }
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

  openGoalPicker() {
    if (this.data.goalOptions.length <= 1) {
      if (this.data.goal?.id) wx.navigateTo({ url: `/pages/goal-detail/index?id=${this.data.goal.id}` });
      return;
    }
    this.setData({ goalPickerVisible: true });
  },

  closeGoalPicker() {
    this.setData({ goalPickerVisible: false }, () => {
      wx.nextTick(() => {
        this.drawGoalRing();
        this.drawTrendLine();
      });
    });
  },

  switchGoal(event: { currentTarget: { dataset: { id?: string } } }) {
    const id = String(event.currentTarget.dataset.id || "");
    if (!id || id === this.data.goal?.id) {
      this.closeGoalPicker();
      return;
    }
    try {
      setCurrentGoal(id);
      this.setData({ goalPickerVisible: false, trendRange: "week", trendRanges: buildTrendRanges("week") });
      this.load();
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "目标切换失败", icon: "none" });
    }
  },

  switchTrendRange(event: { currentTarget: { dataset: { key?: TrendRange } } }) {
    const range = event.currentTarget.dataset.key || "week";
    if (range === this.data.trendRange) return;
    const today = getTodayBusinessDate();
    const tasks = this.data.goal ? getTasksByGoal(this.data.goal.id) : [];
    const trendView = buildTrendView(range, tasks, today);
    this.setData({
      trendRange: range,
      trendRanges: buildTrendRanges(range),
      aiCoach: buildAiCoachView(this.data.goal, range, trendView.trendSummary),
      growthConclusionTitle: growthConclusionTitle(range),
      barChart: trendView.barChart,
      trendSummary: trendView.trendSummary,
      heatmapWeeks: trendView.heatmapWeeks,
      heatmapMonthLabels: trendView.heatmapMonthLabels,
      yearSummary: trendView.yearSummary,
      yearHighlights: trendView.yearHighlights,
      selectedTrendItem: null,
      selectedHeatmapDay: null,
    }, () => {
      this.drawTrendLine();
      if (this.data.goal?.id && range !== "year") {
        prepareProgressCoach(range, this.data.goal.id).catch(() => undefined);
      }
    });
  },

  openAiCoach() {
    if (this.data.trendRange === "year") {
      wx.showToast({ title: "年度教练分析正在准备中", icon: "none" });
      return;
    }
    const goalId = this.data.goal?.id || "";
    const query = [`scope=${this.data.trendRange}`];
    if (goalId) query.push(`goalId=${encodeURIComponent(goalId)}`);
    wx.navigateTo({ url: `/pages/ai-coach/index?${query.join("&")}` });
  },

  onBarTap(event: { currentTarget: { dataset: { key?: string } } }) {
    const key = String(event.currentTarget.dataset.key || "");
    const today = getTodayBusinessDate();
    const tasks = this.data.goal ? getTasksByGoal(this.data.goal.id) : [];
    const currentKey = this.data.selectedTrendItem?.key;
    const nextKey = currentKey === key ? undefined : key;
    const trendView = buildTrendView(this.data.trendRange, tasks, today, nextKey);
    this.setData({
      barChart: trendView.barChart,
      selectedTrendItem: trendView.barChart.bars.find((bar) => bar.active) || null,
    }, () => this.drawTrendLine());
  },

  onChartBackdropTap() {
    if (!this.data.selectedTrendItem) return;
    const bars = this.data.barChart.bars.map((bar) => ({ ...bar, active: false }));
    this.setData({
      barChart: { ...this.data.barChart, bars },
      selectedTrendItem: null,
    }, () => this.drawTrendLine());
  },

  onHeatmapDayTap(event: { currentTarget: { dataset: { date?: string } } }) {
    const date = String(event.currentTarget.dataset.date || "");
    if (!date) return;
    const today = getTodayBusinessDate();
    const tasks = this.data.goal ? getTasksByGoal(this.data.goal.id) : [];
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

  drawGoalRing() {
    if (!this.data.goal || !this.data.chartCanvasVisible || this.data.goalPickerVisible) return;
    const query = wx.createSelectorQuery();
    query.select("#goalRing").fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) return;
      const canvas = res[0].node as { width: number; height: number; getContext: (type: "2d") => CanvasRenderingContext2D };
      const ctx = canvas.getContext("2d");
      const dpr = wx.getWindowInfo().pixelRatio;
      const width = res[0].width;
      const height = res[0].height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);
      const centerX = width / 2;
      const centerY = height / 2;
      const lineWidth = Math.max(10, width * 0.075);
      const radius = Math.max(1, Math.min(width, height) / 2 - lineWidth);
      const startAngle = -Math.PI / 2;
      const progress = Math.max(0, Math.min(100, this.data.goalProgressPercent)) / 100;

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.strokeStyle = "#EAF1E5";
      ctx.lineWidth = lineWidth;
      ctx.lineCap = "round";
      ctx.stroke();

      if (progress > 0) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, startAngle, startAngle + Math.PI * 2 * progress);
        ctx.strokeStyle = "#2F6F4B";
        ctx.lineWidth = lineWidth;
        ctx.lineCap = "round";
        ctx.stroke();
      }
    });
  },

  drawTrendLine() {
    if (!FEATURE_FLAGS.ENABLE_TREND_LINE) return;
    if (this.data.trendRange === "year") return;
    const bars = this.data.barChart.bars;
    if (bars.length === 0 || this.data.barChart.insufficient) return;

    const query = wx.createSelectorQuery();
    query.select("#trendLine").fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) return;
      const canvas = res[0].node as { width: number; height: number; getContext: (type: "2d") => CanvasRenderingContext2D };
      const ctx = canvas.getContext("2d");
      const dpr = wx.getWindowInfo().pixelRatio;
      const width = res[0].width;
      const height = res[0].height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const maxValue = Math.max(1, this.data.barChart.maxActions);
      const count = bars.length;
      const chartTopPadding = 28;
      const chartBottomPadding = 9;
      const drawableHeight = Math.max(1, height - chartTopPadding - chartBottomPadding);
      const points = bars.map((bar, index) => {
        const ratio = Math.max(0, Math.min(1, bar.actions / maxValue));
        return {
          x: ((index + 0.5) / count) * width,
          y: chartTopPadding + (1 - ratio) * drawableHeight,
        };
      });

      // 平滑曲线
      ctx.beginPath();
      ctx.strokeStyle = "#55A84F";
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      if (points.length === 1) {
        ctx.moveTo(points[0].x, points[0].y);
        ctx.lineTo(points[0].x, points[0].y);
      } else {
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 0; i < points.length - 1; i += 1) {
          const curr = points[i];
          const next = points[i + 1];
          const midX = (curr.x + next.x) / 2;
          ctx.bezierCurveTo(midX, curr.y, midX, next.y, next.x, next.y);
        }
      }
      ctx.stroke();

      points.forEach((point) => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#FFFFFF";
        ctx.fill();
        ctx.strokeStyle = "#55A84F";
        ctx.lineWidth = 2;
        ctx.stroke();
      });

      const selectedIndex = bars.findIndex((bar) => bar.active);
      points.forEach((point, index) => {
        if (bars[index].actions <= 0) return;
        if (selectedIndex >= 0 && Math.abs(selectedIndex - index) <= 1) return;
        const label = String(bars[index].actions);
        ctx.font = "12px sans-serif";
        const textWidth = ctx.measureText(label).width;
        const labelWidth = textWidth + 12;
        const labelHeight = 20;
        const centerX = Math.max(labelWidth / 2 + 2, Math.min(width - labelWidth / 2 - 2, point.x));
        const placeBelow = point.y < chartTopPadding + labelHeight;
        const labelTop = placeBelow ? point.y + 8 : point.y - labelHeight - 8;
        ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
        ctx.fillRect(centerX - labelWidth / 2, labelTop, labelWidth, labelHeight);
        ctx.fillStyle = "#426B4D";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, centerX, labelTop + labelHeight / 2);
      });
    });
  },

  openHistoryReview() {
    const archivedGoals = getArchivedGoals().sort((a, b) => {
      const bTime = b.archivedAt || b.endedAt || b.createdAt;
      const aTime = a.archivedAt || a.endedAt || a.createdAt;
      return bTime.localeCompare(aTime);
    });
    const latest = archivedGoals[0];
    if (!latest) {
      wx.showToast({ title: "暂无历史复盘", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/goal-review/index?id=${latest.id}` });
  },
}));
