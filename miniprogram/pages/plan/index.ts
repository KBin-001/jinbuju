import {
  deleteCurrentPlan,
  getPlanPageData,
  pauseCurrentPlan,
  postponePlanTask,
  resumeCurrentPlan,
  updatePlanTime,
} from "../../services/plan";
import {
  PlanDayStatus,
  PlanDaySummary,
  PlanPageData,
  PlanPageTask,
  PlanStatus,
} from "../../types/goal";
import {
  clearGoalDraft,
  clearLongTermGoalDraft,
  clearPlanPreview,
  clearStagePreviewCache,
  getStagePreviewCache,
} from "../../utils/storage";

type PageStatus = "loading" | "empty" | "error" | "preview" | "ready";

interface PlanDayView extends PlanDaySummary {
  monthDay: string;
  weekday: string;
  statusLabel: string;
}

interface DatasetEvent {
  currentTarget: {
    dataset: {
      date?: string;
      taskId?: string;
    };
  };
}

interface TimeChangeEvent {
  detail: {
    value?: string;
  };
}

const CATEGORY_LABELS: Record<string, string> = {
  exam: "考试备考",
  skill: "技能学习",
  career: "求职提升",
  reading: "阅读成长",
  fitness: "运动健康",
  habit: "习惯养成",
  other: "其他目标",
};

const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  active: "进行中",
  paused: "已暂停",
  completed: "已完成",
  reviewing: "待复盘",
};

const DAY_STATUS_LABELS: Record<PlanDayStatus, string> = {
  future: "未来",
  today: "今天",
  completed: "已完成",
  partial: "部分完成",
  missed: "未完成",
  rest: "休息日",
  paused: "已暂停",
  not_started: "未开始",
};

function formatDay(dateValue: string): { monthDay: string; weekday: string } {
  const parts = dateValue.split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return { monthDay: dateValue, weekday: "" };
  }
  const weekdayIndex = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
  return {
    monthDay: `${parts[1]} 月 ${parts[2]} 日`,
    weekday: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][weekdayIndex],
  };
}

function getProgressText(rate: number): string {
  if (rate >= 100) return "当前阶段行动已经完成";
  if (rate >= 80) return "当前阶段接近完成";
  if (rate >= 40) return "你正在稳步推进";
  if (rate > 0) return "阶段已经开始，继续保持";
  return "从今天的一件小事开始";
}

function toDayView(day: PlanDaySummary): PlanDayView {
  const display = formatDay(day.date);
  return {
    ...day,
    ...display,
    statusLabel: DAY_STATUS_LABELS[day.status],
  };
}

