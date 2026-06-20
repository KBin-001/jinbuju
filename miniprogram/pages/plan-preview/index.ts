import {
  confirmStagePlan,
  createStagePreview,
  createStageRequestId,
  getStagePreview,
  regenerateStagePreview,
  updateStagePreviewTask,
} from "../../services/stage";
import {
  AIStageAction,
  AIStageDay,
  CreateStagePreviewInput,
  StageFeedbackType,
  StageGenerationResult,
  STAGE_FEEDBACK_OPTIONS,
} from "../../types/stage";
import {
  clearLongTermGoalDraft,
  clearGoalAnalysisCache,
  getGoalAnalysisCache,
  clearStagePreviewCache,
  getLongTermGoalDraft,
  getStagePreviewCache,
  saveStagePreviewCache,
} from "../../utils/storage";
import { getUiEventString, UiComponentEvent } from "../../utils/ui-event";

type PreviewStatus = "loading" | "ready" | "error";

interface WeekView {
  number: number;
  expanded: boolean;
  days: AIStageDay[];
}

interface DatasetEvent {
  currentTarget: {
    dataset: {
      week?: number;
      slotId?: string;
      type?: string;
    };
  };
}

function toCreateInput(): CreateStagePreviewInput | null {
  const draft = getLongTermGoalDraft();
  if (!draft) return null;
  return {
    templateId: draft.templateId,
    customGoalTitle: draft.templateId === "custom" ? draft.customGoalTitle : undefined,
    currentLevel: draft.currentLevel,
    dailyMinutes: draft.dailyMinutes,
    weeklyDays: draft.weeklyDays,
    intensity: draft.intensity,
    durationDays: draft.durationDays,
    deadline: draft.deadline || undefined,
  };
}

function getCreateAnalysisId(): string {
  return getGoalAnalysisCache()?.analysisId || "";
}

function cleanText(text: string): string {
  // Strip Unicode noncharacters that cause display garbled characters
  return text.replace(/[\ufdd0-\ufdef\ufffe\uffff]/g, "");
}

function buildWeeks(days: AIStageDay[], current: WeekView[] = []): WeekView[] {
  const actionTypeLabels: Record<string, string> = {
    practice: "练习",
    learning: "学习",
    preparation: "准备",
    reflection: "复盘",
    recovery: "恢复",
    creation: "创作",
    execution: "执行",
  };
  const expanded = new Map(current.map((week) => [week.number, week.expanded]));
  const viewDays = days.map((day) => ({
    ...day,
    actions: day.actions.map((action) => ({
      ...action,
      title: cleanText(action.title),
      description: cleanText(action.description),
      actionTypeLabel: action.actionType ? actionTypeLabels[action.actionType] || "" : "",
      completionCriteria: action.completionCriteria ? cleanText(action.completionCriteria) : "",
      resourceText: action.requiredResources?.join("、") || "",
      safetyText: action.safetyNotes?.join("；") || "",
    })),
  }));
  const weeks: WeekView[] = [];
  for (let index = 0; index < viewDays.length; index += 7) {
    const number = Math.floor(index / 7) + 1;
    weeks.push({
      number,
      expanded: expanded.has(number) ? Boolean(expanded.get(number)) : number === 1,
      days: viewDays.slice(index, index + 7),
    });
  }
  return weeks;
}

const REGEN_POLL_INTERVAL = 3000;
const REGEN_MAX_POLLS = 30;

