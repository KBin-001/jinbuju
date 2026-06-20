import { checkActiveGoal } from "../../services/plan";
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
  GenerationProgress,
  GenerationState,
  GoalAnalysisResult,
  GoalIntensity,
  GoalLevel,
  GoalTemplateId,
  LongTermGoalDraft,
  PlanDurationDays,
} from "../../types/stage";
import {
  clearStagePreviewCache,
  clearGoalAnalysisCache,
  getClarificationAnswers,
  getGoalAnalysisCache,
  getLongTermGoalDraft,
  saveClarificationAnswers,
  saveGoalAnalysisCache,
  saveLongTermGoalDraft,
  getGenerationState,
  saveGenerationState,
  clearGenerationState,
  getGenerationProgress,
  saveGenerationProgress,
  clearGenerationProgress,
  getStagePreviewCache,
  saveStagePreviewCache,
} from "../../utils/storage";
import { addDays, formatDate } from "../../utils/date";
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

const TEMPLATE_OPTIONS = [
  { value: "cet4", label: "英语四级", description: "词汇、听力、阅读与写作" },
  { value: "teacher_exam", label: "教师资格证", description: "考情、知识点与练习" },
  { value: "python", label: "Python 入门", description: "基础语法与动手练习" },
  { value: "ai_tools", label: "AI 工具学习", description: "提示方法与实际应用" },
  { value: "video_editing", label: "视频剪辑", description: "素材、剪辑、字幕与导出" },
  { value: "resume", label: "完善简历", description: "岗位方向、经历与成果表达" },
  { value: "interview", label: "面试准备", description: "问题梳理、回答与模拟练习" },
  { value: "custom", label: "自定义目标", description: "创建一个自己的成长方向" },
];
const LEVEL_OPTIONS = [
  { value: "zero", label: "零基础" },
  { value: "basic", label: "了解一点" },
  { value: "intermediate", label: "有一定基础" },
];
const MINUTE_OPTIONS = [15, 30, 45, 60, 90];
const WEEKLY_OPTIONS = [3, 5, 7];
const DURATION_OPTIONS = [
  { value: 1, label: "1 天" },
  { value: 2, label: "2 天" },
  { value: 3, label: "3 天" },
  { value: 4, label: "4 天" },
  { value: 5, label: "5 天" },
  { value: 6, label: "6 天" },
  { value: 7, label: "7 天" },
];
const INTENSITY_OPTIONS = [
  { value: "light", label: "轻松", description: "使用约 75% 的可投入时间" },
  { value: "normal", label: "普通", description: "稳定推进，适合大多数人" },
  { value: "intensive", label: "挑战", description: "时间不增加，任务更有挑战" },
];

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

function defaultDraft(): LongTermGoalDraft {
  return {
    version: 2,
    templateId: "cet4",
    customGoalTitle: "",
    currentLevel: "zero",
    dailyMinutes: 30,
    weeklyDays: 5,
    intensity: "normal",
    durationDays: 7,
    deadline: "",
  };
}

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

