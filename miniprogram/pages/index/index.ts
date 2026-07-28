import { getActiveGoal } from "../../services/manualGoal";
import { getProgressSummary, recordDailyCheckin } from "../../services/manualStats";
import { calculateTodaySummary, createTask, deleteTask, getTasksByGoal, getTodayPageTasks, rescheduleTask, updateTask, updateTaskExecutionMode, updateTaskPriorityOverride, updateTaskReminder, updateTaskStatus } from "../../services/manualTask";
import { getLocalUserProfile } from "../../services/profile";
import { bootstrapAccount } from "../../services/account";
import { analyzeProgress, prepareProgressCoach } from "../../services/progressCoach";
import { getCurrentThemeId, MODAL_CONFIRM_COLORS, withAppTheme } from "../../services/theme";
import { syncManualData } from "../../services/manualSync";
import { cancelTaskReminder, InAppMessage, listInAppMessages, readInAppMessage, requestNotificationAuthorization, requestNotificationAuthorizationWithReceipt, upsertTaskReminder } from "../../services/notification";
import { isNotificationConfigured } from "../../config/notification";
import { ActionExecutionMode, ActionIssueReason, ActionSession, ActionTask, ActionTaskStatus, Goal, TodaySummary } from "../../types/manual";
import { addDays, formatDate, formatDisplayDate, getTodayBusinessDate, getTimeGreeting } from "../../utils/date";
import { off, on } from "../../utils/eventBus";
import { getActionTaskDisplayStatus, groupTodayTasks, isCarryOverTask, sortTodayTasksIncompleteFirst } from "../../utils/taskStatus";
import { groupTasksByPriority, PriorityContext, PriorityReason } from "../../utils/taskPriority";
import { getTabHeaderLayout } from "../../utils/tabHeader";
import { buildReminderAt, nextReminderTime, normalizeReminderTime, reminderDateRange } from "../../utils/actionReminder";
import { resolveActionIcon } from "../../utils/actionIcon";
import { abandonActionSession, finishActionSession, getActiveActionSession, getActiveActionSessionContext, pauseActionSession, resumeActionSession, startActionSession } from "../../services/actionSession";
import { ACTION_DURATION_MAX_MINUTES, ACTION_DURATION_MIN_MINUTES } from "../../config/action";

const REASONS: Array<{ label: string; value: ActionIssueReason }> = [{ label: "时间不够", value: "not_enough_time" }, { label: "难度太高", value: "too_difficult" }, { label: "缺少资源", value: "resource_unavailable" }, { label: "身体或状态不适", value: "physical_condition" }, { label: "临时有事", value: "temporary_event" }, { label: "任务不符合实际", value: "not_practical" }, { label: "其他", value: "other" }];
const QUICK_DURATION_MINUTES = ACTION_DURATION_MIN_MINUTES;
const QUICK_DURATION_MAX_MINUTES = ACTION_DURATION_MAX_MINUTES;
const QUICK_DURATION_STEP_MINUTES = 5;
const QUICK_DURATION_MARK_INTERVAL_MINUTES = 15;
const QUICK_DURATION_TICK_RPX = 24;
const QUICK_DURATION_SUBSTEP_RPX = QUICK_DURATION_TICK_RPX / (QUICK_DURATION_MARK_INTERVAL_MINUTES / QUICK_DURATION_STEP_MINUTES);
const QUICK_DURATION_MARKS = Array.from(
  { length: QUICK_DURATION_MAX_MINUTES / QUICK_DURATION_MARK_INTERVAL_MINUTES + 1 },
  (_, index) => {
    const value = index * QUICK_DURATION_MARK_INTERVAL_MINUTES;
    const major = value % 30 === 0;
    const showLabel = value > 0 && (value <= 240 ? major : value % 60 === 0);
    return { value, major, label: showLabel ? String(value) : "" };
  },
);
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
interface TaskMenuItem {
  label: string;
  desc: string;
  icon: string;
  color?: "danger";
  actionIndex: number;
}
interface TaskMenuGroup { title: "执行任务" | "调整今天"; items: TaskMenuItem[]; }
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
 * 今日行动保持「快速推进 / 稍后安排」两段。底层优先级评分仍然保留，
 * 原本的 focus 与 quick 在首页合并为快速推进，避免分组过碎。
 */
