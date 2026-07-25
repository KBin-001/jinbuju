import { addDays, formatDate } from "../utils/date";
import { ActionTask } from "../types/manual";
import { getTasksByGoal } from "./manualTask";

export type DetailPeriod = "day" | "week" | "month";

export interface DetailMetrics {
  minutes: number;
  completed: number;
  focusRate: number;
  total: number;
}

export interface DistributionBar {
  label: string;
  value: number;
  height: number;
}

export interface DurationSlice {
  id: string;
  title: string;
  minutes: number;
  percent: number;
  color: string;
  completedTime: string;
  reflection: string;
}

export interface TodayDataDetails {
  date: string;
  metrics: DetailMetrics;
  previous: DetailMetrics;
  completedTasks: DurationSlice[];
  durationTotal: number;
  pieGradient: string;
  bars: DistributionBar[];
  axisLabels: string[];
}

export interface DetailCalendarDay {
  date: string;
  day: string;
  isToday: boolean;
  isSelected: boolean;
  isCurrentMonth: boolean;
  isFuture: boolean;
  isBeforeMin: boolean;
  hasAction: boolean;
  isCompleted: boolean;
}

const COLORS = ["#356859", "#6FAE84", "#F0B53F", "#9CC6AD", "#CFE2D4", "#84AFA0", "#E1C66A"];

function metricsFor(tasks: ActionTask[], date: string): DetailMetrics {
  const dayTasks = tasks.filter((task) => task.currentDate === date && task.status !== "skipped");
  const completed = dayTasks.filter((task) => task.status === "completed").length;
  return {
    minutes: dayTasks.reduce((sum, task) => sum + (task.actualMinutes || 0), 0),
    completed,
    focusRate: dayTasks.length ? Math.round((completed / dayTasks.length) * 100) : 0,
    total: dayTasks.length,
  };
}

function completedHour(task: ActionTask): number {
  const value = task.completedAt || task.updatedAt || task.createdAt;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 12 : date.getHours();
}

function dateRange(period: DetailPeriod, selectedDate: string): Array<{ date: string; label: string }> {
  const selected = new Date(`${selectedDate}T00:00:00`);
  if (period === "week") {
    const monday = addDays(selected, -((selected.getDay() + 6) % 7));
    return ["一", "二", "三", "四", "五", "六", "日"].map((label, index) => ({ date: formatDate(addDays(monday, index)), label: `周${label}` }));
  }
  if (period === "month") {
    // 注意：当前设计仅支持单月内范围，所有区间都在 selectedDate 所在月份内。
    // 若未来需要支持跨月范围，buildBars 月视图的字符串比较需改为 isValidBusinessDate + differenceInBusinessDays。
    const year = selected.getFullYear();
    const month = selected.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate();
    const ranges = [[1, 5], [6, 10], [11, 15], [16, 20], [21, 25], [26, lastDay]];
    return ranges.map(([start, end]) => ({ date: `${year}-${String(month + 1).padStart(2, "0")}-${String(start).padStart(2, "0")}|${end}`, label: `${start}-${end}` }));
  }
  return [];
}

function buildBars(tasks: ActionTask[], selectedDate: string, period: DetailPeriod): { bars: DistributionBar[]; axisLabels: string[] } {
  let raw: Array<{ label: string; value: number }>;
  if (period === "day") {
    raw = [0, 4, 8, 12, 16, 20].map((start) => ({
      label: `${start}时`,
      value: tasks
        .filter((task) => task.currentDate === selectedDate && (task.actualMinutes || 0) > 0 && completedHour(task) >= start && completedHour(task) < start + 4)
        .reduce((sum, task) => sum + (task.actualMinutes || 0), 0),
    }));
  } else if (period === "week") {
    raw = dateRange(period, selectedDate).map((item) => ({
      label: item.label,
      value: tasks.filter((task) => task.currentDate === item.date).reduce((sum, task) => sum + (task.actualMinutes || 0), 0),
    }));
  } else {
    // 月视图：当前 dateRange 仅生成单月内区间，字符串比较安全。
    // 若未来支持跨月范围，需改用 isValidBusinessDate + differenceInBusinessDays 做范围判断。
    raw = dateRange(period, selectedDate).map((item) => {
      const [startDate, endText] = item.date.split("|");
      // 用 slice(0, 7) 取 "YYYY-MM"，再拼上 "-DD"，避免 slice(0, 8) 含末尾横杠的脆弱写法
      const endDate = `${startDate.slice(0, 7)}-${String(endText).padStart(2, "0")}`;
      return { label: item.label, value: tasks.filter((task) => task.currentDate >= startDate && task.currentDate <= endDate).reduce((sum, task) => sum + (task.actualMinutes || 0), 0) };
    });
  }
  const maxValue = Math.max(...raw.map((item) => item.value), 0);
  const axisMax = Math.max(60, Math.ceil(maxValue / 15) * 15);
  return {
    bars: raw.map((item) => ({ ...item, height: item.value ? Math.max(6, Math.round((item.value / axisMax) * 100)) : 0 })),
    axisLabels: [axisMax, Math.round(axisMax * 0.75), Math.round(axisMax * 0.5), Math.round(axisMax * 0.25), 0].map((value) => `${value} 分钟`),
  };
}

