import { buildProfileGrowthSummary } from "../../services/profileGrowth";
import { readManualStore } from "../../services/manualStore";
import { deleteTask, getTask, SaveActionRecordInput, updateActionRecord } from "../../services/manualTask";
import { syncManualData } from "../../services/manualSync";
import { MODAL_CONFIRM_COLORS, withAppTheme } from "../../services/theme";
import { ActionTask, ArchivedGoal, Goal, ManualDataStore } from "../../types/manual";
import { getTodayBusinessDate } from "../../utils/date";
import { off, on } from "../../utils/eventBus";
import { getTabHeaderLayout } from "../../utils/tabHeader";

type PageStatus = "loading" | "ready" | "error";
type RecordFilter = "all" | "completed" | "partial";

interface GoalView {
  id: string;
  title: string;
  active: boolean;
  archived: boolean;
}

interface GoalFilterOption {
  id: string;
  label: string;
  selected: boolean;
}

interface GrowthRecordView {
  id: string;
  goalId: string;
  goalTitle: string;
  title: string;
  date: string;
  statusKind: "completed" | "partial" | "rescheduled";
  statusText: string;
  statusTone: "success" | "warning";
  minutesText: string;
  actualMinutes: number;
  reflection: string;
  readOnly: boolean;
  archived: boolean;
}

interface GrowthRecordGroup {
  date: string;
  dateLabel: string;
  completedCount: number;
  actualMinutes: number;
  records: GrowthRecordView[];
}

const PAGE_SIZE = 20;

function actionDate(task: ActionTask): string {
  return String(task.activityDate || task.currentDate || "").slice(0, 10);
}

function isProgressRecord(task: ActionTask): boolean {
  return task.status === "completed"
    || task.status === "partially_completed"
    || (task.status === "rescheduled" && task.statusBeforeReschedule === "partially_completed");
}

function formatDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "日期未记录";
  return `${Number(value.slice(0, 4))}年${Number(value.slice(5, 7))}月${Number(value.slice(8, 10))}日`;
}

