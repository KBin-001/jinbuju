import { getActiveGoal, getActiveGoals, getArchivedGoals, getGoal } from "../../services/manualGoal";
import { getTask, getTaskHistoryByGoal } from "../../services/manualTask";
import { getProgressSummary } from "../../services/manualStats";
import { getLocalUserProfile } from "../../services/profile";
import { bootstrapAccount } from "../../services/account";
import { askProgressCoach } from "../../services/progressCoach";
import { executeCoachProposal } from "../../services/manualSync";
import { getCurrentThemeId } from "../../services/theme";
import { addDays, formatDate, getTodayBusinessDate } from "../../utils/date";
import { ActionTask, Goal } from "../../types/manual";
import { CoachActionProposal, CoachRange, ProgressCoachChatMessage } from "../../types/progressCoach";
import { off, on } from "../../utils/eventBus";
import { openTodayActionEditor } from "../../utils/todayActionEditor";

interface ChatMessage extends ProgressCoachChatMessage {
  id: string;
  actionProposal?: CoachActionProposal;
}

interface PeriodStats {
  minutes: number;
  completedActions: number;
  totalActions: number;
  completionRate: number;
}

interface ScopeMetric {
  key: "complete" | "minutes" | "days" | "goals";
  icon: string;
  value: number;
  unit: string;
  label: string;
  note: string;
  tone: "paper" | "mint" | "gold";
  progress?: number;
}

interface RhythmPoint {
  key: string;
  label: string;
  minutes: number;
  completed: number;
  color: string;
  tint: string;
  icon?: string;
  isCurrent: boolean;
  isFuture?: boolean;
}

interface LoopDiagnosisItem {
  key: "rhythm" | "quality" | "focus";
  icon: string;
  label: string;
  value: string;
  detail: string;
  meta?: string;
  tone: "gold" | "mint" | "paper";
}

interface LoopDiagnosis {
  score: number;
  grade: string;
  quote: string;
  items: LoopDiagnosisItem[];
}

interface ReviewItem {
  id: string;
  title: string;
  subtitle: string;
  statusLabel: string;
  tone: "complete" | "active" | "pending";
  icon: string;
  editable: boolean;
}

interface GoalInsightItem {
  id: string;
  title: string;
  subtitle: string;
  completed: number;
  total: number;
  progress: number;
  statusLabel: string;
  tone: "active" | "archived";
}

function normalizeScope(value?: string): CoachRange {
  if (value === "day" || value === "week" || value === "month") return value;
  return "overall";
}

