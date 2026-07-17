import { getActiveGoal } from "../../services/manualGoal";
import { getProgressSummary } from "../../services/manualStats";
import { calculateTodaySummary, createTask, deleteTask, getTasksByGoal, getTodayPageTasks, rescheduleTask, updateTaskStatus } from "../../services/manualTask";
import { getLocalUserProfile } from "../../services/profile";
import { analyzeProgress, prepareProgressCoach } from "../../services/progressCoach";
import { getCurrentThemeId, withAppTheme } from "../../services/theme";
import { syncManualData } from "../../services/manualSync";
import { InAppMessage, listInAppMessages, readInAppMessage, requestNotificationAuthorization } from "../../services/notification";
import { isNotificationConfigured } from "../../config/notification";
import { ActionIssueReason, ActionTask, ActionTaskStatus, Goal, TodaySummary } from "../../types/manual";
import { addDays, formatDate, formatDisplayDate, getTodayBusinessDate, getTimeGreeting } from "../../utils/date";
import { off, on } from "../../utils/eventBus";
import { getActionTaskDisplayStatus, groupTodayTasks, isCarryOverTask, sortTodayTasksIncompleteFirst } from "../../utils/taskStatus";
import { getTabHeaderLayout } from "../../utils/tabHeader";

const REASONS: Array<{ label: string; value: ActionIssueReason }> = [{ label: "时间不够", value: "not_enough_time" }, { label: "难度太高", value: "too_difficult" }, { label: "缺少资源", value: "resource_unavailable" }, { label: "身体或状态不适", value: "physical_condition" }, { label: "临时有事", value: "temporary_event" }, { label: "任务不符合实际", value: "not_practical" }, { label: "其他", value: "other" }];
const DURATION_OPTIONS = [
  { label: "15 分钟", value: 15 },
  { label: "25 分钟", value: 25 },
  { label: "30 分钟", value: 30 },
  { label: "45 分钟", value: 45 },
  { label: "60 分钟", value: 60 },
  { label: "90 分钟", value: 90 },
  { label: "120 分钟", value: 120 },
  { label: "180 分钟", value: 180 },
  { label: "240 分钟", value: 240 },
];
const DEFAULT_QUICK_ADD_MINUTE_INDEX = DURATION_OPTIONS.findIndex((option) => option.value === 30);
const QUICK_DURATION_VALUES = new Set([30, 45, 60, 90, 120]);
const QUICK_DURATION_OPTIONS = DURATION_OPTIONS
  .map((option, sourceIndex) => ({ ...option, sourceIndex }))
  .filter((option) => QUICK_DURATION_VALUES.has(option.value));
