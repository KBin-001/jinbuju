import { checkActiveGoal } from "../../services/plan";
import {
  GoalLevel,
  GoalTemplateKey,
  LongTermGoalDraft,
} from "../../types/stage";
import {
  clearStagePreviewCache,
  clearGoalAnalysisCache,
  getLongTermGoalDraft,
  saveLongTermGoalDraft,
  getGenerationState,
  clearGenerationState,
  clearGenerationProgress,
  getStagePreviewCache,
} from "../../utils/storage";
import { addDays, formatDate } from "../../utils/date";
import { getUiEventString, UiComponentEvent } from "../../utils/ui-event";

interface DatasetEvent {
  currentTarget: {
    dataset: {
      value?: string | number;
    };
  };
}

const TEMPLATE_OPTIONS: Array<{ value: GoalTemplateKey; label: string; description: string }> = [
  { value: "cet", label: "英语四六级", description: "词汇、听力、阅读与写作" },
  { value: "teacher_exam", label: "教师资格证", description: "考情、知识点与练习" },
  { value: "postgraduate_exam", label: "考研", description: "长期备考与阶段复习" },
  { value: "civil_service_exam", label: "考公", description: "行测、申论与刷题节奏" },
  { value: "ai_learning", label: "AI学习", description: "AI工具、提示词与应用实践" },
  { value: "custom", label: "自定义目标", description: "创建一个自己的成长方向" },
];
const LEVEL_OPTIONS = [
  { value: "zero", label: "零基础" },
  { value: "basic", label: "了解一点" },
  { value: "intermediate", label: "有基础" },
];
const MINUTE_OPTIONS = [30, 60, 90, 120, 180, 360];
const WEEKLY_OPTIONS = [3, 5, 7];
const DURATION_OPTIONS = [
  { value: 7, label: "7天" },
  { value: 14, label: "14天" },
  { value: 30, label: "30天" },
  { value: 90, label: "长期" },
];
const DURATION_VALUES = DURATION_OPTIONS.map((item) => item.value);

function normalizeDraftTemplate(draft: LongTermGoalDraft): LongTermGoalDraft {
  if (draft.templateId === "cet4") return { ...draft, templateId: "cet" };
  if (draft.templateId === "ai_tools") return { ...draft, templateId: "ai_learning" };
  const legacyCustomTitles: Partial<Record<LongTermGoalDraft["templateId"], string>> = {
    python: "Python 入门",
    video_editing: "视频剪辑",
    resume: "完善简历",
    interview: "面试准备",
  };
  const customGoalTitle = legacyCustomTitles[draft.templateId];
  return customGoalTitle ? { ...draft, templateId: "custom", customGoalTitle } : draft;
}

function normalizeDraftRhythm(draft: LongTermGoalDraft): LongTermGoalDraft {
  const dailyMinutes = MINUTE_OPTIONS.includes(draft.dailyMinutes) ? draft.dailyMinutes : 30;
  const currentDuration = Number(draft.planDurationDays || draft.durationDays || 7);
  const planDurationDays = DURATION_VALUES.includes(currentDuration)
    ? currentDuration
    : currentDuration <= 7
      ? 7
      : currentDuration <= 14
        ? 14
        : currentDuration <= 30
          ? 30
          : 90;
  const minimumDeadline = formatDate(addDays(new Date(), planDurationDays - 1));
  const deadline = draft.deadline && draft.deadline >= minimumDeadline ? draft.deadline : "";
  return {
    ...draft,
    dailyMinutes,
    durationDays: planDurationDays,
    planDurationDays,
    deadline,
  };
}

function defaultDraft(): LongTermGoalDraft {
  return {
    version: 2,
    templateId: "cet",
    customGoalTitle: "",
    currentLevel: "zero",
    dailyMinutes: 30,
    weeklyDays: 5,
    intensity: "normal",
    durationDays: 7,
    planDurationDays: 7,
    deadline: "",
  };
}