function toDate(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

function periodStart(scope: CoachRange, today: string): string | undefined {
  const date = toDate(today);
  if (scope === "day") return today;
  if (scope === "week") return formatDate(addDays(date, -((date.getDay() + 6) % 7)));
  if (scope === "month") return formatDate(new Date(date.getFullYear(), date.getMonth(), 1));
  return undefined;
}

function summarize(tasks: ActionTask[]): PeriodStats {
  const visibleTasks = tasks.filter((task) => task.status !== "skipped" && task.status !== "rescheduled");
  const completedActions = visibleTasks.filter((task) => task.status === "completed").length;
  return {
    minutes: tasks.reduce((sum, task) => sum + (task.actualMinutes || 0), 0),
    completedActions,
    totalActions: visibleTasks.length,
    completionRate: visibleTasks.length ? Math.round((completedActions / visibleTasks.length) * 100) : 0,
  };
}

function businessDate(task: ActionTask): string {
  return task.activityDate || task.currentDate;
}

function inPeriod(task: ActionTask, start: string | undefined, today: string): boolean {
  const date = businessDate(task);
  return (!start || date >= start) && date <= today;
}

function metricCards(scope: CoachRange, stats: PeriodStats, activeDays: number, streakDays: number, activeGoalCount: number, archivedGoalCount: number): ScopeMetric[] {
  if (scope === "overall") {
    return [
      { key: "complete", icon: "check-circle", value: stats.completedActions, unit: "项", label: "累计完成", note: `共沉淀 ${stats.totalActions} 项行动`, tone: "paper", progress: stats.completionRate },
      { key: "minutes", icon: "time", value: stats.minutes, unit: "分钟", label: "累计投入", note: `${activeDays} 个真实行动日`, tone: "mint" },
      { key: "goals", icon: "flag", value: activeGoalCount, unit: "个", label: "进行中目标", note: archivedGoalCount ? `另有 ${archivedGoalCount} 个历史目标` : "持续目标正在积累", tone: "gold" },
    ];
  }
  return [
    { key: "complete", icon: "check-circle", value: stats.completedActions, unit: `/${stats.totalActions}`, label: "完成行动", note: `完成率 ${stats.completionRate}%`, tone: "paper", progress: stats.completionRate },
    { key: "minutes", icon: "time", value: stats.minutes, unit: "分钟", label: "实际投入", note: "只统计真实记录", tone: "mint" },
    { key: "days", icon: "flag", value: activeDays, unit: "天", label: "行动天数", note: streakDays ? `当前连续 ${streakDays} 天` : "从一次行动开始", tone: "gold" },
  ];
}

function statusView(task: ActionTask): Pick<ReviewItem, "statusLabel" | "tone" | "icon"> {
  if (task.status === "completed") return { statusLabel: "已完成", tone: "complete", icon: "check-circle" };
  if (task.status === "partially_completed") return { statusLabel: "进行中", tone: "active", icon: "time" };
  return { statusLabel: "待推进", tone: "pending", icon: "time" };
}

function reviewItems(tasks: ActionTask[]): ReviewItem[] {
  const priority: Record<string, number> = { partially_completed: 0, pending: 1, completed: 2 };
  return tasks
    .filter((task) => task.status !== "skipped" && task.status !== "rescheduled")
    .slice()
    .sort((left, right) => (priority[left.status] ?? 3) - (priority[right.status] ?? 3) || businessDate(right).localeCompare(businessDate(left)))
    .slice(0, 3)
    .map((task) => {
      const status = statusView(task);
      const date = businessDate(task);
      const minutes = task.actualMinutes || task.estimatedMinutes;
      return {
        id: task.id,
        title: task.title,
        subtitle: task.description || `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日 · ${task.actualMinutes ? "实际" : "预计"} ${minutes} 分钟`,
        ...status,
        editable: task.status !== "rescheduled",
      };
    });
}

const RHYTHM_PALETTE = [
  { color: "#9DBBAE", tint: "rgba(157,187,174,.2)" },
  { color: "#7FA393", tint: "rgba(127,163,147,.2)" },
  { color: "#4F7D6A", tint: "rgba(79,125,106,.22)" },
  { color: "#245B4D", tint: "rgba(36,91,77,.18)" },
];
const RHYTHM_CURRENT_TONE = { color: "#C89B4A", tint: "rgba(200,155,74,.22)" };
const DAY_PERIOD_ICONS: Record<string, string> = { morning: "sun-rising", afternoon: "sunny", evening: "sun-fall", night: "moon" };

function decorateRhythm(points: Array<Omit<RhythmPoint, "color" | "tint">>): RhythmPoint[] {
  return points.map((point, index) => {
    const tone = point.isCurrent ? RHYTHM_CURRENT_TONE : RHYTHM_PALETTE[index % RHYTHM_PALETTE.length];
    return { ...point, color: tone.color, tint: tone.tint };
  });
}

function buildRhythm(scope: CoachRange, today: string, tasks: ActionTask[]): RhythmPoint[] {
  const todayDate = toDate(today);
  if (scope === "day") {
    const periods = [
      { key: "morning", label: "上午", start: 5, end: 12 },
      { key: "afternoon", label: "下午", start: 12, end: 18 },
      { key: "evening", label: "晚上", start: 18, end: 24 },
      { key: "night", label: "夜间", start: 0, end: 5 },
    ];
    return decorateRhythm(periods.map((period) => {
      const bucket = tasks.filter((task) => {
        if (!task.completedAt) return period.key === "evening";
        const value = new Date(task.completedAt);
        const hour = new Date(value.getTime() + 8 * 60 * 60 * 1000).getUTCHours();
        return hour >= period.start && hour < period.end;
      });
      return { key: period.key, label: period.label, minutes: bucket.reduce((sum, task) => sum + (task.actualMinutes || 0), 0), completed: bucket.filter((task) => task.status === "completed").length, icon: DAY_PERIOD_ICONS[period.key], isCurrent: false };
    }));
  }
  if (scope === "week") {
    const startDate = toDate(periodStart("week", today) || today);
    const labels = ["一", "二", "三", "四", "五", "六", "日"];
    return decorateRhythm(labels.map((label, index) => {
      const date = formatDate(addDays(startDate, index));
      const dayTasks = tasks.filter((task) => businessDate(task) === date);
      return {
        key: date,
        label,
        minutes: dayTasks.reduce((sum, task) => sum + (task.actualMinutes || 0), 0),
        completed: dayTasks.filter((task) => task.status === "completed").length,
        isCurrent: date === today,
        isFuture: date > today,
      };
    }));
  }
  if (scope === "month") {
    const daysInMonth = new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0).getDate();
    const monthPrefix = today.slice(0, 7);
    const points: Array<Omit<RhythmPoint, "color" | "tint">> = [];
    for (let startDay = 1; startDay <= daysInMonth; startDay += 7) {
      const endDay = Math.min(daysInMonth, startDay + 6);
      const startDate = `${monthPrefix}-${String(startDay).padStart(2, "0")}`;
      const endDate = `${monthPrefix}-${String(endDay).padStart(2, "0")}`;
      const bucket = tasks.filter((task) => businessDate(task) >= startDate && businessDate(task) <= endDate);
      points.push({
        key: startDate,
        label: `第${points.length + 1}周`,
        minutes: bucket.reduce((sum, task) => sum + (task.actualMinutes || 0), 0),
        completed: bucket.filter((task) => task.status === "completed").length,
        isCurrent: Number(today.slice(8, 10)) >= startDay && Number(today.slice(8, 10)) <= endDay,
        isFuture: startDate > today,
      });
    }
    return decorateRhythm(points);
  }
  const points: Array<Omit<RhythmPoint, "color" | "tint">> = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const cursor = new Date(todayDate.getFullYear(), todayDate.getMonth() - offset, 1);
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    const start = formatDate(cursor);
    const end = formatDate(addDays(next, -1));
    const bucket = tasks.filter((task) => businessDate(task) >= start && businessDate(task) <= end);
    points.push({
      key: start,
      label: `${cursor.getMonth() + 1}月`,
      minutes: bucket.reduce((sum, task) => sum + (task.actualMinutes || 0), 0),
      completed: bucket.filter((task) => task.status === "completed").length,
      isCurrent: offset === 0,
    });
  }
  return decorateRhythm(points);
}

