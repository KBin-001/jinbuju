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
      value?: Difficulty | NextPreference;
    };
  };
}

interface InputEvent {
  detail: {
    value?: string;
  };
}

const DIFFICULTY_OPTIONS = [
  { value: "easy", label: "偏轻松", description: "多数行动都能从容完成" },
  { value: "suitable", label: "刚刚好", description: "有挑战，也能稳定推进" },
  { value: "hard", label: "偏吃力", description: "需要降低一点压力" },
];

const PREFERENCE_OPTIONS = [
  { value: "lighter", label: "轻一点", description: "减少负担，优先保持连续行动" },
  { value: "same", label: "保持节奏", description: "延续当前强度和方向" },
  { value: "stronger", label: "加强一点", description: "在可执行的前提下增加挑战" },
  { value: "change_focus", label: "调整重点", description: "告诉 AI 下一阶段更想推进什么" },
];

Page({
  data: {
    status: "loading" as PageStatus,
    stageId: "",
    review: null as StageReviewData | null,
    errorMessage: "",
    difficulty: "suitable" as Difficulty,
    nextPreference: "same" as NextPreference,
    focusAdjustment: "",
    difficultyOptions: DIFFICULTY_OPTIONS,
    preferenceOptions: PREFERENCE_OPTIONS,
    submitting: false,
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
        this.setData({ status: "ready", review });
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

  updateFocus(event: InputEvent) {
    this.setData({ focusAdjustment: String(event.detail.value || "").slice(0, 50) });
  },

  continuePreview() {
    const previewId = this.data.review?.previewId;
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
      (focusAdjustment.length < 2 || focusAdjustment.length > 50)
    ) {
      wx.showToast({ title: "请填写 2～50 个字的调整重点", icon: "none" });
      return;
    }

    this.setData({ submitting: true });
    submitStageReview(
      {
        stageId: this.data.stageId,
        difficulty: this.data.difficulty,
        nextPreference: this.data.nextPreference,
        focusAdjustment:
          this.data.nextPreference === "change_focus" ? focusAdjustment : undefined,
      },
      createStageRequestId(),
    )
      .then((result) => {
        wx.navigateTo({ url: `/pages/plan-preview/index?previewId=${result.previewId}` });
      })
      .catch((error: Error) => {
        wx.showModal({
          title: "下一阶段暂时无法生成",
          content: error.message || "请稍后重试。",
          showCancel: false,
        });
      })
      .then(() => this.setData({ submitting: false }));
  },
});
