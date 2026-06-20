import { createManualTask, getHomeData, toggleTaskStatus } from "../../services/home";
import {
  GoalSummary,
  HomeData,
  TaskSourceSummary,
  TodayCheckinDraft,
  TodayTask,
  TodayTaskGroup,
  UserProgress,
} from "../../types/home";
import { saveTodayCheckinDraft } from "../../utils/checkin-draft";
import { getUiEventString, UiComponentEvent } from "../../utils/ui-event";

type PageStatus = "loading" | "success" | "error";

/** Cache TTL in ms – data within this window is considered fresh. */
const CACHE_TTL = 30_000;

interface TaskToggleEvent {
  currentTarget: {
    dataset: {
      id?: string | number;
    };
  };
}

interface TodayViewTask extends TodayTask {
  toggling: boolean;
  expanded: boolean;
}

interface TodayViewTaskGroup extends Omit<TodayTaskGroup, "tasks"> {
  tasks: TodayViewTask[];
}

const EMPTY_USER: UserProgress = {
  nickname: "",
  streakDays: 0,
};

const CATEGORY_LABELS: Record<string, string> = {
  exam: "考试备考",
  skill: "技能学习",
  career: "求职提升",
  reading: "阅读",
  fitness: "运动健康",
  habit: "习惯养成",
  other: "其他",
};

function formatDateTitle(businessDate: string): string {
  const parts = businessDate.split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return "今天";
  }
  return `今天，${parts[1]} 月 ${parts[2]} 日`;
}

function formatWeekday(businessDate: string): string {
  const parts = businessDate.split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return "";
  }
  const weekday = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
  return ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][weekday];
}

function getProgressText(completionRate: number): string {
  if (completionRate >= 100) {
    return "今天的行动已经完成";
  }
  if (completionRate > 0) {
    return "已经开始了，继续保持";
  }
  return "今天先完成一件小事";
}

function getGreetingText(completionRate: number, streakDays: number): string {
  if (completionRate >= 100) {
    return "今天的行动全部完成";
  }
  if (completionRate >= 50) {
    return "已经过半了，继续推进";
  }
  if (streakDays >= 7) {
    return `已经连续 ${streakDays} 天了，了不起`;
  }
  return "今天先完成一件小事";
}

function getCheckinButtonText(
  completedCount: number,
  totalCount: number,
  checkedInToday: boolean,
  planPaused: boolean,
  planReviewing = false,
): string {
  if (planReviewing) {
    return "请先完成阶段复盘";
  }
  if (planPaused) {
    return "阶段已暂停";
  }
  if (checkedInToday) {
    return "今日已打卡";
  }
  return "记录今日行动";
}

function buildTaskGroups(tasks: TodayViewTask[]): TodayViewTaskGroup[] {
  const labels: Record<TodayTask["timePeriod"], string> = {
    morning: "上午",
    afternoon: "下午",
    evening: "晚上",
    anytime: "随时",
  };
  const keys: TodayTask["timePeriod"][] = ["morning", "afternoon", "evening", "anytime"];
  return keys
    .map((key) => ({
      key,
      title: labels[key],
      tasks: tasks.filter((task) => task.timePeriod === key),
    }))
    .filter((group) => group.tasks.length > 0);
}

