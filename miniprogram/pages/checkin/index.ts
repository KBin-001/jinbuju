import { getTodayCheckinStatus, submitCheckin } from "../../services/checkin";
import {
  ACTION_STATUS_OPTIONS,
  ActionResultStatus,
  CheckinFeeling,
  CheckinOverallStatus,
  CheckinStatusData,
  SKIP_REASON_OPTIONS,
  SkipReason,
  SubmitCheckinResult,
  TaskActionResult,
  TodayTask,
} from "../../types/home";
import { clearTodayCheckinDraft, getTodayCheckinDraft } from "../../utils/checkin-draft";
import { CheckinServiceError } from "../../services/checkin";
import { getUiEventString, UiComponentEvent } from "../../utils/ui-event";

type PageStatus = "loading" | "ready" | "success" | "error";

interface FeelingOption {
  value: CheckinFeeling;
  emoji: string;
  label: string;
}

interface TaskItem {
  id: string;
  title: string;
  description: string;
  currentStatus: ActionResultStatus | "";
  statusOptions: typeof ACTION_STATUS_OPTIONS;
}

const FEELING_OPTIONS: FeelingOption[] = [
  { value: "rewarding", emoji: "😊", label: "充实" },
  { value: "easy", emoji: "😌", label: "平静" },
  { value: "challenging", emoji: "😓", label: "有点累" },
  { value: "normal", emoji: "🤔", label: "一般" },
];

const ENCOURAGEMENT_MAP: Record<CheckinOverallStatus, string[]> = {
  completed: ["今天的行动已经完成。", "每一步都算数。", "继续保持这样的节奏。"],
  partially_completed: ["每一步都算数。", "坚持本身就是进步。", "已经开始了，继续保持。"],
  skipped: ["记录下来，明天继续。", "记录也是一种坚持。", "休息一天没关系。"],
  rescheduled: ["调整节奏，按自己的来。", "灵活安排也是进步。", "按自己的步调走。"],
};

function getEncouragement(overallStatus: CheckinOverallStatus): string {
  const texts = ENCOURAGEMENT_MAP[overallStatus] || ENCOURAGEMENT_MAP.partially_completed;
  return texts[Math.floor(Math.random() * texts.length)];
}

function formatBusinessDateDisplay(dateValue: string): string {
  const parts = dateValue.split("-").map(Number);
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) {
    return dateValue;
  }
  return `${parts[1]} 月 ${parts[2]} 日`;
}

function computeOverallStatus(taskItems: TaskItem[]): CheckinOverallStatus | "" {
  const selected = taskItems.filter((t) => t.currentStatus !== "");
  if (selected.length === 0) return "";

  const statuses = selected.map((t) => t.currentStatus as ActionResultStatus);
  const completedCount = statuses.filter((s) => s === "completed").length;
  const partialCount = statuses.filter((s) => s === "partially_completed").length;
  const rescheduledCount = statuses.filter((s) => s === "rescheduled").length;

  if (completedCount === statuses.length) return "completed";
  if (completedCount + partialCount > 0) return "partially_completed";
  if (rescheduledCount === statuses.length) return "rescheduled";
  return "skipped";
}

function getSubmitButtonText(overallStatus: CheckinOverallStatus | ""): string {
  if (!overallStatus) return "记录今日行动";
  if (overallStatus === "completed" || overallStatus === "partially_completed") {
    return "记录今日行动";
  }
  return "记录今日情况";
}

