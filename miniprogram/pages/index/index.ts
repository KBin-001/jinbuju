import { getActiveGoal } from "../../services/manualGoal";
import { getProgressSummary, recordDailyCheckin } from "../../services/manualStats";
import { calculateTodaySummary, createTask, deleteTask, getTasksByGoal, getTodayPageTasks, rescheduleTask, updateTaskExecutionMode, updateTaskPriorityOverride, updateTaskReminder, updateTaskStatus } from "../../services/manualTask";
import { getLocalUserProfile } from "../../services/profile";
import { bootstrapAccount } from "../../services/account";
import { analyzeProgress, prepareProgressCoach } from "../../services/progressCoach";
import { getCurrentThemeId, MODAL_CONFIRM_COLORS, withAppTheme } from "../../services/theme";
import { syncManualData } from "../../services/manualSync";
import { InAppMessage, listInAppMessages, readInAppMessage, requestNotificationAuthorization, requestNotificationAuthorizationWithReceipt, upsertTaskReminder } from "../../services/notification";
import { isNotificationConfigured } from "../../config/notification";
import { ActionExecutionMode, ActionIssueReason, ActionSession, ActionTask, ActionTaskStatus, Goal, TodaySummary } from "../../types/manual";
import { addDays, formatDate, formatDisplayDate, getTodayBusinessDate, getTimeGreeting } from "../../utils/date";
import { off, on } from "../../utils/eventBus";
import { getActionTaskDisplayStatus, groupTodayTasks, isCarryOverTask, sortTodayTasksIncompleteFirst } from "../../utils/taskStatus";
import { groupTasksByPriority, PriorityContext, PriorityReason } from "../../utils/taskPriority";
import { getTabHeaderLayout } from "../../utils/tabHeader";
import { buildReminderAt, nextReminderTime, normalizeReminderTime, reminderDateRange } from "../../utils/actionReminder";
import { ACTION_DURATION_OPTIONS } from "../../config/action";
import { resolveActionIcon } from "../../utils/actionIcon";
import { abandonActionSession, finishActionSession, getActiveActionSession, getActiveActionSessionContext, pauseActionSession, resumeActionSession, startActionSession } from "../../services/actionSession";

const REASONS: Array<{ label: string; value: ActionIssueReason }> = [{ label: "时间不够", value: "not_enough_time" }, { label: "难度太高", value: "too_difficult" }, { label: "缺少资源", value: "resource_unavailable" }, { label: "身体或状态不适", value: "physical_condition" }, { label: "临时有事", value: "temporary_event" }, { label: "任务不符合实际", value: "not_practical" }, { label: "其他", value: "other" }];
const DURATION_OPTIONS = ACTION_DURATION_OPTIONS;
const DEFAULT_QUICK_ADD_MINUTE_INDEX = DURATION_OPTIONS.findIndex((option) => option.value === 30);
const QUICK_DURATION_VALUES = new Set([30, 45, 60, 90, 120]);
const QUICK_DURATION_OPTIONS = DURATION_OPTIONS
  .map((option, sourceIndex) => ({ ...option, sourceIndex }))
  .filter((option) => QUICK_DURATION_VALUES.has(option.value));
const EXAMPLE_ACTION_TITLES = ["背单词 30 个", "阅读 30 分钟", "听力练习 20 分钟", "真题复盘 1 套"];
type TaskPrimaryAction = "complete" | "focus" | "active" | "result";
interface ViewTask extends ActionTask {
  displayTitle: string;
  statusLabel: string;
  statusTone: string;
  rescheduled: boolean;
  dateLabel: string;
  partialHint: boolean;
  actionSubtext: string;
  actionTimeText: string;
  actionIconKey: string;
  actionIconAsset: string;
  actionIconTone: string;
  canComplete: boolean;
  primaryAction: TaskPrimaryAction;
  primaryActionLabel: string;
  primaryActionShortLabel: string;
  primaryActionIcon: string;
  primaryActionTone: "plain" | "focus" | "success";
  promptExecution: boolean;
  isRecommendedAction: boolean;
  priorityReasons?: PriorityReason[];
}
interface ViewTaskGroup { key: "today" | "continue"; title: string; tasks: ViewTask[]; }
interface ActionPresentationGroup {
  key: "focus" | "quick" | "later";
  title: string;
  hint: string;
  icon: string;
  tone: "gold" | "green" | "muted";
  tasks: Array<ViewTask & { priorityReasons: PriorityReason[] }>;
}
interface TodayMood { title: string; copy: string; tone: "empty" | "low" | "half" | "done"; mark: string; }
interface ProactiveInsight { label: string; title: string; body: string; tone: "start" | "progress" | "near" | "done" | "streak"; }
interface ProgressSegment { active: boolean; }
interface WeekDayView { label: string; date: string; day: string; isToday: boolean; isSelected: boolean; isCurrentMonth: boolean; }
interface CalendarDayView extends WeekDayView { hasAction: boolean; isCompleted: boolean; }
interface CalendarView { title: string; days: CalendarDayView[]; }

function monthDayLabel(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function dateCopy(value: string): { weekday: string } {
  const date = new Date(`${value}T00:00:00`);
  return { weekday: ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][date.getDay()] };
}
function emptySummary(): TodaySummary { return { estimatedMinutes: 0, actualMinutes: 0, completedCount: 0, partialCount: 0, unfinishedCount: 0, totalCount: 0 }; }
function completionPercent(summary: TodaySummary): number {
  if (!summary.totalCount) return 0;
  // completed 计为 1，partially_completed 计为 0.5，体现部分进度
  const weighted = summary.completedCount + summary.partialCount * 0.5;
  return Math.round(weighted / summary.totalCount * 100);
}
function focusPercent(summary: TodaySummary): number { return completionPercent(summary); }
function remainingCount(summary: TodaySummary): number { return Math.max(0, summary.totalCount - summary.completedCount); }
function remainingEstimatedMinutes(tasks: ViewTask[], today: string): number {
  return tasks
    .filter((task) => task.currentDate === today && task.status !== "completed" && task.status !== "rescheduled")
    .reduce((sum, task) => sum + task.estimatedMinutes, 0);
}
function progressSegments(summary: TodaySummary): ProgressSegment[] {
  const total = summary.totalCount || 4;
  // completed 和 partially_completed 都标记为 active，体现已推进的进度
  const activeCount = summary.completedCount + summary.partialCount;
  return Array.from({ length: total }, (_, index) => ({ active: index < activeCount }));
}

/**
 * 今日行动智能分组：委托 groupTasksByPriority 纯函数，基于多维评分自动分入
 * "今日重点""快速推进""稍后安排"三段。上下文从 getProgressSummary 获取。
 */
