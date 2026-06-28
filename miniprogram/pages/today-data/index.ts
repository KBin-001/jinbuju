import { getActiveGoal } from "../../services/manualGoal";
import { updateTaskCompletionTime } from "../../services/manualTask";
import { DetailCalendarDay, DetailPeriod, DurationSlice, getTodayDataBounds, getTodayDataCalendar, getTodayDataDetails } from "../../services/todayDetails";
import { addDays, formatDate, getTodayBusinessDate } from "../../utils/date";

function dateLabel(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${weekday}`;
}

function deltaCopy(current: number, previous: number, unit: string): string {
  const delta = current - previous;
  if (delta === 0) return `较昨日持平`;
  return `较昨日 ${delta > 0 ? "+" : ""}${delta}${unit}`;
}

function monthStart(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

function addMonths(value: string, delta: number): string {
  const date = new Date(`${monthStart(value)}T00:00:00`);
  return formatDate(new Date(date.getFullYear(), date.getMonth() + delta, 1));
}

Page({
  data: {
    status: "loading",
    errorMessage: "",
    date: "",
    maxDate: "",
    minDate: "",
    dateLabel: "",
    dateMonth: "",
    goalId: "",
    goalTitle: "",
    period: "day" as DetailPeriod,
    metrics: { minutes: 0, completed: 0, focusRate: 0, total: 0 },
    previous: { minutes: 0, completed: 0, focusRate: 0, total: 0 },
    minuteDelta: "较昨日持平",
    completedDelta: "较昨日持平",
    focusDelta: "较昨日持平",
    bars: [] as Array<{ label: string; value: number; height: number }>,
    axisLabels: [] as string[],
    completedTasks: [] as DurationSlice[],
    visibleDurationTasks: [] as DurationSlice[],
    durationTotal: 0,
    pieGradient: "conic-gradient(#E8EFEA 0% 100%)",
    showAllDurations: false,
    calendarRendered: false,
    calendarVisible: false,
    calendarMonth: "",
    calendarTitle: "",
    calendarWeekLabels: ["一", "二", "三", "四", "五", "六", "日"],
    calendarDays: [] as DetailCalendarDay[],
    calendarPrevDisabled: false,
    calendarNextDisabled: false,
    timeEditorRendered: false,
    timeEditorVisible: false,
    editingTaskId: "",
    editingTaskTitle: "",
    draftHour: 0,
    draftMinute: 0,
    draftHourText: "00",
    draftMinuteText: "00",
    draftTimeText: "00:00",
    savingTime: false,
    timeSyncText: "修改后将保存到本地数据",
  },
  calendarCloseTimer: null as ReturnType<typeof setTimeout> | null,
  timeEditorCloseTimer: null as ReturnType<typeof setTimeout> | null,
  timeEditorSavedTimer: null as ReturnType<typeof setTimeout> | null,

  onLoad(query: Record<string, string>) {
    const today = getTodayBusinessDate();
    const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(query.date || "")) ? String(query.date) : today;
    const date = requestedDate > today ? today : requestedDate;
    this.setData({ date, maxDate: today, dateLabel: dateLabel(date), dateMonth: String(Number(date.slice(5, 7))), calendarMonth: monthStart(date) });
    this.load();
  },

  onShow() {
    if (this.data.status === "ready") this.load();
  },

  onUnload() {
    if (this.calendarCloseTimer) clearTimeout(this.calendarCloseTimer);
    if (this.timeEditorCloseTimer) clearTimeout(this.timeEditorCloseTimer);
    if (this.timeEditorSavedTimer) clearTimeout(this.timeEditorSavedTimer);
  },

  load() {
    this.setData({ status: "loading", errorMessage: "" });
    try {
      const goal = getActiveGoal();
      if (!goal) throw new Error("请先创建目标，再查看今日数据");
      const bounds = getTodayDataBounds(goal.id, this.data.maxDate || getTodayBusinessDate());
      const requestedDate = this.data.date || bounds.maxDate;
      const date = requestedDate < bounds.minDate ? bounds.minDate : requestedDate > bounds.maxDate ? bounds.maxDate : requestedDate;
      const details = getTodayDataDetails(goal.id, date, this.data.period);
      const visibleDurationTasks = this.data.showAllDurations ? details.completedTasks : details.completedTasks.slice(0, 5);
      this.setData({
        status: "ready",
        goalId: goal.id,
        goalTitle: goal.title,
        date,
        minDate: bounds.minDate,
        maxDate: bounds.maxDate,
        dateLabel: dateLabel(date),
        dateMonth: String(Number(date.slice(5, 7))),
        metrics: details.metrics,
        previous: details.previous,
        minuteDelta: deltaCopy(details.metrics.minutes, details.previous.minutes, " 分钟"),
        completedDelta: deltaCopy(details.metrics.completed, details.previous.completed, " 项"),
        focusDelta: deltaCopy(details.metrics.focusRate, details.previous.focusRate, "%"),
        bars: details.bars,
        axisLabels: details.axisLabels,
        completedTasks: details.completedTasks,
        visibleDurationTasks,
        durationTotal: details.durationTotal,
        pieGradient: details.pieGradient,
      });
    } catch (error) {
      this.setData({ status: "error", errorMessage: error instanceof Error ? error.message : "数据读取失败" });
    }
  },

  openCalendar() {
    if (this.calendarCloseTimer) {
      clearTimeout(this.calendarCloseTimer);
      this.calendarCloseTimer = null;
    }
    const calendarMonth = monthStart(this.data.date);
    this.showCalendarMonth(calendarMonth);
    this.setData({ calendarRendered: true, calendarVisible: false });
    wx.nextTick(() => this.setData({ calendarVisible: true }));
  },

  closeCalendar() {
    this.setData({ calendarVisible: false });
    if (this.calendarCloseTimer) clearTimeout(this.calendarCloseTimer);
    this.calendarCloseTimer = setTimeout(() => {
      this.setData({ calendarRendered: false });
      this.calendarCloseTimer = null;
    }, 220);
  },

  showCalendarMonth(calendarMonth: string) {
    if (!this.data.goalId) return;
    const calendar = getTodayDataCalendar(this.data.goalId, this.data.date, calendarMonth, this.data.minDate, this.data.maxDate);
    this.setData({
      calendarMonth,
      calendarTitle: calendar.title,
      calendarDays: calendar.days,
      calendarPrevDisabled: calendarMonth <= monthStart(this.data.minDate),
      calendarNextDisabled: calendarMonth >= monthStart(this.data.maxDate),
    });
  },

  switchCalendarMonth(event: { currentTarget: { dataset: { delta?: string | number } } }) {
    const delta = Number(event.currentTarget.dataset.delta || 0);
    if (delta < 0 && this.data.calendarPrevDisabled) return;
    if (delta > 0 && this.data.calendarNextDisabled) return;
    this.showCalendarMonth(addMonths(this.data.calendarMonth || this.data.date, delta));
  },

  selectCalendarDate(event: { currentTarget: { dataset: { date?: string } } }) {
    const date = String(event.currentTarget.dataset.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < this.data.minDate || date > this.data.maxDate) return;
    this.applyDate(date, true);
  },

  jumpTodayFromCalendar() {
    const date = this.data.maxDate;
    this.applyDate(date, true);
  },

  shiftDate(event: { currentTarget: { dataset: { delta?: string | number } } }) {
    const delta = Number(event.currentTarget.dataset.delta || 0);
    if ((delta < 0 && this.data.date <= this.data.minDate) || (delta > 0 && this.data.date >= this.data.maxDate)) return;
    const date = formatDate(addDays(new Date(`${this.data.date}T00:00:00`), delta));
    if (date < this.data.minDate || date > this.data.maxDate) return;
    this.applyDate(date, false);
  },

  applyDate(date: string, closeCalendar: boolean) {
    if (closeCalendar) this.closeCalendar();
    this.setData({ date, dateLabel: dateLabel(date), dateMonth: String(Number(date.slice(5, 7))), calendarMonth: monthStart(date), showAllDurations: false });
    this.load();
  },

  openTimeEditor(event: { currentTarget: { dataset: { id?: string } } }) {
    const taskId = String(event.currentTarget.dataset.id || "");
    const task = this.data.completedTasks.find((item) => item.id === taskId);
    if (!task) return;
    const match = /^(\d{2}):(\d{2})$/.exec(task.completedTime);
    const now = new Date();
    const draftHour = match ? Number(match[1]) : now.getHours();
    const draftMinute = match ? Number(match[2]) : now.getMinutes();
    if (this.timeEditorCloseTimer) {
      clearTimeout(this.timeEditorCloseTimer);
      this.timeEditorCloseTimer = null;
    }
    this.setData({
      timeEditorRendered: true,
      timeEditorVisible: false,
      editingTaskId: task.id,
      editingTaskTitle: task.title,
      draftHour,
      draftMinute,
      draftHourText: String(draftHour).padStart(2, "0"),
      draftMinuteText: String(draftMinute).padStart(2, "0"),
      draftTimeText: `${String(draftHour).padStart(2, "0")}:${String(draftMinute).padStart(2, "0")}`,
      savingTime: false,
      timeSyncText: "修改后将保存到本地数据",
    });
    wx.nextTick(() => this.setData({ timeEditorVisible: true }));
  },

  closeTimeEditor() {
    if (this.data.savingTime) return;
    this.setData({ timeEditorVisible: false });
    if (this.timeEditorCloseTimer) clearTimeout(this.timeEditorCloseTimer);
    this.timeEditorCloseTimer = setTimeout(() => {
      this.setData({ timeEditorRendered: false, editingTaskId: "" });
      this.timeEditorCloseTimer = null;
    }, 220);
  },

  adjustCompletionTime(event: { currentTarget: { dataset: { part?: string; delta?: string | number } } }) {
    if (this.data.savingTime) return;
    const part = String(event.currentTarget.dataset.part || "");
    const delta = Number(event.currentTarget.dataset.delta || 0);
    let draftHour = this.data.draftHour;
    let draftMinute = this.data.draftMinute;
    if (part === "hour") draftHour = (draftHour + delta + 24) % 24;
    else if (part === "minute") draftMinute = (draftMinute + delta + 60) % 60;
    else return;
    this.setData({
      draftHour,
      draftMinute,
      draftHourText: String(draftHour).padStart(2, "0"),
      draftMinuteText: String(draftMinute).padStart(2, "0"),
      draftTimeText: `${String(draftHour).padStart(2, "0")}:${String(draftMinute).padStart(2, "0")}`,
    });
  },

  saveCompletionTime() {
    if (this.data.savingTime || !this.data.editingTaskId) return;
    this.setData({ savingTime: true, timeSyncText: "正在保存到本地…" });
    try {
      updateTaskCompletionTime(this.data.editingTaskId, this.data.date, this.data.draftTimeText);
      this.setData({ savingTime: false, timeSyncText: "已保存到本地" });
      this.load();
      this.timeEditorSavedTimer = setTimeout(() => {
        this.timeEditorSavedTimer = null;
        this.closeTimeEditor();
        wx.showToast({ title: "完成时间已更新", icon: "success" });
      }, 450);
    } catch (error) {
      const message = error instanceof Error ? error.message : "完成时间保存失败";
      this.setData({ savingTime: false, timeSyncText: message });
      wx.showToast({ title: message, icon: "none" });
    }
  },

  noop() {},

  changePeriod(event: { currentTarget: { dataset: { period?: string } } }) {
    const period = String(event.currentTarget.dataset.period || "day") as DetailPeriod;
    if (!["day", "week", "month"].includes(period) || period === this.data.period) return;
    this.setData({ period });
    this.load();
  },

  toggleDurations() {
    const showAllDurations = !this.data.showAllDurations;
    this.setData({
      showAllDurations,
      visibleDurationTasks: showAllDurations ? this.data.completedTasks : this.data.completedTasks.slice(0, 5),
    });
  },

  goAddAction() {
    wx.navigateTo({
      url: `/pages/action-edit/index?goalId=${encodeURIComponent(this.data.goalId)}&date=${encodeURIComponent(this.data.date)}`,
      fail: () => wx.showToast({ title: "添加页面打开失败", icon: "none" }),
    });
  },
});