Page({
  data: {
    status: "loading" as PageStatus,
    errorMessage: "",

    goalTitle: "",
    businessDate: "",
    dateDisplay: "",
    taskItems: [] as TaskItem[],
    completedCount: 0,
    totalCount: 0,
    completionRate: 0,

    overallStatus: "" as CheckinOverallStatus | "",
    showSkipReason: false,
    skipReason: "" as SkipReason | "",
    skipReasonOptions: SKIP_REASON_OPTIONS,
    canSubmit: false,
    submitButtonText: "记录今日行动",

    feeling: "normal" as CheckinFeeling,
    feelingBounce: "" as string,
    feelingOptions: FEELING_OPTIONS,
    note: "",
    noteRemaining: 100,
    submitting: false,

    resultData: null as SubmitCheckinResult | null,
    encouragementText: "",
    resultOverallStatus: "" as CheckinOverallStatus | "",
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

    getTodayCheckinStatus()
      .then((serverData: CheckinStatusData) => {
        if (serverData.planStatus === "paused") {
          this.setData({
            status: "error",
            errorMessage: "当前阶段已暂停，恢复后再继续记录行动。",
          });
          return;
        }
        if (serverData.checkedInToday) {
          this.setData({
            status: "error",
            errorMessage: "今天已经打过卡了，明天继续加油。",
          });
          return;
        }

        // Build taskItems: use server tasks, merge with draft completed state.
        const localCompletedIds = new Set(draft.completedTaskIds || []);
        // Build a map from server taskResults if available.
        const serverResultMap: Record<string, ActionResultStatus> = {};
        if (serverData.taskResults) {
          for (const r of serverData.taskResults) {
            serverResultMap[r.taskId] = r.status;
          }
        }

        const taskItems: TaskItem[] = serverData.tasks.map((task: TodayTask) => {
          let defaultStatus: ActionResultStatus | "" = "";
          // Use server resultStatus, then taskResults map, then draft completed.
          if (task.resultStatus) {
            defaultStatus = task.resultStatus;
          } else if (serverResultMap[task.id]) {
            defaultStatus = serverResultMap[task.id];
          } else if (task.completed || localCompletedIds.has(task.id)) {
            defaultStatus = "completed";
          }
          return {
            id: task.id,
            title: task.title,
            description: task.description || "",
            currentStatus: defaultStatus,
            statusOptions: ACTION_STATUS_OPTIONS,
          };
        });

        const overallStatus = computeOverallStatus(taskItems);
        const completedCount = taskItems.filter(
          (t) => t.currentStatus === "completed",
        ).length;
        const totalCount = taskItems.length;
        const completionRate =
          totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

        this.setData({
          status: "ready",
          goalTitle: draft.goalId ? "当前目标" : "",
          businessDate: draft.businessDate,
          dateDisplay: formatBusinessDateDisplay(draft.businessDate),
          taskItems,
          completedCount,
          totalCount,
          completionRate,
          overallStatus,
          showSkipReason: overallStatus !== "" && overallStatus !== "completed",
          canSubmit: overallStatus !== "",
          submitButtonText: getSubmitButtonText(overallStatus),
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

  selectTaskStatus(event: UiComponentEvent<unknown>) {
    const taskId = String(event.currentTarget?.dataset?.taskId || "");
    const statusValue = getUiEventString(event) as ActionResultStatus;

    if (!taskId || !ACTION_STATUS_OPTIONS.some((o) => o.value === statusValue)) {
      return;
    }

    const taskItems = this.data.taskItems.map((item) => {
      if (item.id !== taskId) return item;
      // Toggle: if already selected, deselect.
      const newStatus: ActionResultStatus | "" =
        item.currentStatus === statusValue ? "" : statusValue;
      return { ...item, currentStatus: newStatus };
    });

    const overallStatus = computeOverallStatus(taskItems);
    const completedCount = taskItems.filter(
      (t) => t.currentStatus === "completed",
    ).length;
    const totalCount = taskItems.length;
    const completionRate =
      totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    this.setData({
      taskItems,
      completedCount,
      completionRate,
      overallStatus,
      showSkipReason: overallStatus !== "" && overallStatus !== "completed",
      canSubmit: overallStatus !== "",
      submitButtonText: getSubmitButtonText(overallStatus),
    });
  },

  selectSkipReason(event: UiComponentEvent<unknown>) {
    const value = getUiEventString(event) as SkipReason;
    if (SKIP_REASON_OPTIONS.some((o) => o.value === value)) {
      // Toggle: if already selected, deselect.
      this.setData({
        skipReason: this.data.skipReason === value ? "" : value,
      });
    }
  },

  selectFeeling(event: UiComponentEvent<unknown> | WechatMiniprogram.TouchEvent) {
    let value: string;
    if ('currentTarget' in event && event.currentTarget?.dataset?.value) {
      value = String(event.currentTarget.dataset.value);
    } else {
      value = getUiEventString(event);
    }
    const feelingValue = value as CheckinFeeling;
    if (FEELING_OPTIONS.some((option) => option.value === feelingValue)) {
      this.setData({ feelingBounce: "" });
      setTimeout(() => {
        this.setData({ feeling: feelingValue, feelingBounce: feelingValue });
      }, 20);
    }
  },

  onNoteInput(event: UiComponentEvent<unknown>) {
    const raw = getUiEventString(event);
    const note = raw.slice(0, 100);
    this.setData({
      note,
      noteRemaining: 100 - note.length,
    });
  },

  doSubmitCheckin() {
    if (this.data.submitting || !this.data.canSubmit) {
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

    const overallStatus = this.data.overallStatus as CheckinOverallStatus;
    if (!overallStatus) {
      return;
    }

    // Build taskResults from taskItems (only those with a status selected).
    const taskResults: TaskActionResult[] = this.data.taskItems
      .filter((item) => item.currentStatus !== "")
      .map((item) => ({
        taskId: item.id,
        status: item.currentStatus as ActionResultStatus,
      }));

    if (taskResults.length === 0) {
      this.setData({
        errorMessage: "请至少为一项任务选择执行状态。",
      });
      return;
    }

    this.setData({ submitting: true });

    submitCheckin({
      goalId: draft.goalId,
      planId: draft.planId,
      taskResults,
      feeling: this.data.feeling,
      note: this.data.note.trim() || undefined,
      skipReason: (this.data.skipReason as SkipReason) || undefined,
      overallStatus,
    })
      .then((result: SubmitCheckinResult) => {
        clearTodayCheckinDraft();
        this.setData({
          status: "success",
          submitting: false,
          resultData: result,
          encouragementText: getEncouragement(result.overallStatus || overallStatus),
          resultOverallStatus: result.overallStatus || overallStatus,
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