function buildActionPresentationGroups(tasks: ViewTask[], context: PriorityContext): ActionPresentationGroup[] {
  if (!tasks.length) return [];
  let groups: ActionPresentationGroup[] = [];
  try {
    groups = groupTasksByPriority(tasks, context) as ActionPresentationGroup[];
  } catch (_error) {
    groups = [];
  }
  const sourceGroups = groups.length ? groups : [{
    key: "later" as const,
    title: "稍后安排",
    hint: "",
    icon: "time",
    tone: "muted" as const,
    tasks: tasks.map((task) => ({ ...task, priorityReasons: task.priorityReasons || [] })),
  }];
  const quickTasks = sourceGroups
    .filter((group) => group.key === "focus" || group.key === "quick")
    .reduce<Array<ViewTask & { priorityReasons: PriorityReason[] }>>((all, group) => all.concat(group.tasks), []);
  const laterTasks = sourceGroups
    .filter((group) => group.key === "later")
    .reduce<Array<ViewTask & { priorityReasons: PriorityReason[] }>>((all, group) => all.concat(group.tasks), []);
  const result: ActionPresentationGroup[] = [];
  if (quickTasks.length) result.push({ key: "quick", title: "快速推进", hint: "", icon: "play-circle", tone: "green", tasks: quickTasks });
  if (laterTasks.length) result.push({ key: "later", title: "稍后安排", hint: "", icon: "time", tone: "muted", tasks: laterTasks });
  return result;
}
function sessionClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  const pair = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${pair(hours)}:${pair(minutes)}:${pair(rest)}` : `${pair(minutes)}:${pair(rest)}`;
}

function durationHourCopy(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(2).replace(/0$/, "");
}

function durationScrollLeft(minutes: number): number {
  const windowWidth = wx.getWindowInfo ? wx.getWindowInfo().windowWidth : 375;
  const substepPx = QUICK_DURATION_SUBSTEP_RPX * windowWidth / 750;
  const stepIndex = Math.round(minutes / QUICK_DURATION_STEP_MINUTES);
  return Math.max(0, stepIndex * substepPx);
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
function buildCoachPresentation(tasks: ViewTask[], summary: TodaySummary): { title: string; body: string } {
  const unfinished = tasks.filter((task) => task.status === "pending" || task.status === "partially_completed");
  if (!summary.totalCount) return { title: "今天先添加 1 项行动", body: "从一件具体的小事开始，建立今天的行动节奏。" };
  if (!unfinished.length) return { title: "今天的行动已经全部完成", body: "可以回顾投入记录，为明天保留稳定节奏。" };
  const first = unfinished[0];
  const second = unfinished[1];
  return {
    title: "今天先完成 1 项重点",
    body: second ? `先完成${first.displayTitle}，再进入${second.displayTitle}。` : `先完成${first.displayTitle}，为今天建立清晰节奏。`,
  };
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
    };
  }
  const mode: ActionExecutionMode = task.executionMode === "direct" ? "direct" : "focus";
  const primaryAction: TaskPrimaryAction = mode === "direct" ? "complete" : "focus";
  return {
    ...task,
    primaryAction,
    primaryActionLabel: primaryAction === "complete" ? "完成行动" : "开始专注",
    primaryActionShortLabel: primaryAction === "complete" ? "完成" : "专注",
    primaryActionIcon: primaryAction === "complete" ? "check-circle" : "play-circle",
    primaryActionTone: primaryAction === "complete" ? "success" : "focus",
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
    taskSortMode: "habit" as "habit" | "shortest",
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
    coachHeadline: "今天先添加 1 项行动",
    coachBody: "从一件具体的小事开始，建立今天的行动节奏。",
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
    quickAddMode: "create" as "create" | "edit",
    quickAddTaskId: "",
    quickAddTitle: "",
    quickAddMinutes: 30,
    quickAddHourText: durationHourCopy(30),
    quickAddExecutionMode: "focus" as ActionExecutionMode,
    quickAddImportance: "normal" as "required" | "normal",
    quickAddBlocksOthers: false,
    quickAddDate: getTodayBusinessDate(),
    quickAddDateStart: getTodayBusinessDate(),
    quickAddDateEnd: reminderDateRange().end,
    quickAddReminderEnabled: false,
    quickAddReminderTime: nextReminderTime(),
    quickAddHadScheduledReminder: false,
    quickAddPreservedDescription: "",
    quickAddPreservedIconKey: "" as ActionTask["iconKey"] | "",
    quickAddPreservedIconManual: false,
    quickDurationMarks: QUICK_DURATION_MARKS,
    quickDurationScrollLeft: durationScrollLeft(30),
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
    taskMenuVisible: false,
    taskMenuSubtitle: "",
    taskMenuRecommendation: "",
    taskMenuGroups: [] as TaskMenuGroup[],
    inAppMessage: null as InAppMessage | null,
    tickSoundEnabled: true,
  },
  profileHandler: null as null | (() => void),
  focusGoalHandler: null as null | (() => void),
  sessionUpdateHandler: null as null | (() => void),
  completionSheetTimer: null as ReturnType<typeof setTimeout> | null,
  sessionTicker: null as ReturnType<typeof setInterval> | null,
  quickDurationScrollTimer: null as ReturnType<typeof setTimeout> | null,
  tickAudioMinor: null as any,
  tickAudioMajor: null as any,
  tickSoundLastPlay: 0,
  coachRequestKey: "",
  coachRequestGeneration: 0,
  scrollTopCache: 0,
  taskMenuActions: [] as Array<() => void>,
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
    this.initTickSounds();
  },
  onReady() {},
  onHide() { this.stopSessionTicker(); },
  onUnload() {
    this.stopSessionTicker();
    if (this.quickDurationScrollTimer) {
      clearTimeout(this.quickDurationScrollTimer);
      this.quickDurationScrollTimer = null;
    }
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
    if (this.tickAudioMinor) { this.tickAudioMinor.destroy(); this.tickAudioMinor = null; }
    if (this.tickAudioMajor) { this.tickAudioMajor.destroy(); this.tickAudioMajor = null; }
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
      const defaultTasks = sortTodayTasksIncompleteFirst(baseTaskGroups.reduce<ViewTask[]>((all, group) => all.concat(group.tasks), []));
      const orderedTasks = this.data.taskSortMode === "shortest"
        ? [...defaultTasks].sort((left, right) => {
          const leftDone = left.status === "completed" ? 1 : 0;
          const rightDone = right.status === "completed" ? 1 : 0;
          return leftDone - rightDone || left.estimatedMinutes - right.estimatedMinutes;
        })
        : defaultTasks;
      const tasks = markRecommendedAction(
        orderedTasks,
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
      const coachPresentation = buildCoachPresentation(tasks, summary);
      const visibleTasks = this.data.actionListExpanded ? tasks : tasks.slice(0, 5);
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
        coachHeadline: coachPresentation.title,
        coachBody: coachPresentation.body,
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
    const visibleTasks = actionListExpanded ? this.data.tasks : this.data.tasks.slice(0, 5);
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
      this.openQuickAddEditor(task);
      return;
    }
    if (task.primaryAction === "active") {
      this.openActiveSession();
      return;
    }
    if (task.primaryAction === "complete") this.completeTask(task);
    else this.startTask({ detail: { id: task.id } });
  },
  openExecutionPreference() {
    wx.showActionSheet({
      itemList: ["直接完成", "开始专注"],
      success: ({ tapIndex }) => {
        const mode: ActionExecutionMode = tapIndex === 0 ? "direct" : "focus";
        this.setData({ quickAddExecutionMode: mode });
        wx.showToast({ title: mode === "direct" ? "新增行动默认直接完成" : "新增行动默认专注计时", icon: "none" });
      },
    });
  },
  openSortOptions() {
    wx.showActionSheet({
      itemList: ["按习惯推荐", "预计时长从短到长"],
      success: ({ tapIndex }) => {
        const taskSortMode = tapIndex === 1 ? "shortest" as const : "habit" as const;
        this.setData({ taskSortMode }, () => this.load());
        wx.showToast({ title: taskSortMode === "shortest" ? "已按预计时长排序" : "已恢复习惯推荐", icon: "none" });
      },
    });
  },
  setTaskPriorityPosition(task: ViewTask) {
    wx.showActionSheet({
      itemList: ["设为今日重点", "移到快速推进", "移到稍后安排", "恢复系统推荐"],
      success: ({ tapIndex }) => {
        const positions: Array<"focus" | "quick" | "later" | null> = ["focus", "quick", "later", null];
        const position = positions[tapIndex];
        if (position === undefined) return;
        this.setTaskPriorityOverride(task, position);
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
  openActiveSession() {
    if (this.data.activeSessionOrphan) {
      wx.showToast({ title: "关联行动已删除，请先清理计时", icon: "none" });
      return;
    }
    const taskId = this.data.activeSessionTaskId;
    if (!taskId) return;
    wx.navigateTo({ url: `/pages/action-session/index?taskId=${encodeURIComponent(taskId)}` });
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
      cancelText: "仅结束计时",
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
      this.setData({ activeSessionId: sessionId });
    }
    this.setData({ timerSubmitting: true });
    try {
      finishActionSession(this.data.activeSessionId, markTaskCompleted);
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
    this.openQuickAddEditor();
  },
  openQuickAddEditor(task?: ViewTask) {
    const range = reminderDateRange();
    const minutes = task?.estimatedMinutes || 30;
    const reminderScheduled = task?.reminder?.status === "scheduled";
    const date = task?.currentDate || range.start;
    this.setData({
      quickAddVisible: true,
      quickAddMode: task ? "edit" : "create",
      quickAddTaskId: task?.id || "",
      quickAddTitle: task?.title || "",
      quickAddMinutes: minutes,
      quickAddHourText: durationHourCopy(minutes),
      quickAddExecutionMode: task ? (task.executionMode === "direct" ? "direct" : "focus") : this.data.quickAddExecutionMode,
      quickAddImportance: task?.importance === "required" ? "required" : "normal",
      quickAddBlocksOthers: Boolean(task?.blocksOthers),
      quickAddDate: date,
      quickAddDateStart: date < range.start ? date : range.start,
      quickAddDateEnd: range.end,
      quickAddReminderEnabled: reminderScheduled,
      quickAddReminderTime: task?.reminder?.time || nextReminderTime(),
      quickAddHadScheduledReminder: reminderScheduled,
      quickAddPreservedDescription: task?.description || "",
      quickAddPreservedIconKey: task?.iconKey || "",
      quickAddPreservedIconManual: Boolean(task?.iconManual),
      quickDurationScrollLeft: durationScrollLeft(minutes),
      quickAddSubmitting: false,
      quickAddTouchDeltaY: 0,
    });
  },
  closeQuickAdd() {
    if (this.data.quickAddSubmitting) return;
    this.setData(
      { quickAddVisible: false, quickAddTaskId: "", quickAddTouchDeltaY: 0 },
    );
  },
  noop() {},
  inputQuickAddTitle(event: { detail: { value?: string } }) { this.setData({ quickAddTitle: String(event.detail.value || "").slice(0, 40) }); },
  selectQuickExecutionMode(event: { currentTarget: { dataset: { mode?: ActionExecutionMode } } }) {
    const mode = event.currentTarget.dataset.mode;
    if (!mode || !["direct", "focus"].includes(mode)) return;
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
  initTickSounds() {
    if (this.tickAudioMinor || this.tickAudioMajor) return;
    try {
      const stored = wx.getStorageSync("tickSoundEnabled");
      if (stored === false) { this.setData({ tickSoundEnabled: false }); return; }
    } catch { /* storage read failed — keep default on */ }
    const minor = wx.createInnerAudioContext();
    minor.src = "/assets/sounds/tick-minor.wav";
    minor.volume = 0.3;
    minor.preload = true;
    this.tickAudioMinor = minor;
    const major = wx.createInnerAudioContext();
    major.src = "/assets/sounds/tick-major.wav";
    major.volume = 0.4;
    major.preload = true;
    this.tickAudioMajor = major;
  },
  playTickSound(isMajor: boolean) {
    if (!this.data.tickSoundEnabled) return;
    const now = Date.now();
    if (now - this.tickSoundLastPlay < 50) return;
    this.tickSoundLastPlay = now;
    const ctx = isMajor ? this.tickAudioMajor : this.tickAudioMinor;
    if (!ctx) return;
    try { ctx.stop(); ctx.seek(0); ctx.play(); } catch { /* playback failed — silently ignore */ }
  },
  toggleTickSound() {
    const enabled = !this.data.tickSoundEnabled;
    this.setData({ tickSoundEnabled: enabled });
    try { wx.setStorageSync("tickSoundEnabled", enabled); } catch { /* storage write failed */ }
    if (enabled && !this.tickAudioMinor) this.initTickSounds();
  },
  onQuickDurationScroll(event: { detail: { scrollLeft?: number } }) {
    const windowWidth = wx.getWindowInfo ? wx.getWindowInfo().windowWidth : 375;
    const substepPx = QUICK_DURATION_SUBSTEP_RPX * windowWidth / 750;
    const index = Math.round(Number(event.detail.scrollLeft || 0) / substepPx);
    const minutes = Math.min(
      QUICK_DURATION_MAX_MINUTES,
      Math.max(QUICK_DURATION_MINUTES, index * QUICK_DURATION_STEP_MINUTES),
    );
    if (minutes !== this.data.quickAddMinutes) {
      this.playTickSound(minutes % 30 === 0);
      this.setData({
        quickAddMinutes: minutes,
        quickAddHourText: durationHourCopy(minutes),
      });
    }
    if (this.quickDurationScrollTimer) clearTimeout(this.quickDurationScrollTimer);
    this.quickDurationScrollTimer = setTimeout(() => {
      this.quickDurationScrollTimer = null;
      this.setData({ quickDurationScrollLeft: durationScrollLeft(minutes) });
    }, 100);
  },
  onQuickDurationReachStart() {
    this.setData({
      quickAddMinutes: QUICK_DURATION_MINUTES,
      quickAddHourText: durationHourCopy(QUICK_DURATION_MINUTES),
      quickDurationScrollLeft: durationScrollLeft(QUICK_DURATION_MINUTES),
    });
  },
  onQuickDurationReachEnd() {
    this.setData({
      quickAddMinutes: QUICK_DURATION_MAX_MINUTES,
      quickAddHourText: durationHourCopy(QUICK_DURATION_MAX_MINUTES),
      quickDurationScrollLeft: durationScrollLeft(QUICK_DURATION_MAX_MINUTES),
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
    const title = this.data.quickAddTitle.trim();
    const estimatedMinutes = Number(this.data.quickAddMinutes);
    if (title.length < 2 || title.length > 40) {
      wx.showToast({ title: "行动标题请控制在 2～40 个字", icon: "none" });
      return;
    }
    if (!Number.isInteger(estimatedMinutes) || estimatedMinutes < QUICK_DURATION_MINUTES || estimatedMinutes > QUICK_DURATION_MAX_MINUTES) {
      wx.showToast({ title: "预计投入需为 5～360 分钟", icon: "none" });
      return;
    }
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
      const isEdit = this.data.quickAddMode === "edit" && Boolean(this.data.quickAddTaskId);
      const needsAuthorization = this.data.quickAddReminderEnabled && !this.data.quickAddHadScheduledReminder;
      let receipt: Awaited<ReturnType<typeof requestNotificationAuthorizationWithReceipt>> | null = null;
      if (needsAuthorization) {
        try {
          receipt = await requestNotificationAuthorizationWithReceipt("daily_action_reminder", "task_reminder");
        } catch (_error) {
          receipt = null;
        }
      }
      const reminderAllowed = !needsAuthorization || receipt?.result === "accept";
      const input = {
        id: isEdit ? this.data.quickAddTaskId : undefined,
        goalId: goal.id,
        title,
        description: this.data.quickAddPreservedDescription,
        estimatedMinutes,
        executionMode: this.data.quickAddExecutionMode,
        iconKey: this.data.quickAddPreservedIconKey || undefined,
        iconManual: this.data.quickAddPreservedIconManual,
        importance: this.data.quickAddImportance,
        blocksOthers: this.data.quickAddBlocksOthers,
        currentDate: this.data.quickAddDate,
        reminder: this.data.quickAddReminderEnabled && reminderAllowed
          ? {
            time: this.data.quickAddReminderTime,
            remindAt,
            status: this.data.quickAddHadScheduledReminder ? "scheduled" as const : "pending_authorization" as const,
          }
          : null,
      };
      const task = isEdit ? updateTask(input) : createTask(input);
      await syncManualData();
      let reminderScheduled = false;
      if (this.data.quickAddReminderEnabled && reminderAllowed) {
        try {
          await upsertTaskReminder({ taskId: task.id, remindAt, authorizationRequestId: receipt?.requestId });
          updateTaskReminder(task.id, { time: this.data.quickAddReminderTime, remindAt, status: "scheduled" });
          reminderScheduled = true;
        } catch (_error) {
          updateTaskReminder(task.id, { time: this.data.quickAddReminderTime, remindAt, status: "failed" });
        }
      } else if (this.data.quickAddHadScheduledReminder) {
        await cancelTaskReminder(task.id).catch(() => undefined);
      }
      const reminderRejected = this.data.quickAddReminderEnabled && !reminderAllowed;
      const toastTitle = reminderRejected || (this.data.quickAddReminderEnabled && !reminderScheduled)
        ? "行动已保存，提醒未开启"
        : isEdit ? "行动已更新" : "行动已添加";
      wx.showToast({ title: toastTitle, icon: reminderScheduled || !this.data.quickAddReminderEnabled ? "success" : "none" });
      this.setData({ quickAddVisible: false, quickAddMode: "create", quickAddTaskId: "", quickAddTitle: "", quickAddMinutes: 30, quickAddHourText: durationHourCopy(30), quickAddExecutionMode: "focus", quickAddImportance: "normal", quickAddBlocksOthers: false, quickAddReminderEnabled: false, quickAddHadScheduledReminder: false, quickAddSubmitting: false, quickAddTouchDeltaY: 0 });
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
    this.openQuickAddEditor(task);
  },
  deleteQuickAddTask() {
    if (this.data.quickAddSubmitting || this.data.quickAddMode !== "edit") return;
    const task = this.data.tasks.find((item) => item.id === this.data.quickAddTaskId);
    if (!task) {
      wx.showToast({ title: "找不到该行动", icon: "none" });
      return;
    }
    wx.showModal({
      title: "删除行动？",
      content: `“${task.displayTitle}”删除后无法恢复。`,
      confirmText: "删除",
      confirmColor: MODAL_CONFIRM_COLORS.danger,
      success: (result) => {
        if (!result.confirm) return;
        try {
          deleteTask(task.id);
          this.setData({ quickAddVisible: false, quickAddTaskId: "" });
          this.load();
          wx.showToast({ title: "行动已删除", icon: "success" });
        } catch (error) {
          wx.showToast({ title: error instanceof Error ? error.message : "删除失败", icon: "none" });
        }
      },
    });
  },
  openTaskMenu(event: { detail?: { id?: string }; currentTarget?: { dataset?: { id?: string } } }) {
    const id = String(event.detail?.id || event.currentTarget?.dataset?.id || "");
    const task = this.data.tasks.find((item) => item.id === id);
    if (!task) {
      wx.showToast({ title: "找不到该行动", icon: "none" });
      return;
    }
    const actions: Array<() => void> = [];
    const execItems: TaskMenuItem[] = [];
    const adjustItems: TaskMenuItem[] = [];
    const pushExec = (label: string, desc: string, icon: string, action: () => void) => { execItems.push({ label, desc, icon, actionIndex: actions.length }); actions.push(action); };
    const pushAdjust = (label: string, desc: string, icon: string, action: () => void, color?: "danger") => { adjustItems.push({ label, desc, icon, color, actionIndex: actions.length }); actions.push(action); };
    if (task.status === "completed") {
      pushExec("取消完成", "恢复为未完成状态", "rollback", () => this.toggleTaskDone({ detail: { id: task.id } }));
    } else {
      if (this.data.activeSessionTaskId !== task.id) {
        pushExec("开始专注", "进入计时模式", "play-circle", () => this.startTask({ detail: { id: task.id } }));
      }
      pushExec("标记完成", "直接记录本次行动", "check-circle", () => this.completeTask(task));
      pushExec("跳过今天", "今天不再提醒，明天正常恢复", "chevron-right-double", () => this.chooseReason(task, "skipped"));
    }
    pushAdjust("设为今日重点", "优先展示在今日行动顶部", "star", () => this.setTaskPriorityOverride(task, "focus"));
    const nextExecutionMode: ActionExecutionMode = task.executionMode === "direct" ? "focus" : "direct";
    pushAdjust(
      nextExecutionMode === "focus" ? "改为开始专注" : "改为直接完成",
      nextExecutionMode === "focus" ? "点击主操作后进入计时" : "点击主操作后直接记录完成",
      nextExecutionMode === "focus" ? "play-circle" : "check-circle",
      () => this.setTaskExecutionMode(task, nextExecutionMode),
    );
    const placement = this.data.visibleTaskGroups.find((group) => group.tasks.some((item) => item.id === task.id))
      || buildActionPresentationGroups([task], this.priorityContext || { today: getTodayBusinessDate(), currentStreakDays: 0 })[0];
    const placementTitle = placement?.title || "系统推荐";
    pushAdjust("调整推荐位置", `当前：${placementTitle}`, "arrow-up-down-1", () => this.setTaskPriorityPosition(task));
    pushAdjust("编辑任务", "修改名称、时长和行动设置", "edit", () => this.openQuickAddEditor(task));
    pushAdjust("删除任务", "删除后不可恢复", "delete", () => this.remove(task), "danger");
    this.taskMenuActions = actions;
    const groups: TaskMenuGroup[] = [];
    if (execItems.length) groups.push({ title: "执行任务", items: execItems });
    if (adjustItems.length) groups.push({ title: "调整今天", items: adjustItems });
    this.setData({
      taskMenuVisible: true,
      taskMenuSubtitle: `${task.displayTitle} · 预计 ${task.estimatedMinutes} 分钟`,
      taskMenuRecommendation: `${placementTitle} · ${task.priorityOverride ? "手动设置" : "系统推荐"}`,
      taskMenuGroups: groups,
    });
  },
  onTaskMenuItemTap(event: { currentTarget: { dataset: { index: number } } }) {
    const action = this.taskMenuActions[event.currentTarget.dataset.index];
    this.setData({ taskMenuVisible: false });
    if (action) action();
  },
  onTaskMenuClose() {
    this.setData({ taskMenuVisible: false, taskMenuRecommendation: "", taskMenuGroups: [] });
  },
  setTaskExecutionMode(task: ViewTask, executionMode: ActionExecutionMode) {
    try {
      const updated = updateTaskExecutionMode(task.id, executionMode);
      const selectedDate = this.data.selectedDate || getTodayBusinessDate();
      this.applyTaskPatch(toViewTask(updated, selectedDate), this.scrollTopCache);
      void syncManualData();
      wx.showToast({ title: executionMode === "focus" ? "已改为开始专注" : "已改为直接完成", icon: "none" });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "执行方式更新失败", icon: "none" });
    }
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
    const coachPresentation = buildCoachPresentation(tasks, summary);
    const visibleTasks = this.data.actionListExpanded ? tasks : tasks.slice(0, 5);
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
      coachHeadline: coachPresentation.title,
      coachBody: coachPresentation.body,
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
