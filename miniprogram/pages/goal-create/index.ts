import { checkActiveGoal } from "../../services/plan";
import {
  analyzeGoal,
  createAnalysisRequestId,
  submitGoalClarification,
} from "../../services/stage";
import {
  ClarificationAnswer,
  ClarificationQuestion,
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
} from "../../utils/storage";
import { addDays, formatDate } from "../../utils/date";

interface DatasetEvent {
  currentTarget: {
    dataset: {
      value?: string | number;
      questionId?: string;
    };
  };
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

Page({
  data: {
    pageStatus: "loading" as "loading" | "form" | "error",
    pageError: "",
  currentStep: 1,
    totalSteps: 3,
    submitting: false,
    analyzing: false,
    analysis: null as GoalAnalysisResult | null,
    answers: {} as Record<string, ClarificationAnswer["value"]>,
    advancedOpen: false,
    draft: defaultDraft(),
    templateOptions: TEMPLATE_OPTIONS,
    levelOptions: LEVEL_OPTIONS,
    minuteOptions: MINUTE_OPTIONS,
    weeklyOptions: WEEKLY_OPTIONS,
    durationOptions: DURATION_OPTIONS,
    intensityOptions: INTENSITY_OPTIONS,
    minimumDeadline: formatDate(addDays(new Date(), 6)),
  },

  onLoad() {
    this.initialize();
  },

  onHide() {
    if (this.data.pageStatus === "form" && !this.data.submitting) {
      saveLongTermGoalDraft(this.data.draft);
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
        const analysis = getGoalAnalysisCache();
        this.setData({
          pageStatus: "form",
          draft: getLongTermGoalDraft() || defaultDraft(),
          analysis,
          answers: getClarificationAnswers(),
          currentStep: analysis?.needsClarification ? 3 : 1,
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
    this.setData({ analysis: null, answers: {} });
  },

  selectTemplate(event: DatasetEvent) {
    const templateId = String(event.currentTarget.dataset.value || "") as GoalTemplateId;
    this.resetAnalysisState();
    this.setData({ draft: { ...this.data.draft, templateId } });
  },

  inputCustomGoal(event: { detail: { value?: string } }) {
    this.resetAnalysisState();
    this.setData({
      draft: {
        ...this.data.draft,
        customGoalTitle: String(event.detail.value || "").slice(0, 30),
      },
    });
  },

  selectLevel(event: DatasetEvent) {
    this.resetAnalysisState();
    this.setData({
      draft: {
        ...this.data.draft,
        currentLevel: String(event.currentTarget.dataset.value || "") as GoalLevel,
      },
    });
  },

  selectMinutes(event: DatasetEvent) {
    this.resetAnalysisState();
    this.setData({
      draft: {
        ...this.data.draft,
        dailyMinutes: Number(event.currentTarget.dataset.value) as LongTermGoalDraft["dailyMinutes"],
      },
    });
  },

  selectWeeklyDays(event: DatasetEvent) {
    this.resetAnalysisState();
    this.setData({
      draft: {
        ...this.data.draft,
        weeklyDays: Number(event.currentTarget.dataset.value) as 3 | 5 | 7,
      },
    });
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
    this.setData({
      minimumDeadline,
      draft: { ...this.data.draft, durationDays, deadline },
    });
  },

  selectIntensity(event: DatasetEvent) {
    this.resetAnalysisState();
    this.setData({
      draft: {
        ...this.data.draft,
        intensity: String(event.currentTarget.dataset.value || "") as GoalIntensity,
      },
    });
  },

  changeDeadline(event: { detail: { value?: string } }) {
    this.resetAnalysisState();
    this.setData({
      draft: { ...this.data.draft, deadline: String(event.detail.value || "") },
    });
  },

  clearDeadline() {
    this.resetAnalysisState();
    this.setData({ draft: { ...this.data.draft, deadline: "" } });
  },

  previousStep() {
    if (this.data.currentStep === 1) {
      wx.navigateBack();
      return;
    }
    this.setData({ currentStep: this.data.currentStep === 3 ? 2 : 1 });
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

  startAnalysis() {
    if (this.data.submitting) return;
    const draft = {
      ...this.data.draft,
      customGoalTitle: this.data.draft.customGoalTitle?.trim() || "",
    };
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
        this.setData({ analysis, answers: {}, analyzing: false });
        if (analysis.needsClarification) {
          this.setData({ currentStep: 3, submitting: false });
          return;
        }
        this.goToPreview();
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

  goToPreview() {
    wx.navigateTo({
      url: "/pages/plan-preview/index?create=1",
      complete: () => this.setData({ submitting: false }),
    });
  },

  setAnswer(questionId: string, value: ClarificationAnswer["value"]) {
    const answers = { ...this.data.answers, [questionId]: value };
    saveClarificationAnswers(answers);
    this.setData({ answers });
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

  inputAnswer(event: { currentTarget: { dataset: { questionId?: string } }; detail: { value?: string } }) {
    const questionId = String(event.currentTarget.dataset.questionId || "");
    this.setAnswer(questionId, String(event.detail.value || ""));
  },

  inputNumberAnswer(event: { currentTarget: { dataset: { questionId?: string } }; detail: { value?: string } }) {
    const questionId = String(event.currentTarget.dataset.questionId || "");
    this.setAnswer(questionId, Number(event.detail.value || 0));
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

  submitClarification() {
    const analysis = this.data.analysis;
    const answers = this.validateClarification();
    if (!analysis || !answers || this.data.submitting) return;
    this.setData({ submitting: true });
    submitGoalClarification(analysis.analysisId, answers)
      .then((result) => {
        saveGoalAnalysisCache(result);
        this.setData({ analysis: result });
        this.goToPreview();
      })
      .catch((error: Error) => {
        this.setData({ submitting: false });
        wx.showModal({
          title: "补充信息提交失败",
          content: error.message || "请稍后重试。",
          showCancel: false,
        });
      });
  },

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
      this.startAnalysis();
      return;
    }
    this.submitClarification();
  },
});
