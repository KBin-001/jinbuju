import { getActiveGoal } from "../../services/manualGoal";
import { getProgressSummary } from "../../services/manualStats";
import { calculateTodaySummary, createTask, deleteTask, getTasksByGoal, getTodayPageTasks, rescheduleTask, updateTaskStatus } from "../../services/manualTask";
import { getLocalUserProfile } from "../../services/profile";
import { getCurrentThemeId, withAppTheme } from "../../services/theme";
import { ActionIssueReason, ActionTask, Goal, TodaySummary } from "../../types/manual";
import { addDays, formatDate, formatDisplayDate, getTodayBusinessDate } from "../../utils/date";
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
interface ViewTask extends ActionTask { displayTitle: string; statusLabel: string; statusTone: string; rescheduled: boolean; dateLabel: string; partialHint: boolean; actionSubtext: string; actionIconType: "book" | "audio" | "note"; }
interface ViewTaskGroup { key: "today" | "continue"; title: string; tasks: ViewTask[]; }
interface TodayMood { title: string; copy: string; tone: "empty" | "low" | "half" | "done"; mark: string; }
interface ProgressSegment { active: boolean; }
interface WeekDayView { label: string; date: string; day: string; isToday: boolean; isSelected: boolean; isCurrentMonth: boolean; }
interface CalendarDayView extends WeekDayView { hasAction: boolean; isCompleted: boolean; }
interface CalendarView { title: string; days: CalendarDayView[]; }

