import { getActiveGoal } from "../../services/manualGoal";
import { getProgressSummary } from "../../services/manualStats";
import { calculateTodaySummary, getTasksByDate } from "../../services/manualTask";
import { DailyActionSummary, Goal, ProgressSummary } from "../../types/manual";
import { formatDate } from "../../utils/date";

type TrendTabKey = "week" | "month" | "year";

interface TrendTab {
  key: TrendTabKey;
  label: string;
  active: boolean;
}

interface TrendPoint {
  date: string;
  label: string;
  value: number;
  x: number;
  y: number;
  active: boolean;
}

interface TrendSegment {
  key: string;
  left: number;
  bottom: number;
  width: number;
  rotate: number;
}

interface MilestoneView {
  days: number;
  label: string;
  achieved: boolean;
  next: boolean;
}

const TREND_TABS: Array<{ key: TrendTabKey; label: string }> = [
  { key: "week", label: "周" },
  { key: "month", label: "月" },
  { key: "year", label: "年" },
];

const MILESTONE_DAYS = [7, 14, 30, 60, 90];

function completionRate(summary: ProgressSummary | null): number {
  if (!summary || summary.totalTasks <= 0) return 0;
  return Math.round((summary.completedTasks / summary.totalTasks) * 100);
}

function levelLabel(actionDays: number): string {
  if (actionDays >= 30) return "Lv.4 · 稳定推进者";
  if (actionDays >= 14) return "Lv.3 · 行动熟手";
  if (actionDays >= 7) return "Lv.2 · 自律新星";
  return "Lv.1 · 自律新兵";
}

function goalPeriod(goal: Goal | null): string {
  if (!goal) return "";
  return `目标周期：${(goal.startedAt || goal.createdAt).slice(0, 10)}`;
}

function buildTrendTabs(activeKey: TrendTabKey): TrendTab[] {
  return TREND_TABS.map((tab) => ({ ...tab, active: tab.key === activeKey }));
}

function buildTrendPoints(
  goal: Goal | null,
  recentDays: DailyActionSummary[],
  activeDate?: string,
): { points: TrendPoint[]; segments: TrendSegment[]; selected: TrendPoint | null } {
  const days = recentDays.slice().reverse();
  const values = days.map((day) => {
    if (!goal) return 0;
    return calculateTodaySummary(getTasksByDate(goal.id, day.date)).actualMinutes;
  });
  const maxValue = Math.max(1, ...values);
  const selectedDate = activeDate || days[days.length - 1]?.date || "";
  const count = Math.max(1, days.length - 1);
  const points = days.map((day, index) => {
    const value = values[index] || 0;
    const x = days.length === 1 ? 50 : (index / count) * 100;
    const y = 8 + (value / maxValue) * 78;
    return { date: day.date, label: day.label, value, x, y, active: day.date === selectedDate };
  });
  const segments = points.slice(0, -1).map((point, index) => {
    const next = points[index + 1];
    const dx = next.x - point.x;
    const dy = next.y - point.y;
    return {
      key: `${point.date}-${next.date}`,
      left: point.x,
      bottom: point.y,
      width: Math.sqrt(dx * dx + dy * dy),
      rotate: -Math.atan2(dy, dx) * (180 / Math.PI),
    };
  });
  return { points, segments, selected: points.find((point) => point.active) || points[points.length - 1] || null };
}

function buildMilestones(actionDays: number): MilestoneView[] {
  const nextTarget = MILESTONE_DAYS.find((days) => actionDays < days) || 0;
  return MILESTONE_DAYS.map((days) => ({
    days,
    label: `${days} 天`,
    achieved: actionDays >= days,
    next: nextTarget === days,
  }));
}

Page({
  data: {
    status: "loading",
    errorMessage: "",
    goal: null as Goal | null,
    summary: null as ProgressSummary | null,
    completionRate: 0,
    progressText: "已坚持 0 天 · 完成 0 / 0 项行动",
    todayActualMinutes: 0,
    levelLabel: "Lv.1 · 自律新兵",
    goalPeriod: "",
    trendTabs: buildTrendTabs("week"),
    trendMode: "week" as TrendTabKey,
    trendPoints: [] as TrendPoint[],
    trendSegments: [] as TrendSegment[],
    selectedTrendPoint: null as TrendPoint | null,
    milestones: [] as MilestoneView[],
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
      const rate = completionRate(summary);
      const todayActualMinutes = goal ? calculateTodaySummary(getTasksByDate(goal.id, today)).actualMinutes : 0;
      const trend = buildTrendPoints(goal, summary?.recentDays || [], this.data.selectedTrendPoint?.date);
      this.setData({
        status: "ready",
        goal,
        summary,
        completionRate: rate,
        progressText: summary ? `已坚持 ${summary.totalActionDays} 天 · 完成 ${summary.completedTasks} / ${summary.totalTasks} 项行动` : "已坚持 0 天 · 完成 0 / 0 项行动",
        todayActualMinutes,
        levelLabel: levelLabel(summary?.totalActionDays || 0),
        goalPeriod: goalPeriod(goal),
        trendTabs: buildTrendTabs(this.data.trendMode),
        trendPoints: trend.points,
        trendSegments: trend.segments,
        selectedTrendPoint: trend.selected,
        milestones: buildMilestones(summary?.totalActionDays || 0),
      });
    } catch (error) {
      this.setData({ status: "error", errorMessage: error instanceof Error ? error.message : "进度读取失败" });
    }
  },

  retry() {
    this.load();
  },

  createGoal() {
    wx.navigateTo({ url: "/pages/goal-create/index" });
  },

  switchTrendTab(event: { currentTarget: { dataset: { key?: TrendTabKey } } }) {
    const trendMode = event.currentTarget.dataset.key || "week";
    const trend = buildTrendPoints(this.data.goal, this.data.summary?.recentDays || [], this.data.selectedTrendPoint?.date);
    this.setData({ trendMode, trendTabs: buildTrendTabs(trendMode), trendPoints: trend.points, trendSegments: trend.segments, selectedTrendPoint: trend.selected });
  },

  selectTrendPoint(event: { currentTarget: { dataset: { date?: string } } }) {
    const date = String(event.currentTarget.dataset.date || "");
    const trend = buildTrendPoints(this.data.goal, this.data.summary?.recentDays || [], date);
    this.setData({ trendPoints: trend.points, trendSegments: trend.segments, selectedTrendPoint: trend.selected });
  },
});
