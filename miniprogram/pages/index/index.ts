import { getActiveGoal } from "../../services/manualGoal";
import { getProgressSummary } from "../../services/manualStats";
import { calculateTodaySummary, createTask, deleteTask, getTasksByGoal, getTodayPageTasks, rescheduleTask, updateTaskStatus } from "../../services/manualTask";
import { getLocalUserProfile } from "../../services/profile";
import { analyzeProgress, prepareProgressCoach } from "../../services/progressCoach";
import { getCurrentThemeId, withAppTheme } from "../../services/theme";
import { syncManualData } from "../../services/manualSync";
import { ActionIssueReason, ActionTask, ActionTaskStatus, Goal, TodaySummary } from "../../types/manual";
import { addDays, formatDate, formatDisplayDate, getTodayBusinessDate, getTimeGreeting } from "../../utils/date";
import { off, on } from "../../utils/eventBus";
import { getActionTaskDisplayStatus, groupTodayTasks, isCarryOverTask } from "../../utils/taskStatus";

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
const EXAMPLE_ACTION_TITLES = ["背单词 30 个", "阅读 30 分钟", "听力练习 20 分钟", "真题复盘 1 套"];
interface ViewTask extends ActionTask { displayTitle: string; statusLabel: string; statusTone: string; rescheduled: boolean; dateLabel: string; partialHint: boolean; actionSubtext: string; actionIconType: "book" | "audio" | "note"; canComplete: boolean; }
interface ViewTaskGroup { key: "today" | "continue"; title: string; tasks: ViewTask[]; }
interface TodayMood { title: string; copy: string; tone: "empty" | "low" | "half" | "done"; mark: string; }
interface ProgressSegment { active: boolean; }
interface WeekDayView { label: string; date: string; day: string; isToday: boolean; isSelected: boolean; isCurrentMonth: boolean; }
interface CalendarDayView extends WeekDayView { hasAction: boolean; isCompleted: boolean; }
interface CalendarView { title: string; days: CalendarDayView[]; }