const EXAMPLE_ACTION_TITLES = ["背单词 30 个", "阅读 30 分钟", "听力练习 20 分钟", "真题复盘 1 套"];
interface ViewTask extends ActionTask { displayTitle: string; statusLabel: string; statusTone: string; rescheduled: boolean; dateLabel: string; partialHint: boolean; actionSubtext: string; actionIconType: "book" | "audio" | "note"; canComplete: boolean; }
interface ViewTaskGroup { key: "today" | "continue"; title: string; tasks: ViewTask[]; }
interface TodayMood { title: string; copy: string; tone: "empty" | "low" | "half" | "done"; mark: string; }
interface ProactiveInsight { label: string; title: string; body: string; tone: "start" | "progress" | "near" | "done" | "streak"; }
interface ProgressSegment { active: boolean; }
interface StatsRhythmBar { key: string; height: number; active: boolean; }
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
function buildStatsRhythmBars(tasks: ActionTask[]): StatsRhythmBar[] {
  const buckets = Array.from({ length: 12 }, () => 0);
  tasks.forEach((task) => {
    const minutes = Math.max(0, Number(task.actualMinutes || 0));
    if (!minutes) return;
    const timestamp = new Date(task.completedAt || task.updatedAt || task.createdAt);
    const bucketIndex = Number.isNaN(timestamp.getTime()) ? 0 : Math.min(11, Math.floor(timestamp.getHours() / 2));
    buckets[bucketIndex] += minutes;
  });
  const maxMinutes = Math.max(0, ...buckets);
  return buckets.map((minutes, index) => ({
    key: `rhythm-${index}`,
    active: minutes > 0,
    height: minutes > 0 && maxMinutes > 0 ? Math.max(12, Math.round((minutes / maxMinutes) * 42)) : 5,
  }));
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
function taskIconType(task: ActionTask): ViewTask["actionIconType"] {
  const copy = `${task.title} ${task.description || ""}`;
  if (/听|音频|口语|跟读/.test(copy)) return "audio";
  if (/背|单词|词汇|记忆/.test(copy)) return "book";
  return "note";
}
function toViewTask(task: ActionTask, selectedDate: string, businessToday = getTodayBusinessDate()): ViewTask {
  const displayStatus = getActionTaskDisplayStatus(task, selectedDate);
  const displayTitle = displayTaskTitle(task);
  return {
    ...task,
    displayTitle,
    statusLabel: displayStatus.text,
    statusTone: displayStatus.tone,
    rescheduled: isCarryOverTask(task),
    dateLabel: task.currentDate === selectedDate ? "今天" : formatDisplayDate(task.currentDate),
    partialHint: displayStatus.badge === "待继续",
    actionSubtext: task.description || `学习 ${task.estimatedMinutes} 分钟`,
    actionIconType: taskIconType(task),
    canComplete: task.currentDate <= businessToday && task.status !== "rescheduled",
  };
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
    taskGroups: [] as ViewTaskGroup[],
    visibleTasks: [] as ViewTask[],
    summary: emptySummary(),
    completionPercent: 0,
    flowRemainingPercent: 100,
    focusPercent: 0,
    remainingCount: 0,
    statsRhythmBars: buildStatsRhythmBars([]) as StatsRhythmBar[],
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
    quickDurationOptions: DURATION_OPTIONS,
    quickDurationPrimaryOptions: QUICK_DURATION_OPTIONS,
    quickAddMinuteIndex: DEFAULT_QUICK_ADD_MINUTE_INDEX,
    quickDurationVisible: false,
    quickAddSubmitting: false,
    quickAddTouchStartY: 0,
    quickAddTouchDeltaY: 0,
    currentScrollTop: 0,
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
  completionSheetTimer: null as ReturnType<typeof setTimeout> | null,
  coachRequestKey: "",
  coachRequestGeneration: 0,
  onPageScroll(event: { scrollTop: number }) {
    this.setData({ currentScrollTop: event.scrollTop });
  },
  onLoad() {
    this.profileHandler = () => this.load();
    this.focusGoalHandler = () => this.load();
    on("profile:update", this.profileHandler);
    on("goal:focus:update", this.focusGoalHandler);
  },
  onUnload() {
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
  },
  onShow() {
    (this as any).getTabBar?.()?.syncSelected?.();
    this.setData({ appTheme: getCurrentThemeId() });
    // 先立即加载本地数据，让页面马上显示内容
    this.load();
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
      const taskGroups = groupTodayTasks(sourceTasks, selectedDate).map((group) => ({ ...group, tasks: group.tasks.map((task) => toViewTask(task, selectedDate, today)) }));
      const tasks = sortTodayTasksIncompleteFirst(taskGroups.reduce<ViewTask[]>((all, group) => all.concat(group.tasks), []));
      const summary = calculateTodaySummary(selectedTasks);
      const progress = goal ? getProgressSummary(goal.id, selectedDate) : null;
      const mood = todayMood(summary);
      const visibleTasks = this.data.actionListExpanded ? tasks : tasks.slice(0, 3);
      const week = buildWeekDays(today, selectedDate, this.data.weekOffset);
      const calendarMonth = this.data.calendarMonth || monthStart(selectedDate);
      const calendar = buildCalendar(today, selectedDate, calendarMonth, goalTasks);
      this.setData({
        status: "ready",
        displayName,
        displayAvatarUrl,
        greetingText: timeGreeting.greeting,
        greetingSubtitle: timeGreeting.subtitle,
        goal,
        selectedDate,
        todayDate: today,
        tasks,
        taskGroups,
        visibleTasks,
        summary,
        completionPercent: completionPercent(summary),
        flowRemainingPercent: 100 - completionPercent(summary),
        focusPercent: focusPercent(summary),
        remainingCount: remainingCount(summary),
        statsRhythmBars: buildStatsRhythmBars(selectedTasks),
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
        this.prepareTodayCoach();
      });
    } catch (error) { this.setData({ status: "error", errorMessage: error instanceof Error ? error.message : "本地数据读取失败" }); }
  },
  useDefaultAvatar() { this.setData({ displayAvatarUrl: "" }); },
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
        this.setData({ coachStatus: "ready", proactiveInsight: buildAiPriorityInsight(analysis, this.data.proactiveInsight) });
      }, () => {
        if (this.coachRequestKey === requestKey && this.coachRequestGeneration === generation) this.setData({ coachStatus: "error" });
      });
  },
  retry() { this.load(); },
  toggleActionList() {
    const actionListExpanded = !this.data.actionListExpanded;
    const visibleTasks = actionListExpanded ? this.data.tasks : this.data.tasks.slice(0, 3);
    this.setData({ actionListExpanded, visibleTasks, hiddenActionCount: Math.max(0, this.data.tasks.length - visibleTasks.length) });
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
    this.setData({ selectedDate, calendarMonth: monthStart(selectedDate), actionListExpanded: false, currentScrollTop: 0 });
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
    this.setData({ selectedDate, calendarMonth: monthStart(selectedDate), calendarVisible: false, actionListExpanded: false, weekOffset: 0, currentScrollTop: 0 });
    this.load();
  },
  jumpTodayFromCalendar() {
    const selectedDate = getTodayBusinessDate();
    this.setData({ selectedDate, calendarMonth: monthStart(selectedDate), calendarVisible: false, actionListExpanded: false, weekOffset: 0, currentScrollTop: 0 });
    this.load();
  },
  goCreateGoal() { if (this.data.navigating) return; this.setData({ navigating: true }); wx.navigateTo({ url: "/pages/goal-create/index", fail: () => this.setData({ navigating: false }) }); },
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
      url: `/pages/daily-coach/index?date=${encodeURIComponent(date)}&goalId=${encodeURIComponent(this.data.goal.id)}`,
      fail: () => wx.showToast({ title: "每日教练打开失败", icon: "none" }),
    });
  },
  addTask() {
    if (!this.data.goal) { this.goCreateGoal(); return; }
    this.setData({ quickAddVisible: true, quickAddTitle: "", quickAddMinutes: 30, quickAddMinuteIndex: DEFAULT_QUICK_ADD_MINUTE_INDEX, quickDurationVisible: false, quickAddSubmitting: false, quickAddTouchDeltaY: 0 });
  },
  closeQuickAdd() {
    if (this.data.quickAddSubmitting) return;
    this.setData(
      { quickAddVisible: false, quickDurationVisible: false, quickAddTouchDeltaY: 0 },
    );
  },
  noop() {},
  inputQuickAddTitle(event: { detail: { value?: string } }) { this.setData({ quickAddTitle: String(event.detail.value || "").slice(0, 40) }); },
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
      confirmColor: "#245B4D",
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
  saveQuickAdd() {
    if (this.data.quickAddSubmitting) return;
    const goal = this.data.goal;
    if (!goal) { this.goCreateGoal(); return; }
    this.setData({ quickAddSubmitting: true });
    try {
      createTask({
        goalId: goal.id,
        title: this.data.quickAddTitle,
        estimatedMinutes: Number(this.data.quickAddMinutes || 30),
        currentDate: getTodayBusinessDate(),
      });
      wx.showToast({ title: "行动已添加", icon: "success" });
      this.setData({ quickAddVisible: false, quickAddTitle: "", quickAddMinutes: 30, quickAddMinuteIndex: DEFAULT_QUICK_ADD_MINUTE_INDEX, quickDurationVisible: false, quickAddSubmitting: false, quickAddTouchDeltaY: 0 });
      this.load();
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "保存失败", icon: "none" });
      this.setData({ quickAddSubmitting: false, quickAddTouchDeltaY: 0 });
    }
  },
  openTask(event: { currentTarget: { dataset: { id?: string } } }) {
    const id = String(event.currentTarget.dataset.id || ""); const task = this.data.tasks.find((item) => item.id === id); if (!task) return;
    wx.showActionSheet({ itemList: ["标记完成", "完成一部分", "顺延到明天", "今天不做", "编辑", "删除"], success: ({ tapIndex }) => {
      if (tapIndex === 0) this.completeTask(task); else if (tapIndex === 1) this.chooseReason(task, "partially_completed"); else if (tapIndex === 2) this.reschedule(task); else if (tapIndex === 3) this.chooseReason(task, "skipped"); else if (tapIndex === 4) wx.navigateTo({ url: `/pages/action-edit/index?id=${task.id}` }); else if (tapIndex === 5) this.remove(task);
    } });
  },
  applyTaskPatch(updatedTask: ViewTask, prevScrollTop: number) {
    const today = getTodayBusinessDate();
    const selectedDate = this.data.selectedDate || today;
    const tasks = sortTodayTasksIncompleteFirst<ViewTask>(this.data.tasks.map((item) => (item.id === updatedTask.id ? updatedTask : item)));
    const taskGroups = this.data.taskGroups.map((group) => ({ ...group, tasks: group.tasks.map((item) => (item.id === updatedTask.id ? updatedTask : item)) }));
    const todayTasks = tasks.filter((item) => item.currentDate === selectedDate);
    const summary = calculateTodaySummary(todayTasks);
    const progress = this.data.goal ? getProgressSummary(this.data.goal.id, selectedDate) : null;
    const mood = todayMood(summary);
    const visibleTasks = this.data.actionListExpanded ? tasks : tasks.slice(0, 3);
    this.setData({
      tasks,
      taskGroups,
      visibleTasks,
      summary,
      completionPercent: completionPercent(summary),
      flowRemainingPercent: 100 - completionPercent(summary),
      focusPercent: focusPercent(summary),
      remainingCount: remainingCount(summary),
      statsRhythmBars: buildStatsRhythmBars(todayTasks),
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
    });
    wx.nextTick(() => wx.pageScrollTo({ scrollTop: prevScrollTop, duration: 0 }));
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
  toggleTaskDone(event: { currentTarget: { dataset: { id?: string } } }) {
    const id = String(event.currentTarget.dataset.id || "");
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
    const prevScrollTop = this.data.currentScrollTop;
    try {
      const today = getTodayBusinessDate();
      const nextStatus: ActionTaskStatus = task.issueReason ? "partially_completed" : "pending";
      const updatedTask = toViewTask(updateTaskStatus(task.id, nextStatus, task.actualMinutes), this.data.selectedDate || today);
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
    try {
      updateTaskStatus(task.id, "completed", task.actualMinutes ?? 0);
      wx.vibrateShort({ type: "light" });
      wx.showToast({ title: "已完成", icon: "success" });
      this.load();
      if (task.currentDate === getTodayBusinessDate() && this.data.selectedDate === getTodayBusinessDate()) this.openCompletionSheet();
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "保存失败", icon: "none" });
    }
  },
  askActual(task: ViewTask, status: "partially_completed", reason?: ActionIssueReason) {
    wx.showModal({ title: "完成一部分", editable: true, placeholderText: "请输入实际投入分钟数", content: task.actualMinutes ? String(task.actualMinutes) : "", confirmText: "保存", success: (result) => { if (!result.confirm) return; const minutes = Number(String(result.content || "").trim()); if (!Number.isInteger(minutes) || minutes < 1 || minutes > 480) { wx.showToast({ title: "请输入 1～480 的整数分钟", icon: "none" }); return; } try { updateTaskStatus(task.id, status, minutes, reason); this.load(); } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "保存失败", icon: "none" }); } } });
  },
  chooseReason(task: ViewTask, status: "partially_completed" | "skipped") { wx.showActionSheet({ itemList: REASONS.map((item) => item.label), success: ({ tapIndex }) => { const reason = REASONS[tapIndex]?.value; if (!reason) return; if (status === "partially_completed") this.askActual(task, status, reason); else { try { updateTaskStatus(task.id, status, task.actualMinutes, reason); this.load(); } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "保存失败", icon: "none" }); } } } }); },
  reschedule(task: ViewTask) { try { rescheduleTask(task.id); wx.showToast({ title: "已顺延到明天", icon: "success" }); this.load(); } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "顺延失败", icon: "none" }); } },
  remove(task: ViewTask) { wx.showModal({ title: "删除行动？", content: `“${task.title}”删除后无法恢复。`, confirmColor: "#9B4B45", success: (result) => { if (!result.confirm) return; try { deleteTask(task.id); this.load(); } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "删除失败", icon: "none" }); } } }); },
}));