Page({
  data: {
    stepItems: [
      { title: "目标" },
      { title: "节奏" },
      { title: "生成" },
    ],
    pageStatus: "loading" as "loading" | "form" | "error",
    pageError: "",
    currentStep: 1,
    totalSteps: 4,
    submitting: false,
    analyzing: false,
    analysis: null as GoalAnalysisResult | null,
    answers: {} as Record<string, ClarificationAnswer["value"]>,
    clarificationQuestions: [] as ClarificationQuestionView[],
    advancedOpen: false,
    draft: defaultDraft(),
    templateOptions: TEMPLATE_OPTIONS,
    levelOptions: LEVEL_OPTIONS,
    minuteOptions: MINUTE_OPTIONS,
    weeklyOptions: WEEKLY_OPTIONS,
    durationOptions: DURATION_OPTIONS,
    intensityOptions: INTENSITY_OPTIONS,
    minimumDeadline: formatDate(addDays(new Date(), 6)),
    // Step 3 generation fields
    generationPhase: "idle" as GenerationPhase | "idle",
    generationMessage: "",
    showLongWaitHint: false,
    longWaitMessage: "",
    flowState: "idle" as FlowState,
    showClarification: false,
    retryCount: 0,
  },

  _phaseTimers: [] as number[],
  _longWaitTimer: 0,
  _longWaitTimer15: 0,
  _navigateTimer: 0,
  _lastSubmitTime: 0,

  onLoad() {
    this.initialize();
  },

  onHide() {
    if (
      this.data.flowState === "analyzing" ||
      this.data.flowState === "generating"
    ) {
      saveGenerationState({
        flowState: this.data.flowState,
        analysisId: this.data.analysis?.analysisId,
        stageRequestId: this.data.generationPhase === "generating" || this.data.generationPhase === "validating"
          ? undefined
          : undefined,
        input: this.buildCreateInput(),
      });
      saveGenerationProgress({
        phase: this.data.generationPhase as GenerationPhase,
        phaseStartedAt: Date.now(),
        totalStartedAt: Date.now(),
        retryCount: this.data.retryCount,
      });
    } else if (this.data.pageStatus === "form" && !this.data.submitting) {
      saveLongTermGoalDraft(this.data.draft);
    }
  },

  onShow() {
    const progress = getGenerationProgress();
    if (
      progress &&
      (this.data.flowState === "analyzing" || this.data.flowState === "generating")
    ) {
      this.setData({
        generationPhase: progress.phase,
        generationMessage: PHASE_MESSAGES[progress.phase],
      });
    }
  },

  initialize() {
    checkActiveGoal()
      .then((active) => {
        if (active) {
          wx.showModal({
            title: "已有进行中的目标",
            content: "V1 暂不支持同时创建多个目标。",
            showCancel: false,
            success: () => wx.switchTab({ url: "/pages/plan/index" }),
          });
          return;
        }
        // Check for interrupted generation state first
        const genState = getGenerationState();
        if (genState) {
          if (genState.flowState === "completed") {
            const cached = getStagePreviewCache();
            if (cached) {
              clearGenerationState();
              clearGenerationProgress();
              wx.navigateTo({ url: "/pages/plan-preview/index?create=1" });
              return;
            }
            // Completed but no cache — fall through to normal init
            clearGenerationState();
            clearGenerationProgress();
          } else if (
            genState.flowState === "analyzing" ||
            genState.flowState === "generating"
          ) {
            // Generation was interrupted — show Step 3 error state
            const draft = getLongTermGoalDraft() || defaultDraft();
            const analysis = getGoalAnalysisCache();
            const answers = getClarificationAnswers();
            this.setData({
              pageStatus: "form",
              draft,
              analysis,
              answers,
              clarificationQuestions: buildClarificationQuestions(analysis, answers),
              currentStep: 3,
              flowState: "error",
              generationPhase: "error",
              generationMessage: "上次生成中断了，请重新生成",
              pageError: "上次方案生成被中断，请重新尝试。",
              retryCount: 0,
            });
            clearGenerationState();
            clearGenerationProgress();
            return;
          } else if (genState.flowState === "error") {
            clearGenerationState();
            clearGenerationProgress();
          }
        }
        // Normal initialization with cache restoration
        const analysis = getGoalAnalysisCache();
        const answers = getClarificationAnswers();
        const showClarification = Boolean(analysis?.needsClarification);
        this.setData({
          pageStatus: "form",
          draft: getLongTermGoalDraft() || defaultDraft(),
          analysis,
          answers,
          clarificationQuestions: buildClarificationQuestions(analysis, answers),
          currentStep: showClarification ? 2 : 1,
          showClarification,
        });
      })
      .catch((error: Error) => {
        this.setData({
          pageStatus: "error",
          pageError: error.message || "暂时无法开始创建，请稍后重试。",
        });
      });
  },

  retryInitialize() {
    this.setData({ pageStatus: "loading", pageError: "" });
    this.initialize();
  },

  resetAnalysisState() {
    clearGoalAnalysisCache();
    this.setData({
      analysis: null,
      answers: {},
      clarificationQuestions: [],
      showClarification: false,
    });
  },

  selectTemplate(event: DatasetEvent) {
    const templateId = String(event.currentTarget.dataset.value || "") as GoalTemplateId;
    this.resetAnalysisState();
    const newDraft = { ...this.data.draft, templateId };
    this.setData({ draft: newDraft });
    saveLongTermGoalDraft(newDraft);
  },

  inputCustomGoal(event: UiComponentEvent<unknown>) {
    this.resetAnalysisState();
    const newDraft = {
      ...this.data.draft,
      customGoalTitle: getUiEventString(event).slice(0, 30),
    };
    this.setData({ draft: newDraft });
    saveLongTermGoalDraft(newDraft);
  },

  selectLevel(event: DatasetEvent) {
    this.resetAnalysisState();
    const newDraft = {
      ...this.data.draft,
      currentLevel: String(event.currentTarget.dataset.value || "") as GoalLevel,
    };
    this.setData({ draft: newDraft });
    saveLongTermGoalDraft(newDraft);
  },

  selectMinutes(event: DatasetEvent) {
    this.resetAnalysisState();
    const newDraft = {
      ...this.data.draft,
      dailyMinutes: Number(event.currentTarget.dataset.value) as LongTermGoalDraft["dailyMinutes"],
    };
    this.setData({ draft: newDraft });
    saveLongTermGoalDraft(newDraft);
  },

  selectWeeklyDays(event: DatasetEvent) {
    this.resetAnalysisState();
    const newDraft = {
      ...this.data.draft,
      weeklyDays: Number(event.currentTarget.dataset.value) as 3 | 5 | 7,
    };
    this.setData({ draft: newDraft });
    saveLongTermGoalDraft(newDraft);
  },

  toggleAdvanced() {
    this.setData({ advancedOpen: !this.data.advancedOpen });
  },

  selectDuration(event: DatasetEvent) {
    this.resetAnalysisState();
    const durationDays = Number(event.currentTarget.dataset.value) as PlanDurationDays;
    const minimumDeadline = formatDate(addDays(new Date(), durationDays - 1));
    const deadline =
      this.data.draft.deadline && this.data.draft.deadline < minimumDeadline
        ? ""
        : this.data.draft.deadline;
    const newDraft = { ...this.data.draft, durationDays, deadline };
    this.setData({ minimumDeadline, draft: newDraft });
    saveLongTermGoalDraft(newDraft);
  },

  selectIntensity(event: DatasetEvent) {
    this.resetAnalysisState();
    const newDraft = {
      ...this.data.draft,
      intensity: String(event.currentTarget.dataset.value || "") as GoalIntensity,
    };
    this.setData({ draft: newDraft });
    saveLongTermGoalDraft(newDraft);
  },

  changeDeadline(event: { detail: { value?: string } }) {
    this.resetAnalysisState();
    const newDraft = { ...this.data.draft, deadline: String(event.detail.value || "") };
    this.setData({ draft: newDraft });
    saveLongTermGoalDraft(newDraft);
  },

  clearDeadline() {
    this.resetAnalysisState();
    const newDraft = { ...this.data.draft, deadline: "" };
    this.setData({ draft: newDraft });
    saveLongTermGoalDraft(newDraft);
  },

  previousStep() {
    if (this.data.currentStep === 1) {
      wx.navigateBack();
      return;
    }
    if (this.data.currentStep === 3) {
      if (
        this.data.flowState === "analyzing" ||
        this.data.flowState === "generating"
      ) {
        wx.showModal({
          title: "方案正在生成中",
          content: "确定要返回吗？当前生成进度将丢失。",
          success: (res) => {
            if (res.confirm) {
              this.clearPhaseTimers();
              this.setData({
                currentStep: 2,
                flowState: "idle",
                generationPhase: "idle",
                generationMessage: "",
                showLongWaitHint: false,
                submitting: false,
              });
              clearGenerationState();
              clearGenerationProgress();
            }
          },
        });
        return;
      }
      // Error or idle — go back to step 2
      this.setData({
        currentStep: 2,
        flowState: "idle",
        generationPhase: "idle",
        generationMessage: "",
        pageError: "",
      });
      return;
    }
    // Step 2 → Step 1
    this.setData({ currentStep: 1, showClarification: false });
  },

  buildAnalyzeInput() {
    const template = TEMPLATE_OPTIONS.find((item) => item.value === this.data.draft.templateId);
    return {
      title:
        this.data.draft.templateId === "custom"
          ? this.data.draft.customGoalTitle!.trim()
          : template?.label || "成长目标",
      dailyMinutes: this.data.draft.dailyMinutes,
      durationDays: this.data.draft.durationDays,
      currentLevel: this.data.draft.currentLevel,
      intensity: this.data.draft.intensity,
      deadline: this.data.draft.deadline || undefined,
    };
  },

  buildCreateInput() {
    const draft = this.data.draft;
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
    // Start long-wait hint timer for active phases
    if (phase === "understanding" || phase === "organizing" || phase === "generating" || phase === "validating") {
      this._longWaitTimer = setTimeout(() => {
        this.setData({ showLongWaitHint: true, longWaitMessage: "AI 正在认真思考，通常还需要一些时间" });
      }, LONG_WAIT_THRESHOLD) as unknown as number;
      this._longWaitTimer15 = setTimeout(() => {
        this.setData({ longWaitMessage: LONG_WAIT_MESSAGE_15S });
      }, 15000) as unknown as number;
    }
  },

  // ─── Step 2: Analyze then maybe clarify ───────────────────────────

  startAnalysisForStep2() {
    if (this.data.submitting || this.data.analyzing) return;
    // Debounce
    if (Date.now() - this._lastSubmitTime < 2000) return;
    this._lastSubmitTime = Date.now();

    const draft = { ...this.data.draft, customGoalTitle: this.data.draft.customGoalTitle?.trim() || "" };
    saveLongTermGoalDraft(draft);
    clearStagePreviewCache();
    this.setData({ submitting: true, analyzing: true });

    analyzeGoal(this.buildAnalyzeInput(), createAnalysisRequestId())
      .then((analysis) => {
        if (analysis.status === "analyzing") {
          wx.showToast({ title: "正在理解你的目标，请稍后重试", icon: "none" });
          this.setData({ submitting: false, analyzing: false });
          return;
        }
        saveGoalAnalysisCache(analysis);
        this.setData({
          analysis,
          analyzing: false,
          clarificationQuestions: buildClarificationQuestions(analysis, this.data.answers),
        });
        if (analysis.needsClarification) {
          // Expand clarification in Step 2
          this.setData({ showClarification: true, submitting: false });
          return;
        }
        // No clarification needed — go directly to Step 3 generation
        this.startGeneration(analysis);
      })
      .catch((error: Error) => {
        this.setData({ submitting: false, analyzing: false });
        wx.showModal({
          title: "目标分析失败",
          content: error.message || "请稍后重试。",
          showCancel: false,
        });
      });
  },

  // ─── Step 3: Full generation flow ─────────────────────────────────

  startGeneration(analysis?: GoalAnalysisResult) {
    if (this.data.submitting && this.data.flowState !== "idle") return;
    // Debounce
    if (Date.now() - this._lastSubmitTime < 2000) return;
    this._lastSubmitTime = Date.now();

    const currentAnalysis = analysis || this.data.analysis;
    const input = this.buildCreateInput();
    const stageRequestId = createStageRequestId();

    this.setData({
      currentStep: 3,
      flowState: "analyzing",
      submitting: true,
      pageError: "",
    });

    // Save generation state for recovery
    saveGenerationState({
      flowState: "analyzing",
      analysisId: currentAnalysis?.analysisId,
      input,
    });

    // If analysis already done (from Step 2 clarify path), skip to generation
    if (currentAnalysis && !currentAnalysis.needsClarification) {
      this.setData({ flowState: "generating" });
      saveGenerationState({
        flowState: "generating",
        analysisId: currentAnalysis.analysisId,
        input,
      });
      this.beginStagePreviewGeneration(currentAnalysis.analysisId, input, stageRequestId);
      return;
    }

    // Otherwise, start with analyzeGoal first
    this.setPhase("understanding");
    const organizingTimer = setTimeout(() => {
      this.setPhase("organizing");
    }, PHASE_ORGANIZING_DELAY) as unknown as number;
    this._phaseTimers.push(organizingTimer);

    analyzeGoal(this.buildAnalyzeInput(), createAnalysisRequestId())
      .then((newAnalysis) => {
        this.clearPhaseTimers();
        if (newAnalysis.status === "analyzing") {
          this.setData({
            currentStep: 2,
            flowState: "idle",
            generationPhase: "idle",
            submitting: false,
          });
          wx.showToast({ title: "正在理解你的目标，请稍后重试", icon: "none" });
          return;
        }
        saveGoalAnalysisCache(newAnalysis);
        this.setData({ analysis: newAnalysis });

        if (newAnalysis.needsClarification) {
          // Go back to Step 2 with clarification
          this.setData({
            currentStep: 2,
            flowState: "idle",
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

        // Proceed to stage preview generation
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
    input: ReturnType<typeof this.buildCreateInput>,
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

        // Save result for plan-preview to read from cache
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

        // Navigate after short delay so user sees "completed" state
        this._navigateTimer = setTimeout(() => {
          clearGenerationState();
          clearGenerationProgress();
          wx.navigateTo({
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

    console.warn("[goal-create] generation error", {
      stage,
      code,
      message: String(error.message || "").slice(0, 120),
    });

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

  backToStep2() {
    this.clearPhaseTimers();
    clearGenerationState();
    clearGenerationProgress();
    this.setData({
      currentStep: 2,
      flowState: "idle",
      generationPhase: "idle",
      generationMessage: "",
      pageError: "",
      submitting: false,
    });
  },

  // ─── Clarification (in Step 2) ────────────────────────────────────

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
          clarificationQuestions: buildClarificationQuestions(result, this.data.answers),
        });
        this.startGeneration(result);
      })
      .catch((error: Error) => {
        const serviceError = error as Error & { code?: string };
        console.warn("[goal-create] submit clarification failed", {
          code: serviceError.code || "UNKNOWN",
          message: serviceError.message || "",
          analysisIdSuffix: analysis.analysisId.slice(-8),
          questionCount: analysis.questions.length,
          answerCount: answers.length,
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

  // ─── Step navigation ──────────────────────────────────────────────

  nextStep() {
    if (this.data.currentStep === 1) {
      if (
        this.data.draft.templateId === "custom" &&
        this.data.draft.customGoalTitle!.trim().length < 2
      ) {
        wx.showToast({ title: "请输入 2～30 个字的目标", icon: "none" });
        return;
      }
      this.setData({ currentStep: 2 });
      return;
    }
    if (this.data.currentStep === 2) {
      if (this.data.showClarification && this.data.analysis) {
        // Clarification visible — submit answers then generate
        this.submitClarificationAndGenerate();
      } else {
        // First time — run analysis
        this.startAnalysisForStep2();
      }
      return;
    }
    // Step 3 should not have a next button during generation
  },
});
