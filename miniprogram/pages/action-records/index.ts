import { getActiveGoals } from "../../services/manualGoal";
import { deleteTask, getTask, getTasksByGoal, SaveActionRecordInput, updateActionRecord } from "../../services/manualTask";
import { MODAL_CONFIRM_COLORS, withAppTheme } from "../../services/theme";
import { ActionTask, Goal } from "../../types/manual";
import { getTodayBusinessDate } from "../../utils/date";
import { getActionTaskDisplayStatus } from "../../utils/taskStatus";

type RecordFilter = "all" | "continue" | "completed";

interface RecordView {
  id: string;
  title: string;
  date: string;
  statusText: string;
  statusTone: string;
  minutesText: string;
  completed: boolean;
  partial: boolean;
}

interface RecordGroup {
  date: string;
  dateLabel: string;
  completedCount: number;
  actualMinutes: number;
  records: RecordView[];
}

const PAGE_SIZE = 20;

function monthDay(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "日期未记录";
  return `${Number(value.slice(5, 7))}月${Number(value.slice(8, 10))}日`;
}

function recordDate(task: ActionTask): string {
  return String(task.activityDate || task.currentDate || "").slice(0, 10);
}

function isVisibleTask(task: ActionTask): boolean {
  return !task.deletedAt && task.status !== "rescheduled" && task.status !== "skipped";
}

function matchesFilter(task: ActionTask, filter: RecordFilter): boolean {
  if (filter === "completed") return task.status === "completed";
  if (filter === "continue") return task.status === "pending" || task.status === "partially_completed";
  return true;
}

function toRecordView(task: ActionTask, today: string): RecordView {
  const status = getActionTaskDisplayStatus(task, today);
  const completed = task.status === "completed";
  const partial = task.status === "partially_completed";
  let minutesText = `预计 ${task.estimatedMinutes} 分钟`;
  if (completed) minutesText = (task.actualMinutes || 0) > 0 ? `实际 ${task.actualMinutes} 分钟` : "未记录实际投入";
  if (partial) minutesText = `已投入 ${task.actualMinutes || 0} 分钟 · 预计 ${task.estimatedMinutes} 分钟`;
  return {
    id: task.id,
    title: task.title,
    date: recordDate(task),
    statusText: status.text,
    statusTone: status.tone,
    minutesText,
    completed,
    partial,
  };
}

function buildGroups(records: RecordView[]): RecordGroup[] {
  const groups = new Map<string, RecordGroup>();
  records.forEach((record) => {
    const date = record.date || "unknown";
    const current = groups.get(date) || {
      date,
      dateLabel: date === "unknown" ? "日期未记录" : monthDay(date),
      completedCount: 0,
      actualMinutes: 0,
      records: [],
    };
    current.records.push(record);
    if (record.completed) current.completedCount += 1;
    const task = getTask(record.id);
    current.actualMinutes += task?.actualMinutes || 0;
    groups.set(date, current);
  });
  return Array.from(groups.values()).sort((left, right) => right.date.localeCompare(left.date));
}

