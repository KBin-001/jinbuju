import {
  confirmStagePlan,
  createStageRequestId,
  generateStagePlan,
  getStagePreview,
} from "../../services/stage";
import {
  LongTermGoalDraft,
  StageGenerationResult,
  StagePlanGenerationInput,
} from "../../types/stage";
import {
  clearLongTermGoalDraft,
  clearStagePreviewCache,
  getLongTermGoalDraft,
  getStagePreviewCache,
  saveStagePreviewCache,
} from "../../utils/storage";

type PreviewStatus = "initial" | "generating" | "success" | "error" | "fallback";

function toInput(draft: LongTermGoalDraft): StagePlanGenerationInput {
  return {
    goalTitle: draft.title,
    category: draft.category as StagePlanGenerationInput["category"],
    desiredResult: draft.desiredResult,
    dailyMinutes: draft.dailyMinutes,
    targetDuration: draft.targetDuration,
    stageNumber: 1,
    durationDays: 7,
  };
}

Page({
  data: {
    status: "initial" as PreviewStatus,
    input: null as StagePlanGenerationInput | null,
    preview: null as StageGenerationResult | null,
    errorMessage: "",
    stageText: "正在理解你的长期目标",
    generating: false,
    confirming: false,
    previewId: "",
    isNextStage: false,
  },

  onLoad(options: { generate?: string; previewId?: string }) {
    if (options.previewId) {
      this.setData({ previewId: options.previewId, isNextStage: true });
      this.restoreServerPreview(options.previewId);
      return;
    }
    const cached = getStagePreviewCache();
    if (options.generate !== "1" && cached) {
      this.applyPreview(cached.input, cached.result);
      return;
    }
    const draft = getLongTermGoalDraft();
    if (!draft || !draft.category) {
      this.setData({ status: "error", errorMessage: "没有找到长期目标信息，请返回重新填写。" });
      return;
    }
    const input = toInput(draft);
    this.setData({ input });
    this.startGeneration(false, false);
  },

  restoreServerPreview(previewId: string) {
    this.setData({ status: "initial" });
    getStagePreview(previewId)
      .then((preview) => {
        const cached = getStagePreviewCache();
        this.applyPreview(cached?.input || null, preview);
      })
      .catch((error: Error) => {
        this.setData({ status: "error", errorMessage: error.message || "阶段预览加载失败。" });
      });
  },

  applyPreview(input: StagePlanGenerationInput | null, preview: StageGenerationResult) {
    this.setData({
      input,
      preview,
      status: preview.generatedBy === "template" ? "fallback" : "success",
      generating: false,
    });
  },

  startGeneration(forceFallback: boolean, regenerate: boolean) {
    const input = this.data.input;
    if (!input || this.data.generating) return;
    const requestId = createStageRequestId();
    this.setData({
      status: "generating",
      generating: true,
      errorMessage: "",
      stageText: forceFallback ? "正在准备基础行动方案" : "正在制定行动方案",
    });
    generateStagePlan(input, requestId, forceFallback, regenerate)
      .then((result) => {
        saveStagePreviewCache({ input, result, generatedAt: Date.now() });
        this.applyPreview(input, result);
      })
      .catch((error: Error) => {
        this.setData({
          status: "error",
          errorMessage: error.message || "行动阶段生成失败，请稍后重试。",
        });
      })
      .then(() => this.setData({ generating: false }));
  },

  retry() {
    if (this.data.previewId) {
      this.restoreServerPreview(this.data.previewId);
      return;
    }
    this.startGeneration(false, false);
  },

  useFallback() {
    if (!this.data.input) return;
    this.startGeneration(true, true);
  },

  regenerate() {
    if (!this.data.input) {
      wx.showToast({ title: "下一阶段请先返回复盘页调整", icon: "none" });
      return;
    }
    wx.showModal({
      title: "调整行动安排？",
      content: "会替换当前尚未确认的阶段预览，每个阶段最多调整两次。",
      confirmText: "重新制定",
      success: (result: { confirm: boolean }) => {
        if (result.confirm) this.startGeneration(false, true);
      },
    });
  },

  editGoal() {
    if (this.data.generating || this.data.confirming) return;
    wx.navigateBack({
      fail: () => wx.redirectTo({ url: "/pages/goal-create/index" }),
    });
  },

  goBack() {
    if (!this.data.generating && !this.data.confirming) wx.navigateBack();
  },

  confirmStage() {
    const preview = this.data.preview;
    if (!preview || this.data.confirming) return;
    this.setData({ confirming: true });
    confirmStagePlan(preview.previewId)
      .then(() => {
        clearLongTermGoalDraft();
        clearStagePreviewCache();
        wx.switchTab({
          url: "/pages/index/index",
          success: () =>
            setTimeout(
              () => wx.showToast({ title: "行动阶段已开始", icon: "success" }),
              200,
            ),
        });
      })
      .catch((error: Error) => {
        wx.showModal({
          title: "暂时无法开始",
          content: error.message || "请稍后重试。",
          showCancel: false,
        });
      })
      .then(() => this.setData({ confirming: false }));
  },
});