function goalInsightItems(activeGoals: Goal[], activeTasks: ActionTask[], archivedGoals: ReturnType<typeof getArchivedGoals>): GoalInsightItem[] {
  const activeItems: GoalInsightItem[] = activeGoals.map((goal) => {
    const tasks = activeTasks.filter((task) => task.goalId === goal.id && task.status !== "rescheduled" && task.status !== "skipped");
    const completed = tasks.filter((task) => task.status === "completed").length;
    return {
      id: goal.id,
      title: goal.title,
      subtitle: goal.description || "正在持续推进",
      completed,
      total: tasks.length,
      progress: tasks.length ? Math.round((completed / tasks.length) * 100) : 0,
      statusLabel: "进行中",
      tone: "active" as const,
    };
  });
  const archivedItems: GoalInsightItem[] = archivedGoals.map((goal) => ({
    id: goal.id,
    title: goal.title,
    subtitle: `${goal.stats.actualMinutes || 0} 分钟真实投入`,
    completed: goal.stats.completedActions || 0,
    total: goal.stats.totalActions || 0,
    progress: goal.stats.completionRate || 0,
    statusLabel: "已归档",
    tone: "archived" as const,
  }));
  return activeItems.concat(archivedItems).slice(0, 3);
}

function getNavigationMetrics() {
  try {
    const windowInfo = wx.getWindowInfo();
    const menu = wx.getMenuButtonBoundingClientRect();
    const navTop = Math.max(windowInfo.statusBarHeight, menu.top);
    const navHeight = Math.max(32, menu.height);
    return {
      statusBarHeight: windowInfo.statusBarHeight,
      navTop,
      navHeight,
      scopeTop: navTop + navHeight + 9,
      scopeMenuTop: navTop + navHeight + 50,
      headlineTop: navTop + navHeight + 82,
      menuRightInset: Math.max(92, windowInfo.windowWidth - menu.left + 8),
    };
  } catch (_error) {
    return { statusBarHeight: 44, navTop: 44, navHeight: 32, scopeTop: 85, scopeMenuTop: 126, headlineTop: 158, menuRightInset: 96 };
  }
}

