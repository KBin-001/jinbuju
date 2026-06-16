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

type PageStatus = "loading" | "success" | "error";

interface TaskToggleEvent {
  currentTarget: {
    dataset: {
      id?: string | number;
    };
  };
}

interface InputEvent {
  detail: {
    value?: string;
  };
}

interface TodayViewTask extends TodayTask {
  toggling: boolean;
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
  if (completedCount === 0) {
    return "完成行动后再记录";
  }
  if (completedCount < totalCount) {
    return "记录今日行动";
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
    checkinButtonText: getCheckinButtonText(0, 0, false, false),
    checkedInToday: false,
    todayRest: false,
    planPaused: false,
    planReviewing: false,
    planReadOnly: false,
    navigating: false,
    quickTitle: "",
    quickTimePeriod: "anytime" as TodayTask["timePeriod"],
    quickEstimatedMinutes: 30,
    quickTagName: "",
    showMoreSettings: false,
    creatingTask: false,
  },

  onShow() {
    this.loadToday();
  },

  loadToday() {
    if (this.data.status === "loading" && this.data.businessDate) {
      return;
    }

    this.setData({
      status: "loading",
      errorMessage: "",
      navigating: false,
    });

    getHomeData()
      .then((homeData: HomeData) => {
        this.applyHomeData(homeData);
      })
      .catch((error: Error) => {
        this.setData({
          status: "error",
          errorMessage: error.message || "今日数据暂时无法加载，请稍后重试。",
        });
      });
  },

  applyHomeData(homeData: HomeData) {
    const tasks = homeData.todayTasks.map((task) => ({ ...task, toggling: false }));
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
      planReadOnly: Boolean(goal?.planId) && goal?.planStatus !== "active",
    });
    this.updateProgress(tasks);
  },

  updateProgress(tasks: TodayViewTask[]) {
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
        this.setData({ tasks: unlockedTasks });
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

  onQuickTitleInput(event: InputEvent) {
    this.setData({ quickTitle: String(event.detail.value || "") });
  },

  onQuickTagInput(event: InputEvent) {
    this.setData({ quickTagName: String(event.detail.value || "") });
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
    if (!title) {
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
      taskDate: this.data.businessDate,
      timePeriod: this.data.quickTimePeriod,
      estimatedMinutes: this.data.quickEstimatedMinutes,
      tagName: this.data.quickTagName.trim(),
      repeatType: "none",
      priority: "normal",
      taskType: "required",
    })
      .then(() => {
        finishCreating();
        this.setData({
          quickTitle: "",
          quickTagName: "",
          quickTimePeriod: "anytime",
          quickEstimatedMinutes: 30,
          showMoreSettings: false,
        });
        wx.showToast({
          title: "已添加到今日",
          icon: "success",
          duration: 1200,
        });
        this.loadToday();
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
    if (this.data.status === "loading") {
      return;
    }
    this.loadToday();
  },

  goToCreateGoal() {
    if (this.data.navigating) {
      return;
    }
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
      this.data.completedCount === 0 ||
      !goal ||
      !goal.planId ||
      this.data.planReadOnly
    ) {
      return;
    }

    this.setData({ navigating: true });
    const draft: TodayCheckinDraft = {
      goalId: goal.id,
      planId: goal.planId,
      businessDate: this.data.businessDate,
      tasks: this.data.tasks.map(({ toggling, ...task }: TodayViewTask) => ({ ...task })),
      completedTaskIds: this.data.tasks
        .filter((task: TodayViewTask) => task.completed)
        .map((task: TodayViewTask) => task.id),
      completedCount: this.data.completedCount,
      totalCount: this.data.totalCount,
      preparedAt: Date.now(),
    };
    saveTodayCheckinDraft(draft);

    wx.navigateTo({
      url: "/pages/checkin/index",
      complete: () => {
        this.setData({ navigating: false });
      },
    });
  },
});
