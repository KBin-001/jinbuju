import { getActiveGoal, getGoal } from "../../services/manualGoal";
import { getTasksByGoal } from "../../services/manualTask";
import { getProgressSummary } from "../../services/manualStats";
import { getLocalUserProfile } from "../../services/profile";
import { addDays, formatDate, getTodayBusinessDate } from "../../utils/date";
import { ActionTask } from "../../types/manual";

type CoachRange = "week" | "month" | "total";

interface CoachMetric {
  key: string;
  label: string;
  value: number;
  unit: string;
  helper: string;
  signal: string;
  signalTone: string;
}

interface CoachPeriod {
  range: CoachRange;
  periodLabel: string;
  analysisLabel: string;
  greeting: string;
  scoreLabel: string;
  discoveryMeta: string;
  start?: string;
  end?: string;
  previousStart?: string;
  previousEnd?: string;
}

interface PeriodStats {
  minutes: number;
  completedActions: number;
  totalActions: number;
  completionRate: number;
}

const QUICK_QUESTIONS = ["帮我拆解目标", "我该怎么坚持？", "为什么我总是中断？", "安排今日最小行动"];

function normalizeRange(value?: string): CoachRange {
  if (value === "week" || value === "month") return value;
  return "total";
}

function toDate(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

function buildCoachPeriod(range: CoachRange, today: string): CoachPeriod {
  const todayDate = toDate(today);
  if (range === "week") {
    return {
      range,
      periodLabel: "本周",
      analysisLabel: "周数据分析",
      greeting: "本周节奏正在形成",
      scoreLabel: "本周完成率",
      discoveryMeta: "对比上周 · 本周",
      start: formatDate(addDays(todayDate, -6)),
      end: today,
      previousStart: formatDate(addDays(todayDate, -13)),
      previousEnd: formatDate(addDays(todayDate, -7)),
    };
  }

  if (range === "month") {
    const day = todayDate.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const currentMonday = addDays(todayDate, mondayOffset);
    const startDate = addDays(currentMonday, -28);
    return {
      range,
      periodLabel: "本月",
      analysisLabel: "月数据分析",
      greeting: "这个月的节奏看得更清楚了",
      scoreLabel: "本月完成率",
      discoveryMeta: "对比上月 · 本月",
      start: formatDate(startDate),
      end: formatDate(addDays(currentMonday, 6)),
      previousStart: formatDate(addDays(startDate, -35)),
      previousEnd: formatDate(addDays(startDate, -1)),
    };
  }

  return {
    range,
    periodLabel: "累计",
    analysisLabel: "累计数据分析",
    greeting: "长期成长正在被记录",
    scoreLabel: "累计完成率",
    discoveryMeta: "当前目标 · 累计",
  };
}

function tasksInPeriod(tasks: ActionTask[], start?: string, end?: string): ActionTask[] {
  if (!start || !end) return tasks;
  return tasks.filter((task) => task.currentDate >= start && task.currentDate <= end);
}

function summarize(tasks: ActionTask[]): PeriodStats {
  const completedActions = tasks.filter((task) => task.status === "completed").length;
  const totalActions = tasks.length;
  return {
    minutes: tasks.reduce((sum, task) => sum + (task.actualMinutes || 0), 0),
    completedActions,
    totalActions,
    completionRate: totalActions ? Math.round((completedActions / totalActions) * 100) : 0,
  };
}

function compareSignal(current: number, previous: number, range: CoachRange): { text: string; tone: string } {
  if (range === "total") return { text: "↗ 累计", tone: "up" };
  if (previous <= 0 && current <= 0) return { text: "↓ 暂无", tone: "down" };
  if (previous <= 0) return { text: "↗ 新增", tone: "up" };
  const rate = Math.round(((current - previous) / previous) * 100);
  if (rate > 0) return { text: `↗ +${rate}%`, tone: "up" };
  if (rate < 0) return { text: `↓ ${rate}%`, tone: "down" };
  return { text: "→ 持平", tone: "flat" };
}

function localCoachReply(
  question: string,
  goalTitle: string,
  streakDays: number,
  periodLabel: string,
): string {
  if (question.includes("拆解")) {
    return `可以把“${goalTitle || "当前目标"}”拆成准备、执行、复盘三步。先完成第一步，并控制在 15～30 分钟。`;
  }
  if (question.includes("坚持")) {
    return `你已经连续行动 ${streakDays} 天。结合${periodLabel}记录，下一步先固定每天同一时间完成一个最小行动。`;
  }
  if (question.includes("中断")) {
    return `${periodLabel}数据说明，中断通常不是意志力问题，而是行动太大或时间点不稳定。可以先把任务缩小一半。`;
  }
  return `结合${periodLabel}数据，建议今天只安排一个 30 分钟小行动。先稳住节奏，再决定是否增加任务。`;
}

Page({
  data: {
    range: "total" as CoachRange,
    requestedGoalId: "",
    displayName: "阿岚",
    goalTitle: "当前目标",
    periodLabel: "累计",
    analysisLabel: "累计数据分析",
    rangeGreeting: "长期成长正在被记录",
    scoreLabel: "累计完成率",
    discoveryMeta: "当前目标 · 累计",
    periodMinutes: 0,
    completionRate: 0,
    streakDays: 0,
    statusText: "可持续",
    metrics: [] as CoachMetric[],
    quickQuestions: QUICK_QUESTIONS,
    question: "",
    replyVisible: false,
    replyText: "",
  },

  onLoad(query: Record<string, string>) {
    this.setData({
      range: normalizeRange(query.range),
      requestedGoalId: String(query.goalId || ""),
    }, () => this.loadCoachData());
  },

  onShow() {
    this.loadCoachData();
  },

  loadCoachData() {
    const requestedGoal = this.data.requestedGoalId ? getGoal(this.data.requestedGoalId) : null;
    const goal = requestedGoal?.status === "active" ? requestedGoal : getActiveGoal();
    const profile = getLocalUserProfile();
    const today = getTodayBusinessDate();
    const period = buildCoachPeriod(this.data.range, today);
    const tasks = goal ? getTasksByGoal(goal.id) : [];
    const currentStats = summarize(tasksInPeriod(tasks, period.start, period.end));
    const previousStats = period.previousStart && period.previousEnd
      ? summarize(tasksInPeriod(tasks, period.previousStart, period.previousEnd))
      : { minutes: 0, completedActions: 0, totalActions: 0, completionRate: 0 };
    const summary = goal ? getProgressSummary(goal.id, today) : null;
    const streakDays = summary?.currentStreakDays || 0;
    const focusSignal = compareSignal(currentStats.minutes, previousStats.minutes, period.range);
    const actionSignal = compareSignal(currentStats.completedActions, previousStats.completedActions, period.range);

    this.setData({
      displayName: profile?.nickname || "阿岚",
      goalTitle: goal?.title || "当前目标",
      periodLabel: period.periodLabel,
      analysisLabel: period.analysisLabel,
      rangeGreeting: period.greeting,
      scoreLabel: period.scoreLabel,
      discoveryMeta: period.discoveryMeta,
      periodMinutes: currentStats.minutes,
      completionRate: currentStats.completionRate,
      streakDays,
      statusText: currentStats.completionRate >= 80 ? "稳步完成" : currentStats.completionRate >= 40 ? "正在推进" : "可持续",
      metrics: [
        {
          key: "focus",
          label: `${period.periodLabel}专注`,
          value: currentStats.minutes,
          unit: "分",
          helper: currentStats.minutes ? "每一分钟都算数。" : "先完成一个最小目标：每天 15 分钟。",
          signal: focusSignal.text,
          signalTone: focusSignal.tone,
        },
        {
          key: "streak",
          label: "连续坚持",
          value: streakDays,
          unit: "天",
          helper: `完成今天即可点亮第 ${streakDays + 1} 天。`,
          signal: "🔥",
          signalTone: "warm",
        },
        {
          key: "actions",
          label: "完成行动",
          value: currentStats.completedActions,
          unit: "项",
          helper: currentStats.completedActions ? `${period.periodLabel}行动正在沉淀。` : "目标刚起步，先从容易完成的行动开始。",
          signal: actionSignal.text,
          signalTone: actionSignal.tone,
        },
        {
          key: "rate",
          label: "完成率",
          value: currentStats.completionRate,
          unit: "%",
          helper: currentStats.totalActions ? `已记录 ${currentStats.totalActions} 项行动。` : "添加行动后会自动统计。",
          signal: "📊",
          signalTone: "chart",
        },
      ],
    });
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  chooseQuestion(event: { currentTarget: { dataset: { question?: string } } }) {
    const question = String(event.currentTarget.dataset.question || "");
    this.setData({
      question,
      replyVisible: true,
      replyText: localCoachReply(question, this.data.goalTitle, this.data.streakDays, this.data.periodLabel),
    });
  },

  inputQuestion(event: { detail: { value?: string } }) {
    this.setData({ question: String(event.detail.value || "").slice(0, 80) });
  },

  sendQuestion() {
    const question = this.data.question.trim();
    if (!question) {
      wx.showToast({ title: "先写下你想问的问题", icon: "none" });
      return;
    }
    this.setData({
      replyVisible: true,
      replyText: localCoachReply(question, this.data.goalTitle, this.data.streakDays, this.data.periodLabel),
    });
  },

  switchMainTab(event: { currentTarget: { dataset: { url?: string } } }) {
    const url = String(event.currentTarget.dataset.url || "");
    if (url) wx.switchTab({ url });
  },
});