Page({
  data: {
    status: "loading" as PageStatus,
    errorMessage: "",
    pageData: null as PlanPageData | null,
    days: [] as PlanDayView[],
    recentDays: [] as PlanDayView[],
    selectedDate: "",
    selectedDay: null as PlanDayView | null,
    categoryLabel: "",
    planStatusLabel: "",
    progressText: getProgressText(0),
    actionLoading: "",
    actionTaskId: "",
    deleting: false,
  },

  onShow() {
    this.loadPlan();
  },

  loadPlan() {
    this.setData({ status: "loading", errorMessage: "" });
    getPlanPageData()
      .then((pageData) => {
        if (!pageData.goal || !pageData.plan) {
          this.setData({
            status: getStagePreviewCache() ? "preview" : "empty",
            pageData: null,
            days: [],
            recentDays: [],
            selectedDay: null,
          });
          return;
        }

        const days = pageData.days.map(toDayView);
        const recentDays = pageData.recentDays.map(toDayView);
        const selectedDate = this.resolveSelectedDate(pageData, days);
        const selectedDay = days.find((day) => day.date === selectedDate) || days[0] || null;
        this.setData({
          status: "ready",
          pageData,
          days,
          recentDays,
          selectedDate,
          selectedDay,
          categoryLabel: CATEGORY_LABELS[pageData.goal.category] || "成长目标",
          planStatusLabel: PLAN_STATUS_LABELS[pageData.plan.status],
          progressText: getProgressText(pageData.plan.completionRate),
          actionLoading: "",
          actionTaskId: "",
        });
      })
      .catch((error: Error) => {
        this.setData({
          status: "error",
          errorMessage: error.message || "进度加载失败，请重试。",
        });
      });
  },

  resolveSelectedDate(pageData: PlanPageData, days: PlanDayView[]): string {
    if (days.some((day) => day.date === this.data.selectedDate)) {
      return this.data.selectedDate;
    }
    if (days.some((day) => day.date === pageData.businessDate)) {
      return pageData.businessDate;
    }
    if (!days.length) return "";
    return pageData.businessDate < days[0].date
      ? days[0].date
      : days[days.length - 1].date;
  },

  selectDay(event: DatasetEvent) {
    const date = String(event.currentTarget.dataset.date || "");
    const selectedDay = this.data.days.find((day: PlanDayView) => day.date === date);
    if (selectedDay) {
      this.setData({ selectedDate: date, selectedDay });
    }
  },

  retry() {
    if (this.data.status !== "loading") this.loadPlan();
  },

  createGoal() {
    wx.navigateTo({ url: "/pages/goal-create/index" });
  },

  continuePreview() {
    const cached = getStagePreviewCache();
    const previewId = cached?.result.previewId;
    wx.navigateTo({
      url: previewId
        ? `/pages/plan-preview/index?previewId=${previewId}`
        : "/pages/plan-preview/index",
    });
  },

  goToToday() {
    wx.switchTab({ url: "/pages/index/index" });
  },

  goToStageReview() {
    const stageId = this.data.pageData?.plan.id;
    if (stageId) {
      wx.navigateTo({ url: `/pages/stage-review/index?stageId=${stageId}` });
    }
  },

  changePlanTime(event: TimeChangeEvent) {
    const value = String(event.detail.value || "");
    const plan = this.data.pageData?.plan;
    if (!plan || this.data.actionLoading || value === plan.dailyReminderTime) return;
    this.setData({ actionLoading: "time" });
    updatePlanTime(plan.id, value)
      .then(() => {
        wx.showToast({ title: "行动时间已更新", icon: "success" });
        this.loadPlan();
      })
      .catch((error: Error) => {
        this.setData({ actionLoading: "" });
        wx.showModal({
          title: "时间更新失败",
          content: error.message || "请稍后重试。",
          showCancel: false,
        });
      });
  },

  confirmPostpone(event: DatasetEvent) {
    const taskId = String(event.currentTarget.dataset.taskId || "");
    const task = this.data.selectedDay?.tasks.find((item) => item.id === taskId);
    if (!task || !task.canPostpone || this.data.actionLoading) return;
    wx.showModal({
      title: "顺延到明天？",
      content: "行动会移动到明天，当前阶段的其他行动不会改变。",
      confirmText: "确认顺延",
      confirmColor: "#356859",
      success: (result: { confirm: boolean }) => {
        if (result.confirm) this.postponeTask(task);
      },
    });
  },

  postponeTask(task: PlanPageTask) {
    const plan = this.data.pageData?.plan;
    if (!plan) return;
    this.setData({ actionLoading: "task", actionTaskId: task.id });
    postponePlanTask(task.id, plan.id)
      .then(() => {
        wx.showToast({ title: "行动已顺延到明天", icon: "none" });
        this.loadPlan();
      })
      .catch((error: Error) => {
        this.setData({ actionLoading: "", actionTaskId: "" });
        wx.showModal({
          title: "暂时无法顺延",
          content: error.message || "请稍后重试。",
          showCancel: false,
        });
      });
  },

  confirmPause() {
    const plan = this.data.pageData?.plan;
    if (!plan || plan.status !== "active" || this.data.actionLoading) return;
    wx.showModal({
      title: "暂停当前阶段？",
      content: "暂停后，每日行动会保留，但暂停期间不会计入连续行动统计。是否继续？",
      confirmText: "暂停阶段",
      confirmColor: "#356859",
      success: (result: { confirm: boolean }) => {
        if (!result.confirm) return;
        this.setData({ actionLoading: "status" });
        pauseCurrentPlan(plan.id)
          .then(() => {
            wx.showToast({ title: "阶段已暂停", icon: "none" });
            this.loadPlan();
          })
          .catch((error: Error) => this.showActionError(error));
      },
    });
  },

  resumePlan() {
    const plan = this.data.pageData?.plan;
    if (!plan || plan.status !== "paused" || this.data.actionLoading) return;
    this.setData({ actionLoading: "status" });
    resumeCurrentPlan(plan.id)
      .then(() => {
        wx.showToast({ title: "阶段已恢复", icon: "success" });
        this.loadPlan();
      })
      .catch((error: Error) => this.showActionError(error));
  },

  showActionError(error: Error) {
    this.setData({ actionLoading: "", actionTaskId: "" });
    wx.showModal({
      title: "操作没有完成",
      content: error.message || "请稍后重试。",
      showCancel: false,
    });
  },

  confirmDelete() {
    if (this.data.deleting) return;
    wx.showModal({
      title: "删除当前目标？",
      content: "长期目标、当前阶段和相关行动都会删除，此操作无法撤销。",
      confirmText: "确认删除",
      confirmColor: "#C65353",
      success: (result: { confirm: boolean }) => {
        if (result.confirm) this.deletePlan();
      },
    });
  },

  deletePlan() {
    if (this.data.deleting) return;
    this.setData({ deleting: true });
    deleteCurrentPlan()
      .then(() => {
        clearGoalDraft();
        clearLongTermGoalDraft();
        clearPlanPreview();
        clearStagePreviewCache();
        this.setData({ deleting: false, pageData: null, status: "empty" });
        wx.showToast({ title: "当前目标已删除", icon: "success" });
      })
      .catch((error: Error) => {
        this.setData({ deleting: false });
        wx.showModal({
          title: "删除失败",
          content: error.message || "请稍后重试。",
          showCancel: false,
        });
      });
  },
});
