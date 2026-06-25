import { getActiveGoal, getArchivedGoals } from "../../services/manualGoal";
import { getProgressSummary } from "../../services/manualStats";
import { calculateTodaySummary, getTasksByDate, getTasksByGoal } from "../../services/manualTask";
import { ActionTask, Goal, ProgressSummary } from "../../types/manual";
import { addDays, formatDate } from "../../utils/date";

type TrendMode = "week" | "month" | "year";
type MilestoneState = "achieved" | "current" | "locked";

interface TrendTab {
  key: TrendMode;
  label: string;
  active: boolean;
}

interface OverviewStat {
  label: string;
  value: string;
  unit: string;
}

interface TrendPoint {
  key: string;
  label: string;
  value: number;
  completedCount: number;
  totalCount: number;
  x: number;
  y: number;
  active: boolean;
  tooltipAlign: "left" | "center" | "right";
}

interface TrendSegment {
  key: string;
  left: number;
  bottom: number;
  width: number;
  rotate: number;
}

interface TrendBuildResult {
  points: TrendPoint[];
  segments: TrendSegment[];
  selected: TrendPoint | null;
  summaryText: string;
  isEmpty: boolean;
  maxLabel: string;
  midLabel: string;
}

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

interface TrendBucket {
  key: string;
  label: string;
  start: string;
  end: string;
}

const TREND_TABS: Array<{ key: TrendMode; label: string }> = [
  { key: "week", label: "周" },
  { key: "month", label: "月" },
  { key: "year", label: "年" },
];

const MILESTONE_DAYS = [7, 14, 30, 60, 90];

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

function nextStepText(summary: ProgressSummary | null): string {
  if (!summary || summary.totalTasks <= 0) return "先添加一个今天能完成的小行动。";
  if (summary.completedTasks >= summary.totalTasks) return "这一轮行动已经收好，可以继续添加下一步。";
  const rest = Math.max(0, summary.totalTasks - summary.completedTasks);
  return `还有 ${rest} 项行动在路上，保持这个节奏就好。`;
}

function goalPeriod(goal: Goal | null): string {
  if (!goal) return "";
  const start = shortDate(goal.startedAt || goal.createdAt);
  return start ? `目标周期 · ${start} 起` : "目标周期 · 已开始";
}

function buildTrendTabs(activeKey: TrendMode): TrendTab[] {
  return TREND_TABS.map((tab) => ({ ...tab, active: tab.key === activeKey }));
}

const CHART_ASPECT_RATIO = 0.45;

function niceMaxMinutes(value: number): number {
  if (value <= 30) return 30;
  if (value <= 60) return 60;
  if (value <= 90) return 90;
  if (value <= 120) return 120;
  if (value <= 180) return 180;
  if (value <= 240) return 240;
  if (value <= 360) return 360;
  if (value <= 480) return 480;
  return Math.ceil(value / 60) * 60;
}