function dateCopy(value: string): { weekday: string } {
  const date = new Date(`${value}T00:00:00`);
  return { weekday: ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][date.getDay()] };
}
function emptySummary(): TodaySummary { return { estimatedMinutes: 0, actualMinutes: 0, completedCount: 0, partialCount: 0, unfinishedCount: 0, totalCount: 0 }; }
function completionPercent(summary: TodaySummary): number { return summary.totalCount ? Math.round(summary.completedCount / summary.totalCount * 100) : 0; }
function focusPercent(summary: TodaySummary): number { return completionPercent(summary); }
function remainingCount(summary: TodaySummary): number { return Math.max(0, summary.totalCount - summary.completedCount); }
function remainingEstimatedMinutes(tasks: ViewTask[], today: string): number {
  return tasks
    .filter((task) => task.currentDate === today && task.status !== "completed" && task.status !== "rescheduled")
    .reduce((sum, task) => sum + task.estimatedMinutes, 0);
}
function progressSegments(summary: TodaySummary): ProgressSegment[] {
  const total = summary.totalCount || 4;
  return Array.from({ length: total }, (_, index) => ({ active: index < summary.completedCount }));
}
function todayMood(summary: TodaySummary): TodayMood {
  const percent = completionPercent(summary);
  if (!summary.totalCount) return { title: "今天还没开局", copy: "先放一件小事上来，别让今天空过去。", tone: "empty", mark: "启" };
  if (percent >= 100) return { title: "今天你赢下来了", copy: "该完成的都收住了，节奏很漂亮。", tone: "done", mark: "赢" };
  if (percent >= 50) return { title: "差一点，但已经上桌了", copy: `还剩 ${remainingCount(summary)} 项，顺手收掉一件就很赚。`, tone: "half", mark: "冲" };
  if (percent > 0) return { title: "先拿下 1 项，节奏已经起来了", copy: `已经完成 ${summary.completedCount} 项，剩下的慢慢推进。`, tone: "low", mark: "进" };
  return { title: "今天别空手离开", copy: `还有 ${summary.totalCount} 项等你开动，挑最小的一件先做。`, tone: "low", mark: "动" };
}
function dailyNudge(tasks: ViewTask[], selectedDate: string, today: string): string {
  const dayLabel = selectedDate === today ? "今天" : "这一天";
  const remaining = tasks.filter((task) => task.status === "pending" || task.status === "partially_completed");
  if (remaining.length > 0) {
    const nextTask = remaining[0];
    return `${dayLabel}还有 ${remaining.length} 项待推进，建议先完成“${nextTask.displayTitle}”的第一步，不追求做多，只完成一次明确推进。`;
  }
  if (tasks.length > 0 && tasks.every((task) => task.status === "completed")) {
    return `${dayLabel}的基础行动已完成，可以简单复盘 2 分钟，记录一个有效做法，为明天减少阻力。`;
  }
  if (tasks.length > 0) {
    return `${dayLabel}没有待推进事项，可以用 2 分钟确认跳过或顺延的原因，避免同一阻力再次出现。`;
  }
  return `${dayLabel}还没有行动记录。先添加一项可以在 15～30 分钟内完成的具体行动。`;
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
function toViewTask(task: ActionTask, today: string): ViewTask {
  const displayStatus = getActionTaskDisplayStatus(task, today);
  const displayTitle = displayTaskTitle(task);
  return {
    ...task,
    displayTitle,
    statusLabel: displayStatus.text,
    statusTone: displayStatus.tone,
    rescheduled: isCarryOverTask(task),
    dateLabel: task.currentDate === today ? "今天" : formatDisplayDate(task.currentDate),
    partialHint: displayStatus.badge === "待继续",
    actionSubtext: task.description || `学习 ${task.estimatedMinutes} 分钟`,
    actionIconType: taskIconType(task),
  };
}

Page(withAppTheme({
  data: {
    appTheme: getCurrentThemeId() as string,
    status: "loading",
    errorMessage: "",
    displayName: "阿岚",
    displayAvatarUrl: "",
    displayAvatarText: "岚",
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
    todayMoodTitle: "今天还没开局",
    todayMoodCopy: "先放一件小事上来，别让今天空过去。",
    todayMoodTone: "empty",
    todayMoodMark: "启",
    dailyNudge: "今天还没有行动记录。先添加一项可以在 15～30 分钟内完成的具体行动。",
    weekday: "",
    weekdayShort: "",
    selectedDate: "",
    todayDate: "",
    weekOffset: 0,
    weekTitle: "今天",
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
    this.load();
  },
  load() {
    this.setData({ status: "loading", errorMessage: "" });
    try {
      const today = getTodayBusinessDate(); const selectedDate = this.data.selectedDate || today; const goal = getActiveGoal(); const copy = dateCopy(selectedDate); const userProfile = getLocalUserProfile(); const displayName = userProfile?.nickname || "阿岚";
      const displayAvatarUrl = userProfile?.avatarUrl || "";
      const displayAvatarText = displayName.slice(0, 1) || "岚";
      const goalTasks = goal ? getTasksByGoal(goal.id) : [];
      const sourceTasks = goal ? getTodayPageTasks(goal.id, selectedDate, today) : [];
      const selectedTasks = sourceTasks.filter((task) => task.currentDate === selectedDate);
      const taskGroups = groupTodayTasks(sourceTasks, selectedDate).map((group) => ({ ...group, tasks: group.tasks.map((task) => toViewTask(task, selectedDate)) }));
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
        displayAvatarText,
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
        dailyNudge: dailyNudge(tasks, selectedDate, today),
        weekday: copy.weekday,
        weekdayShort: copy.weekday.replace("星期", "周"),
        weekTitle: week.weekTitle,
        weekDays: week.weekDays,
        calendarMonth,
        calendarTitle: calendar.title,
        calendarDays: calendar.days,
        navigating: false,
      }, () => this.drawSummaryRing());
    } catch (error) { this.setData({ status: "error", errorMessage: error instanceof Error ? error.message : "本地数据读取失败" }); }
  },
  drawSummaryRing() {
    wx.nextTick(() => {
      const query = wx.createSelectorQuery().in(this);
      query.select("#summary-ring-canvas").fields({ node: true, size: true }).exec((result) => {
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
        const start = -Math.PI / 2;
        const drawArc = (radius: number, lineWidth: number, track: string, color: string, ratio: number) => {
          context.beginPath();
          context.strokeStyle = track;
          context.lineWidth = lineWidth;
          context.arc(centerX, centerY, radius, 0, Math.PI * 2);
          context.stroke();

          context.beginPath();
          context.strokeStyle = color;
          context.lineWidth = lineWidth;
          context.arc(centerX, centerY, radius, start, start + Math.PI * 2 * ratio);
          context.stroke();
        };

        const blue = context.createLinearGradient(0, 0, width, height);
        blue.addColorStop(0, "#4AA0FF");
        blue.addColorStop(1, "#247FEA");
        const orange = context.createLinearGradient(0, 0, width, height);
        orange.addColorStop(0, "#FFC12F");
        orange.addColorStop(1, "#F6A400");

        drawArc(Math.min(width, height) * 0.40, Math.min(width, height) * 0.055, "#EEF0F1", blue, 0.80);
        drawArc(Math.min(width, height) * 0.29, Math.min(width, height) * 0.048, "#F1F1F1", orange, 0.72);
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
    this.setData({ quickAddVisible: true, quickAddTitle: "", quickAddDescription: "", quickAddMinutes: 30, quickAddMinuteIndex: DEFAULT_QUICK_ADD_MINUTE_INDEX, quickDurationVisible: false, quickAddSubmitting: false, quickAddTouchDeltaY: 0 });
  },
  closeQuickAdd() {
    if (this.data.quickAddSubmitting) return;
    this.setData({ quickAddVisible: false, quickDurationVisible: false, quickAddTouchDeltaY: 0 });
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
  toggleTaskDone(event: { currentTarget: { dataset: { id?: string } } }) {
    const id = String(event.currentTarget.dataset.id || "");
    const task = this.data.tasks.find((item) => item.id === id);
    if (!task || task.status === "rescheduled") return;
    const prevScrollTop = this.data.currentScrollTop;
    try {
      const today = getTodayBusinessDate();
      const nextStatus = task.status === "completed" ? "pending" : "completed";
      const nextActual = nextStatus === "completed" ? task.actualMinutes || task.estimatedMinutes : undefined;
      const updatedTask = toViewTask(updateTaskStatus(task.id, nextStatus, nextActual), this.data.selectedDate || today);
      this.applyTaskPatch(updatedTask, prevScrollTop);
      if (nextStatus === "completed") {
        wx.vibrateShort({ type: "light" });
        if (task.currentDate === today && this.data.selectedDate === today) this.openCompletionSheet();
      }
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "保存失败", icon: "none" });
    }
  },
  quickCompleteTask(event: { currentTarget: { dataset: { id?: string } } }) {
    const id = String(event.currentTarget.dataset.id || "");
    const task = this.data.tasks.find((item) => item.id === id);
    if (!task || task.status === "completed") return;
    const prevScrollTop = this.data.currentScrollTop;
    try {
      const today = getTodayBusinessDate();
      const updatedTask = toViewTask(updateTaskStatus(task.id, "completed", task.actualMinutes || task.estimatedMinutes), this.data.selectedDate || today);
      this.applyTaskPatch(updatedTask, prevScrollTop);
      wx.showToast({ title: "行动已完成", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "保存失败", icon: "none" });
    }
  },
  askActual(task: ViewTask, status: "completed" | "partially_completed", reason?: ActionIssueReason) {
    wx.showModal({ title: status === "completed" ? "记录实际投入" : "完成一部分", editable: true, placeholderText: String(task.actualMinutes || task.estimatedMinutes), content: String(task.actualMinutes || task.estimatedMinutes), confirmText: "保存", success: (result) => { if (!result.confirm) return; const minutes = Number(result.content || task.estimatedMinutes); try { updateTaskStatus(task.id, status, minutes, reason); this.load(); } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "保存失败", icon: "none" }); } } });
  },
  chooseReason(task: ViewTask, status: "partially_completed" | "skipped") { wx.showActionSheet({ itemList: REASONS.map((item) => item.label), success: ({ tapIndex }) => { const reason = REASONS[tapIndex]?.value; if (!reason) return; if (status === "partially_completed") this.askActual(task, status, reason); else { try { updateTaskStatus(task.id, status, task.actualMinutes, reason); this.load(); } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "保存失败", icon: "none" }); } } } }); },
  reschedule(task: ViewTask) { try { rescheduleTask(task.id); wx.showToast({ title: "已顺延到明天", icon: "success" }); this.load(); } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "顺延失败", icon: "none" }); } },
  remove(task: ViewTask) { wx.showModal({ title: "删除行动？", content: `“${task.title}”删除后无法恢复。`, confirmColor: "#9B4B45", success: (result) => { if (!result.confirm) return; try { deleteTask(task.id); this.load(); } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "删除失败", icon: "none" }); } } }); },
}));
