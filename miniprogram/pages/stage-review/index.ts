import { withAppTheme } from "../../services/theme";
import {
  createStageRequestId,
  getStageReview,
  submitStageReview,
} from "../../services/stage";
import { StageReviewData, StageReviewInput } from "../../types/stage";

type PageStatus = "loading" | "ready" | "error";
type Difficulty = StageReviewInput["difficulty"];
type NextPreference = StageReviewInput["nextPreference"];

interface OptionEvent {
  currentTarget: {
    dataset: {
      value?: Difficulty | NextPreference | number;
    };
  };
}

interface InputEvent {
  detail: {
    value?: string;
  };
}

const ACTION_TYPE_LABELS: Record<string, string> = {
  practice: "实践练习",
  learning: "学习认知",
  preparation: "准备工作",
  reflection: "反思总结",
  recovery: "恢复调整",
  creation: "创作产出",
  execution: "执行落地",
};

const SKIP_REASON_LABELS: Record<string, string> = {
  not_enough_time: "时间不够",
  too_difficult: "任务太难",
  insufficient_resources: "资源不足",
  not_feeling_well: "状态不适",
  unexpected_event: "临时有事",
  task_not_realistic: "不符合实际",
  other: "其他",
};

const DIFFICULTY_OPTIONS = [
  { value: "easy", label: "偏轻松", description: "多数行动都能从容完成" },
  { value: "suitable", label: "刚刚好", description: "有挑战，也能稳定推进" },
  { value: "hard", label: "偏吃力", description: "需要降低一点压力" },
];

const PREFERENCE_OPTIONS = [
  { value: "lighter", label: "轻一点", description: "减少负担，优先保持连续行动" },
  { value: "same", label: "保持节奏", description: "延续当前强度和方向" },
  { value: "stronger", label: "加强一点", description: "在可执行的前提下增加挑战" },
  { value: "change_focus", label: "调整重点", description: "告诉 AI 新计划更想推进什么" },
];

const DURATION_OPTIONS = [7, 14, 21, 30];

Page(withAppTheme({
  data: {
    status: "loading" as PageStatus,
    stageId: "",
    review: null as StageReviewData | null,
    errorMessage: "",
    difficulty: "suitable" as Difficulty,
    nextPreference: "same" as NextPreference,
    planDurationDays: 14,
    durationOptions: DURATION_OPTIONS,
    focusAdjustment: "",
    difficultyOptions: DIFFICULTY_OPTIONS,
    preferenceOptions: PREFERENCE_OPTIONS,
    submitting: false,
    justReviewed: false,
    generatedPreviewId: "",
    submitErrorCode: "",
    submitErrorMessage: "",
    actionTypeRates: [] as { type: string; label: string; rate: number }[],
    skipReasonList: [] as { reason: string; label: string; count: number }[],
    timeDeviation: 0,
    hasDetailedSummary: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    const stageId = String(options.stageId || "");
    if (!stageId) {
      this.setData({
        status: "error",
        errorMessage: "缺少阶段信息，请返回进度页重试。",
      });
      return;
    }
    this.setData({ stageId });
    this.loadReview();
  },

  loadReview() {
    if (!this.data.stageId) return;
    this.setData({ status: "loading", errorMessage: "" });
    getStageReview(this.data.stageId)
      .then((review) => {
        const summary = review.executionSummary;

        const actionTypeRates = summary?.actionTypeCompletionRates
          ? Object.entries(summary.actionTypeCompletionRates).map(([type, rate]) => ({
              type,
              label: ACTION_TYPE_LABELS[type] || type,
              rate,
            }))
          : [];

        const skipReasonList = summary?.skipReasons
          ? Object.entries(summary.skipReasons)
              .sort((a, b) => b[1] - a[1])
              .map(([reason, count]) => ({
                reason,
                label: SKIP_REASON_LABELS[reason] || reason,
                count,
              }))
          : [];

        const timeDeviation = summary
          ? summary.averageDailyMinutes - summary.plannedDailyMinutes
          : 0;

        this.setData({
          status: "ready",
          review,
          actionTypeRates,
          skipReasonList,
          timeDeviation,
          hasDetailedSummary: Boolean(summary && summary.totalActionCount > 0),
        });
      })
      .catch((error: Error) => {
        this.setData({
          status: "error",
          errorMessage: error.message || "阶段复盘暂时无法加载。",
        });
      });
  },

  retry() {
    if (!this.data.submitting) this.loadReview();
  },

  chooseDifficulty(event: OptionEvent) {
    if (this.data.submitting) return;
    const value = event.currentTarget.dataset.value as Difficulty | undefined;
    if (value) this.setData({ difficulty: value });
  },

  choosePreference(event: OptionEvent) {
    if (this.data.submitting) return;
    const value = event.currentTarget.dataset.value as NextPreference | undefined;
    if (value) this.setData({ nextPreference: value });
  },

  chooseDuration(event: OptionEvent) {
    if (this.data.submitting) return;
    const value = Number(event.currentTarget.dataset.value || 0);
    if (DURATION_OPTIONS.includes(value)) this.setData({ planDurationDays: value });
  },

  updateFocus(event: InputEvent) {
    this.setData({ focusAdjustment: String(event.detail.value || "").slice(0, 200) });
  },

  continuePreview() {
    const previewId = this.data.generatedPreviewId || this.data.review?.previewId;
    if (previewId && !this.data.submitting) {
      wx.navigateTo({ url: `/pages/plan-preview/index?previewId=${previewId}` });
    }
  },

  submit() {
    const review = this.data.review;
    if (!review || this.data.submitting) return;
    if (!review.canReview) {
      wx.showToast({ title: "当前阶段结束后再来复盘", icon: "none" });
      return;
    }
    const focusAdjustment = this.data.focusAdjustment.trim();
    if (
      this.data.nextPreference === "change_focus" &&
      (focusAdjustment.length < 2 || focusAdjustment.length > 200)
    ) {
      wx.showToast({ title: "请填写 2～200 个字的调整重点", icon: "none" });
      return;
    }

    this.setData({ submitting: true, submitErrorCode: "", submitErrorMessage: "" });
    submitStageReview(
      {
        stageId: this.data.stageId,
        difficulty: this.data.difficulty,
        nextPreference: this.data.nextPreference,
        focusAdjustment:
          this.data.nextPreference === "change_focus" ? focusAdjustment : undefined,
        planDurationDays: this.data.planDurationDays,
      },
      createStageRequestId(),
    )
      .then((result) => {
        this.setData({
          submitting: false,
          justReviewed: true,
          generatedPreviewId: result.previewId,
        });
      })
      .catch((error: Error & { code?: string }) => {
        this.setData({
          submitting: false,
          submitErrorCode: error.code || "INTERNAL_ERROR",
          submitErrorMessage: error.message || "新计划暂时无法生成",
        });
        wx.showModal({
          title: "新计划暂时无法生成",
          content: error.message || "请稍后重试。",
          showCancel: false,
        });
      });
  },
}));