function buildActionPresentationGroups(tasks: ViewTask[], context: PriorityContext): ActionPresentationGroup[] {
  if (!tasks.length) return [];
  return groupTasksByPriority(tasks, context) as ActionPresentationGroup[];
}
function sessionClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  const pair = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${pair(hours)}:${pair(minutes)}:${pair(rest)}` : `${pair(minutes)}:${pair(rest)}`;
}

function sessionMinutes(session: ActionSession | null): number {
  return session ? Math.max(0, Math.floor(session.elapsedSeconds / 60)) : 0;
}

function sessionProgress(session: ActionSession | null): number {
  if (!session?.targetSeconds) return 0;
  return Math.min(100, Math.round((session.elapsedSeconds / session.targetSeconds) * 100));
}
function todayMood(summary: TodaySummary): TodayMood {
  const percent = completionPercent(summary);
  if (!summary.totalCount) return { title: "今天还没开局", copy: "先放一件小事上来，别让今天空过去。", tone: "empty", mark: "启" };
  if (percent >= 100) return { title: "今天你赢下来了", copy: "该完成的都收住了，节奏很漂亮。", tone: "done", mark: "赢" };
  if (percent >= 50) return { title: "差一点，但已经上桌了", copy: `还剩 ${remainingCount(summary)} 项，顺手收掉一件就很赚。`, tone: "half", mark: "冲" };
  if (summary.completedCount > 0) return { title: "先拿下 1 项，节奏已经起来了", copy: `已经完成 ${summary.completedCount} 项，剩下的慢慢推进。`, tone: "low", mark: "进" };
  if (summary.partialCount > 0) return { title: "已经开始推进了", copy: `有 ${summary.partialCount} 项完成了一部分，继续把它收住。`, tone: "low", mark: "进" };
  return { title: "今天别空手离开", copy: `还有 ${summary.totalCount} 项等你开动，挑最小的一件先做。`, tone: "low", mark: "动" };
}
function buildProactiveInsight(summary: TodaySummary, tasks: ViewTask[], progress: ReturnType<typeof getProgressSummary> | null, selectedDate: string, today: string): ProactiveInsight {
  const isToday = selectedDate === today;
  const unfinished = tasks.filter((task) => task.status === "pending" || task.status === "partially_completed");
  const remaining = Math.max(0, summary.totalCount - summary.completedCount);
  const streak = progress?.currentStreakDays || 0;

  if (isToday && streak >= 7) {
    return {
      label: "AI 主动观察",
      title: `你已经连续行动 ${streak} 天`,
      body: remaining === 0 ? "今天也完成了，建议记录一下这周最有效的做法。" : `先收掉剩下 ${remaining} 项，连续节奏就能稳稳保住。`,
      tone: "streak",
    };
  }
  if (isToday && summary.totalCount > 0 && remaining === 1) {
    const next = unfinished[0];
    return {
      label: "AI 主动观察",
      title: "还剩最后一项，今天就能闭环",
      body: next ? `优先处理“${next.displayTitle}”，先做 ${Math.min(20, next.estimatedMinutes)} 分钟。` : "把最后一步收住，比继续加任务更重要。",
      tone: "near",
    };
  }
  if (summary.totalCount > 0 && remaining === 0) {
    return {
      label: "AI 主动观察",
      title: isToday ? "今天的行动已经完成" : "这一天的行动已经完成",
      body: "现在适合做 2 分钟复盘：记下顺利的原因，明天会更容易启动。",
      tone: "done",
    };
  }
  if (summary.completedCount > 0 || summary.partialCount > 0 || summary.actualMinutes > 0) {
    return {
      label: "AI 主动观察",
      title: isToday ? "今天的节奏已经启动" : "这一天已有行动记录",
      body: remaining > 0 ? `还有 ${remaining} 项可以继续，不需要加码，先推进最小的一步。` : "已有真实投入，保持收口比继续堆任务更重要。",
      tone: "progress",
    };
  }
  if (summary.totalCount > 0) {
    const next = unfinished[0] || tasks[0];
    return {
      label: "AI 主动观察",
      title: isToday ? "今天还没开始，先降低启动成本" : "这一天还没有行动记录",
      body: next ? `从“${next.displayTitle}”开始，只要求先做 10 分钟。` : (isToday ? "选一件最小行动开始，先让今天有记录。" : "可以回到今天，安排一件容易开始的小行动。"),
      tone: "start",
    };
  }
  return {
    label: "AI 主动观察",
    title: "先添加一项今日行动",
    body: "我会根据完成状态、实际投入和连续天数，给出下一步建议。",
    tone: "start",
  };
}
function buildAiPriorityInsight(analysis: { nextSuggestions: string[]; rhythmDiagnosis: string[] }, fallback: ProactiveInsight): ProactiveInsight {
  const priority = String(analysis.nextSuggestions[0] || "").trim();
  const reason = String(analysis.rhythmDiagnosis[0] || "").trim();
  if (!priority) return fallback;
  return { label: "AI 优先级 1", title: priority, body: reason || fallback.body, tone: "progress" };
}
function buildWeekDays(today: string, selectedDate: string, weekOffset: number): { weekTitle: string; weekDays: WeekDayView[] } {
  const selected = new Date(`${selectedDate}T00:00:00`);
  const mondayOffset = (selected.getDay() + 6) % 7;
  const monday = addDays(selected, weekOffset * 7 - mondayOffset);
  const weekDays = ["一", "二", "三", "四", "五", "六", "日"].map((label, index) => {
    const date = addDays(monday, index);
    const value = formatDate(date);
    return {
      label,
      date: value,
      day: String(date.getDate()),
      isToday: value === today,
      isSelected: value === selectedDate,
      isCurrentMonth: date.getMonth() === selected.getMonth(),
    };
  });
  const title = selectedDate === today ? "今天" : `${selected.getMonth() + 1} 月 ${selected.getDate()} 日`;
  return {
    weekTitle: title,
    weekDays,
  };
}
function monthStart(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return formatDate(new Date(date.getFullYear(), date.getMonth(), 1));
}
function addMonths(value: string, delta: number): string {
  const date = new Date(`${value}T00:00:00`);
  return formatDate(new Date(date.getFullYear(), date.getMonth() + delta, 1));
}
function buildCalendar(today: string, selectedDate: string, monthValue: string, tasks: ActionTask[]): CalendarView {
  const monthDate = new Date(`${monthStart(monthValue)}T00:00:00`);
  const month = monthDate.getMonth();
  const startOffset = (monthDate.getDay() + 6) % 7;
  const firstCell = addDays(monthDate, -startOffset);
  const actionDates = new Set(tasks.filter((task) => task.status !== "rescheduled").map((task) => task.currentDate));
  const completedDates = new Set(tasks.filter((task) => task.status === "completed").map((task) => task.currentDate));
  return {
    title: `${monthDate.getFullYear()} 年 ${monthDate.getMonth() + 1} 月`,
    days: Array.from({ length: 42 }, (_, index) => {
      const date = addDays(firstCell, index);
      const value = formatDate(date);
      return {
        label: ["一", "二", "三", "四", "五", "六", "日"][(date.getDay() + 6) % 7],
        date: value,
        day: String(date.getDate()),
        isToday: value === today,
        isSelected: value === selectedDate,
        isCurrentMonth: date.getMonth() === month,
        hasAction: actionDates.has(value),
        isCompleted: completedDates.has(value),
      };
    }),
  };
}
function displayTaskTitle(task: ActionTask): string {
  if (!/^\d+$/.test(task.title.trim())) return task.title;
  const seed = task.id.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return EXAMPLE_ACTION_TITLES[seed % EXAMPLE_ACTION_TITLES.length];
}
function taskSubtext(task: ActionTask): string {
  const base = task.description || `学习 ${task.estimatedMinutes} 分钟`;
  if (task.reminder?.status === "scheduled") return `${base} · ${formatDisplayDate(task.currentDate)} ${task.reminder.time} 提醒`;
  if (task.reminder?.status === "failed") return `${base} · 提醒未开启`;
  return base;
}

function taskTimeText(task: ActionTask): string {
  const reminderTime = task.reminder?.status === "scheduled" ? `${task.reminder.time} · ` : "";
  return `${reminderTime}预计 ${task.estimatedMinutes} 分钟`;
}

function buildCoachTip(insight: ProactiveInsight, activeTask: ViewTask | null, activeMinutes: number): string {
  if (activeTask) {
    const invested = Math.max(0, activeMinutes);
    return `已经专注 ${invested} 分钟，先完成“${activeTask.displayTitle}”的 ${activeTask.estimatedMinutes} 分钟目标，再开始下一项。`;
  }
  return insight.body || insight.title;
}

function toViewTask(task: ActionTask, selectedDate: string, businessToday = getTodayBusinessDate()): ViewTask {
  const displayStatus = getActionTaskDisplayStatus(task, selectedDate);
  const displayTitle = displayTaskTitle(task);
  const actionIcon = resolveActionIcon(task.title, task.description, task.iconManual ? task.iconKey : undefined);
  return {
    ...task,
    displayTitle,
    statusLabel: displayStatus.text,
    statusTone: displayStatus.tone,
    rescheduled: isCarryOverTask(task),
    dateLabel: task.currentDate === selectedDate ? "今天" : formatDisplayDate(task.currentDate),
    partialHint: displayStatus.badge === "待继续",
    actionSubtext: taskSubtext(task),
    actionTimeText: taskTimeText(task),
    actionIconKey: actionIcon.key,
    actionIconAsset: actionIcon.asset,
    actionIconTone: actionIcon.tone,
    canComplete: task.currentDate <= businessToday && task.status !== "rescheduled",
    primaryAction: "focus",
    primaryActionLabel: "开始专注",
    primaryActionShortLabel: "专注",
    primaryActionIcon: "play-circle",
    primaryActionTone: "focus",
    promptExecution: false,
    isRecommendedAction: false,
  };
}

function decorateTaskAction(task: ViewTask, activeTaskId: string, activeStatus: string): ViewTask {
  if (task.status === "completed") {
    return {
      ...task,
      primaryAction: "result",
      primaryActionLabel: "查看行动记录",
      primaryActionShortLabel: "记录",
      primaryActionIcon: "check-circle",
      primaryActionTone: "success",
      promptExecution: false,
    };
  }
  if (activeTaskId === task.id) {
    const paused = activeStatus === "paused";
    return {
      ...task,
      primaryAction: paused ? "focus" : "active",
      primaryActionLabel: paused ? "继续专注" : "专注中",
      primaryActionShortLabel: paused ? "继续" : "计时中",
      primaryActionIcon: paused ? "play-circle" : "time",
      primaryActionTone: "focus",
      promptExecution: false,
    };
  }
  if (task.status === "partially_completed") {
    return {
      ...task,
      primaryAction: "focus",
      primaryActionLabel: "继续专注",
      primaryActionShortLabel: "继续",
      primaryActionIcon: "play-circle",
      primaryActionTone: "focus",
      promptExecution: false,
    };
  }
  const mode = task.executionMode || "ask";
  const recommendedAction: TaskPrimaryAction = task.estimatedMinutes <= 15 ? "complete" : "focus";
  const primaryAction: TaskPrimaryAction = mode === "direct" ? "complete" : mode === "focus" ? "focus" : recommendedAction;
  const promptExecution = mode === "ask";
  return {
    ...task,
    primaryAction,
    primaryActionLabel: promptExecution ? "选择执行方式" : primaryAction === "complete" ? "完成行动" : "开始专注",
    primaryActionShortLabel: promptExecution ? "开始" : primaryAction === "complete" ? "完成" : "专注",
    primaryActionIcon: primaryAction === "complete" ? "check-circle" : "play-circle",
    primaryActionTone: primaryAction === "complete" ? "success" : "focus",
    promptExecution,
  };
}

function markRecommendedAction(tasks: ViewTask[], enabled: boolean): ViewTask[] {
  let recommendationAssigned = false;
  return tasks.map((task) => {
    const isRecommendedAction = enabled
      && !recommendationAssigned
      && task.canComplete
      && task.status !== "completed"
      && task.primaryAction !== "active";
    if (isRecommendedAction) recommendationAssigned = true;
    return task.isRecommendedAction === isRecommendedAction ? task : { ...task, isRecommendedAction };
  });
}

Page(withAppTheme({
  data: {
    ...getTabHeaderLayout(),
    appTheme: getCurrentThemeId() as string,
    status: "loading",
    errorMessage: "",
    displayName: "行动伙伴",
    displayAvatarUrl: "",
    goal: null as Goal | null,
    tasks: [] as ViewTask[],
    activeSessionId: "",
    activeSessionTaskId: "",
    activeSessionStatus: "",
    activeSessionTask: null as ViewTask | null,
    activeSessionElapsedSeconds: 0,
    activeSessionElapsedMinutes: 0,
    activeSessionDisplay: "00:00",
    activeSessionProgress: 0,
    activeSessionOrphan: false,
    timerSubmitting: false,
    taskGroups: [] as ViewTaskGroup[],
    visibleTasks: [] as ViewTask[],
    visibleTaskGroups: [] as ActionPresentationGroup[],
    summary: emptySummary(),
    completionPercent: 0,
    focusPercent: 0,
    remainingCount: 0,
    todayTargetMinutes: 0,
    todayActualMinutes: 0,
    todayMinuteProgress: 0,
    remainingEstimatedMinutes: 0,
    progressSegments: [] as ProgressSegment[],
    actionListExpanded: false,
    hiddenActionCount: 0,
    heroDayLabel: "DAY 1",
    heroFocusTitle: "今日行动",
    greetingText: "早上好",
    greetingSubtitle: "今天也从一小步开始",
    todayMoodTitle: "今天还没开局",
    todayMoodCopy: "先放一件小事上来，别让今天空过去。",
    todayMoodTone: "empty",
    todayMoodMark: "启",
    currentStreakDays: 0,
    coachStatus: "idle" as "idle" | "loading" | "ready" | "error",
    proactiveInsight: { label: "AI 主动观察", title: "先添加一项今日行动", body: "我会根据完成状态、实际投入和连续天数，主动提醒你下一步。", tone: "start" } as ProactiveInsight,
    coachTipText: "先添加一项今日行动，我会根据真实投入给出下一步建议。",
    weekday: "",
    weekdayShort: "",
    selectedDate: "",
    todayDate: "",
    weekOffset: 0,
    weekTitle: "今天",
    selectedMonthDay: "",
    weekDays: [] as WeekDayView[],
    calendarVisible: false,
    calendarMonth: "",
    calendarTitle: "",
    calendarWeekLabels: ["一", "二", "三", "四", "五", "六", "日"],
    calendarDays: [] as CalendarDayView[],
    navigating: false,
    quickAddVisible: false,
    quickAddTitle: "",
    quickAddMinutes: 30,
    quickAddExecutionMode: "ask" as ActionExecutionMode,
    quickAddImportance: "normal" as "required" | "normal",
    quickAddBlocksOthers: false,
    quickAddDate: getTodayBusinessDate(),
    quickAddDateEnd: reminderDateRange().end,
    quickAddReminderEnabled: false,
    quickAddReminderTime: nextReminderTime(),
    quickDurationOptions: DURATION_OPTIONS,
    quickDurationPrimaryOptions: QUICK_DURATION_OPTIONS,
    quickAddMinuteIndex: DEFAULT_QUICK_ADD_MINUTE_INDEX,
    quickDurationVisible: false,
    quickAddSubmitting: false,
    quickAddTouchStartY: 0,
    quickAddTouchDeltaY: 0,
    completionSheetRendered: false,
    completionSheetVisible: false,
    completionSheetData: {
      done: 0,
      total: 0,
      goalProgress: 0,
      minutes: 0,
      streak: 0,
      allDone: false,
    },
    dailyActionNotificationAvailable: isNotificationConfigured("daily_action_reminder") && new Date().getHours() < 22,
    notificationAuthorizing: false,
    inAppMessage: null as InAppMessage | null,
  },
  profileHandler: null as null | (() => void),
  focusGoalHandler: null as null | (() => void),
  sessionUpdateHandler: null as null | (() => void),
  completionSheetTimer: null as ReturnType<typeof setTimeout> | null,
  sessionTicker: null as ReturnType<typeof setInterval> | null,
  coachRequestKey: "",
  coachRequestGeneration: 0,
  scrollTopCache: 0,
  priorityContext: { today: "", currentStreakDays: 0 } as PriorityContext,
  onPageScroll(event: { scrollTop: number }) {
    this.scrollTopCache = event.scrollTop;
  },
  onLoad() {
    this.profileHandler = () => this.load();
    this.focusGoalHandler = () => this.load();
    this.sessionUpdateHandler = () => this.refreshActiveSession();
    on("profile:update", this.profileHandler);
    on("goal:focus:update", this.focusGoalHandler);
    on("action-session:update", this.sessionUpdateHandler);
  },
  onReady() {},
  onHide() { this.stopSessionTicker(); },
  onUnload() {
    this.stopSessionTicker();
    if (this.completionSheetTimer) {
      clearTimeout(this.completionSheetTimer);
      this.completionSheetTimer = null;
    }
    if (this.profileHandler) {
      off("profile:update", this.profileHandler);
      this.profileHandler = null;
    }
    if (this.focusGoalHandler) {
      off("goal:focus:update", this.focusGoalHandler);
      this.focusGoalHandler = null;
    }
    if (this.sessionUpdateHandler) {
      off("action-session:update", this.sessionUpdateHandler);
      this.sessionUpdateHandler = null;
    }
  },
  onShow() {
    (this as any).getTabBar?.()?.syncSelected?.();
    this.setData({ appTheme: getCurrentThemeId() });
    // 先立即加载本地数据，让页面马上显示内容
    this.load();
    // 今日页不能依赖用户先打开“我的”页；缓存会立即生效，云端完成后由 profile:update 再刷新。
    bootstrapAccount().catch(() => undefined).then(() => this.load());
    // 再后台同步云端数据，完成后刷新一次
    syncManualData().catch(() => undefined).then(() => this.load());
    this.loadInAppMessage();
  },
  async loadInAppMessage() {
    try {
      const result = await listInAppMessages(1);
      this.setData({ inAppMessage: result.list[0] || null });
    } catch (_error) {
      this.setData({ inAppMessage: null });
    }
  },
  async openInAppMessage() {
    const message = this.data.inAppMessage;
    if (!message) return;
    this.setData({ inAppMessage: null });
    try {
      await readInAppMessage(message.id);
    } catch (_error) {
      this.setData({ inAppMessage: message });
      wx.showToast({ title: "消息状态更新失败，请重试", icon: "none" });
      return;
    }
    if (!/^\/pages\/[A-Za-z0-9_/-]+(?:\?[A-Za-z0-9_=&%.-]+)?$/.test(message.page)) return;
    const tabPages = new Set(["/pages/index/index", "/pages/plan/index", "/pages/team/index", "/pages/profile/index"]);
    if (tabPages.has(message.page)) wx.switchTab({ url: message.page });
    else wx.navigateTo({ url: message.page });
  },
  load() {
    // 已有数据时不闪 loading，保持旧内容可见，后台静默刷新
    if (this.data.status !== "ready") this.setData({ status: "loading", errorMessage: "" });
    try {
      const today = getTodayBusinessDate(); const selectedDate = this.data.selectedDate || today; const goal = getActiveGoal(); const copy = dateCopy(selectedDate); const userProfile = getLocalUserProfile(); const displayName = userProfile?.nickname || "行动伙伴"; const timeGreeting = getTimeGreeting();
      const displayAvatarUrl = userProfile?.avatarUrl || "";
      const goalTasks = goal ? getTasksByGoal(goal.id) : [];
      const sourceTasks = goal ? getTodayPageTasks(goal.id, selectedDate, today) : [];
      const selectedTasks = sourceTasks.filter((task) => task.currentDate === selectedDate);
      const summaryTasks = selectedDate === today ? sourceTasks : selectedTasks;
      // 活跃会话是全局概念：不依赖选中日期，也不经过目标作用域过滤。
      // 通过服务层上下文函数按会话 taskId 直接解析任务，顺延/跨目标任务仍能锚定。
      const activeContext = getActiveActionSessionContext();
      const activeSession = activeContext ? activeContext.session : null;
      const baseTaskGroups = groupTodayTasks(sourceTasks, selectedDate).map((group) => ({
        ...group,
        tasks: group.tasks.map((task) => decorateTaskAction(toViewTask(task, selectedDate, today), activeSession?.taskId || "", activeSession?.status || "")),
      }));
      const tasks = markRecommendedAction(
        sortTodayTasksIncompleteFirst(baseTaskGroups.reduce<ViewTask[]>((all, group) => all.concat(group.tasks), [])),
        selectedDate === today,
      );
      const taskById = new Map(tasks.map((task) => [task.id, task]));
      const taskGroups = baseTaskGroups.map((group) => ({
        ...group,
        tasks: group.tasks.map((task) => taskById.get(task.id) || task),
      }));
      const activeRawTask = activeContext && activeContext.task ? activeContext.task : null;
      const activeSessionOrphan = Boolean(activeContext && activeContext.task === null && activeSession);
      const activeSessionTask = activeRawTask ? toViewTask(activeRawTask, selectedDate, today) : null;
      const summary = calculateTodaySummary(summaryTasks);
      const activeMinutes = sessionMinutes(activeSession);
      const todayTargetMinutes = summary.estimatedMinutes;
      // 活跃会话的进行中投入只在「今日摘要」场景叠加，非今日日期的历史摘要不误算入。
      const todayActualMinutes = summary.actualMinutes + (selectedDate === today ? activeMinutes : 0);
      const todayMinuteProgress = todayTargetMinutes > 0 ? Math.min(100, Math.round(todayActualMinutes / todayTargetMinutes * 100)) : 0;
      const progress = goal ? getProgressSummary(goal.id, selectedDate) : null;
      const mood = todayMood(summary);
      const visibleTasks = this.data.actionListExpanded ? tasks : tasks.slice(0, 4);
      const priorityContext: PriorityContext = { today, goalTargetDate: goal?.targetDate, currentStreakDays: progress?.currentStreakDays || 0 };
      this.priorityContext = priorityContext;
      const visibleTaskGroups = buildActionPresentationGroups(visibleTasks, priorityContext);
      const week = buildWeekDays(today, selectedDate, this.data.weekOffset);
      const calendarMonth = this.data.calendarMonth || monthStart(selectedDate);
      const calendar = buildCalendar(today, selectedDate, calendarMonth, goalTasks);
      this.setData({
        status: "ready",
        displayName,
        displayAvatarUrl,
        greetingText: timeGreeting.greeting,
        greetingSubtitle: selectedDate === today ? "回顾今天，收住节奏" : timeGreeting.subtitle,
        goal,
        selectedDate,
        todayDate: today,
        tasks,
        activeSessionId: activeSession?.id || "",
        activeSessionTaskId: activeSession?.taskId || "",
        activeSessionStatus: activeSession?.status || "",
        activeSessionTask,
        activeSessionOrphan,
        activeSessionElapsedSeconds: activeSession?.elapsedSeconds || 0,
        activeSessionElapsedMinutes: activeMinutes,
        activeSessionDisplay: sessionClock(activeSession?.elapsedSeconds || 0),
        activeSessionProgress: sessionProgress(activeSession),
        taskGroups,
        visibleTasks,
        visibleTaskGroups,
        summary,
        completionPercent: completionPercent(summary),
        focusPercent: focusPercent(summary),
        remainingCount: remainingCount(summary),
        todayTargetMinutes,
        todayActualMinutes,
        todayMinuteProgress,
        remainingEstimatedMinutes: remainingEstimatedMinutes(tasks, selectedDate),
        progressSegments: progressSegments(summary),
        hiddenActionCount: Math.max(0, tasks.length - visibleTasks.length),
        heroDayLabel: `DAY ${Math.max(1, progress?.totalActionDays || (summary.completedCount > 0 ? 1 : 0))}`,
        heroFocusTitle: goal?.title || "今日行动",
        todayMoodTitle: mood.title,
        todayMoodCopy: mood.copy,
        todayMoodTone: mood.tone,
        todayMoodMark: mood.mark,
        currentStreakDays: progress?.currentStreakDays || 0,
        proactiveInsight: buildProactiveInsight(summary, tasks, progress, selectedDate, today),
        coachTipText: buildCoachTip(buildProactiveInsight(summary, tasks, progress, selectedDate, today), activeSessionTask, activeMinutes),
        weekday: copy.weekday,
        weekdayShort: copy.weekday.replace("星期", "周"),
        weekTitle: week.weekTitle,
        selectedMonthDay: monthDayLabel(selectedDate),
        weekDays: week.weekDays,
        calendarMonth,
        calendarTitle: calendar.title,
        calendarDays: calendar.days,
        navigating: false,
      }, () => {
        this.syncSessionTicker();
        this.prepareTodayCoach();
      });
    } catch (error) { this.setData({ status: "error", errorMessage: error instanceof Error ? error.message : "本地数据读取失败" }); }
  },
  useDefaultAvatar() { this.setData({ displayAvatarUrl: "" }); },
  syncSessionTicker() {
    this.stopSessionTicker();
    if (!this.data.activeSessionId || this.data.activeSessionStatus !== "running") return;
    this.sessionTicker = setInterval(() => this.refreshActiveSession(), 1000);
  },
  stopSessionTicker() {
    if (!this.sessionTicker) return;
    clearInterval(this.sessionTicker);
    this.sessionTicker = null;
  },
  refreshActiveSession() {
    const session = getActiveActionSession();
    if (!session || session.id !== this.data.activeSessionId) {
      this.load();
      return;
    }
    const activeMinutes = sessionMinutes(session);
    // 活跃会话的进行中投入只在「今日摘要」场景叠加，非今日日期的历史摘要不误算入。
    const isTodayView = this.data.selectedDate === this.data.todayDate;
    const todayActualMinutes = this.data.summary.actualMinutes + (isTodayView ? activeMinutes : 0);
    const todayMinuteProgress = this.data.todayTargetMinutes > 0
      ? Math.min(100, Math.round(todayActualMinutes / this.data.todayTargetMinutes * 100))
      : 0;
    this.setData({
      activeSessionStatus: session.status,
      activeSessionElapsedSeconds: session.elapsedSeconds,
      activeSessionElapsedMinutes: activeMinutes,
      activeSessionDisplay: sessionClock(session.elapsedSeconds),
      activeSessionProgress: sessionProgress(session),
      todayActualMinutes,
      todayMinuteProgress,
      coachTipText: buildCoachTip(this.data.proactiveInsight, this.data.activeSessionTask, activeMinutes),
    });
  },
  prepareTodayCoach() {
    const goal = this.data.goal;
    if (!goal?.id) { this.coachRequestKey = ""; this.setData({ coachStatus: "idle" }); return; }
    const analysisDate = this.data.selectedDate || getTodayBusinessDate();
    const requestKey = `day:${goal.id}:${analysisDate}`;
    const generation = ++this.coachRequestGeneration;
    this.coachRequestKey = requestKey;
    this.setData({ coachStatus: "loading" });
    prepareProgressCoach("day", goal.id, false, analysisDate)
      .then(() => analyzeProgress(goal.id, "day", analysisDate))
      .then((analysis) => {
        if (this.coachRequestKey !== requestKey || this.coachRequestGeneration !== generation) return;
        const proactiveInsight = buildAiPriorityInsight(analysis, this.data.proactiveInsight);
        this.setData({
          coachStatus: "ready",
          proactiveInsight,
          coachTipText: buildCoachTip(proactiveInsight, this.data.activeSessionTask, this.data.activeSessionElapsedMinutes),
        });
      }, () => {
        if (this.coachRequestKey === requestKey && this.coachRequestGeneration === generation) this.setData({ coachStatus: "error" });
      });
  },
  retry() { this.load(); },
  toggleActionList() {
    const actionListExpanded = !this.data.actionListExpanded;
    const visibleTasks = actionListExpanded ? this.data.tasks : this.data.tasks.slice(0, 4);
    this.setData({
      actionListExpanded,
      visibleTasks,
      visibleTaskGroups: buildActionPresentationGroups(visibleTasks, this.priorityContext || { today: getTodayBusinessDate(), currentStreakDays: 0 }),
      hiddenActionCount: Math.max(0, this.data.tasks.length - visibleTasks.length),
    });
  },
  switchWeek(event: { currentTarget: { dataset: { direction?: string | number } } }) {
    const direction = Number(event.currentTarget.dataset.direction || 0);
    const weekOffset = this.data.weekOffset + direction;
    const today = getTodayBusinessDate();
    const selectedDate = this.data.selectedDate || today;
    const week = buildWeekDays(today, selectedDate, weekOffset);
    this.setData({ weekOffset, weekTitle: week.weekTitle, weekDays: week.weekDays });
  },
  selectWeekDate(event: { currentTarget: { dataset: { date?: string } } }) {
    const selectedDate = String(event.currentTarget.dataset.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate) || selectedDate === this.data.selectedDate) return;
    this.scrollTopCache = 0;
    this.setData({ selectedDate, calendarMonth: monthStart(selectedDate), actionListExpanded: false });
    this.load();
  },
  openCalendar() {
    const selectedDate = this.data.selectedDate || getTodayBusinessDate();
    const calendarMonth = monthStart(selectedDate);
    this.setData({ calendarVisible: true, calendarMonth });
    this.load();
  },
  closeCalendar() {
    this.setData({ calendarVisible: false });
  },
  switchCalendarMonth(event: { currentTarget: { dataset: { delta?: string | number } } }) {
    const delta = Number(event.currentTarget.dataset.delta || 0);
    const calendarMonth = addMonths(this.data.calendarMonth || monthStart(this.data.selectedDate || getTodayBusinessDate()), delta);
    const today = getTodayBusinessDate();
    const goal = getActiveGoal();
    const tasks = goal ? getTasksByGoal(goal.id) : [];
    const calendar = buildCalendar(today, this.data.selectedDate || today, calendarMonth, tasks);
    this.setData({ calendarMonth, calendarTitle: calendar.title, calendarDays: calendar.days });
  },
  selectCalendarDate(event: { currentTarget: { dataset: { date?: string } } }) {
    const selectedDate = String(event.currentTarget.dataset.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) return;
    this.scrollTopCache = 0;
    this.setData({ selectedDate, calendarMonth: monthStart(selectedDate), calendarVisible: false, actionListExpanded: false, weekOffset: 0 });
    this.load();
  },
  jumpTodayFromCalendar() {
    const selectedDate = getTodayBusinessDate();
    this.scrollTopCache = 0;
    this.setData({ selectedDate, calendarMonth: monthStart(selectedDate), calendarVisible: false, actionListExpanded: false, weekOffset: 0 });
    this.load();
  },
  goCreateGoal() { if (this.data.navigating) return; this.setData({ navigating: true }); wx.navigateTo({ url: "/pages/goal-create/index", fail: () => this.setData({ navigating: false }) }); },
  handleTaskPrimary(event: { detail?: { id?: string }; currentTarget?: { dataset?: { id?: string } } }) {
    const taskId = String(event.detail?.id || event.currentTarget?.dataset?.id || "");
    const task = this.data.tasks.find((item) => item.id === taskId);
    if (!task) return;
    if (!task.canComplete && task.primaryAction === "complete") {
      wx.showToast({ title: "未来行动到当天后再记录完成", icon: "none" });
      return;
    }
    if (task.primaryAction === "result") {
      wx.navigateTo({ url: `/pages/action-edit/index?id=${task.id}` });
      return;
    }
    if (task.primaryAction === "active") {
      wx.showToast({ title: "当前行动正在专注", icon: "none" });
      return;
    }
    if (task.promptExecution) {
      wx.showActionSheet({
        itemList: ["直接完成", "开始专注"],
        success: ({ tapIndex }) => {
          if (tapIndex === 0) this.completeTask(task);
          else if (tapIndex === 1) this.startTask({ detail: { id: task.id } });
        },
      });
      return;
    }
    if (task.primaryAction === "complete") this.completeTask(task);
    else this.startTask({ detail: { id: task.id } });
  },
  openExecutionPreference() {
    wx.showActionSheet({
      itemList: ["直接完成：轻任务优先打卡", "专注计时：长任务优先计时", "每次询问：按任务灵活选择"],
      success: ({ tapIndex }) => {
        const mode: ActionExecutionMode = tapIndex === 0 ? "direct" : tapIndex === 1 ? "focus" : "ask";
        this.setData({ quickAddExecutionMode: mode });
        wx.showToast({ title: mode === "direct" ? "新增行动默认直接完成" : mode === "focus" ? "新增行动默认专注计时" : "新增行动将每次询问", icon: "none" });
      },
    });
  },
  setTaskExecutionMode(task: ViewTask) {
    wx.showActionSheet({
      itemList: ["直接完成", "专注计时", "每次询问"],
      success: ({ tapIndex }) => {
        const mode: ActionExecutionMode = tapIndex === 0 ? "direct" : tapIndex === 1 ? "focus" : "ask";
        try {
          updateTaskExecutionMode(task.id, mode);
          this.load();
          wx.showToast({ title: "执行方式已更新", icon: "success" });
        } catch (error) {
          wx.showToast({ title: error instanceof Error ? error.message : "设置失败", icon: "none" });
        }
      },
    });
  },
  async startTask(event: { detail?: { id?: string }; currentTarget?: { dataset?: { id?: string } } }) {
    const taskId = String(event.detail?.id || event.currentTarget?.dataset?.id || "");
    if (!taskId) return;
    if (this.data.timerSubmitting) return;
    try {
      const active = getActiveActionSession();
      if (active && active.taskId !== taskId) {
        wx.showToast({ title: "请先结束当前计时", icon: "none" });
        return;
      }
      if (active?.status === "paused") resumeActionSession(active.id);
      else if (!active) startActionSession(taskId, "countdown");
      this.load();
      wx.showToast({ title: active?.status === "paused" ? "继续计时" : "开始计时", icon: "none" });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "计时启动失败", icon: "none" });
    }
  },
  toggleActiveTimer() {
    if (!this.data.activeSessionId || this.data.timerSubmitting) return;
    try {
      if (this.data.activeSessionStatus === "paused") resumeActionSession(this.data.activeSessionId);
      else pauseActionSession(this.data.activeSessionId);
      this.refreshActiveSession();
      this.syncSessionTicker();
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "计时状态更新失败", icon: "none" });
    }
  },
  requestFinishTimer() {
    if (this.data.timerSubmitting) { wx.showToast({ title: "正在保存，请稍候", icon: "none" }); return; }
    // 页面丢失会话引用时，先从全局重新获取活跃会话再继续，而非静默返回。
    let sessionId = this.data.activeSessionId;
    if (!sessionId) {
      const context = getActiveActionSessionContext();
      if (!context || !context.session) { wx.showToast({ title: "当前没有进行中的计时", icon: "none" }); return; }
      sessionId = context.session.id;
      this.setData({
        activeSessionId: context.session.id,
        activeSessionTaskId: context.session.taskId,
        activeSessionStatus: context.session.status,
        activeSessionElapsedSeconds: context.session.elapsedSeconds,
        activeSessionDisplay: sessionClock(context.session.elapsedSeconds),
        activeSessionProgress: sessionProgress(context.session),
        activeSessionElapsedMinutes: sessionMinutes(context.session),
        activeSessionOrphan: context.task === null,
        activeSessionTask: context.task ? toViewTask(context.task, this.data.selectedDate || getTodayBusinessDate()) : null,
      });
    }
    try {
      if (this.data.activeSessionStatus === "running") pauseActionSession(sessionId);
      this.refreshActiveSession();
    } catch (_error) {
      // 弹窗仍可继续，最终保存会再次校验会话状态。
    }
    const minutes = Math.max(1, Math.round(this.data.activeSessionElapsedSeconds / 60));
    const taskTitle = this.data.activeSessionTask?.displayTitle || "当前行动";
    wx.showModal({
      title: "结束本次计时",
      content: `本次专注 ${minutes} 分钟，是否同时完成"${taskTitle}"？`,
      cancelText: "仅结束",
      confirmText: "标记完成",
      confirmColor: MODAL_CONFIRM_COLORS.confirm,
      success: (result) => { this.finishActiveTimer(Boolean(result.confirm)); },
    });
  },
  async finishActiveTimer(markTaskCompleted: boolean) {
    if (this.data.timerSubmitting) { wx.showToast({ title: "正在保存，请稍候", icon: "none" }); return; }
    // 页面丢失会话引用时，先从全局重新获取活跃会话再继续，而非静默返回。
    let sessionId = this.data.activeSessionId;
    if (!sessionId) {
      const context = getActiveActionSessionContext();
      if (!context || !context.session) { wx.showToast({ title: "当前没有进行中的计时", icon: "none" }); return; }
      sessionId = context.session.id;
    }
    this.setData({ timerSubmitting: true });
    try {
      finishActionSession(sessionId, markTaskCompleted);
      await syncManualData().catch(() => undefined);
      this.stopSessionTicker();
      this.setData({ timerSubmitting: false });
      this.load();
      wx.showToast({ title: markTaskCompleted ? "计时已保存，行动已完成" : "本次投入已保存", icon: "none" });
    } catch (error) {
      this.setData({ timerSubmitting: false });
      wx.showToast({ title: error instanceof Error ? error.message : "计时保存失败", icon: "none" });
    }
  },
  cleanupOrphanSession() {
    const sessionId = this.data.activeSessionId;
    if (!sessionId) { wx.showToast({ title: "当前没有需要清理的计时", icon: "none" }); return; }
    if (this.data.timerSubmitting) { wx.showToast({ title: "正在处理，请稍候", icon: "none" }); return; }
    wx.showModal({
      title: "结束并清理",
      content: "关联的行动已删除，结束并清理残留计时后可开始新的专注。",
      cancelText: "取消",
      confirmText: "结束清理",
      confirmColor: MODAL_CONFIRM_COLORS.danger,
      success: (result) => {
        if (!result.confirm) return;
        this.setData({ timerSubmitting: true });
        try {
          abandonActionSession(sessionId, false);
          this.stopSessionTicker();
          this.setData({ timerSubmitting: false });
          this.load();
          wx.showToast({ title: "已清理，可开始新计时", icon: "none" });
        } catch (error) {
          this.setData({ timerSubmitting: false });
          wx.showToast({ title: error instanceof Error ? error.message : "清理失败", icon: "none" });
        }
      },
    });
  },
  openTodayDataDetails() {
    if (!this.data.goal) return;
    const date = this.data.selectedDate || getTodayBusinessDate();
    wx.navigateTo({
      url: `/pages/today-data/index?date=${encodeURIComponent(date)}`,
      fail: () => wx.showToast({ title: "数据详情打开失败", icon: "none" }),
    });
  },
  openDailyCoach() {
    if (!this.data.goal) return;
    const date = this.data.selectedDate || getTodayBusinessDate();
    wx.navigateTo({
      url: `/pages/ai-coach/index?scope=day&date=${encodeURIComponent(date)}&goalId=${encodeURIComponent(this.data.goal.id)}`,
      fail: () => wx.showToast({ title: "每日教练打开失败", icon: "none" }),
    });
  },
  openRecommendInfo() {
    wx.showModal({
      title: "按习惯推荐",
      content: "根据截止时间、预计时长和你的行动习惯自动排序，你可以随时调整。",
      showCancel: false,
      confirmText: "知道了",
      confirmColor: MODAL_CONFIRM_COLORS.confirm,
    });
  },
  addTask() {
    if (!this.data.goal) { this.goCreateGoal(); return; }
    const range = reminderDateRange();
    this.setData({ quickAddVisible: true, quickAddTitle: "", quickAddMinutes: 30, quickAddExecutionMode: "ask", quickAddImportance: "normal", quickAddBlocksOthers: false, quickAddDate: range.start, quickAddDateEnd: range.end, quickAddReminderEnabled: false, quickAddReminderTime: nextReminderTime(), quickAddMinuteIndex: DEFAULT_QUICK_ADD_MINUTE_INDEX, quickDurationVisible: false, quickAddSubmitting: false, quickAddTouchDeltaY: 0 });
  },
  closeQuickAdd() {
    if (this.data.quickAddSubmitting) return;
    this.setData(
      { quickAddVisible: false, quickDurationVisible: false, quickAddTouchDeltaY: 0 },
    );
  },
  noop() {},
  inputQuickAddTitle(event: { detail: { value?: string } }) { this.setData({ quickAddTitle: String(event.detail.value || "").slice(0, 40) }); },
  selectQuickExecutionMode(event: { currentTarget: { dataset: { mode?: ActionExecutionMode } } }) {
    const mode = event.currentTarget.dataset.mode;
    if (!mode || !["direct", "focus", "ask"].includes(mode)) return;
    this.setData({ quickAddExecutionMode: mode });
  },
  selectQuickAddImportance(event: { currentTarget: { dataset: { importance?: "required" | "normal" } } }) {
    const importance = event.currentTarget.dataset.importance;
    if (importance !== "required" && importance !== "normal") return;
    this.setData({ quickAddImportance: importance });
  },
  toggleQuickAddBlocksOthers(event: { detail: { value?: boolean } }) {
    this.setData({ quickAddBlocksOthers: Boolean(event.detail.value) });
  },
  changeQuickAddDate(event: { detail: { value?: string } }) {
    this.setData({ quickAddDate: String(event.detail.value || getTodayBusinessDate()) });
  },
  toggleQuickAddReminder(event: { detail: { value?: boolean } }) {
    this.setData({ quickAddReminderEnabled: Boolean(event.detail.value) });
  },
  changeQuickAddReminderTime(event: { detail: { value?: string } }) {
    try {
      this.setData({ quickAddReminderTime: normalizeReminderTime(String(event.detail.value || "")) });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "提醒时间无效", icon: "none" });
    }
  },
  openDurationPicker() {
    if (this.data.quickAddSubmitting) return;
    this.setData({ quickDurationVisible: true });
  },
  closeDurationPicker() {
    this.setData({ quickDurationVisible: false });
  },
  selectQuickAddDuration(event: { currentTarget: { dataset: { index?: string | number } } }) {
    const index = Number(event.currentTarget.dataset.index);
    const option = DURATION_OPTIONS[index];
    if (!option) return;
    this.setData({ quickAddMinuteIndex: index, quickAddMinutes: option.value, quickDurationVisible: false });
  },
  selectQuickDurationChip(event: { currentTarget: { dataset: { index?: string | number } } }) {
    const index = Number(event.currentTarget.dataset.index);
    const option = DURATION_OPTIONS[index];
    if (!option || this.data.quickAddSubmitting) return;
    this.setData({ quickAddMinuteIndex: index, quickAddMinutes: option.value });
  },
  openCustomDuration() {
    if (this.data.quickAddSubmitting) return;
    wx.showModal({
      title: "自定义预计投入",
      content: String(this.data.quickAddMinutes || 30),
      editable: true,
      placeholderText: "请输入 5～240 分钟",
      cancelText: "取消",
      confirmText: "确定",
      confirmColor: MODAL_CONFIRM_COLORS.confirm,
      success: (result) => {
        if (!result.confirm) return;
        const minutes = Number(String(result.content || "").trim());
        if (!Number.isInteger(minutes) || minutes < 5 || minutes > 240) {
          wx.showToast({ title: "请输入 5～240 的整数分钟", icon: "none" });
          return;
        }
        const matchedIndex = DURATION_OPTIONS.findIndex((option) => option.value === minutes);
        this.setData({ quickAddMinutes: minutes, quickAddMinuteIndex: matchedIndex });
      },
    });
  },
  quickAddTouchStart(event: WechatMiniprogram.TouchEvent) {
    const touch = event.touches[0];
    this.setData({ quickAddTouchStartY: touch ? touch.clientY : 0, quickAddTouchDeltaY: 0 });
  },
  quickAddTouchMove(event: WechatMiniprogram.TouchEvent) {
    const touch = event.touches[0];
    if (!touch) return;
    const deltaY = Math.max(0, touch.clientY - this.data.quickAddTouchStartY);
    this.setData({ quickAddTouchDeltaY: deltaY });
  },
  quickAddTouchEnd() {
    if (this.data.quickAddTouchDeltaY > 80) { this.closeQuickAdd(); return; }
    this.setData({ quickAddTouchDeltaY: 0 });
  },
  async saveQuickAdd() {
    if (this.data.quickAddSubmitting) return;
    const goal = this.data.goal;
    if (!goal) { this.goCreateGoal(); return; }
    let remindAt = "";
    if (this.data.quickAddReminderEnabled) {
      try {
        remindAt = buildReminderAt(this.data.quickAddDate, this.data.quickAddReminderTime);
      } catch (error) {
        wx.showToast({ title: error instanceof Error ? error.message : "提醒时间无效", icon: "none" });
        return;
      }
    }
    this.setData({ quickAddSubmitting: true });
    try {
      let receipt: Awaited<ReturnType<typeof requestNotificationAuthorizationWithReceipt>> | null = null;
      if (this.data.quickAddReminderEnabled) {
        try {
          receipt = await requestNotificationAuthorizationWithReceipt("daily_action_reminder", "task_reminder");
        } catch (_error) {
          receipt = null;
        }
      }
      const accepted = receipt?.result === "accept";
      const task = createTask({
        goalId: goal.id,
        title: this.data.quickAddTitle,
        estimatedMinutes: Number(this.data.quickAddMinutes || 30),
        executionMode: this.data.quickAddExecutionMode,
        importance: this.data.quickAddImportance,
        blocksOthers: this.data.quickAddBlocksOthers,
        currentDate: this.data.quickAddDate,
        reminder: accepted ? { time: this.data.quickAddReminderTime, remindAt, status: "pending_authorization" } : undefined,
      });
      let reminderScheduled = false;
      if (accepted && receipt) {
        try {
          await syncManualData();
          await upsertTaskReminder({ taskId: task.id, remindAt, authorizationRequestId: receipt.requestId });
          updateTaskReminder(task.id, { time: this.data.quickAddReminderTime, remindAt, status: "scheduled" });
          reminderScheduled = true;
        } catch (_error) {
          updateTaskReminder(task.id, { time: this.data.quickAddReminderTime, remindAt, status: "failed" });
        }
      }
      const toastTitle = !this.data.quickAddReminderEnabled
        ? "行动已添加"
        : reminderScheduled ? "行动与提醒已设置" : "行动已保存，提醒未开启";
      wx.showToast({ title: toastTitle, icon: reminderScheduled || !this.data.quickAddReminderEnabled ? "success" : "none" });
      this.setData({ quickAddVisible: false, quickAddTitle: "", quickAddMinutes: 30, quickAddExecutionMode: "ask", quickAddImportance: "normal", quickAddBlocksOthers: false, quickAddReminderEnabled: false, quickAddMinuteIndex: DEFAULT_QUICK_ADD_MINUTE_INDEX, quickDurationVisible: false, quickAddSubmitting: false, quickAddTouchDeltaY: 0 });
      this.load();
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "保存失败", icon: "none" });
      this.setData({ quickAddSubmitting: false, quickAddTouchDeltaY: 0 });
    }
  },
  openTask(event: { detail?: { id?: string }; currentTarget?: { dataset?: { id?: string } } }) {
    const id = String(event.detail?.id || event.currentTarget?.dataset?.id || "");
    const task = this.data.tasks.find((item) => item.id === id);
    if (!task) return;
    wx.navigateTo({ url: `/pages/action-edit/index?id=${task.id}` });
  },
  openTaskMenu(event: { detail?: { id?: string }; currentTarget?: { dataset?: { id?: string } } }) {
    const id = String(event.detail?.id || event.currentTarget?.dataset?.id || "");
    const task = this.data.tasks.find((item) => item.id === id);
    if (!task) return;
    const items: string[] = [];
    const actions: Array<() => void> = [];
    const push = (label: string, action: () => void) => { items.push(label); actions.push(action); };
    if (task.status === "completed") {
      push("取消完成", () => this.toggleTaskDone({ detail: { id: task.id } }));
    } else {
      if (this.data.activeSessionTaskId !== task.id) {
        push("开始专注", () => this.startTask({ detail: { id: task.id } }));
      }
      push("直接完成", () => this.completeTask(task));
      push("完成一部分", () => this.chooseReason(task, "partially_completed"));
      push("设置执行方式", () => this.setTaskExecutionMode(task));
      push("设为今日重点", () => this.setTaskPriorityOverride(task, "focus"));
      push("移到快速推进", () => this.setTaskPriorityOverride(task, "quick"));
      push("稍后安排", () => this.setTaskPriorityOverride(task, "later"));
      if (task.priorityOverride) push("清除分组覆盖", () => this.setTaskPriorityOverride(task, null));
      push("顺延到明天", () => this.reschedule(task));
      push("今天不做", () => this.chooseReason(task, "skipped"));
    }
    push("编辑行动", () => wx.navigateTo({ url: `/pages/action-edit/index?id=${task.id}` }));
    push("删除行动", () => this.remove(task));
    wx.showActionSheet({ itemList: items, success: ({ tapIndex }) => actions[tapIndex]?.() });
  },
  applyTaskPatch(updatedTask: ViewTask, prevScrollTop: number) {
    const today = getTodayBusinessDate();
    const selectedDate = this.data.selectedDate || today;
    const decoratedTask = decorateTaskAction(updatedTask, this.data.activeSessionTaskId, this.data.activeSessionStatus);
    const tasks = markRecommendedAction(
      sortTodayTasksIncompleteFirst<ViewTask>(this.data.tasks.map((item) => (item.id === decoratedTask.id ? decoratedTask : item))),
      selectedDate === today,
    );
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const taskGroups = this.data.taskGroups.map((group) => ({
      ...group,
      tasks: group.tasks.map((item) => taskById.get(item.id) || item),
    }));
    const todayTasks = tasks.filter((item) => item.currentDate === selectedDate);
    const summary = calculateTodaySummary(todayTasks);
    const progress = this.data.goal ? getProgressSummary(this.data.goal.id, selectedDate) : null;
    const mood = todayMood(summary);
    const visibleTasks = this.data.actionListExpanded ? tasks : tasks.slice(0, 4);
    const priorityContext: PriorityContext = { today, goalTargetDate: this.data.goal?.targetDate, currentStreakDays: progress?.currentStreakDays || 0 };
    this.priorityContext = priorityContext;
    const visibleTaskGroups = buildActionPresentationGroups(visibleTasks, priorityContext);
    this.setData({
      tasks,
      taskGroups,
      visibleTasks,
      visibleTaskGroups,
      summary,
      completionPercent: completionPercent(summary),
      focusPercent: focusPercent(summary),
      remainingCount: remainingCount(summary),
      todayTargetMinutes: summary.estimatedMinutes,
      todayActualMinutes: summary.actualMinutes + (selectedDate === today ? this.data.activeSessionElapsedMinutes : 0),
      todayMinuteProgress: summary.estimatedMinutes > 0 ? Math.min(100, Math.round((summary.actualMinutes + (selectedDate === today ? this.data.activeSessionElapsedMinutes : 0)) / summary.estimatedMinutes * 100)) : 0,
      remainingEstimatedMinutes: remainingEstimatedMinutes(tasks, selectedDate),
      progressSegments: progressSegments(summary),
      hiddenActionCount: Math.max(0, tasks.length - visibleTasks.length),
      heroDayLabel: `DAY ${Math.max(1, progress?.totalActionDays || (summary.completedCount > 0 ? 1 : 0))}`,
      todayMoodTitle: mood.title,
      todayMoodCopy: mood.copy,
      todayMoodTone: mood.tone,
      todayMoodMark: mood.mark,
      currentStreakDays: progress?.currentStreakDays || 0,
      proactiveInsight: buildProactiveInsight(summary, tasks, progress, selectedDate, today),
      coachTipText: buildCoachTip(buildProactiveInsight(summary, tasks, progress, selectedDate, today), this.data.activeSessionTask, this.data.activeSessionElapsedMinutes),
    }, () => {
      wx.pageScrollTo({ scrollTop: prevScrollTop, duration: 0 });
    });
  },
  openCompletionSheet() {
    const goal = this.data.goal;
    if (!goal) return;
    if (this.completionSheetTimer) {
      clearTimeout(this.completionSheetTimer);
      this.completionSheetTimer = null;
    }
    const today = getTodayBusinessDate();
    const todayTasks = getTasksByGoal(goal.id).filter((task) => task.currentDate === today && task.status !== "rescheduled");
    const summary = calculateTodaySummary(todayTasks);
    const progress = getProgressSummary(goal.id, today);
    const goalProgress = progress.totalTasks ? Math.round((progress.completedTasks / progress.totalTasks) * 100) : 0;
    this.setData({
      completionSheetRendered: true,
      completionSheetVisible: false,
      dailyActionNotificationAvailable: isNotificationConfigured("daily_action_reminder") && new Date().getHours() < 22,
      completionSheetData: {
        done: summary.completedCount,
        total: summary.totalCount,
        goalProgress,
        minutes: summary.actualMinutes,
        streak: progress.currentStreakDays,
        allDone: summary.totalCount > 0 && summary.unfinishedCount === 0 && summary.partialCount === 0,
      },
    });
    wx.nextTick(() => this.setData({ completionSheetVisible: true }));
  },
  closeCompletionSheet() {
    if (!this.data.completionSheetRendered) return;
    this.setData({ completionSheetVisible: false });
    if (this.completionSheetTimer) clearTimeout(this.completionSheetTimer);
    this.completionSheetTimer = setTimeout(() => {
      this.setData({ completionSheetRendered: false });
      this.completionSheetTimer = null;
    }, 260);
  },
  generateTodayShareCard() {
    this.closeCompletionSheet();
    wx.navigateTo({
      url: "/pages/share-card/index",
      fail: () => wx.showToast({ title: "分享卡打开失败", icon: "none" }),
    });
  },
  async subscribeDailyActionReminder() {
    if (this.data.notificationAuthorizing) return;
    this.setData({ notificationAuthorizing: true });
    try {
      const result = await requestNotificationAuthorization("daily_action_reminder", "today_completion");
      wx.showToast({
        title: result === "accept" ? "明日提醒已订阅" : "未获得订阅授权",
        icon: result === "accept" ? "success" : "none",
      });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "订阅未完成", icon: "none" });
    } finally {
      this.setData({ notificationAuthorizing: false });
    }
  },
  toggleTaskDone(event: { detail?: { id?: string }; currentTarget?: { dataset?: { id?: string } } }) {
    const id = String(event.detail?.id || event.currentTarget?.dataset?.id || "");
    const task = this.data.tasks.find((item) => item.id === id);
    if (!task || task.status === "rescheduled") return;
    if (!task.canComplete) {
      wx.showToast({ title: "未来行动到当天后再记录完成", icon: "none" });
      return;
    }
    if (task.status !== "completed") {
      this.completeTask(task);
      return;
    }
    const prevScrollTop = this.scrollTopCache;
    try {
      const today = getTodayBusinessDate();
      const nextStatus: ActionTaskStatus = task.issueReason ? "partially_completed" : "pending";
      const updated = updateTaskStatus(task.id, nextStatus, task.actualMinutes);
      recordDailyCheckin(updated.goalId, updated.activityDate || updated.currentDate);
      const updatedTask = toViewTask(updated, this.data.selectedDate || today);
      this.applyTaskPatch(updatedTask, prevScrollTop);
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "保存失败", icon: "none" });
    }
  },
  quickCompleteTask(event: { currentTarget: { dataset: { id?: string } } }) {
    const id = String(event.currentTarget.dataset.id || "");
    const task = this.data.tasks.find((item) => item.id === id);
    if (!task || task.status === "completed") return;
    this.completeTask(task);
  },
  completeTask(task: ViewTask) {
    if (this.data.activeSessionTaskId === task.id) {
      wx.showToast({ title: "请先结束计时，再决定是否完成行动", icon: "none" });
      return;
    }
    try {
      const updated = updateTaskStatus(task.id, "completed");
      recordDailyCheckin(updated.goalId, updated.activityDate || updated.currentDate);
      const selectedDate = this.data.selectedDate || getTodayBusinessDate();
      const updatedTask = toViewTask(updated, selectedDate);
      const shouldRevealCompleted = this.data.tasks.length > 4 && !this.data.actionListExpanded;
      if (shouldRevealCompleted) this.setData({ actionListExpanded: true });
      this.applyTaskPatch(updatedTask, this.scrollTopCache);
      wx.vibrateShort({ type: "light" });
      wx.showToast({ title: "已完成", icon: "success" });
      if (task.currentDate === getTodayBusinessDate() && this.data.selectedDate === getTodayBusinessDate()) this.openCompletionSheet();
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "保存失败", icon: "none" });
    }
  },
  askActual(task: ViewTask, status: "partially_completed", reason?: ActionIssueReason) {
    wx.showModal({ title: "完成一部分", editable: true, placeholderText: "请输入实际投入分钟数", content: task.actualMinutes ? String(task.actualMinutes) : "", confirmText: "保存", success: (result) => { if (!result.confirm) return; const minutes = Number(String(result.content || "").trim()); if (!Number.isInteger(minutes) || minutes < 1 || minutes > 480) { wx.showToast({ title: "请输入 1～480 的整数分钟", icon: "none" }); return; } try { const updated = updateTaskStatus(task.id, status, minutes, reason); recordDailyCheckin(updated.goalId, updated.activityDate || updated.currentDate); this.load(); } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "保存失败", icon: "none" }); } } });
  },
  chooseReason(task: ViewTask, status: "partially_completed" | "skipped") { wx.showActionSheet({ itemList: REASONS.map((item) => item.label), success: ({ tapIndex }) => { const reason = REASONS[tapIndex]?.value; if (!reason) return; if (status === "partially_completed") this.askActual(task, status, reason); else { try { updateTaskStatus(task.id, status, task.actualMinutes, reason); this.load(); } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "保存失败", icon: "none" }); } } } }); },
  reschedule(task: ViewTask) { try { rescheduleTask(task.id); wx.showToast({ title: "已顺延到明天", icon: "success" }); this.load(); } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "顺延失败", icon: "none" }); } },
  setTaskPriorityOverride(task: ViewTask, override: "focus" | "quick" | "later" | null) {
    if (override === "focus") {
      const focusGroup = this.data.visibleTaskGroups.find((g) => g.key === "focus");
      const existingFocusCount = focusGroup ? focusGroup.tasks.filter((t) => t.id !== task.id && t.priorityOverride === "focus").length : 0;
      if (existingFocusCount >= 2) { wx.showToast({ title: "今日重点最多 2 项，请先移出再设置", icon: "none" }); return; }
    }
    try {
      const updated = updateTaskPriorityOverride(task.id, override);
      const updatedTask = toViewTask(updated, this.data.selectedDate || getTodayBusinessDate());
      this.applyTaskPatch(updatedTask, this.scrollTopCache);
      const labels: Record<string, string> = { focus: "已设为今日重点", quick: "已移到快速推进", later: "已安排到稍后", "": "已清除分组覆盖" };
      wx.showToast({ title: labels[override || ""] || "分组已更新", icon: "none" });
    } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "分组调整失败", icon: "none" }); }
  },
  remove(task: ViewTask) { wx.showModal({ title: "删除行动？", content: `“${task.title}”删除后无法恢复。`, confirmColor: MODAL_CONFIRM_COLORS.danger, success: (result) => { if (!result.confirm) return; try { deleteTask(task.id); this.load(); } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "删除失败", icon: "none" }); } } }); },
}));
