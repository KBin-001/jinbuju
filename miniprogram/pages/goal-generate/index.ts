import {
  analyzeGoal,
  createAnalysisRequestId,
  createStagePreview,
  createStageRequestId,
  submitGoalClarification,
} from "../../services/stage";
import {
  ClarificationAnswer,
  ClarificationQuestion,
  FlowState,
  GenerationPhase,
  GoalAnalysisResult,
} from "../../types/stage";
import {
  clearStagePreviewCache,
  getClarificationAnswers,
  getGoalAnalysisCache,
  getLongTermGoalDraft,
  saveClarificationAnswers,
  saveGoalAnalysisCache,
  getGenerationState,
  saveGenerationState,
  clearGenerationState,
  saveGenerationProgress,
  clearGenerationProgress,
  getStagePreviewCache,
  saveStagePreviewCache,
} from "../../utils/storage";
import { getUiEventString, UiComponentEvent } from "../../utils/ui-event";

interface DatasetEvent {
  currentTarget: {
    dataset: {
      value?: string | number;
      questionId?: string;
    };
  };
}

interface ClarificationOptionView {
  value: string;
  selected: boolean;
}

interface ClarificationQuestionView extends ClarificationQuestion {
  optionViews: ClarificationOptionView[];
  answerValue: ClarificationAnswer["value"] | "";
}

const PHASE_MESSAGES: Record<GenerationPhase, string> = {
  understanding: "正在理解你的目标",
  organizing: "正在整理行动重点",
  generating: "正在生成第一阶段",
  validating: "正在检查方案是否可执行",
  completed: "方案已生成",
  error: "生成遇到问题",
};

const LONG_WAIT_THRESHOLD = 10000;
const LONG_WAIT_MESSAGE_15S = "生成时间较长，请耐心等待";
const MAX_RETRY_COUNT = 2;
const PHASE_ORGANIZING_DELAY = 8000;
const PHASE_VALIDATING_DELAY = 30000;
const COMPLETED_NAVIGATE_DELAY = 800;

function buildClarificationQuestions(
  analysis: GoalAnalysisResult | null,
  answers: Record<string, ClarificationAnswer["value"]>,
): ClarificationQuestionView[] {
  if (!analysis) return [];
  return analysis.questions.map((question) => {
    const answerValue = answers[question.id] ?? "";
    const selectedValues = Array.isArray(answerValue) ? answerValue : [answerValue];
    return {
      ...question,
      answerValue,
      optionViews: (question.options || []).map((option) => ({
        value: option,
        selected: selectedValues.includes(option),
      })),
    };
  });
}

function buildAnalyzeInput(draft: ReturnType<typeof getLongTermGoalDraft>) {
  if (!draft) return { title: "成长目标", dailyMinutes: 30, durationDays: 7, currentLevel: "zero" };
  const TEMPLATE_LABELS: Record<string, string> = {
    cet: "英语四六级", teacher_exam: "教师资格证", postgraduate_exam: "考研",
    civil_service_exam: "考公", ai_learning: "AI学习",
    cet4: "英语四级", python: "Python 入门", ai_tools: "AI 工具学习", video_editing: "视频剪辑",
    resume: "完善简历", interview: "面试准备", custom: "",
  };
  return {
    title: draft.templateId === "custom"
      ? (draft.customGoalTitle || "").trim() || "成长目标"
      : TEMPLATE_LABELS[draft.templateId] || "成长目标",
    dailyMinutes: draft.dailyMinutes,
    durationDays: draft.durationDays,
    currentLevel: draft.currentLevel,
    intensity: draft.intensity,
    deadline: draft.deadline || undefined,
  };
}

function buildCreateInput(draft: ReturnType<typeof getLongTermGoalDraft>) {
  if (!draft) return null;
  return {
    templateId: draft.templateId,
    customGoalTitle: draft.templateId === "custom" ? draft.customGoalTitle : undefined,
    currentLevel: draft.currentLevel,
    dailyMinutes: draft.dailyMinutes,
    weeklyDays: draft.weeklyDays,
    intensity: draft.intensity,
    durationDays: draft.durationDays,
    planDurationDays: draft.planDurationDays || draft.durationDays,
    deadline: draft.deadline || undefined,
  };
}