function scopeCopy(scope: CoachRange) {
  if (scope === "day") return {
    label: "今日复盘",
    subtitle: "只分析今天的真实行动与投入",
    reportName: "今日完成情况",
    prompt: "帮我分析一下今天的完成情况",
    questions: ["为什么这样建议", "今日总结", "找出今日卡点"],
  };
  if (scope === "week") return {
    label: "本周复盘",
    subtitle: "只分析本周行动，不做长期评价",
    reportName: "本周完成情况",
    prompt: "帮我分析一下本周的完成情况",
    questions: ["为什么这样建议", "本周总结", "找出本周问题"],
  };
  if (scope === "month") return {
    label: "本月观察",
    subtitle: "只分析本月行动，不做长期评价",
    reportName: "本月完成情况",
    prompt: "帮我分析一下本月的完成情况",
    questions: ["查看进步总结", "本月总结", "找出高效习惯"],
  };
  return {
    label: "长期洞察",
    subtitle: "结合当前目标与累计行动分析",
    reportName: "累计完成情况",
    prompt: "帮我分析一下当前的整体成长情况",
    questions: ["当前方向对吗", "拆解长期路径", "回顾成长变化"],
  };
}

function judgement(stats: PeriodStats, scopeLabel: string): string {
  if (!stats.totalActions) return `${scopeLabel}还没有行动记录，先完成一件低启动成本的小事。`;
  if (stats.completionRate === 100) return `${scopeLabel}计划内行动已经全部完成，当前节奏稳定，可以记录有效做法。`;
  if (stats.completionRate >= 60) return `${scopeLabel}已经完成大部分行动，保持当前节奏并优先收尾剩余事项。`;
  if (stats.completedActions > 0) return `${scopeLabel}已经开始推进，但完成节奏仍有提升空间，建议缩小下一步。`;
  return `${scopeLabel}尚未形成完成记录，先选择最容易开始的一项行动。`;
}

function bottleneck(stats: PeriodStats, streakDays: number): string {
  const pending = Math.max(0, stats.totalActions - stats.completedActions);
  if (!stats.totalActions) return "当前更需要建立第一条行动记录，而不是继续增加任务。";
  if (pending > 0) return `还有 ${pending} 项行动待推进，建议先处理最接近完成的一项。`;
  if (!stats.minutes) return "行动已完成但尚未记录实际投入，补充时间后分析会更准确。";
  return streakDays > 0 ? `已经连续行动 ${streakDays} 天，注意保持节奏，不必临时加码。` : "当前没有明显卡点，继续保持稳定投入。";
}