function createRequestId(): string {
  return `manual_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeTextList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function buildViewTask(task: TodayTask): TodayViewTask {
  return {
    ...task,
    actionType: String(task.actionType || ""),
    actionTypeLabel: String(task.actionTypeLabel || ""),
    completionCriteria: String(task.completionCriteria || ""),
    requiredResources: normalizeTextList(task.requiredResources),
    safetyNotes: normalizeTextList(task.safetyNotes),
    toggling: false,
    expanded: false,
  };
}

Page({
  data: {
    status: "loading" as PageStatus,
    errorMessage: "",
    businessDate: "",
    dateTitle: "",
    weekday: "",
    user: EMPTY_USER,
    goal: null as GoalSummary | null,
    categoryLabel: "",
    tasks: [] as TodayViewTask[],
    taskGroups: [] as TodayViewTaskGroup[],
    sourceSummary: [] as TaskSourceSummary[],
    completedCount: 0,
    totalCount: 0,
    completionRate: 0,
    progressText: getProgressText(0),
    greetingText: getGreetingText(0, 0),
    checkinButtonText: getCheckinButtonText(0, 0, false, false),
    checkedInToday: false,
    todayRest: false,
    planPaused: false,
    planReviewing: false,
    planReadOnly: false,
    pendingActionCount: 0,
    navigating: false,
    quickTitle: "",
    quickDescription: "",
    quickTimePeriod: "anytime" as TodayTask["timePeriod"],
    quickEstimatedMinutes: 30,
    quickTagName: "",
    showQuickTaskPanel: false,
    showMoreSettings: false,
    creatingTask: false,
    sheetTranslateY: 0,
    quickTimeOptions: [
      { label: "上午", value: "morning" },
      { label: "下午", value: "afternoon" },
      { label: "晚上", value: "evening" },
      { label: "随时", value: "anytime" },
    ],
    quickDurationOptions: [
      { label: "15 分钟", value: 15 },
      { label: "30 分钟", value: 30 },
      { label: "45 分钟", value: 45 },
      { label: "60 分钟", value: 60 },
    ],
  },

  // ── In-memory cache metadata ──
  _lastFetchTime: 0,
  _loading: false,
  _forceNextShow: false,
  _sheetTouchStartY: 0,
  _sheetTouchStartTime: 0,

  onShow() {
    const force = this._forceNextShow;
    this._forceNextShow = false;
    this.loadToday(force);
    if (wx.getStorageSync("openQuickTaskOnShow")) {
      wx.removeStorageSync("openQuickTaskOnShow");
      setTimeout(() => this.openQuickTaskPanel(), 300);
    }
  },

  /**
   * @param force  true = always refetch (after mutations); false = use cache if fresh.
   */
  loadToday(force = false) {
    if (this._loading) return;

    const now = Date.now();
    const hasFreshCache = !force && this._lastFetchTime > 0 && (now - this._lastFetchTime < CACHE_TTL);
    if (hasFreshCache) return;

    const silent = this._lastFetchTime > 0;
    this._loading = true;

    if (!silent) {
      this.setData({
        status: "loading",
        errorMessage: "",
        navigating: false,
      });
    }

    getHomeData()
      .then((homeData: HomeData) => {
        this._lastFetchTime = Date.now();
        this._loading = false;
        this.applyHomeData(homeData);
      })
      .catch((error: Error) => {
        this._loading = false;
        if (!silent) {
          this.setData({
            status: "error",
            errorMessage: error.message || "今日数据暂时无法加载，请稍后重试。",
          });
        }
      });
  },

  applyHomeData(homeData: HomeData) {
    const tasks = homeData.todayTasks.map(buildViewTask);
    const goal = homeData.goal;
    const checkedInToday = homeData.checkedInToday || false;
    const planPaused = goal?.planStatus === "paused";
    const planReviewing = goal?.planStatus === "reviewing";
    this.setData({
      status: "success",
      businessDate: homeData.businessDate,
      dateTitle: formatDateTitle(homeData.businessDate),
      weekday: formatWeekday(homeData.businessDate),
      user: homeData.user || EMPTY_USER,
      goal,
      categoryLabel: goal ? CATEGORY_LABELS[goal.category] || "成长目标" : "",
      tasks,
      taskGroups: buildTaskGroups(tasks),
      sourceSummary: homeData.sourceSummary || [],
      navigating: false,
      checkedInToday,
      todayRest: homeData.todayRest || false,
      planPaused,
      planReviewing,
      planReadOnly:
        Boolean(goal?.planId) &&
        !["active", "expired", "extended"].includes(String(goal?.planStatus || "")),
      pendingActionCount: homeData.pendingActionCount || 0,
    });
    this.updateProgress(tasks, (homeData.user || EMPTY_USER).streakDays);
  },

  updateProgress(tasks: TodayViewTask[], streakDays = this.data.user.streakDays) {
    const totalCount = tasks.length;
    const completedCount = tasks.filter((task) => task.completed).length;
    const completionRate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
    this.setData({
      tasks,
      taskGroups: buildTaskGroups(tasks),
      completedCount,
      totalCount,
      completionRate,
      progressText: getProgressText(completionRate),
      greetingText: getGreetingText(completionRate, streakDays),
      checkinButtonText: getCheckinButtonText(
        completedCount,
        totalCount,
        this.data.checkedInToday,
        this.data.planPaused,
        this.data.planReviewing,
      ),
    });
  },

  toggleTask(event: TaskToggleEvent) {
    const taskId = String(event.currentTarget.dataset.id || "");
    const currentTask = this.data.tasks.find((task: TodayViewTask) => task.id === taskId);
    if (
      !taskId ||
      !currentTask ||
      currentTask.toggling ||
      (Boolean(currentTask.planId) && this.data.planReadOnly)
    ) {
      return;
    }

    const newCompleted = !currentTask.completed;

    // Optimistic UI update.
    const tasks = this.data.tasks.map((task: TodayViewTask) =>
      task.id === taskId
        ? { ...task, completed: newCompleted, toggling: true }
        : task,
    );
    this.updateProgress(tasks);

    toggleTaskStatus(taskId, newCompleted)
      .then(() => {
        const unlockedTasks = this.data.tasks.map((task: TodayViewTask) =>
          task.id === taskId ? { ...task, toggling: false } : task,
        );
        this.updateProgress(unlockedTasks);
      })
      .catch(() => {
        // Revert on failure.
        const revertedTasks = this.data.tasks.map((task: TodayViewTask) =>
          task.id === taskId
            ? { ...task, completed: !newCompleted, toggling: false }
            : task,
        );
        this.updateProgress(revertedTasks);
        wx.showToast({
          title: "行动状态未保存，请重试",
          icon: "none",
          duration: 2000,
        });
      });
  },

  toggleTaskDetail(event: TaskToggleEvent) {
    const taskId = String(event.currentTarget.dataset.id || "");
    if (!taskId) {
      return;
    }
    const tasks = this.data.tasks.map((task: TodayViewTask) =>
      task.id === taskId ? { ...task, expanded: !task.expanded } : task,
    );
    this.setData({
      tasks,
      taskGroups: buildTaskGroups(tasks),
    });
  },

  onQuickTitleInput(event: UiComponentEvent<unknown>) {
    this.setData({ quickTitle: getUiEventString(event) });
  },

  onQuickDescriptionInput(event: { detail: { value?: string } }) {
    this.setData({ quickDescription: String(event.detail.value || "").slice(0, 150) });
  },

  openQuickTaskPanel() {
    this.setData({ showQuickTaskPanel: true });
  },

  closeQuickTaskPanel() {
    if (this.data.creatingTask) {
      return;
    }
    this.setData({
      showQuickTaskPanel: false,
      showMoreSettings: false,
      sheetTranslateY: 0,
    });
  },

  onSheetTouchStart(e: WechatMiniprogram.TouchEvent) {
    if (this.data.creatingTask) return;
    this._sheetTouchStartY = e.touches[0].clientY;
    this._sheetTouchStartTime = Date.now();
  },

  onSheetTouchMove(e: WechatMiniprogram.TouchEvent) {
    if (this.data.creatingTask || !this._sheetTouchStartY) return;
    const deltaY = e.touches[0].clientY - this._sheetTouchStartY;
    if (deltaY > 0) {
      this.setData({ sheetTranslateY: deltaY });
    } else if (this.data.sheetTranslateY > 0) {
      this.setData({ sheetTranslateY: 0 });
    }
  },

  onSheetTouchEnd() {
    if (this.data.creatingTask) return;
    const deltaY = this.data.sheetTranslateY;
    const timeDiff = Date.now() - this._sheetTouchStartTime;
    const velocity = deltaY / Math.max(timeDiff, 1);
    if (deltaY > 100 || (deltaY > 30 && velocity > 0.3)) {
      this.closeQuickTaskPanel();
    } else {
      this.setData({ sheetTranslateY: 0 });
    }
  },

  preventBubble() {},

  onQuickTagInput(event: UiComponentEvent<unknown>) {
    this.setData({ quickTagName: getUiEventString(event) });
  },

  changeQuickTimePeriod(event: UiComponentEvent<unknown>) {
    const value = getUiEventString(event);
    if (["morning", "afternoon", "evening", "anytime"].includes(value)) {
      this.setData({ quickTimePeriod: value as TodayTask["timePeriod"] });
    }
  },

  changeQuickDuration(event: UiComponentEvent<unknown>) {
    const value = Number(getUiEventString(event));
    if ([15, 30, 45, 60].includes(value)) {
      this.setData({ quickEstimatedMinutes: value });
    }
  },

  selectTimePeriod(event: TaskToggleEvent) {
    const value = String(event.currentTarget.dataset.id || "");
    if (!["morning", "afternoon", "evening", "anytime"].includes(value)) {
      return;
    }
    this.setData({ quickTimePeriod: value as TodayTask["timePeriod"] });
  },

  selectDuration(event: TaskToggleEvent) {
    const value = Number(event.currentTarget.dataset.id);
    if (![15, 30, 45, 60].includes(value)) {
      return;
    }
    this.setData({ quickEstimatedMinutes: value });
  },

  toggleMoreSettings() {
    this.setData({ showMoreSettings: !this.data.showMoreSettings });
  },

  createTodayTask() {
    const title = this.data.quickTitle.trim();
    if (title.length < 2) {
      wx.showToast({
        title: "先写下今天要完成什么",
        icon: "none",
      });
      return;
    }
    if (this.data.creatingTask) {
      return;
    }

    this.setData({ creatingTask: true });
    const finishCreating = () => {
      this.setData({ creatingTask: false });
    };

    createManualTask({
      requestId: createRequestId(),
      title,
      description: this.data.quickDescription.trim(),
      taskDate: this.data.businessDate,
      timePeriod: this.data.quickTimePeriod,
      estimatedMinutes: this.data.quickEstimatedMinutes,
      tagName: this.data.quickTagName.trim(),
      planId: this.data.goal?.planId || "",
      repeatType: "none",
      priority: "normal",
      taskType: "required",
    })
      .then(() => {
        finishCreating();
        this.setData({
          quickTitle: "",
          quickDescription: "",
          quickTagName: "",
          quickTimePeriod: "anytime",
          quickEstimatedMinutes: 30,
          showQuickTaskPanel: false,
          showMoreSettings: false,
        });
        wx.showToast({
          title: "已添加到今日",
          icon: "success",
          duration: 1200,
        });
        this.loadToday(true);
      }, (error: Error) => {
        finishCreating();
        wx.showToast({
          title: error.message || "任务创建失败，请重试",
          icon: "none",
          duration: 2000,
        });
      });
  },

  retry() {
    if (this._loading) return;
    this._lastFetchTime = 0;
    this.loadToday(true);
  },

  goToCreateGoal() {
    if (this.data.navigating) {
      return;
    }
    this._forceNextShow = true;
    this.setData({ navigating: true });
    wx.navigateTo({
      url: "/pages/goal-create/index",
      complete: () => {
        this.setData({ navigating: false });
      },
    });
  },

  prepareCheckin() {
    const goal = this.data.goal;
    if (
      this.data.navigating ||
      !goal ||
      !goal.planId ||
      this.data.planReadOnly
    ) {
      return;
    }

    this.setData({ navigating: true });

    // Build taskResults from current toggle state.
    const taskResults = this.data.tasks.map((task: TodayViewTask) => ({
      taskId: task.id,
      status: task.completed ? "completed" as const : "" as const,
    })).filter((r: { taskId: string; status: string }) => r.status !== "");

    const draft: TodayCheckinDraft = {
      goalId: goal.id,
      planId: goal.planId,
      businessDate: this.data.businessDate,
      tasks: this.data.tasks.map(({ toggling, expanded, ...task }: TodayViewTask) => ({ ...task })),
      completedTaskIds: this.data.tasks
        .filter((task: TodayViewTask) => task.completed)
        .map((task: TodayViewTask) => task.id),
      completedCount: this.data.completedCount,
      totalCount: this.data.totalCount,
      preparedAt: Date.now(),
      taskResults: taskResults.length > 0 ? taskResults : undefined,
    };
    this._forceNextShow = true;
    saveTodayCheckinDraft(draft);

    wx.navigateTo({
      url: "/pages/checkin/index",
      complete: () => {
        this.setData({ navigating: false });
      },
    });
  },
});