function streakDays(dates: Set<string>, today: string): number {
  if (!dates.size) return 0;
  const cursor = new Date(`${today}T00:00:00`);
  if (Number.isNaN(cursor.getTime())) return 0;
  if (!dates.has(today)) cursor.setDate(cursor.getDate() - 1);
  let count = 0;
  while (count < 3650) {
    const date = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    if (!dates.has(date)) break;
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

function hiddenGoalIds(store: ManualDataStore): Set<string> {
  return new Set((store.archivedGoals || [])
    .filter((goal) => (Boolean(goal.deletedAt) && !goal.restoredAt) || Boolean(goal.purgedAt))
    .map((goal) => goal.id));
}

function buildGoals(store: ManualDataStore, hidden: Set<string>): GoalView[] {
  const goals = new Map<string, GoalView>();
  (store.goals || []).forEach((goal: Goal) => {
    if (hidden.has(goal.id) || goal.deletedAt) return;
    goals.set(goal.id, {
      id: goal.id,
      title: goal.title || "未命名目标",
      active: goal.status === "active",
      archived: goal.status !== "active",
    });
  });
  (store.archivedGoals || []).forEach((goal: ArchivedGoal) => {
    if (hidden.has(goal.id) || goal.restoredAt || goal.purgedAt) return;
    goals.set(goal.id, {
      id: goal.id,
      title: goal.title || "未命名目标",
      active: false,
      archived: true,
    });
  });
  return Array.from(goals.values()).sort((left, right) => Number(right.active) - Number(left.active) || left.title.localeCompare(right.title));
}

function collectTasks(store: ManualDataStore, hidden: Set<string>): ActionTask[] {
  // tasks 是行动事实的唯一数据源；归档快照只补目标名称和只读状态，不能重复汇总 actions。
  return (store.tasks || []).filter((task) => !task.deletedAt && !hidden.has(task.goalId));
}

function toRecord(task: ActionTask, goal: GoalView | undefined): GrowthRecordView {
  const rescheduled = task.status === "rescheduled";
  const completed = task.status === "completed";
  const actualMinutes = Math.max(0, task.actualMinutes || 0);
  return {
    id: task.id,
    goalId: task.goalId,
    goalTitle: goal?.title || "目标记录",
    title: task.title || "未命名行动",
    date: actionDate(task),
    statusKind: rescheduled ? "rescheduled" : completed ? "completed" : "partial",
    statusText: rescheduled ? "部分完成后顺延" : completed ? "已完成" : "完成一部分",
    statusTone: completed ? "success" : "warning",
    minutesText: actualMinutes > 0
      ? `实际投入 ${actualMinutes} 分钟`
      : `未记录实际投入 · 预计 ${Math.max(0, task.estimatedMinutes || 0)} 分钟`,
    actualMinutes,
    reflection: String(task.reflection || "").trim(),
    readOnly: !goal?.active || rescheduled,
    archived: Boolean(goal?.archived),
  };
}

function buildGroups(records: GrowthRecordView[]): GrowthRecordGroup[] {
  const groups = new Map<string, GrowthRecordGroup>();
  records.forEach((record) => {
    const key = record.date || "unknown";
    const current = groups.get(key) || {
      date: key,
      dateLabel: formatDate(record.date),
      completedCount: 0,
      actualMinutes: 0,
      records: [],
    };
    current.records.push(record);
    if (record.statusKind === "completed") current.completedCount += 1;
    current.actualMinutes += record.actualMinutes;
    groups.set(key, current);
  });
  return Array.from(groups.values()).sort((left, right) => right.date.localeCompare(left.date));
}

Page(withAppTheme({
  data: {
    ...getTabHeaderLayout(),
    status: "loading" as PageStatus,
    errorMessage: "",
    selectedGoalId: "all",
    recordFilter: "all" as RecordFilter,
    recordFilters: [
      { key: "all", label: "全部记录" },
      { key: "completed", label: "已完成" },
      { key: "partial", label: "部分完成" },
    ],
    goalOptions: [] as GoalFilterOption[],
    goals: [] as GoalView[],
    allRecords: [] as GrowthRecordView[],
    groups: [] as GrowthRecordGroup[],
    visibleCount: PAGE_SIZE,
    hasMore: false,
    totalRecordCount: 0,
    summary: { completedActions: 0, totalMinutes: 0, actionDays: 0, currentStreakDays: 0 },
    recordEditorVisible: false,
    editingRecordId: "",
    recordEditorTask: null as ActionTask | null,
    savingRecord: false,
    deletingRecord: false,
  },

  manualSyncHandler: null as null | (() => void),

  onLoad(query: Record<string, string>) {
    const goalId = String(query.goalId || "").trim();
    if (goalId) this.setData({ selectedGoalId: goalId });
    this.manualSyncHandler = () => this.load(false);
    on("manual:sync", this.manualSyncHandler);
  },

  onUnload() {
    if (this.manualSyncHandler) off("manual:sync", this.manualSyncHandler);
    this.manualSyncHandler = null;
  },

  onShow() {
    this.load(false);
  },

  onPullDownRefresh() {
    this.load(true);
  },

  load(forceCloud: boolean) {
    const hadReadyData = this.data.status === "ready";
    if (this.data.status !== "ready") this.setData({ status: "loading", errorMessage: "" });
    const ready = forceCloud ? syncManualData().then(() => undefined) : Promise.resolve();
    ready.then(() => {
      const store = readManualStore();
      const today = getTodayBusinessDate();
      const hidden = hiddenGoalIds(store);
      const goals = buildGoals(store, hidden);
      const goalMap = new Map(goals.map((goal) => [goal.id, goal]));
      const tasks = collectTasks(store, hidden)
        .filter((task) => actionDate(task) <= today && isProgressRecord(task));
      const allRecords = tasks
        .map((task) => toRecord(task, goalMap.get(task.goalId)))
        .sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id));
      const profileSummary = buildProfileGrowthSummary(store, today);
      const actionDates = new Set(allRecords.map((record) => record.date).filter(Boolean));
      const requestedGoalExists = goals.some((goal) => goal.id === this.data.selectedGoalId);
      const selectedGoalId = this.data.selectedGoalId === "all" || requestedGoalExists ? this.data.selectedGoalId : "all";
      this.setData({
        status: "ready",
        errorMessage: "",
        selectedGoalId,
        goals,
        goalOptions: [
          { id: "all", label: "全部目标", selected: selectedGoalId === "all" },
          ...goals.map((goal) => ({ id: goal.id, label: goal.title, selected: selectedGoalId === goal.id })),
        ],
        allRecords,
        totalRecordCount: allRecords.length,
        summary: {
          completedActions: profileSummary.completedActions,
          totalMinutes: profileSummary.totalMinutes,
          actionDays: actionDates.size,
          currentStreakDays: streakDays(actionDates, today),
        },
      });
      this.applyFilters(true);
    }).catch((error: Error) => {
      const message = error.message || "成长记录暂时无法读取";
      if (hadReadyData) wx.showToast({ title: `刷新失败：${message}`, icon: "none" });
      else this.setData({ status: "error", errorMessage: message });
    }).then(() => wx.stopPullDownRefresh());
  },

  applyFilters(resetCount = false) {
    const visibleCount = resetCount ? PAGE_SIZE : this.data.visibleCount;
    const filtered = this.data.allRecords.filter((record) => {
      if (this.data.selectedGoalId !== "all" && record.goalId !== this.data.selectedGoalId) return false;
      if (this.data.recordFilter === "completed") return record.statusKind === "completed";
      if (this.data.recordFilter === "partial") return record.statusKind === "partial" || record.statusKind === "rescheduled";
      return true;
    });
    const visible = filtered.slice(0, visibleCount);
    this.setData({ groups: buildGroups(visible), visibleCount, hasMore: visible.length < filtered.length });
  },

  selectGoal(event: { currentTarget: { dataset: { id?: string } } }) {
    const selectedGoalId = String(event.currentTarget.dataset.id || "all");
    if (selectedGoalId === this.data.selectedGoalId) return;
    this.setData({
      selectedGoalId,
      goalOptions: this.data.goalOptions.map((option) => ({ ...option, selected: option.id === selectedGoalId })),
    }, () => this.applyFilters(true));
  },

  selectRecordFilter(event: { currentTarget: { dataset: { filter?: RecordFilter } } }) {
    const recordFilter = event.currentTarget.dataset.filter || "all";
    if (recordFilter === this.data.recordFilter) return;
    this.setData({ recordFilter }, () => this.applyFilters(true));
  },

  clearFilters() {
    this.setData({
      selectedGoalId: "all",
      recordFilter: "all",
      goalOptions: this.data.goalOptions.map((option) => ({ ...option, selected: option.id === "all" })),
    }, () => this.applyFilters(true));
  },

  loadMore() {
    this.setData({ visibleCount: this.data.visibleCount + PAGE_SIZE }, () => this.applyFilters());
  },

  openRecord(event: { currentTarget: { dataset: { id?: string } } }) {
    const recordId = String(event.currentTarget.dataset.id || "");
    const record = this.data.allRecords.find((item) => item.id === recordId);
    if (!record) return;
    if (record.readOnly) {
      if (record.archived && record.goalId) {
        wx.navigateTo({ url: `/pages/goal-review/index?id=${encodeURIComponent(record.goalId)}` });
      } else {
        wx.showToast({ title: "顺延前的投入记录仅供回顾", icon: "none" });
      }
      return;
    }
    const task = getTask(recordId);
    if (!task) {
      wx.showToast({ title: "这条记录暂时无法编辑", icon: "none" });
      return;
    }
    this.setData({
      recordEditorVisible: true,
      editingRecordId: task.id,
      recordEditorTask: task,
      savingRecord: false,
      deletingRecord: false,
    });
  },

  closeRecordEditor() {
    if (this.data.savingRecord || this.data.deletingRecord) return;
    this.setData({ recordEditorVisible: false, recordEditorTask: null, editingRecordId: "" });
  },

  saveRecordEditor(event: CustomEvent<Omit<SaveActionRecordInput, "taskId">>) {
    if (this.data.savingRecord || !this.data.editingRecordId) return;
    this.setData({ savingRecord: true });
    try {
      updateActionRecord({ taskId: this.data.editingRecordId, ...event.detail });
      this.setData({ recordEditorVisible: false, recordEditorTask: null, editingRecordId: "", savingRecord: false });
      this.load(false);
      wx.showToast({ title: "成长记录已更新", icon: "success" });
    } catch (error) {
      this.setData({ savingRecord: false });
      wx.showToast({ title: error instanceof Error ? error.message : "保存失败", icon: "none" });
    }
  },

  deleteRecordEditor() {
    if (this.data.savingRecord || this.data.deletingRecord || !this.data.editingRecordId) return;
    wx.showModal({
      title: "删除成长记录？",
      content: "删除后会同步影响今日数据、目标进度和历史复盘，且无法恢复。",
      confirmText: "删除",
      confirmColor: MODAL_CONFIRM_COLORS.danger,
      success: (result) => {
        if (!result.confirm) return;
        this.setData({ deletingRecord: true });
        try {
          deleteTask(this.data.editingRecordId);
          this.setData({ recordEditorVisible: false, recordEditorTask: null, editingRecordId: "", deletingRecord: false });
          this.load(false);
          wx.showToast({ title: "成长记录已删除", icon: "success" });
        } catch (error) {
          this.setData({ deletingRecord: false });
          wx.showToast({ title: error instanceof Error ? error.message : "删除失败", icon: "none" });
        }
      },
    });
  },

  openHistory() {
    wx.navigateTo({ url: "/pages/history/index" });
  },

  goToday() {
    wx.switchTab({ url: "/pages/index/index" });
  },

  retry() {
    this.load(false);
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack({ delta: 1 });
    else wx.switchTab({ url: "/pages/plan/index" });
  },
}));
