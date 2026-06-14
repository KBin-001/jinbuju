import { getHomeData } from "../../services/home";
import { GoalSummary, HomeData, TodayCheckinDraft, TodayTask, UserProgress } from "../../types/home";
import { saveTodayCheckinDraft } from "../../utils/checkin-draft";

type PageStatus = "loading" | "success" | "error";

interface TaskToggleEvent {
  currentTarget: {
    dataset: {
      id?: string;
    };
  };
}

interface TodayViewTask extends TodayTask {
  toggling: boolean;
}

const EMPTY_USER: UserProgress = {
  nickname: "",
  streakDays: 0,
};

const CATEGORY_LABELS: Record<string, string> = {
  exam: "考试备考",
  skill: "技能学习",
  career: "求职提升",
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
): string {
  if (checkedInToday) {
    return "今日已打卡";
  }
  if (completedCount === 0) {
    return "完成任务后再打卡";
  }
  if (completedCount < totalCount) {
    return "去完成今日打卡";
  }
  return "完成今日打卡";
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
    completedCount: 0,
    totalCount: 0,
    completionRate: 0,
    progressText: getProgressText(0),
    checkinButtonText: getCheckinButtonText(0, 0, false),
    checkedInToday: false,
    navigating: false,
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
    this.setData({
      status: "success",
      businessDate: homeData.businessDate,
      dateTitle: formatDateTitle(homeData.businessDate),
      weekday: formatWeekday(homeData.businessDate),
      user: homeData.user || EMPTY_USER,
      goal,
      categoryLabel: goal ? CATEGORY_LABELS[goal.category] || "成长目标" : "",
      tasks,
      navigating: false,
      checkedInToday,
    });
    this.updateProgress(tasks);
  },

  updateProgress(tasks: TodayViewTask[]) {
    const totalCount = tasks.length;
    const completedCount = tasks.filter((task) => task.completed).length;
    const completionRate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
    this.setData({
      tasks,
      completedCount,
      totalCount,
      completionRate,
      progressText: getProgressText(completionRate),
      checkinButtonText: getCheckinButtonText(
        completedCount,
        totalCount,
        this.data.checkedInToday,
      ),
    });
  },

  toggleTask(event: TaskToggleEvent) {
    const taskId = String(event.currentTarget.dataset.id || "");
    const currentTask = this.data.tasks.find((task: TodayViewTask) => task.id === taskId);
    if (!taskId || !currentTask || currentTask.toggling) {
      return;
    }

    const tasks = this.data.tasks.map((task: TodayViewTask) =>
      task.id === taskId
        ? { ...task, completed: !task.completed, toggling: true }
        : task,
    );
    this.updateProgress(tasks);

    setTimeout(() => {
      const unlockedTasks = this.data.tasks.map((task: TodayViewTask) =>
        task.id === taskId ? { ...task, toggling: false } : task,
      );
      this.setData({ tasks: unlockedTasks });
    }, 350);
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
      !goal.planId
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
