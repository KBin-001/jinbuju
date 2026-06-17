import {
  confirmStagePlan,
  createStagePreview,
  createStageRequestId,
  getStagePreview,
  updateStagePreviewTask,
} from "../../services/stage";
import {
  AIStageAction,
  AIStageDay,
  CreateStagePreviewInput,
  StageGenerationResult,
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
      actionTypeLabel: action.actionType ? actionTypeLabels[action.actionType] || "" : "",
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
    const cached = getStagePreviewCache();
    if (this.data.isV2Create || cached?.input) {
      saveStagePreviewCache({
        input: cached?.input || toCreateInput(),
        result: preview,
        generatedAt: Date.now(),
      });
    }
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
    if (!this.data.isV2Create || this.data.savingTask) return;
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

  inputEditTitle(event: { detail: { value?: string } }) {
    this.setData({ editTitle: String(event.detail.value || "").slice(0, 40) });
  },

  inputEditDescription(event: { detail: { value?: string } }) {
    this.setData({ editDescription: String(event.detail.value || "").slice(0, 150) });
  },

  inputEditMinutes(event: { detail: { value?: string } }) {
    this.setData({ editMinutes: Number(event.detail.value || 0) });
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
    if (this.data.confirming || this.data.savingTask) return;
    wx.navigateBack({
      fail: () => wx.redirectTo({ url: "/pages/goal-create/index" }),
    });
  },

  goBack() {
    if (!this.data.confirming && !this.data.savingTask) wx.navigateBack();
  },

  confirmStage() {
    const preview = this.data.preview;
    if (!preview || this.data.confirming || this.data.savingTask) return;
    this.setData({ confirming: true });
    confirmStagePlan(preview.previewId, this.data.isV2Create ? preview.revision : undefined)
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
});