Page({
  data: {
    flowState: "analyzing" as FlowState,
    generationPhase: "idle" as GenerationPhase | "idle",
    generationMessage: "",
    showLongWaitHint: false,
    longWaitMessage: "",
    showClarification: false,
    analysis: null as GoalAnalysisResult | null,
    answers: {} as Record<string, ClarificationAnswer["value"]>,
    clarificationQuestions: [] as ClarificationQuestionView[],
    pageError: "",
    submitting: false,
    retryCount: 0,
  },

  _draft: null as ReturnType<typeof getLongTermGoalDraft>,
  _phaseTimers: [] as number[],
  _longWaitTimer: 0,
  _longWaitTimer15: 0,
  _navigateTimer: 0,
  _lastSubmitTime: 0,

  onLoad() {
    this._draft = getLongTermGoalDraft();

    // Check for interrupted generation
    const genState = getGenerationState();
    if (genState) {
      if (genState.flowState === "completed") {
        const cached = getStagePreviewCache();
        if (cached) {
          clearGenerationState();
          clearGenerationProgress();
          wx.redirectTo({ url: "/pages/plan-preview/index?create=1" });
          return;
        }
        clearGenerationState();
        clearGenerationProgress();
      } else if (genState.flowState === "analyzing" || genState.flowState === "generating") {
        clearGenerationState();
        clearGenerationProgress();
        this.setData({
          flowState: "error",
          generationPhase: "error",
          generationMessage: "上次生成中断了，请重新生成",
          pageError: "上次方案生成被中断，请重新尝试。",
        });
        return;
      } else if (genState.flowState === "error") {
        clearGenerationState();
        clearGenerationProgress();
      }
    }

    // Check cached analysis
    const analysis = getGoalAnalysisCache();
    const answers = getClarificationAnswers();
    if (analysis && analysis.needsClarification) {
      this.setData({
        analysis,
        answers,
        showClarification: true,
        flowState: "analyzing",
        clarificationQuestions: buildClarificationQuestions(analysis, answers),
      });
      return;
    }

    // Start fresh analysis
    this.startAnalysis();
  },

  onUnload() {
    this.clearPhaseTimers();
  },

  onHide() {
    if (this.data.flowState === "analyzing" || this.data.flowState === "generating") {
      saveGenerationState({
        flowState: this.data.flowState,
        analysisId: this.data.analysis?.analysisId,
        input: this._draft ? buildCreateInput(this._draft) : undefined,
      });
      saveGenerationProgress({
        phase: this.data.generationPhase as GenerationPhase,
        phaseStartedAt: Date.now(),
        totalStartedAt: Date.now(),
        retryCount: this.data.retryCount,
      });
    }
  },

  // ─── Phase management ─────────────────────────────────────────────

  clearPhaseTimers() {
    this._phaseTimers.forEach((id) => clearTimeout(id));
    this._phaseTimers = [];
    clearTimeout(this._longWaitTimer);
    clearTimeout(this._longWaitTimer15);
    clearTimeout(this._navigateTimer);
    this._longWaitTimer = 0;
    this._longWaitTimer15 = 0;
    this._navigateTimer = 0;
  },

  setPhase(phase: GenerationPhase) {
    this.clearPhaseTimers();
    const now = Date.now();
    this.setData({
      generationPhase: phase,
      generationMessage: PHASE_MESSAGES[phase],
      showLongWaitHint: false,
      longWaitMessage: "",
    });
    saveGenerationProgress({
      phase,
      phaseStartedAt: now,
      totalStartedAt: now,
      retryCount: this.data.retryCount,
    });
    if (phase === "understanding" || phase === "organizing" || phase === "generating" || phase === "validating") {
      this._longWaitTimer = setTimeout(() => {
        this.setData({ showLongWaitHint: true, longWaitMessage: "AI 正在认真思考，通常还需要一些时间" });
      }, LONG_WAIT_THRESHOLD) as unknown as number;
      this._longWaitTimer15 = setTimeout(() => {
        this.setData({ longWaitMessage: LONG_WAIT_MESSAGE_15S });
      }, 15000) as unknown as number;
    }
  },

  // ─── Analysis ─────────────────────────────────────────────────────

  startAnalysis() {
    if (!this._draft) {
      this.setData({ flowState: "error", pageError: "目标数据丢失，请返回重新创建。" });
      return;
    }

    this.setData({ flowState: "analyzing", submitting: true });
    clearStagePreviewCache();

    const input = buildAnalyzeInput(this._draft);
    analyzeGoal(input, createAnalysisRequestId())
      .then((analysis) => {
        if (analysis.status === "analyzing") {
          wx.showToast({ title: "正在理解你的目标，请稍后重试", icon: "none" });
          this.setData({ submitting: false });
          return;
        }
        saveGoalAnalysisCache(analysis);
        this.setData({
          analysis,
          submitting: false,
          showClarification: analysis.needsClarification,
          clarificationQuestions: buildClarificationQuestions(analysis, this.data.answers),
        }, () => {
          if (!analysis.needsClarification) this.startGeneration(analysis);
        });
      })
      .catch((error: Error) => {
        this.setData({ submitting: false });
        this.handleGenerationError(error, "analyze");
      });
  },

  // ─── Generation ───────────────────────────────────────────────────

  startGeneration(analysis?: GoalAnalysisResult) {
    if (this.data.submitting && this.data.flowState !== "idle") return;
    if (Date.now() - this._lastSubmitTime < 2000) return;
    this._lastSubmitTime = Date.now();

    const currentAnalysis = analysis || this.data.analysis;
    const input = this._draft ? buildCreateInput(this._draft) : null;
    if (!input) {
      this.setData({ flowState: "error", pageError: "目标数据丢失，请返回重新创建。" });
      return;
    }
    const stageRequestId = createStageRequestId();

    this.setData({
      flowState: "generating",
      submitting: true,
      pageError: "",
      showClarification: false,
    });

    saveGenerationState({
      flowState: "generating",
      analysisId: currentAnalysis?.analysisId,
      input,
    });

    if (currentAnalysis && !currentAnalysis.needsClarification) {
      this.beginStagePreviewGeneration(currentAnalysis.analysisId, input, stageRequestId);
      return;
    }

    // Need to analyze first
    this.setPhase("understanding");
    const organizingTimer = setTimeout(() => {
      this.setPhase("organizing");
    }, PHASE_ORGANIZING_DELAY) as unknown as number;
    this._phaseTimers.push(organizingTimer);

    analyzeGoal(buildAnalyzeInput(this._draft), createAnalysisRequestId())
      .then((newAnalysis) => {
        this.clearPhaseTimers();
        if (newAnalysis.status === "analyzing") {
          this.setData({ flowState: "error", pageError: "目标分析时间较长，请稍后重试。", submitting: false });
          return;
        }
        saveGoalAnalysisCache(newAnalysis);
        this.setData({ analysis: newAnalysis });

        if (newAnalysis.needsClarification) {
          this.setData({
            flowState: "analyzing",
            generationPhase: "idle",
            generationMessage: "",
            showClarification: true,
            submitting: false,
            clarificationQuestions: buildClarificationQuestions(newAnalysis, this.data.answers),
          });
          clearGenerationState();
          clearGenerationProgress();
          return;
        }

        this.setData({ flowState: "generating" });
        saveGenerationState({
          flowState: "generating",
          analysisId: newAnalysis.analysisId,
          input,
        });
        this.beginStagePreviewGeneration(newAnalysis.analysisId, input, stageRequestId);
      })
      .catch((error: Error) => {
        this.clearPhaseTimers();
        this.handleGenerationError(error, "analyze");
      });
  },

  beginStagePreviewGeneration(
    analysisId: string,
    input: NonNullable<ReturnType<typeof buildCreateInput>>,
    stageRequestId: string,
  ) {
    this.setPhase("generating");
    const validatingTimer = setTimeout(() => {
      this.setPhase("validating");
    }, PHASE_VALIDATING_DELAY) as unknown as number;
    this._phaseTimers.push(validatingTimer);

    createStagePreview(null, stageRequestId, analysisId || undefined)
      .then((result) => {
        this.clearPhaseTimers();
        this.setPhase("completed");

        saveStagePreviewCache({
          input,
          analysisId,
          result,
          generatedAt: Date.now(),
        });
        saveGenerationState({
          flowState: "completed",
          analysisId,
          previewId: result.previewId,
          input,
        });

        this.setData({ flowState: "completed", submitting: false });

        this._navigateTimer = setTimeout(() => {
          clearGenerationState();
          clearGenerationProgress();
          wx.redirectTo({
            url: "/pages/plan-preview/index?create=1",
          });
        }, COMPLETED_NAVIGATE_DELAY) as unknown as number;
      })
      .catch((error: Error) => {
        this.clearPhaseTimers();
        this.handleGenerationError(error, "generate");
      });
  },

  handleGenerationError(error: Error, stage: "analyze" | "generate") {
    const serviceError = error as Error & { code?: string };
    const code = serviceError.code || "";
    let message = error.message || "请稍后重试。";

    if (code === "REQUEST_TIMEOUT") {
      message = stage === "analyze"
        ? "目标分析时间较长，请稍后重试。"
        : "方案生成时间较长，请稍后重试。";
    } else if (code === "NETWORK_ERROR") {
      message = "网络连接不稳定，请检查后重试。";
    } else if (code === "AI_REQUEST_FAILED" || code === "AI_RESPONSE_INVALID") {
      message = "AI 暂时不可用，请稍后重试。";
    }

    console.warn("[goal-generate] error", { stage, code, message: String(error.message || "").slice(0, 120) });

    this.setData({
      flowState: "error",
      generationPhase: "error",
      generationMessage: PHASE_MESSAGES.error,
      pageError: message,
      submitting: false,
    });
    saveGenerationState({ flowState: "error" });
    saveGenerationProgress({
      phase: "error",
      phaseStartedAt: Date.now(),
      totalStartedAt: Date.now(),
      errorMessage: message,
      retryCount: this.data.retryCount,
    });
  },

  retryGeneration() {
    if (this.data.retryCount >= MAX_RETRY_COUNT) {
      wx.showModal({
        title: "暂时无法生成方案",
        content: "建议稍后再试，或返回修改目标信息。",
        showCancel: false,
      });
      return;
    }
    this.setData({ retryCount: this.data.retryCount + 1 });
    clearGenerationState();
    clearGenerationProgress();
    this.startGeneration();
  },

  goBack() {
    this.clearPhaseTimers();
    clearGenerationState();
    clearGenerationProgress();
    wx.navigateBack();
  },

  // ─── Clarification ────────────────────────────────────────────────

  setAnswer(questionId: string, value: ClarificationAnswer["value"]) {
    const answers = { ...this.data.answers, [questionId]: value };
    saveClarificationAnswers(answers);
    this.setData({
      answers,
      clarificationQuestions: buildClarificationQuestions(this.data.analysis, answers),
    });
  },

  selectAnswer(event: DatasetEvent) {
    const questionId = String(event.currentTarget.dataset.questionId || "");
    const rawValue = event.currentTarget.dataset.value;
    const value =
      rawValue === "true" ? true : rawValue === "false" ? false : String(rawValue || "");
    this.setAnswer(questionId, value);
  },

  toggleMultiAnswer(event: DatasetEvent) {
    const questionId = String(event.currentTarget.dataset.questionId || "");
    const value = String(event.currentTarget.dataset.value || "");
    const current = Array.isArray(this.data.answers[questionId])
      ? this.data.answers[questionId] as string[]
      : [];
    this.setAnswer(
      questionId,
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );
  },

  inputAnswer(event: UiComponentEvent<unknown>) {
    const questionId = String(event.currentTarget?.dataset?.questionId || "");
    this.setAnswer(questionId, getUiEventString(event));
  },

  inputNumberAnswer(event: UiComponentEvent<unknown>) {
    const questionId = String(event.currentTarget?.dataset?.questionId || "");
    this.setAnswer(questionId, Number(getUiEventString(event) || 0));
  },

  validateClarification(): ClarificationAnswer[] | null {
    const analysis = this.data.analysis;
    if (!analysis) return null;
    const answers: ClarificationAnswer[] = [];
    for (const question of analysis.questions as ClarificationQuestion[]) {
      const value = this.data.answers[question.id];
      const empty =
        value === undefined ||
        value === "" ||
        (Array.isArray(value) && value.length === 0);
      if (question.required && empty) {
        wx.showToast({ title: "请先回答必填问题", icon: "none" });
        return null;
      }
      if (!empty) answers.push({ questionId: question.id, value });
    }
    return answers;
  },

  submitClarificationAndGenerate() {
    const analysis = this.data.analysis;
    const answers = this.validateClarification();
    if (!analysis || !answers || this.data.submitting) return;
    this.setData({ submitting: true });
    submitGoalClarification(analysis.analysisId, answers)
      .then((result) => {
        saveGoalAnalysisCache(result);
        this.setData({
          analysis: result,
          submitting: false,
          clarificationQuestions: buildClarificationQuestions(result, this.data.answers),
        }, () => {
          this.startGeneration(result);
        });
      })
      .catch((error: Error) => {
        const serviceError = error as Error & { code?: string };
        console.warn("[goal-generate] clarification failed", {
          code: serviceError.code || "UNKNOWN",
          message: serviceError.message || "",
        });
        this.setData({ submitting: false });
        wx.showModal({
          title: "补充信息提交失败",
          content: serviceError.code
            ? `${serviceError.message || "请稍后重试。"}\n\n错误码：${serviceError.code}`
            : error.message || "请稍后重试。",
          showCancel: false,
        });
      });
  },
});
