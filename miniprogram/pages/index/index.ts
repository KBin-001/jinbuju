import { getActiveGoal } from "../../services/manualGoal";
import { calculateTodaySummary, createTask, deleteTask, getTodayPageTasks, rescheduleTask, updateTaskStatus } from "../../services/manualTask";
import { ActionIssueReason, ActionTask, Goal, TodaySummary } from "../../types/manual";
import { formatDisplayDate, getTodayBusinessDate } from "../../utils/date";
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
interface ViewTask extends ActionTask { statusLabel: string; statusTone: string; rescheduled: boolean; dateLabel: string; partialHint: boolean; }
interface ViewTaskGroup { key: "today" | "continue"; title: string; tasks: ViewTask[]; }

function dateCopy(value: string): { title: string; weekday: string } { const date = new Date(`${value}T00:00:00`); return { title: `今天，${date.getMonth() + 1} 月 ${date.getDate()} 日`, weekday: ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][date.getDay()] }; }
function emptySummary(): TodaySummary { return { estimatedMinutes: 0, actualMinutes: 0, completedCount: 0, partialCount: 0, unfinishedCount: 0, totalCount: 0 }; }
function completionPercent(summary: TodaySummary): number { return summary.totalCount ? Math.round(summary.completedCount / summary.totalCount * 100) : 0; }
function toViewTask(task: ActionTask, today: string): ViewTask {
  const displayStatus = getActionTaskDisplayStatus(task, today);
  return {
    ...task,
    statusLabel: displayStatus.text,
    statusTone: displayStatus.tone,
    rescheduled: isCarryOverTask(task),
    dateLabel: task.currentDate === today ? "今天" : formatDisplayDate(task.currentDate),
    partialHint: displayStatus.badge === "待继续",
  };
}

Page({
  data: {
    status: "loading",
    errorMessage: "",
    goal: null as Goal | null,
    tasks: [] as ViewTask[],
    taskGroups: [] as ViewTaskGroup[],
    summary: emptySummary(),
    completionPercent: 0,
    dateTitle: "",
    weekday: "",
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
  },
  onPageScroll(event: { scrollTop: number }) {
    this.setData({ currentScrollTop: event.scrollTop });
  },
  onShow() { this.load(); },
  load() {
    this.setData({ status: "loading", errorMessage: "" });
    try {
      const today = getTodayBusinessDate(); const goal = getActiveGoal(); const copy = dateCopy(today);
      const sourceTasks = goal ? getTodayPageTasks(goal.id, today) : [];
      const todayTasks = sourceTasks.filter((task) => task.currentDate === today);
      const taskGroups = groupTodayTasks(sourceTasks, today).map((group) => ({ ...group, tasks: group.tasks.map((task) => toViewTask(task, today)) }));
      const tasks = taskGroups.reduce<ViewTask[]>((all, group) => all.concat(group.tasks), []);
      const summary = calculateTodaySummary(todayTasks);
      this.setData({ status: "ready", goal, tasks, taskGroups, summary, completionPercent: completionPercent(summary), dateTitle: copy.title, weekday: copy.weekday, navigating: false });
    } catch (error) { this.setData({ status: "error", errorMessage: error instanceof Error ? error.message : "本地数据读取失败" }); }
  },
  retry() { this.load(); },
  goCreateGoal() { if (this.data.navigating) return; this.setData({ navigating: true }); wx.navigateTo({ url: "/pages/goal-create/index", fail: () => this.setData({ navigating: false }) }); },
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
        currentDate: getTodayBusinessDate(),
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
  quickCompleteTask(event: { currentTarget: { dataset: { id?: string } } }) {
    const id = String(event.currentTarget.dataset.id || "");
    const task = this.data.tasks.find((item) => item.id === id);
    if (!task || task.status === "completed") return;
    const prevScrollTop = this.data.currentScrollTop;
    try {
      const today = getTodayBusinessDate();
      const updatedTask = toViewTask(updateTaskStatus(task.id, "completed", task.actualMinutes || task.estimatedMinutes), today);
      const tasks = this.data.tasks.map((item) => (item.id === id ? updatedTask : item));
      const taskGroups = this.data.taskGroups.map((group) => ({ ...group, tasks: group.tasks.map((item) => (item.id === id ? updatedTask : item)) }));
      const todayTasks = tasks.filter((item) => item.currentDate === today);
      const summary = calculateTodaySummary(todayTasks);
      this.setData({ tasks, taskGroups, summary, completionPercent: completionPercent(summary) });
      wx.showToast({ title: "行动已完成", icon: "success" });
      wx.nextTick(() => {
        wx.pageScrollTo({ scrollTop: prevScrollTop, duration: 0 });
      });
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
});