Page({
  data: {
    stepItems: [
      { title: "目标" },
      { title: "节奏" },
    ],
    pageStatus: "loading" as "loading" | "form" | "error",
    pageError: "",
    currentStep: 1,
    totalSteps: 2,
    submitting: false,
    canContinueGoal: true,

    draft: defaultDraft(),
    templateOptions: TEMPLATE_OPTIONS,
    levelOptions: LEVEL_OPTIONS,
    minuteOptions: MINUTE_OPTIONS,
    weeklyOptions: WEEKLY_OPTIONS,
    durationOptions: DURATION_OPTIONS,
    minimumDeadline: formatDate(addDays(new Date(), 6)),

    // 节奏选择页前端状态
    deadlineMode: "none" as "none" | "date",
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
        // Check for completed generation that needs redirect
        const genState = getGenerationState();
        if (genState && genState.flowState === "completed") {
          const cached = getStagePreviewCache();
          if (cached) {
            clearGenerationState();
            clearGenerationProgress();
            wx.navigateTo({ url: "/pages/plan-preview/index?create=1" });
            return;
          }
          clearGenerationState();
          clearGenerationProgress();
        }
        // Normal init
        const storedDraft = normalizeDraftRhythm(
          normalizeDraftTemplate(getLongTermGoalDraft() || defaultDraft()),
        );
        const deadlineMode = storedDraft.deadline ? "date" : "none";
        const minimumDeadline = formatDate(addDays(new Date(), storedDraft.planDurationDays - 1));
        this.setData({
          pageStatus: "form",
          draft: storedDraft,
          canContinueGoal:
            storedDraft.templateId !== "custom" ||
            (storedDraft.customGoalTitle || "").trim().length >= 2,
          deadlineMode,
          minimumDeadline,
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
  },

  // ─── Step 1: Goal selection ────────────────────────────────────────

  selectTemplate(event: DatasetEvent) {
    const templateId = String(event.currentTarget.dataset.value || "") as GoalTemplateKey;
    this.resetAnalysisState();
    const newDraft = { ...this.data.draft, templateId };
    this.setData({
      draft: newDraft,
      canContinueGoal:
        templateId !== "custom" || (newDraft.customGoalTitle || "").trim().length >= 2,
    });
    saveLongTermGoalDraft(newDraft);
  },

  inputCustomGoal(event: UiComponentEvent<unknown>) {
    this.resetAnalysisState();
    const customGoalTitle = getUiEventString(event).slice(0, 30);
    const newDraft = {
      ...this.data.draft,
      customGoalTitle,
    };
    this.setData({
      draft: newDraft,
      canContinueGoal: customGoalTitle.trim().length >= 2,
    });
    saveLongTermGoalDraft(newDraft);
  },

  // ─── Step 2: Rhythm settings ──────────────────────────────────────

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

  selectDuration(event: DatasetEvent) {
    const selected = Number(event.currentTarget.dataset.value);
    this.resetAnalysisState();
    const minimumDeadline = formatDate(addDays(new Date(), selected - 1));
    const deadline =
      this.data.draft.deadline && this.data.draft.deadline < minimumDeadline
        ? ""
        : this.data.draft.deadline;
    const newDraft = {
      ...this.data.draft,
      durationDays: selected,
      planDurationDays: selected,
      deadline,
    };
    this.setData({
      minimumDeadline,
      draft: newDraft,
      deadlineMode: deadline ? "date" : this.data.deadlineMode,
    });
    saveLongTermGoalDraft(newDraft);
  },

  selectDeadlineMode(event: DatasetEvent) {
    const mode = String(event.currentTarget.dataset.value || "") as "none" | "date";
    if (mode === "none") {
      this.resetAnalysisState();
      const newDraft = { ...this.data.draft, deadline: "" };
      this.setData({ draft: newDraft, deadlineMode: "none" });
      saveLongTermGoalDraft(newDraft);
    } else {
      this.setData({ deadlineMode: "date" });
    }
  },

  changeDeadline(event: { detail: { value?: string } }) {
    this.resetAnalysisState();
    const newDraft = { ...this.data.draft, deadline: String(event.detail.value || "") };
    this.setData({ draft: newDraft, deadlineMode: "date" });
    saveLongTermGoalDraft(newDraft);
  },

  clearDeadline() {
    this.resetAnalysisState();
    const newDraft = { ...this.data.draft, deadline: "" };
    this.setData({ draft: newDraft, deadlineMode: "none" });
    saveLongTermGoalDraft(newDraft);
  },

  // ─── Validation ───────────────────────────────────────────────────

  validateRhythm(): boolean {
    const { draft } = this.data;
    if (!draft.currentLevel) {
      wx.showToast({ title: "请选择当前水平", icon: "none" });
      return false;
    }
    if (!MINUTE_OPTIONS.includes(draft.dailyMinutes)) {
      wx.showToast({ title: "请选择每天投入时间", icon: "none" });
      return false;
    }
    if (!draft.weeklyDays) {
      wx.showToast({ title: "请选择每周安排", icon: "none" });
      return false;
    }
    if (!draft.planDurationDays || draft.planDurationDays < 3 || draft.planDurationDays > 90) {
      wx.showToast({ title: "请选择计划周期", icon: "none" });
      return false;
    }
    if (this.data.deadlineMode === "date" && !draft.deadline) {
      wx.showToast({ title: "请选择截止日期", icon: "none" });
      return false;
    }
    return true;
  },

  // ─── Navigation ────────────────────────────────────────────────────

  previousStep() {
    if (this.data.currentStep === 1) {
      wx.navigateBack();
      return;
    }
    this.setData({ currentStep: 1 });
  },

  nextStep() {
    if (this.data.currentStep === 1) {
      if (this.data.draft.templateId === "custom") {
        const customGoalTitle = (this.data.draft.customGoalTitle || "").trim();
        if (!customGoalTitle) {
          wx.showToast({ title: "写下你想推进的目标吧", icon: "none" });
          return;
        }
        if (customGoalTitle.length < 2 || customGoalTitle.length > 30) {
          wx.showToast({ title: "目标请控制在 2～30 个字", icon: "none" });
          return;
        }
        const draft = { ...this.data.draft, customGoalTitle };
        this.setData({ draft });
        saveLongTermGoalDraft(draft);
      }
      this.setData({ currentStep: 2 });
      return;
    }
    if (this.data.currentStep === 2) {
      if (!this.validateRhythm()) return;
      // Save draft and navigate to generate page
      const draft = { ...this.data.draft, customGoalTitle: this.data.draft.customGoalTitle?.trim() || "" };
      saveLongTermGoalDraft(draft);
      clearStagePreviewCache();
      this.setData({ submitting: true });
      wx.navigateTo({
        url: "/pages/goal-generate/index",
        fail: () => this.setData({ submitting: false }),
      });
    }
  },
});
