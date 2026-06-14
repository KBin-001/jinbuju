import { getTodayCheckinStatus, submitCheckin } from "../../services/checkin";
import {
  CheckinFeeling,
  CheckinStatusData,
  SubmitCheckinResult,
  TodayTask,
} from "../../types/home";
import { clearTodayCheckinDraft, getTodayCheckinDraft } from "../../utils/checkin-draft";
import { CheckinServiceError } from "../../services/checkin";

type PageStatus = "loading" | "ready" | "success" | "error";

interface FeelingOption {
  value: CheckinFeeling;
  label: string;
}

const FEELING_OPTIONS: FeelingOption[] = [
  { value: "easy", label: "轻松" },
  { value: "normal", label: "还好" },
  { value: "challenging", label: "有挑战" },
  { value: "rewarding", label: "有收获" },
];

const ENCOURAGEMENT_TEXTS = [
  "每一步都算数。",
  "坚持本身就是进步。",
  "今天的行动已记录。",
  "继续按自己的节奏前进。",
];

function getEncouragement(): string {
  return ENCOURAGEMENT_TEXTS[Math.floor(Math.random() * ENCOURAGEMENT_TEXTS.length)];
}

function formatBusinessDateDisplay(dateValue: string): string {
  const parts = dateValue.split("-").map(Number);
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) {
    return dateValue;
  }
  return `${parts[1]} 月 ${parts[2]} 日`;
}

Page({
  data: {
    status: "loading" as PageStatus,
    errorMessage: "",

    goalTitle: "",
    businessDate: "",
    dateDisplay: "",
    mergedTasks: [] as TodayTask[],
    completedCount: 0,
    totalCount: 0,
    completionRate: 0,

    feeling: "normal" as CheckinFeeling,
    feelingOptions: FEELING_OPTIONS,
    note: "",
    noteRemaining: 100,
    submitting: false,

    resultData: null as SubmitCheckinResult | null,
    encouragementText: "",
  },

  onLoad() {
    const draft = getTodayCheckinDraft();
    if (!draft) {
      this.setData({
        status: "error",
        errorMessage: "打卡数据已失效，请返回今日页重新操作。",
      });
      return;
    }

    const localCompletedIds = new Set(draft.completedTaskIds);

    getTodayCheckinStatus()
      .then((serverData: CheckinStatusData) => {
        if (serverData.checkedInToday) {
          this.setData({
            status: "error",
            errorMessage: "今天已经打过卡了，明天继续加油。",
          });
          return;
        }

        const serverCompletedIds = new Set(
          serverData.tasks
            .filter((task: TodayTask) => task.completed)
            .map((task: TodayTask) => task.id),
        );

        const mergedTasks = serverData.tasks.map((task: TodayTask) => ({
          ...task,
          completed: task.completed || localCompletedIds.has(task.id),
        }));

        const completedCount = mergedTasks.filter(
          (task: TodayTask) => task.completed,
        ).length;
        const totalCount = mergedTasks.length;
        const completionRate =
          totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

        this.setData({
          status: "ready",
          goalTitle: draft.goalId ? "当前目标" : "",
          businessDate: draft.businessDate,
          dateDisplay: formatBusinessDateDisplay(draft.businessDate),
          mergedTasks,
          completedCount,
          totalCount,
          completionRate,
        });
      })
      .catch((error: Error) => {
        const serviceError = error as CheckinServiceError;
        this.setData({
          status: "error",
          errorMessage:
            serviceError.message || "打卡信息加载失败，请稍后重试。",
        });
      });
  },

  selectFeeling(event: { currentTarget: { dataset: { value?: string } } }) {
    const value = event.currentTarget.dataset.value as CheckinFeeling;
    if (FEELING_OPTIONS.some((option) => option.value === value)) {
      this.setData({ feeling: value });
    }
  },

  onNoteInput(event: { detail: { value?: string } }) {
    const raw = String(event.detail.value || "");
    const note = raw.slice(0, 100);
    this.setData({
      note,
      noteRemaining: 100 - note.length,
    });
  },

  doSubmitCheckin() {
    if (this.data.submitting) {
      return;
    }

    const draft = getTodayCheckinDraft();
    if (!draft) {
      this.setData({
        status: "error",
        errorMessage: "打卡数据已失效，请返回今日页重新操作。",
      });
      return;
    }

    const completedTaskIds = this.data.mergedTasks
      .filter((task: TodayTask) => task.completed)
      .map((task: TodayTask) => task.id);

    if (completedTaskIds.length === 0) {
      this.setData({
        status: "error",
        errorMessage: "请至少完成一项任务后再打卡。",
      });
      return;
    }

    this.setData({ submitting: true });

    submitCheckin({
      goalId: draft.goalId,
      planId: draft.planId,
      completedTaskIds,
      feeling: this.data.feeling,
      note: this.data.note.trim() || undefined,
    })
      .then((result: SubmitCheckinResult) => {
        clearTodayCheckinDraft();
        this.setData({
          status: "success",
          submitting: false,
          resultData: result,
          encouragementText: getEncouragement(),
        });
      })
      .catch((error: Error) => {
        clearTodayCheckinDraft();
        const serviceError = error as CheckinServiceError;
        const code = serviceError.code || "";

        if (code === "CHECKIN_ALREADY_EXISTS") {
          this.setData({
            status: "error",
            submitting: false,
            errorMessage: "今天已经打过卡了，明天继续加油。",
          });
          return;
        }

        this.setData({
          submitting: false,
          errorMessage: serviceError.message || "打卡提交失败，请稍后重试。",
        });
      });
  },

  goBackToToday() {
    if (this.data.status === "success") {
      wx.switchTab({ url: "/pages/index/index" });
    } else {
      wx.navigateBack({
        fail() {
          wx.switchTab({ url: "/pages/index/index" });
        },
      });
    }
  },

  retry() {
    this.onLoad();
  },
});