function loopDiagnosis(stats: PeriodStats, streakDays: number, rhythmPoints: RhythmPoint[]): LoopDiagnosis {
  const focusPoint = rhythmPoints
    .filter((point) => point.minutes > 0)
    .slice()
    .sort((left, right) => right.minutes - left.minutes)[0];
  const focusWindow: Record<string, string> = {
    morning: "05:00–12:00",
    afternoon: "12:00–18:00",
    evening: "18:00–24:00",
    night: "00:00–05:00",
  };
  const completionScore = Math.round(stats.completionRate * 0.5);
  const investmentScore = Math.round(Math.min(25, (stats.minutes / 45) * 25));
  const continuityScore = Math.round(Math.min(25, (streakDays / 4) * 25));
  const score = stats.totalActions ? Math.min(100, completionScore + investmentScore + continuityScore) : 0;
  const grade = score >= 90 ? "优秀" : score >= 75 ? "良好" : score >= 55 ? "稳步推进" : "待建立";
  const rhythmValue = stats.completionRate === 100 ? "稳定" : stats.completionRate >= 60 ? "推进中" : stats.completedActions ? "已启动" : "待启动";
  const qualityValue = stats.completedActions && stats.minutes ? "高质量" : stats.completedActions ? "已完成" : "待记录";
  return {
    score,
    grade,
    quote: score >= 75 ? "继续保持当前节奏，微小复利，持续累积。" : "先完成一个清晰的小步骤，让节奏重新流动。",
    items: [
      {
        key: "rhythm",
        icon: "chart-pulse",
        label: "节奏状态",
        value: rhythmValue,
        detail: stats.totalActions ? `完成 ${stats.completedActions}/${stats.totalActions} 项，节奏${stats.completionRate >= 60 ? "良好" : "仍可收紧"}` : "暂无计划内行动记录",
        tone: "gold",
      },
      {
        key: "quality",
        icon: "shield",
        label: "完成质量",
        value: qualityValue,
        detail: stats.completedActions ? `完成 ${stats.completedActions} 项，真实投入 ${stats.minutes} 分钟` : "完成行动后生成质量判断",
        meta: stats.completedActions ? `${Math.min(5, Math.max(1, Math.round(stats.completionRate / 20)))} / 5` : "0 / 5",
        tone: "mint",
      },
      {
        key: "focus",
        icon: "sunny",
        label: "专注时段",
        value: focusPoint?.label || "待形成",
        detail: focusPoint ? `${focusPoint.minutes} 分钟投入最集中` : "记录投入后识别高效时段",
        meta: focusPoint ? focusWindow[focusPoint.key] || "" : "",
        tone: "gold",
      },
    ],
  };
}

function errorMessage(rawError: unknown): string {
  const error = rawError as Error & { code?: string };
  if (error?.code === "FUNCTION_NOT_FOUND") return "AI 云函数尚未上传，请先部署服务。";
  if (error?.code === "COACH_RUNTIME_MISMATCH") return "云端 AI 教练版本较旧，请重新上传 generatePlan 云函数。";
  if (error?.code === "AI_COACH_INVALID") return "这次回答没有通过数据校验，请再试一次。";
  if (error?.code === "AI_COACH_FAILED") return "AI 服务尚未配置或暂时不可用。";
  if (error?.code === "MANUAL_STORAGE_UNAVAILABLE") return "行动数据存储尚未初始化，请重新进入页面后再试。";
  if (error?.code === "COACH_ACTION_CONFLICT") return error.message || "行动数据已变化，请重新发送指令。";
  if (error?.code === "COACH_ACTION_EXPIRED") return "确认操作已过期，请重新发送指令。";
  if (error?.code === "FUNCTION_TIMEOUT" || error?.code === "NETWORK_ERROR") return "连接有点慢，请稍后重试。";
  return error?.message || "暂时没有生成回答，请稍后重试。";
}