Page({
  data: {
    status: "loading" as PreviewStatus,
    preview: null as StageGenerationResult | null,
    weeks: [] as WeekView[],
    errorMessage: "",
    confirming: false,
    applying: false,
    optimizing: false,
    isNextStage: false,
    isV2Create: false,
    editingSlotId: "",
    editTitle: "",
    editDescription: "",
    editMinutes: 30,
    savingTask: false,
    createRequestId: "",
    optimizationPollCount: 0,
    showFeedbackPanel: false,
    selectedFeedbackTypes: [] as StageFeedbackType[],
    feedbackTypeSet: {} as Record<string, boolean>,
    hasOtherFeedback: false,
    feedbackNote: "",
    regenerating: false,
    regenerationError: "",
    feedbackOptions: STAGE_FEEDBACK_OPTIONS,
  },

  onLoad(options: { create?: string; previewId?: string }) {
    if (options.previewId) {
      const cached = getStagePreviewCache();
      const cachedInput = cached?.input as CreateStagePreviewInput | null | undefined;
      const isV2Create =
        cached?.result.previewId === options.previewId &&
        Boolean(cachedInput && "templateId" in cachedInput && !("goalTitle" in cachedInput));
      this.setData({ isNextStage: !isV2Create, isV2Create });
      this.restoreServerPreview(options.previewId);
      return;
    }
    if (options.create === "1") {
      // Prefer cached result from goal-create Step 3 generation
      const cached = getStagePreviewCache();
      const cachedInput = cached?.input as CreateStagePreviewInput | null;
      if (cached?.result?.previewId) {
        this.setData({
          isV2Create: Boolean(
            cachedInput && "templateId" in cachedInput && !("goalTitle" in cachedInput),
          ),
        });
        this.applyPreview(cached.result);
        return;
      }
      // Fallback: generate if no cached result
      this.createBasePreview();
      return;
    }
    const cached = getStagePreviewCache();
    if (cached) {
      const cachedInput = cached.input as CreateStagePreviewInput | null;
      this.setData({
        isV2Create: Boolean(
          cachedInput && "templateId" in cachedInput && !("goalTitle" in cachedInput),
        ),
      });
      this.applyPreview(cached.result);
      return;
    }
    this.setData({
      status: "error",
      errorMessage: "没有找到计划信息，请返回重新创建。",
    });
  },

  createBasePreview() {
    const input = toCreateInput();
    if (!input) {
      this.setData({ status: "error", errorMessage: "没有找到目标信息，请返回重新选择。" });
      return;
    }
    const requestId = this.data.createRequestId || createStageRequestId();
    this.setData({
      status: "loading",
      isV2Create: true,
      errorMessage: "",
      createRequestId: requestId,
    });
    const analysisId = getCreateAnalysisId();
    createStagePreview(analysisId ? null : input, requestId, analysisId || undefined)
      .then((result) => {
        if (result.generatedBy === "template") {
          console.warn("[plan-preview] stage preview used template fallback", {
            fallbackReason: result.fallbackReason || "",
            modelId: result.modelId || "",
            providerGroup: result.providerGroup || "",
            analysisIdSuffix: analysisId ? analysisId.slice(-8) : "",
          });
        }
        saveStagePreviewCache({ input, analysisId, result, generatedAt: Date.now() });
        this.applyPreview(result);
      })
      .catch((error: Error) => {
        this.setData({
          status: "error",
          errorMessage: error.message || "基础计划生成失败，请稍后重试。",
        });
      });
  },

  restoreServerPreview(previewId: string) {
    this.setData({ status: "loading", errorMessage: "" });
    getStagePreview(previewId)
      .then((preview) => {
        if (preview.generationStatus === "regenerating") {
          this.setData({ regenerating: true });
          this.applyPreview(preview);
          this.pollRegenerationStatus(preview.previewId, 0);
          return;
        }
        this.applyPreview(preview);
      })
      .catch((error: Error) => {
        this.setData({
          status: "error",
          errorMessage: error.message || "计划预览加载失败。",
        });
      });
  },

  applyPreview(preview: StageGenerationResult) {
    if (preview.generatedBy === "template") {
      console.warn("[plan-preview] stage preview used template fallback", {
        previewId: preview.previewId,
        stageNumber: preview.stageNumber,
        fallbackReason: preview.fallbackReason || "",
        modelId: preview.modelId || "",
        providerGroup: preview.providerGroup || "",
        isV2Create: this.data.isV2Create,
      });
    }
    const cached = getStagePreviewCache();
    if (this.data.isV2Create || cached?.input) {
      saveStagePreviewCache({
        input: cached?.input || toCreateInput(),
        result: preview,
        generatedAt: Date.now(),
      });
    }
    // Sanitize stage-level text
    if (preview.stagePlan?.stage) {
      const stage = preview.stagePlan.stage;
      stage.title = cleanText(stage.title || "");
      stage.summary = cleanText(stage.summary || "");
      stage.focus = cleanText(stage.focus || "");
    }
    const remaining = Math.max(
      0,
      (preview.maxRegenerationCount || 2) - (preview.regenerationCount || 0),
    );
    this.setData({
      status: "ready",
      preview,
      weeks: buildWeeks(preview.stagePlan.days, this.data.weeks),
      optimizing: preview.optimizationStatus === "processing",
      editingSlotId: "",
      savingTask: false,
      optimizationPollCount:
        preview.optimizationStatus === "processing"
          ? this.data.optimizationPollCount
          : 0,
      showFeedbackPanel: false,
      regenerating: preview.generationStatus === "regenerating",
      regenerationError: "",
    });
  },

  retry() {
    if (this.data.preview?.previewId) {
      this.restoreServerPreview(this.data.preview.previewId);
    } else if (this.data.isV2Create) {
      this.createBasePreview();
    }
  },

  retryOptimization() {
    wx.showToast({ title: "重新生成会在后续版本开放", icon: "none" });
  },

  recoverOptimization() {
    this.retryOptimization();
  },

  toggleWeek(event: DatasetEvent) {
    const weekNumber = Number(event.currentTarget.dataset.week);
    this.setData({
      weeks: this.data.weeks.map((week: WeekView) =>
        week.number === weekNumber ? { ...week, expanded: !week.expanded } : week,
      ),
    });
  },

  beginEdit(event: DatasetEvent) {
    if (!this.data.isV2Create || this.data.savingTask || this.data.regenerating) return;
    const slotId = String(event.currentTarget.dataset.slotId || "");
    let action: AIStageAction | null = null;
    this.data.preview?.stagePlan.days.forEach((day: AIStageDay) => {
      if (day.actions[0]?.slotId === slotId) action = day.actions[0];
    });
    if (!action) return;
    this.setData({
      editingSlotId: slotId,
      editTitle: action.title,
      editDescription: action.description,
      editMinutes: action.estimatedMinutes,
    });
  },

  inputEditTitle(event: UiComponentEvent<unknown>) {
    this.setData({ editTitle: getUiEventString(event).slice(0, 40) });
  },

  inputEditDescription(event: UiComponentEvent<unknown>) {
    this.setData({ editDescription: getUiEventString(event).slice(0, 150) });
  },

  inputEditMinutes(event: UiComponentEvent<unknown>) {
    this.setData({ editMinutes: Number(getUiEventString(event) || 0) });
  },

  cancelEdit() {
    if (!this.data.savingTask) this.setData({ editingSlotId: "" });
  },

  saveTask() {
    const preview = this.data.preview;
    const title = this.data.editTitle.trim();
    const description = this.data.editDescription.trim();
    const minutes = Number(this.data.editMinutes);
    if (!preview || !this.data.editingSlotId || this.data.savingTask) return;
    if (title.length < 2 || description.length < 2 || !Number.isInteger(minutes) || minutes < 5) {
      wx.showToast({ title: "请完整填写任务内容和时间", icon: "none" });
      return;
    }
    this.setData({ savingTask: true });
    updateStagePreviewTask({
      previewId: preview.previewId,
      revision: preview.revision,
      mutationId: `edit_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      slotId: this.data.editingSlotId,
      task: { title, description, estimatedMinutes: minutes },
    })
      .then((result) => this.applyPreview(result))
      .catch((error: Error & { code?: string }) => {
        this.setData({ savingTask: false });
        wx.showModal({
          title: error.code === "STAGE_PREVIEW_CONFLICT" ? "计划已更新" : "任务保存失败",
          content: error.message || "请稍后重试。",
          showCancel: false,
          success: () => {
            if (error.code === "STAGE_PREVIEW_CONFLICT") {
              this.restoreServerPreview(preview.previewId);
            }
          },
        });
      });
  },

  applyOptimization() {
    this.retryOptimization();
  },

  editGoal() {
    if (this.data.confirming || this.data.savingTask || this.data.regenerating) return;
    const previousStageId = this.data.preview?.previousStageId || "";
    if (this.data.isNextStage && previousStageId) {
      wx.redirectTo({ url: `/pages/stage-review/index?stageId=${previousStageId}` });
      return;
    }
    wx.navigateBack({
      fail: () => wx.redirectTo({ url: "/pages/goal-create/index" }),
    });
  },

  goBack() {
    if (!this.data.confirming && !this.data.savingTask && !this.data.regenerating) {
      wx.navigateBack();
    }
  },

  confirmStage() {
    const preview = this.data.preview;
    if (!preview || this.data.confirming || this.data.savingTask || this.data.regenerating) return;
    this.setData({ confirming: true });
    confirmStagePlan(
      preview.previewId,
      this.data.isV2Create ? preview.revision : undefined,
      this.data.isV2Create ? preview.currentVersion : undefined,
    )
      .then(() => {
        clearLongTermGoalDraft();
        clearGoalAnalysisCache();
        clearStagePreviewCache();
        wx.switchTab({
          url: "/pages/index/index",
          success: () =>
            setTimeout(() => wx.showToast({ title: "行动计划已开始", icon: "success" }), 200),
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

  // ─── Feedback & Regeneration ────────────────────────────────────────

  openFeedbackPanel() {
    if (this.data.regenerating || this.data.confirming) return;
    const preview = this.data.preview;
    if (!preview) return;
    const remaining = Math.max(
      0,
      (preview.maxRegenerationCount || 2) - (preview.regenerationCount || 0),
    );
    if (remaining <= 0) {
      wx.showToast({ title: "重新生成次数已用完", icon: "none" });
      return;
    }
    this.setData({
      showFeedbackPanel: true,
      selectedFeedbackTypes: [],
      feedbackTypeSet: {},
      hasOtherFeedback: false,
      feedbackNote: "",
      regenerationError: "",
    });
  },

  closeFeedbackPanel() {
    if (!this.data.regenerating) {
      this.setData({ showFeedbackPanel: false });
    }
  },

  toggleFeedbackType(event: DatasetEvent) {
    const type = event.currentTarget.dataset.type as StageFeedbackType;
    if (!type) return;
    const current = this.data.selectedFeedbackTypes;
    const index = current.indexOf(type);
    let newTypes: StageFeedbackType[];
    if (index >= 0) {
      newTypes = current.filter((t) => t !== type);
    } else if (current.length < 3) {
      newTypes = [...current, type];
    } else {
      wx.showToast({ title: "最多选择 3 个问题类型", icon: "none" });
      return;
    }
    const newSet: Record<string, boolean> = {};
    newTypes.forEach((t) => { newSet[t] = true; });
    this.setData({
      selectedFeedbackTypes: newTypes,
      feedbackTypeSet: newSet,
      hasOtherFeedback: newTypes.indexOf("other") >= 0,
    });
  },

  inputFeedbackNote(event: UiComponentEvent<unknown>) {
    this.setData({ feedbackNote: getUiEventString(event).slice(0, 200) });
  },

  submitRegeneration() {
    const preview = this.data.preview;
    if (!preview || this.data.regenerating) return;
    const types = this.data.selectedFeedbackTypes;
    if (types.length === 0) {
      wx.showToast({ title: "请至少选择一个问题类型", icon: "none" });
      return;
    }
    const note = this.data.feedbackNote.trim();
    this.setData({ regenerating: true, regenerationError: "" });

    regenerateStagePreview({
      previewId: preview.previewId,
      feedbackTypes: types,
      feedbackNote: note || undefined,
      requestId: createStageRequestId(),
    })
      .then((result) => {
        this.applyPreview(result);
        wx.showToast({ title: "方案已重新生成", icon: "success" });
      })
      .catch((error: Error & { code?: string }) => {
        const code = error.code || "";
        let message = error.message || "暂时没有生成新的方案，当前方案已经保留。";
        if (code === "STAGE_REGENERATION_LIMIT_REACHED") {
          message = "重新生成次数已用完。";
        } else if (code === "PREVIEW_REGENERATION_IN_PROGRESS") {
          message = "AI 正在重新生成方案，请稍后。";
        }
        this.setData({
          regenerating: false,
          regenerationError: message,
        });
      });
  },

  pollRegenerationStatus(previewId: string, attempt: number) {
    if (attempt >= REGEN_MAX_POLLS) {
      this.setData({ regenerating: false });
      return;
    }
    setTimeout(() => {
      getStagePreview(previewId)
        .then((preview) => {
          if (preview.generationStatus === "regenerating") {
            this.pollRegenerationStatus(previewId, attempt + 1);
            return;
          }
          this.applyPreview(preview);
          if (preview.generationStatus === "failed") {
            this.setData({
              regenerationError: "暂时没有生成新的方案，当前方案已经保留。",
            });
          }
        })
        .catch(() => {
          this.setData({ regenerating: false });
        });
    }, REGEN_POLL_INTERVAL);
  },
});