Page(withAppTheme({
  data: {
    status: "loading",
    errorMessage: "",
    goalId: "",
    goal: null as Goal | null,
    filter: "all" as RecordFilter,
    filterOptions: [
      { key: "all", label: "全部" },
      { key: "continue", label: "待继续" },
      { key: "completed", label: "已完成" },
    ],
    allTasks: [] as ActionTask[],
    groups: [] as RecordGroup[],
    visibleCount: PAGE_SIZE,
    hasMore: false,
    summary: { completed: 0, minutes: 0, continuing: 0 },
    recordEditorVisible: false,
    editingRecordId: "",
    recordEditorTask: null as ActionTask | null,
    savingRecord: false,
    deletingRecord: false,
  },

  onLoad(query: Record<string, string>) {
    this.setData({ goalId: String(query.goalId || "") });
  },

  onShow() {
    this.load();
  },

  load() {
    if (this.data.status !== "ready") this.setData({ status: "loading", errorMessage: "" });
    try {
      const goals = getActiveGoals();
      const goal = goals.find((item) => item.id === this.data.goalId) || goals[0] || null;
      if (!goal) {
        this.setData({ status: "ready", goal: null, allTasks: [], groups: [], hasMore: false });
        return;
      }
      const allTasks = getTasksByGoal(goal.id).filter(isVisibleTask);
      const completed = allTasks.filter((task) => task.status === "completed").length;
      const continuing = allTasks.filter((task) => task.status === "pending" || task.status === "partially_completed").length;
      const minutes = allTasks.reduce((sum, task) => sum + (task.actualMinutes || 0), 0);
      this.setData({
        status: "ready",
        goalId: goal.id,
        goal,
        allTasks,
        summary: { completed, minutes, continuing },
      });
      this.applyFilter(true);
    } catch (error) {
      this.setData({ status: "error", errorMessage: error instanceof Error ? error.message : "行动记录读取失败" });
    }
  },

  applyFilter(resetCount = false) {
    const visibleCount = resetCount ? PAGE_SIZE : this.data.visibleCount;
    const today = getTodayBusinessDate();
    const filtered = this.data.allTasks
      .filter((task) => matchesFilter(task, this.data.filter))
      .sort((left, right) => {
        const dateDiff = recordDate(right).localeCompare(recordDate(left));
        return dateDiff || right.updatedAt.localeCompare(left.updatedAt);
      });
    const records = filtered.slice(0, visibleCount).map((task) => toRecordView(task, today));
    this.setData({ groups: buildGroups(records), visibleCount, hasMore: filtered.length > records.length });
  },

  changeFilter(event: { currentTarget: { dataset: { filter?: RecordFilter } } }) {
    const filter = event.currentTarget.dataset.filter || "all";
    if (filter === this.data.filter) return;
    this.setData({ filter }, () => this.applyFilter(true));
  },

  showAll() {
    this.setData({ filter: "all" }, () => this.applyFilter(true));
  },

  loadMore() {
    this.setData({ visibleCount: this.data.visibleCount + PAGE_SIZE }, () => this.applyFilter());
  },

  openRecord(event: { currentTarget: { dataset: { id?: string } } }) {
    const taskId = String(event.currentTarget.dataset.id || "");
    const task = getTask(taskId);
    if (!task) return;
    if (task.status === "completed" || task.status === "partially_completed") {
      this.setData({ recordEditorVisible: true, editingRecordId: task.id, recordEditorTask: task, savingRecord: false, deletingRecord: false });
      return;
    }
    wx.navigateTo({ url: `/pages/action-edit/index?id=${encodeURIComponent(task.id)}` });
  },

  closeRecordEditor() {
    if (!this.data.savingRecord && !this.data.deletingRecord) {
      this.setData({ recordEditorVisible: false, recordEditorTask: null, editingRecordId: "" });
    }
  },

  saveRecordEditor(event: CustomEvent<Omit<SaveActionRecordInput, "taskId">>) {
    if (this.data.savingRecord || !this.data.editingRecordId) return;
    this.setData({ savingRecord: true });
    try {
      updateActionRecord({ taskId: this.data.editingRecordId, ...event.detail });
      this.setData({ recordEditorVisible: false, recordEditorTask: null, editingRecordId: "", savingRecord: false });
      this.load();
      wx.showToast({ title: "行动记录已更新", icon: "success" });
    } catch (error) {
      this.setData({ savingRecord: false });
      wx.showToast({ title: error instanceof Error ? error.message : "保存失败", icon: "none" });
    }
  },

  deleteRecordEditor() {
    if (this.data.savingRecord || this.data.deletingRecord || !this.data.editingRecordId) return;
    wx.showModal({
      title: "删除行动记录？",
      content: "删除后会同步影响今日统计、目标进度和历史复盘，且无法恢复。",
      confirmText: "删除",
      confirmColor: MODAL_CONFIRM_COLORS.danger,
      success: (result) => {
        if (!result.confirm) return;
        this.setData({ deletingRecord: true });
        try {
          deleteTask(this.data.editingRecordId);
          this.setData({ recordEditorVisible: false, recordEditorTask: null, editingRecordId: "", deletingRecord: false });
          this.load();
          wx.showToast({ title: "行动记录已删除", icon: "success" });
        } catch (error) {
          this.setData({ deletingRecord: false });
          wx.showToast({ title: error instanceof Error ? error.message : "删除失败", icon: "none" });
        }
      },
    });
  },

  addAction() {
    const goalId = this.data.goal?.id;
    if (!goalId) {
      wx.navigateTo({ url: "/pages/goal-create/index" });
      return;
    }
    wx.navigateTo({ url: `/pages/action-edit/index?goalId=${encodeURIComponent(goalId)}&date=${getTodayBusinessDate()}` });
  },

  retry() {
    this.load();
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack({ delta: 1 });
    else wx.switchTab({ url: "/pages/plan/index" });
  },
}));