function formatAxisLabel(minutes: number): string {
  if (minutes <= 0) return "0";
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

function inRange(task: ActionTask, start: string, end: string): boolean {
  return task.currentDate >= start && task.currentDate <= end && task.status !== "rescheduled";
}

function buildWeekBuckets(today: string): TrendBucket[] {
  return Array.from({ length: 7 }).map((_, index) => {
    const date = formatDate(addDays(toDate(today), index - 6));
    return {
      key: date,
      label: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`,
      start: date,
      end: date,
    };
  });
}

function buildMonthBuckets(today: string): TrendBucket[] {
  const labels = ["3周前", "2周前", "上周", "本周"];
  return labels.map((label, index) => {
    const end = formatDate(addDays(toDate(today), -7 * (3 - index)));
    const start = formatDate(addDays(toDate(end), -6));
    return { key: `${start}-${end}`, label, start, end };
  });
}

function buildYearBuckets(today: string): TrendBucket[] {
  const current = toDate(today);
  const buckets: TrendBucket[] = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const startDate = new Date(current.getFullYear(), current.getMonth() - offset, 1);
    const endDate = new Date(current.getFullYear(), current.getMonth() - offset + 1, 0);
    const start = formatDate(startDate);
    const end = formatDate(endDate);
    buckets.push({
      key: `${start.slice(0, 7)}`,
      label: `${startDate.getMonth() + 1}月`,
      start,
      end,
    });
  }
  return buckets;
}

function trendBuckets(mode: TrendMode, today: string): TrendBucket[] {
  if (mode === "month") return buildMonthBuckets(today);
  if (mode === "year") return buildYearBuckets(today);
  return buildWeekBuckets(today);
}

function trendIntro(mode: TrendMode): string {
  if (mode === "month") return "最近四周";
  if (mode === "year") return "最近六个月";
  return "最近一周";
}

function buildTrend(
  mode: TrendMode,
  tasks: ActionTask[],
  today: string,
  selectedKey?: string,
): TrendBuildResult {
  const buckets = trendBuckets(mode, today);
  const values = buckets.map((bucket) => {
    const bucketTasks = tasks.filter((task) => inRange(task, bucket.start, bucket.end));
    return {
      bucket,
      tasks: bucketTasks,
      value: bucketTasks.reduce((sum, task) => sum + (task.actualMinutes || 0), 0),
      completedCount: bucketTasks.filter((task) => task.status === "completed").length,
      totalCount: bucketTasks.length,
    };
  });
  const totalMinutes = values.reduce((sum, item) => sum + item.value, 0);
  const totalCompleted = values.reduce((sum, item) => sum + item.completedCount, 0);
  const nonZeroCount = values.filter((item) => item.value > 0).length;
  const maxValue = niceMaxMinutes(Math.max(30, ...values.map((item) => item.value)));
  const midValue = Math.round(maxValue / 2);
  const selected = selectedKey && values.some((item) => item.bucket.key === selectedKey)
    ? selectedKey
    : [...values].reverse().find((item) => item.value > 0)?.bucket.key || values[values.length - 1]?.bucket.key || "";
  const count = Math.max(1, values.length - 1);
  const points: TrendPoint[] = values.map((item, index) => {
    const x = values.length === 1 ? 50 : 8 + (index / count) * 84;
    const y = 12 + (item.value / maxValue) * 68;
    const tooltipAlign: TrendPoint["tooltipAlign"] = index === 0 ? "left" : index === values.length - 1 ? "right" : "center";
    return {
      key: item.bucket.key,
      label: item.bucket.label,
      value: item.value,
      completedCount: item.completedCount,
      totalCount: item.totalCount,
      x,
      y,
      active: item.bucket.key === selected,
      tooltipAlign,
    };
  });
  const segments = nonZeroCount <= 1
    ? []
    : points.slice(0, -1).map((point, index) => {
        const next = points[index + 1];
        const dx = next.x - point.x;
        const dy = (next.y - point.y) * CHART_ASPECT_RATIO;
        return {
          key: `${point.key}-${next.key}`,
          left: point.x,
          bottom: point.y,
          width: Math.sqrt(dx * dx + dy * dy),
          rotate: -Math.atan2(dy, dx) * (180 / Math.PI),
        };
      });
  return {
    points,
    segments,
    selected: points.find((point) => point.active) || null,
    summaryText: totalMinutes > 0
      ? `${trendIntro(mode)}累计投入 ${totalMinutes} 分钟，完成 ${totalCompleted} 项行动。`
      : `${trendIntro(mode)}还没有投入记录，先完成今天的一小步。`,
    isEmpty: totalMinutes <= 0,
    maxLabel: formatAxisLabel(maxValue),
    midLabel: formatAxisLabel(midValue),
  };
}

function buildOverview(summary: ProgressSummary | null, todayActualMinutes: number): OverviewStat[] {
  const completed = summary?.completedTasks || 0;
  const total = summary?.totalTasks || 0;
  return [
    { label: "坚持天数", value: String(summary?.totalActionDays || 0), unit: "天" },
    { label: "完成项数", value: `${completed}/${total}`, unit: "" },
    { label: "今日投入", value: String(todayActualMinutes), unit: "分钟" },
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
    nextText: nextTarget ? `距离下个里程碑还差 ${nextTarget - actionDays} 天` : "90 天里程碑已达成",
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

Page({
  data: {
    status: "loading",
    errorMessage: "",
    goal: null as Goal | null,
    summary: null as ProgressSummary | null,
    completionRate: 0,
    progressExplain: "行动完成率 0%",
    levelLabel: "Lv.1 · 自律新兵",
    goalPeriod: "",
    goalStatusText: "添加行动后开始记录",
    nextStepText: "先添加一个今天能完成的小行动。",
    overviewStats: [] as OverviewStat[],
    trendTabs: buildTrendTabs("week"),
    trendMode: "week" as TrendMode,
    trendPoints: [] as TrendPoint[],
    trendSegments: [] as TrendSegment[],
    selectedTrendPoint: null as TrendPoint | null,
    trendSummaryText: "",
    trendEmpty: true,
    trendMaxLabel: "30m",
    trendMidLabel: "15m",
    milestones: [] as MilestoneView[],
    nextMilestoneText: "距离下个里程碑还差 7 天",
    medalState: { achieved: false, current: true } as MedalState,
    recentRecords: [] as RecentRecord[],
    hasHistoryReview: false,
  },

  onShow() {
    this.load();
  },

  load() {
    this.setData({ status: "loading", errorMessage: "" });
    try {
      const today = formatDate(new Date());
      const goal = getActiveGoal();
      const summary = goal ? getProgressSummary(goal.id, today) : null;
      const allTasks = goal ? getTasksByGoal(goal.id) : [];
      const todayTasks = goal ? getTasksByDate(goal.id, today) : [];
      const todaySummary = calculateTodaySummary(todayTasks);
      const rate = completionRate(summary);
      const trend = buildTrend(this.data.trendMode, allTasks, today, this.data.selectedTrendPoint?.key);
      const milestoneResult = buildMilestones(summary?.totalActionDays || 0);

      this.setData({
        status: "ready",
        goal,
        summary,
        completionRate: rate,
        progressExplain: summary && summary.totalTasks > 0 ? `行动完成率 ${rate}%` : "添加行动后开始记录",
        levelLabel: levelLabel(summary?.totalActionDays || 0),
        goalPeriod: goalPeriod(goal),
        goalStatusText: goalStatusText(rate, summary?.totalTasks || 0),
        nextStepText: nextStepText(summary),
        overviewStats: buildOverview(summary, todaySummary.actualMinutes),
        trendTabs: buildTrendTabs(this.data.trendMode),
        trendPoints: trend.points,
        trendSegments: trend.segments,
        selectedTrendPoint: trend.selected,
        trendSummaryText: trend.summaryText,
        trendEmpty: trend.isEmpty,
        trendMaxLabel: trend.maxLabel,
        trendMidLabel: trend.midLabel,
        milestones: milestoneResult.milestones,
        nextMilestoneText: milestoneResult.nextText,
        medalState: milestoneResult.medalState,
        recentRecords: buildRecentRecords(todayTasks),
        hasHistoryReview: getArchivedGoals().length > 0,
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

  createGoal() {
    wx.navigateTo({ url: "/pages/goal-create/index" });
  },

  switchTrendTab(event: { currentTarget: { dataset: { key?: TrendMode } } }) {
    const trendMode = event.currentTarget.dataset.key || "week";
    const today = formatDate(new Date());
    const tasks = this.data.goal ? getTasksByGoal(this.data.goal.id) : [];
    const trend = buildTrend(trendMode, tasks, today);
    this.setData({
      trendMode,
      trendTabs: buildTrendTabs(trendMode),
      trendPoints: trend.points,
      trendSegments: trend.segments,
      selectedTrendPoint: trend.selected,
      trendSummaryText: trend.summaryText,
      trendEmpty: trend.isEmpty,
      trendMaxLabel: trend.maxLabel,
      trendMidLabel: trend.midLabel,
    });
  },

  selectTrendPoint(event: { currentTarget: { dataset: { key?: string } } }) {
    const key = String(event.currentTarget.dataset.key || "");
    const today = formatDate(new Date());
    const tasks = this.data.goal ? getTasksByGoal(this.data.goal.id) : [];
    const trend = buildTrend(this.data.trendMode, tasks, today, key);
    this.setData({
      trendPoints: trend.points,
      trendSegments: trend.segments,
      selectedTrendPoint: trend.selected,
      trendSummaryText: trend.summaryText,
      trendEmpty: trend.isEmpty,
      trendMaxLabel: trend.maxLabel,
      trendMidLabel: trend.midLabel,
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
});