Page({
  data: {
    appTheme: getCurrentThemeId(),
    ...getNavigationMetrics(),
    scope: "overall" as CoachRange,
    requestedGoalId: "",
    goalId: "",
    scopeLabel: "长期洞察",
    scopeSubtitle: "结合当前目标与累计行动分析",
    reportName: "累计完成情况",
    initialPrompt: "帮我分析一下当前的整体成长情况",
    displayName: "微信用户", userAvatarUrl: "",
    goalTitle: "当前目标",
    completedCount: 0,
    totalCount: 0,
    periodMinutes: 0,
    completionRate: 0,
    activeDays: 0,
    streakDays: 0,
    recentActionDate: "暂无",
    judgement: "正在整理你的行动记录。",
    bottleneck: "完成更多行动后，会形成更具体的建议。",
    metricCards: [] as ScopeMetric[],
    rhythmTitle: "成长轨迹",
    rhythmSubtitle: "根据真实投入记录生成",
    rhythmPoints: [] as RhythmPoint[],
    rhythmSegments: [] as RhythmPoint[],
    rhythmTotalMinutes: 0,
    loopDiagnosis: { score: 0, grade: "待建立", quote: "先完成一个清晰的小步骤，让节奏重新流动。", items: [] } as LoopDiagnosis,
    reviewTitle: "阶段行动回顾",
    reviewSubtitle: "优先展示需要继续推进的行动",
    reviewItems: [] as ReviewItem[],
    goalItems: [] as GoalInsightItem[],
    focusKind: "goals" as "actions" | "goals",
    quickQuestions: [] as string[],
    messages: [] as ChatMessage[],
    asking: false,
    chatError: "",
    failedQuestion: "",
    executingProposalId: "",
    conversationId: "",
    scopeMenuOpen: false,
  },
  profileHandler: null as null | (() => void),

  onLoad(query: Record<string, string>) {
    this.profileHandler = () => this.refreshUserProfile();
    on("profile:update", this.profileHandler);
    const scope = normalizeScope(query.scope || query.range);
    const copy = scopeCopy(scope);
    this.setData({
      scope,
      requestedGoalId: String(query.goalId || ""),
      scopeLabel: copy.label,
      scopeSubtitle: copy.subtitle,
      reportName: copy.reportName,
      initialPrompt: copy.prompt,
      quickQuestions: copy.questions,
      messages: [],
      conversationId: "",
      chatError: "",
      failedQuestion: "",
      scopeMenuOpen: false,
    }, () => {
      this.loadLocalOverview();
    });
  },

  onShow() {
    this.setData({ appTheme: getCurrentThemeId(), ...getNavigationMetrics() });
    this.refreshUserProfile();
    bootstrapAccount().catch(() => undefined).then(() => this.refreshUserProfile());
  },

  onUnload() {
    if (this.profileHandler) {
      off("profile:update", this.profileHandler);
      this.profileHandler = null;
    }
  },

  refreshUserProfile() {
    const profile = getLocalUserProfile();
    this.setData({ displayName: profile?.nickname || "微信用户", userAvatarUrl: profile?.avatarUrl || "" });
  },

  loadLocalOverview() {
    const requested = this.data.requestedGoalId ? getGoal(this.data.requestedGoalId) : null;
    const selectedGoal = requested?.status === "active" ? requested : getActiveGoal();
    const activeGoals = getActiveGoals();
    const archivedGoals = this.data.scope === "overall" ? getArchivedGoals() : [];
    const goals = this.data.scope === "overall" ? activeGoals : selectedGoal ? [selectedGoal] : [];
    const today = getTodayBusinessDate();
    const start = periodStart(this.data.scope, today);
    const activeTasks = goals.reduce<ActionTask[]>((all, goal) => all.concat(getTaskHistoryByGoal(goal.id)), []);
    const archivedTasks = this.data.scope === "overall" ? archivedGoals.reduce<ActionTask[]>((all, goal) => all.concat(goal.actions || []), []) : [];
    const uniqueTasks = Array.from(new Map(activeTasks.concat(archivedTasks).map((task) => [task.id, task])).values());
    const tasks = uniqueTasks.filter((task) => inPeriod(task, start, today));
    const stats = summarize(tasks);
    const streakDays = goals.reduce((max, goal) => Math.max(max, getProgressSummary(goal.id, today).currentStreakDays || 0), 0);
    const activeDates = Array.from(new Set(tasks
      .filter((task) => task.status === "completed" || task.status === "partially_completed" || (task.actualMinutes || 0) > 0)
      .map((task) => businessDate(task))));
    const recentActionDate = activeDates.sort().pop();
    const profile = getLocalUserProfile();
    const title = goals.length > 1 ? `${goals.length} 个进行中目标` : goals[0]?.title || "当前目标";
    const isOverall = this.data.scope === "overall";
    const rhythmTitle = this.data.scope === "day" ? "今日投入分布" : this.data.scope === "week" ? "本周行动节奏" : this.data.scope === "month" ? "本月周节奏" : "近半年成长轨迹";
    const rhythmSubtitle = this.data.scope === "day" ? "按实际完成时间理解今天的行动节奏" : this.data.scope === "week" ? "按自然周展示每天的真实投入" : this.data.scope === "month" ? "按本月每七天观察投入变化" : "只统计已经发生的行动记录";
    const reviewTitle = this.data.scope === "day" ? "今日行动回顾" : this.data.scope === "week" ? "本周行动回顾" : this.data.scope === "month" ? "本月行动回顾" : "目标全景";
    const reviewSubtitle = isOverall
      ? `进行中 ${activeGoals.length} 个 · 已归档 ${archivedGoals.length} 个`
      : this.data.scope === "day"
        ? "优先展示仍需要复盘输出的行动"
        : "优先展示仍需要继续推进的行动";
    const rhythmPoints = buildRhythm(this.data.scope, today, tasks);
    this.setData({
      goalId: isOverall ? "" : selectedGoal?.id || "",
      displayName: profile?.nickname || "微信用户",
      userAvatarUrl: profile?.avatarUrl || "",
      goalTitle: title,
      completedCount: stats.completedActions,
      totalCount: stats.totalActions,
      periodMinutes: stats.minutes,
      completionRate: stats.completionRate,
      activeDays: activeDates.length,
      streakDays,
      recentActionDate: recentActionDate ? `${Number(recentActionDate.slice(5, 7))}/${Number(recentActionDate.slice(8, 10))}` : "暂无",
      judgement: judgement(stats, this.data.scopeLabel),
      bottleneck: bottleneck(stats, streakDays),
      metricCards: metricCards(this.data.scope, stats, activeDates.length, streakDays, activeGoals.length, archivedGoals.length),
      rhythmTitle,
      rhythmSubtitle,
      rhythmPoints,
      rhythmSegments: rhythmPoints.filter((point) => point.minutes > 0),
      rhythmTotalMinutes: rhythmPoints.reduce((sum, point) => sum + point.minutes, 0),
      loopDiagnosis: loopDiagnosis(stats, streakDays, rhythmPoints),
      reviewTitle,
      reviewSubtitle,
      reviewItems: isOverall ? [] : reviewItems(tasks),
      goalItems: isOverall ? goalInsightItems(activeGoals, activeTasks, archivedGoals) : [],
      focusKind: isOverall ? "goals" : "actions",
    });
  },

  goBack() { wx.navigateBack({ delta: 1 }); },

  toggleScopeMenu() {
    this.setData({ scopeMenuOpen: !this.data.scopeMenuOpen });
  },

  selectCoachScope(event: { currentTarget: { dataset: { scope?: string } } }) {
    const nextScope = String(event.currentTarget.dataset.scope || "overall");
    this.setData({ scopeMenuOpen: false });
    const scope = normalizeScope(nextScope);
    if (scope === this.data.scope) return;
    const copy = scopeCopy(scope);
    this.setData({
      scope,
      scopeLabel: copy.label,
      scopeSubtitle: copy.subtitle,
      reportName: copy.reportName,
      initialPrompt: copy.prompt,
      quickQuestions: copy.questions,
      messages: [],
      conversationId: "",
      chatError: "",
      failedQuestion: "",
    }, () => this.loadLocalOverview());
  },

  sendGuidedQuestion(event: { currentTarget: { dataset: { question?: string } } }) {
    if (this.data.asking) return;
    const question = String(event.currentTarget.dataset.question || "").slice(0, 1000);
    if (!question) return;
    this.askQuestion(question, true);
  },

  handleChatSend(event: { detail: { question?: string } }) {
    this.askQuestion(String(event.detail.question || "").slice(0, 1000), true);
  },

  scrollChatToLatest() {
    wx.nextTick(() => {
      const chat = this.selectComponent("#coach-chat") as unknown as { scrollToLatest?: () => void };
      chat?.scrollToLatest?.();
    });
  },

  async askQuestion(question: string, showUser: boolean) {
    if (this.data.asking) return;
    if (!question) {
      wx.showToast({ title: "先写下你想问的问题", icon: "none" });
      return;
    }
    const history = this.data.messages.map((item) => ({ role: item.role, content: item.content, sentAt: item.sentAt })).slice(-20);
    const messageSentAt = new Date().toISOString();
    const userMessage: ChatMessage = { id: `user_${Date.now()}`, role: "user", content: question, sentAt: messageSentAt,
      scope: this.data.scope, analysisDate: getTodayBusinessDate(), goalId: this.data.goalId || undefined };
    this.setData({
      messages: showUser ? this.data.messages.concat(userMessage).slice(-50) : this.data.messages,
      asking: true,
      chatError: "",
      failedQuestion: "",
    }, () => this.scrollChatToLatest());
    try {
      const result = await askProgressCoach(this.data.scope, this.data.goalId || undefined, question, history, getTodayBusinessDate(), messageSentAt, this.data.conversationId || undefined);
      const assistantMessage: ChatMessage = {
        id: result.assistantMessageId || `assistant_${Date.now()}`,
        role: "assistant",
        content: result.answer,
        sentAt: result.generatedAt,
        scope: this.data.scope,
        analysisDate: getTodayBusinessDate(),
        goalId: this.data.goalId || undefined,
        presentation: result.presentation,
        actionProposal: result.actionProposal,
      };
      this.setData({ conversationId: result.conversationId || this.data.conversationId, messages: this.data.messages.concat(assistantMessage).slice(-50), asking: false }, () => this.scrollChatToLatest());
    } catch (error) {
      this.setData({ asking: false, chatError: errorMessage(error), failedQuestion: question }, () => this.scrollChatToLatest());
    }
  },

  retryLastQuestion() {
    if (!this.data.failedQuestion || this.data.asking) return;
    const failedQuestion = this.data.failedQuestion;
    this.setData({ failedQuestion: "", chatError: "" }, () => this.askQuestion(failedQuestion, false));
  },

  async confirmCoachAction(event: { detail: { proposalId?: string } }) {
    const proposalId = String(event.detail.proposalId || "");
    if (!proposalId || this.data.executingProposalId) return;
    const proposal = this.data.messages.find((item) => item.actionProposal?.id === proposalId)?.actionProposal;
    if (!proposal) { wx.showToast({ title: "操作确认信息已失效", icon: "none" }); return; }
    this.setData({ executingProposalId: proposalId, chatError: "", failedQuestion: "" });
    try {
      const outcome = await executeCoachProposal(proposal);
      this.setData({
        executingProposalId: "",
        chatError: "",
        messages: this.data.messages.map((item) => item.actionProposal?.id === proposalId
          ? { ...item, actionProposal: { ...item.actionProposal, status: "executed" as const } }
          : item),
      }, () => {
        this.loadLocalOverview();
        this.scrollChatToLatest();
      });
      const title = outcome.reminder === "scheduled" ? "行动与提醒已设置"
        : outcome.reminder === "rejected" ? "行动已创建，提醒未开启"
          : outcome.reminder === "invalid" ? "行动已创建，提醒时间无效"
            : outcome.reminder === "failed" ? "行动已创建，提醒设置失败" : "已同步到今日行动";
      wx.showToast({ title, icon: outcome.reminder === "rejected" || outcome.reminder === "invalid" || outcome.reminder === "failed" ? "none" : "success" });
    } catch (error) {
      this.setData({ executingProposalId: "", chatError: errorMessage(error) }, () => this.scrollChatToLatest());
    }
  },

  openReviewItem(event: { currentTarget: { dataset: { taskId?: string } } }) {
    const taskId = String(event.currentTarget.dataset.taskId || "");
    const item = this.data.reviewItems.find((candidate) => candidate.id === taskId);
    if (!item) {
      wx.showToast({ title: "该行动已不存在，请刷新后重试", icon: "none" });
      return;
    }
    if (!item.editable) {
      wx.showToast({ title: "该行动当前不可编辑", icon: "none" });
      return;
    }
    const task = getTask(taskId);
    if (!task || task.deletedAt) {
      wx.showToast({ title: "该行动已不存在，请刷新后重试", icon: "none" });
      return;
    }
    openTodayActionEditor({ mode: "edit", taskId });
  },

  goProgress() { wx.switchTab({ url: "/pages/plan/index" }); },

  goToday() { wx.switchTab({ url: "/pages/index/index" }); },
});