function getTodayLayout(): { menuTop: number; menuHeight: number } {
  try {
    const windowInfo = wx.getWindowInfo();
    const menu = wx.getMenuButtonBoundingClientRect();
    return { menuTop: Math.max(windowInfo.statusBarHeight || 0, menu.top || 0), menuHeight: menu.height || 32 };
  } catch (_) {
    return { menuTop: 28, menuHeight: 32 };
  }
}

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
function todayMood(summary: TodaySummary): TodayMood {
  const percent = completionPercent(summary);
  if (!summary.totalCount) return { title: "今天还没开局", copy: "先放一件小事上来，别让今天空过去。", tone: "empty", mark: "启" };
  if (percent >= 100) return { title: "今天你赢下来了", copy: "该完成的都收住了，节奏很漂亮。", tone: "done", mark: "赢" };
  if (percent >= 50) return { title: "差一点，但已经上桌了", copy: `还剩 ${remainingCount(summary)} 项，顺手收掉一件就很赚。`, tone: "half", mark: "冲" };
  if (summary.completedCount > 0) return { title: "先拿下 1 项，节奏已经起来了", copy: `已经完成 ${summary.completedCount} 项，剩下的慢慢推进。`, tone: "low", mark: "进" };
  if (summary.partialCount > 0) return { title: "已经开始推进了", copy: `有 ${summary.partialCount} 项完成了一部分，继续把它收住。`, tone: "low", mark: "进" };
  return { title: "今天别空手离开", copy: `还有 ${summary.totalCount} 项等你开动，挑最小的一件先做。`, tone: "low", mark: "动" };
}
function dailyNudge(tasks: ViewTask[], selectedDate: string, today: string): string {
  const dayLabel = selectedDate === today ? "今天" : "这一天";
  const remaining = tasks.filter((task) => task.status === "pending" || task.status === "partially_completed");
  if (remaining.length > 0) {
    const nextTask = remaining[0];
    return `先从“${nextTask.displayTitle}”开始，专注 10 分钟，就是${dayLabel}扎实的一步。`;
  }
  if (tasks.length > 0 && tasks.every((task) => task.status === "completed")) {
    return `${dayLabel}已经稳稳推进了，花 2 分钟记下最有效的做法吧。`;
  }
  if (tasks.length > 0) {
    return `${dayLabel}先照顾好自己的节奏，下一次从一件最小的事重新开始。`;
  }
  return `先添加一件 15～30 分钟能完成的小事，让${dayLabel}轻轻开个头。`;
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
    ...getTodayLayout(),
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
    focusPercent: 0,
    remainingCount: 0,
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
    coachSummary: "",
    coachNextStep: "",
    dailyNudge: "先添加一件 15～30 分钟能完成的小事，让今天轻轻开个头。",
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
    quickAddDescription: "",
    quickAddMinutes: 30,
    quickDurationOptions: DURATION_OPTIONS,
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
    },
  },
  profileHandler: null as null | (() => void),
  focusGoalHandler: null as null | (() => void),
  completionSheetTimer: null as ReturnType<typeof setTimeout> | null,
  coachRequestKey: "",
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
    this.setData({ appTheme: getCurrentThemeId() });
    syncManualData().catch(() => undefined).then(() => this.load());
  },
  load() {
    this.setData({ status: "loading", errorMessage: "" });
    try {
      const today = getTodayBusinessDate(); const selectedDate = this.data.selectedDate || today; const goal = getActiveGoal(); const copy = dateCopy(selectedDate); const userProfile = getLocalUserProfile(); const displayName = userProfile?.nickname || "行动伙伴"; const timeGreeting = getTimeGreeting();
      const displayAvatarUrl = userProfile?.avatarUrl || "";
      const goalTasks = goal ? getTasksByGoal(goal.id) : [];
      const sourceTasks = goal ? getTodayPageTasks(goal.id, selectedDate, today) : [];
      const selectedTasks = sourceTasks.filter((task) => task.currentDate === selectedDate);
      const taskGroups = groupTodayTasks(sourceTasks, selectedDate).map((group) => ({ ...group, tasks: group.tasks.map((task) => toViewTask(task, selectedDate, today)) }));
      const tasks = taskGroups.reduce<ViewTask[]>((all, group) => all.concat(group.tasks), []);
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
        focusPercent: focusPercent(summary),
        remainingCount: remainingCount(summary),
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
        dailyNudge: dailyNudge(tasks, selectedDate, today),
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
        this.drawSummaryRing();
        this.prepareTodayCoach();
      });
    } catch (error) { this.setData({ status: "error", errorMessage: error instanceof Error ? error.message : "本地数据读取失败" }); }
  },
  useDefaultAvatar() { this.setData({ displayAvatarUrl: "" }); },
  prepareTodayCoach() {
    const goal = this.data.goal;
    if (!goal?.id) {
      this.coachRequestKey = "";
      this.setData({ coachStatus: "idle", coachSummary: "", coachNextStep: "" });
      return;
    }
    const analysisDate = this.data.selectedDate || getTodayBusinessDate();
    const requestKey = `day:${goal.id}:${analysisDate}`;
    this.coachRequestKey = requestKey;
    this.setData({ coachStatus: "loading", coachSummary: "", coachNextStep: "" });
    prepareProgressCoach("day", goal.id, false, analysisDate)
      .then(() => analyzeProgress(goal.id, "day", analysisDate))
      .then((analysis) => {
        if (this.coachRequestKey !== requestKey) return;
        this.setData({
          coachStatus: "ready",
          coachSummary: analysis.summary,
          coachNextStep: analysis.nextSuggestions[0] || "继续完成眼前这一小步。",
        });
      }, () => {
        if (this.coachRequestKey === requestKey) this.setData({ coachStatus: "error", coachSummary: "", coachNextStep: "" });
      });
  },
  drawSummaryRing() {
    wx.nextTick(() => {
      const query = wx.createSelectorQuery().in(this);
      query.select("#stats-progress-ring").fields({ node: true, size: true }).exec((result) => {
        const field = result?.[0] as { node?: any; width?: number; height?: number } | undefined;
        const canvas = field?.node;
        const width = Number(field?.width || 0);
        const height = Number(field?.height || 0);
        if (!canvas || !width || !height) return;

        const dpr = wx.getWindowInfo().pixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        const context = canvas.getContext("2d");
        context.scale(dpr, dpr);
        context.clearRect(0, 0, width, height);
        context.lineCap = "round";

        const centerX = width / 2;
        const centerY = height / 2;
        const radius = Math.min(width, height) * 0.40;
        const lineWidth = Math.min(width, height) * 0.13;
        const start = -Math.PI / 2;
        const ratio = Math.max(0, Math.min(1, this.data.completionPercent / 100));

        // 轨道
        context.beginPath();
        context.strokeStyle = "#E9D9AD";
        context.lineWidth = lineWidth;
        context.arc(centerX, centerY, radius, 0, Math.PI * 2);
        context.stroke();

        // 进度弧
        if (ratio > 0) {
          context.beginPath();
          context.strokeStyle = "#31584B";
          context.lineWidth = lineWidth;
          context.arc(centerX, centerY, radius, start, start + Math.PI * 2 * ratio);
          context.stroke();
        }
      });
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
    this.setData({ calendarVisible: false }, () => this.drawSummaryRing());
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
    this.setData({ quickAddVisible: true, quickAddTitle: "", quickAddDescription: "", quickAddMinutes: 30, quickAddMinuteIndex: DEFAULT_QUICK_ADD_MINUTE_INDEX, quickDurationVisible: false, quickAddSubmitting: false, quickAddTouchDeltaY: 0 });
  },
  closeQuickAdd() {
    if (this.data.quickAddSubmitting) return;
    this.setData(
      { quickAddVisible: false, quickDurationVisible: false, quickAddTouchDeltaY: 0 },
      () => this.drawSummaryRing(),
    );
  },
  noop() {},
  inputQuickAddTitle(event: { detail: { value?: string } }) { this.setData({ quickAddTitle: String(event.detail.value || "").slice(0, 40) }); },
  inputQuickAddDescription(event: { detail: { value?: string } }) { this.setData({ quickAddDescription: String(event.detail.value || "").slice(0, 150) }); },
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
        description: this.data.quickAddDescription,
        estimatedMinutes: DURATION_OPTIONS[this.data.quickAddMinuteIndex]?.value || 30,
        currentDate: this.data.selectedDate || getTodayBusinessDate(),
      });
      wx.showToast({ title: "行动已添加", icon: "success" });
      this.setData({ quickAddVisible: false, quickAddTitle: "", quickAddDescription: "", quickAddMinutes: 30, quickAddMinuteIndex: DEFAULT_QUICK_ADD_MINUTE_INDEX, quickDurationVisible: false, quickAddSubmitting: false, quickAddTouchDeltaY: 0 });
      this.load();
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "保存失败", icon: "none" });
      this.setData({ quickAddSubmitting: false, quickAddTouchDeltaY: 0 });
    }
  },
  openTask(event: { currentTarget: { dataset: { id?: string } } }) {
    const id = String(event.currentTarget.dataset.id || ""); const task = this.data.tasks.find((item) => item.id === id); if (!task) return;
    wx.showActionSheet({ itemList: ["标记完成", "完成一部分", "顺延到明天", "今天不做", "编辑", "删除"], success: ({ tapIndex }) => {
      if (tapIndex === 0) this.askActual(task, "completed"); else if (tapIndex === 1) this.chooseReason(task, "partially_completed"); else if (tapIndex === 2) this.reschedule(task); else if (tapIndex === 3) this.chooseReason(task, "skipped"); else if (tapIndex === 4) wx.navigateTo({ url: `/pages/action-edit/index?id=${task.id}` }); else if (tapIndex === 5) this.remove(task);
    } });
  },
  applyTaskPatch(updatedTask: ViewTask, prevScrollTop: number) {
    const today = getTodayBusinessDate();
    const selectedDate = this.data.selectedDate || today;
    const tasks = this.data.tasks.map((item) => (item.id === updatedTask.id ? updatedTask : item));
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
      focusPercent: focusPercent(summary),
      remainingCount: remainingCount(summary),
      remainingEstimatedMinutes: remainingEstimatedMinutes(tasks, selectedDate),
      progressSegments: progressSegments(summary),
      hiddenActionCount: Math.max(0, tasks.length - visibleTasks.length),
      heroDayLabel: `DAY ${Math.max(1, progress?.totalActionDays || (summary.completedCount > 0 ? 1 : 0))}`,
      todayMoodTitle: mood.title,
      todayMoodCopy: mood.copy,
      todayMoodTone: mood.tone,
      todayMoodMark: mood.mark,
      currentStreakDays: progress?.currentStreakDays || 0,
      dailyNudge: dailyNudge(tasks, selectedDate, today),
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
      completionSheetData: {
        done: summary.completedCount,
        total: summary.totalCount,
        goalProgress,
        minutes: summary.actualMinutes,
        streak: progress.currentStreakDays,
      },
    });
    wx.nextTick(() => this.setData({ completionSheetVisible: true }));
  },
  closeCompletionSheet() {
    if (!this.data.completionSheetRendered) return;
    this.setData({ completionSheetVisible: false });
    if (this.completionSheetTimer) clearTimeout(this.completionSheetTimer);
    this.completionSheetTimer = setTimeout(() => {
      this.setData({ completionSheetRendered: false }, () => this.drawSummaryRing());
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
  toggleTaskDone(event: { currentTarget: { dataset: { id?: string } } }) {
    const id = String(event.currentTarget.dataset.id || "");
    const task = this.data.tasks.find((item) => item.id === id);
    if (!task || task.status === "rescheduled") return;
    if (!task.canComplete) {
      wx.showToast({ title: "未来行动到当天后再记录完成", icon: "none" });
      return;
    }
    if (task.status !== "completed") {
      this.askActual(task, "completed");
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
    this.askActual(task, "completed");
  },
  askActual(task: ViewTask, status: "completed" | "partially_completed", reason?: ActionIssueReason) {
    wx.showModal({ title: status === "completed" ? "记录实际投入" : "完成一部分", editable: true, placeholderText: "请输入实际投入分钟数", content: task.actualMinutes ? String(task.actualMinutes) : "", confirmText: "保存", success: (result) => { if (!result.confirm) return; const minutes = Number(String(result.content || "").trim()); if (!Number.isInteger(minutes) || minutes < 1 || minutes > 480) { wx.showToast({ title: "请输入 1～480 的整数分钟", icon: "none" }); return; } try { updateTaskStatus(task.id, status, minutes, reason); this.load(); if (status === "completed") { wx.vibrateShort({ type: "light" }); if (task.currentDate === getTodayBusinessDate() && this.data.selectedDate === getTodayBusinessDate()) this.openCompletionSheet(); } } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "保存失败", icon: "none" }); } } });
  },
  chooseReason(task: ViewTask, status: "partially_completed" | "skipped") { wx.showActionSheet({ itemList: REASONS.map((item) => item.label), success: ({ tapIndex }) => { const reason = REASONS[tapIndex]?.value; if (!reason) return; if (status === "partially_completed") this.askActual(task, status, reason); else { try { updateTaskStatus(task.id, status, task.actualMinutes, reason); this.load(); } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "保存失败", icon: "none" }); } } } }); },
  reschedule(task: ViewTask) { try { rescheduleTask(task.id); wx.showToast({ title: "已顺延到明天", icon: "success" }); this.load(); } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "顺延失败", icon: "none" }); } },
  remove(task: ViewTask) { wx.showModal({ title: "删除行动？", content: `“${task.title}”删除后无法恢复。`, confirmColor: "#9B4B45", success: (result) => { if (!result.confirm) return; try { deleteTask(task.id); this.load(); } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "删除失败", icon: "none" }); } } }); },
}));