export function getTodayDataDetails(goalId: string, date: string, period: DetailPeriod = "day"): TodayDataDetails {
  const tasks = getTasksByGoal(goalId);
  const metrics = metricsFor(tasks, date);
  const previousDate = formatDate(addDays(new Date(`${date}T00:00:00`), -1));
  const previous = metricsFor(tasks, previousDate);
  const completed = tasks.filter((task) => task.currentDate === date && task.status === "completed");
  const durationTotal = completed.reduce((sum, task) => sum + (task.actualMinutes || 0), 0);
  let accumulated = 0;
  const completedTasks = completed.map((task, index) => {
    const minutes = task.actualMinutes || 0;
    const percent = durationTotal ? Math.round((minutes / durationTotal) * 100) : 0;
    const completedDate = new Date(task.completedAt || task.updatedAt || task.createdAt);
    const completedTime = Number.isNaN(completedDate.getTime()) ? "--:--" : `${String(completedDate.getHours()).padStart(2, "0")}:${String(completedDate.getMinutes()).padStart(2, "0")}`;
    return { id: task.id, title: task.title, minutes, percent, color: COLORS[index % COLORS.length], completedTime, reflection: task.reflection || "" };
  });
  const pieParts = durationTotal ? completedTasks.map((task, index) => {
    const start = accumulated;
    accumulated += task.percent;
    const end = index === completedTasks.length - 1 ? 100 : Math.min(accumulated, 100);
    return `${task.color} ${start}% ${end}%`;
  }) : [];
  const distribution = buildBars(tasks, date, period);
  return {
    date,
    metrics,
    previous,
    completedTasks,
    durationTotal,
    pieGradient: pieParts.length ? `conic-gradient(${pieParts.join(",")})` : "conic-gradient(#E8EFEA 0% 100%)",
    ...distribution,
  };
}

export function getTodayDataBounds(goalId: string, today: string): { minDate: string; maxDate: string } {
  const dates = getTasksByGoal(goalId).map((task) => task.currentDate).filter((date) => date <= today).sort();
  if (dates.length === 0) {
    // 没有历史任务时，默认展示最近 30 天范围，避免日历只有一天
    const minDate = formatDate(addDays(new Date(`${today}T00:00:00`), -29));
    return { minDate, maxDate: today };
  }
  return { minDate: dates[0], maxDate: today };
}

export function getTodayDataCalendar(goalId: string, selectedDate: string, monthValue: string, minDate: string, today: string): { title: string; days: DetailCalendarDay[] } {
  const tasks = getTasksByGoal(goalId);
  const monthDate = new Date(`${monthValue.slice(0, 7)}-01T00:00:00`);
  const month = monthDate.getMonth();
  const startOffset = (monthDate.getDay() + 6) % 7;
  const firstCell = addDays(monthDate, -startOffset);
  const actionDates = new Set(tasks.map((task) => task.currentDate));
  const completedDates = new Set(tasks.filter((task) => task.status === "completed").map((task) => task.currentDate));
  return {
    title: `${monthDate.getFullYear()} 年 ${monthDate.getMonth() + 1} 月`,
    days: Array.from({ length: 42 }, (_, index) => {
      const valueDate = addDays(firstCell, index);
      const value = formatDate(valueDate);
      return {
        date: value,
        day: String(valueDate.getDate()),
        isToday: value === today,
        isSelected: value === selectedDate,
        isCurrentMonth: valueDate.getMonth() === month,
        isFuture: value > today,
        isBeforeMin: value < minDate,
        hasAction: actionDates.has(value),
        isCompleted: completedDates.has(value),
      };
    }),
  };
}
