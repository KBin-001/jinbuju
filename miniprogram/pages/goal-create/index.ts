import { GoalCategory, GoalDraft, GoalIntensity, GoalLevel } from "../../types/goal";
import { checkActiveGoal } from "../../services/plan";
import { daysUntil, formatDisplayDate, getDefaultDeadline, getTomorrow } from "../../utils/date";
import {
  clearGoalDraft,
  clearPlanPreview,
  consumeGoalEditStep,
  getGoalDraft,
  saveGoalDraft,
} from "../../utils/storage";

interface Choice {
  value: string | number;
  label: string;
  description?: string;
  generatedTitle?: string;
}

const CATEGORY_OPTIONS: Choice[] = [
  { value: "exam", label: "考试备考", description: "四六级、考研、教资、职业证书" },
  { value: "skill", label: "技能学习", description: "编程、AI、设计、剪辑、办公技能" },
  { value: "career", label: "求职提升", description: "简历、面试、作品集、职场能力" },
];

const TEMPLATE_OPTIONS: Record<GoalCategory, Choice[]> = {
  exam: [
    { value: "cet4", label: "英语四级", generatedTitle: "30 天准备英语四级" },
    { value: "cet6", label: "英语六级", generatedTitle: "30 天准备英语六级" },
    { value: "postgraduate", label: "考研", generatedTitle: "系统准备考研" },
    { value: "teacher", label: "教师资格证", generatedTitle: "30 天准备教师资格证" },
    { value: "other_exam", label: "其他证书", generatedTitle: "" },
  ],
  skill: [
    { value: "python", label: "Python", generatedTitle: "零基础学习 Python" },
    { value: "ai_tools", label: "AI 工具", generatedTitle: "系统学习 AI 工具" },
    { value: "frontend", label: "前端开发", generatedTitle: "零基础学习前端开发" },
    { value: "ui", label: "UI 设计", generatedTitle: "系统学习 UI 设计" },
    { value: "video", label: "视频剪辑", generatedTitle: "零基础学习视频剪辑" },
    { value: "excel", label: "Excel", generatedTitle: "系统提升 Excel 技能" },
    { value: "other_skill", label: "其他技能", generatedTitle: "" },
  ],
  career: [
    { value: "resume", label: "完善简历", generatedTitle: "7 天完善个人简历" },
    { value: "interview", label: "面试训练", generatedTitle: "系统进行面试训练" },
    { value: "portfolio", label: "制作作品集", generatedTitle: "7 天完善个人作品集" },
    { value: "workplace", label: "学习职场技能", generatedTitle: "系统提升职场能力" },
    { value: "internship", label: "寻找实习", generatedTitle: "制定实习求职行动计划" },
    { value: "other_career", label: "其他目标", generatedTitle: "" },
  ],
};

const LEVEL_OPTIONS: Choice[] = [
  { value: "zero", label: "完全没接触过" },
  { value: "basic", label: "了解一点" },
  { value: "intermediate", label: "有一定基础" },
  { value: "experienced", label: "已经学习一段时间" },
  { value: "improve", label: "希望系统提升" },
];

const INTENSITY_OPTIONS: Choice[] = [
  { value: "light", label: "轻松", description: "任务少，优先建立习惯" },
  { value: "normal", label: "普通", description: "学习与练习相结合" },
  { value: "intensive", label: "冲刺", description: "任务较多，适合时间紧张" },
];

function createDefaultDraft(): GoalDraft {
  return {
    category: "",
    goalTitle: "",
    goalTemplate: "",
    currentLevel: "",
    deadline: getDefaultDeadline(),
    weeklyDays: 5,
    dailyMinutes: 45,
    intensity: "normal",
    status: "draft",
  };
}

Page({
  data: {
    pageStatus: "loading" as "loading" | "form" | "error",
    pageError: "",
    initialized: false,
    currentStep: 1,
    totalSteps: 6,
    progress: 16.67,
    submitting: false,
    draft: createDefaultDraft(),
    categoryOptions: CATEGORY_OPTIONS,
    templateOptions: [] as Choice[],
    levelOptions: LEVEL_OPTIONS,
    weeklyDayOptions: [3, 4, 5, 6, 7],
    minuteOptions: [15, 30, 45, 60, 90, 120],
    intensityOptions: INTENSITY_OPTIONS,
    minDeadline: getTomorrow(),
    deadlineDisplay: formatDisplayDate(getDefaultDeadline()),
    deadlineHint: "",
    customGoal: false,
    categoryLabel: "",
    levelLabel: "",
    intensityLabel: "普通",
  },

  onLoad(options: { step?: string }) {
    (this as any).requestedStep = Number(options.step || 1);
    this.initializePage();
  },

  onShow() {
    if (!this.data.initialized) return;
    const editStep = consumeGoalEditStep();
    if (editStep) {
      this.setData({
        currentStep: editStep,
        progress: (editStep / 6) * 100,
      });
    }
  },

  initializePage() {
    this.setData({ pageStatus: "loading", pageError: "" });
    checkActiveGoal()
      .then((hasActiveGoal) => {
        if (hasActiveGoal) {
          wx.showModal({
            title: "已有进行中的目标",
            content: "V1 暂不支持同时创建多个目标。",
            showCancel: false,
            success: () => wx.switchTab({ url: "/pages/plan/index" }),
          });
          return;
        }
        this.loadDraft((this as any).requestedStep || 1);
      })
      .catch((error: Error & { code?: string }) => {
        if (error.code === "FUNCTION_NOT_FOUND") {
          wx.showToast({
            title: "可先填写，生成前需部署云函数",
            icon: "none",
            duration: 2500,
          });
          this.loadDraft((this as any).requestedStep || 1);
          return;
        }
        this.setData({
          pageStatus: "error",
          pageError: error.message || "目标状态检查失败，请重试。",
        });
      });
  },

  loadDraft(requestedStep: number) {
    const savedDraft = getGoalDraft();

    if (savedDraft) {
      wx.showModal({
        title: "继续上次编辑？",
        content: "检测到尚未完成的目标草稿。",
        confirmText: "继续编辑",
        cancelText: "重新开始",
        success: (result: any) => {
          if (result.confirm) {
            this.applyDraft(savedDraft, requestedStep);
          } else {
            clearGoalDraft();
            clearPlanPreview();
            this.applyDraft(createDefaultDraft(), 1);
          }
        },
      });
      return;
    }

    this.applyDraft(createDefaultDraft(), requestedStep);
  },

  onHide() {
    if (this.data.initialized && !this.data.submitting) {
      saveGoalDraft(this.data.draft);
    }
  },

  applyDraft(draft: GoalDraft, step: number) {
    const category = draft.category as GoalCategory;
    const templateOptions = category ? TEMPLATE_OPTIONS[category] : [];
    const selectedTemplate = templateOptions.find((item) => item.value === draft.goalTemplate);
    const customGoal = Boolean(draft.goalTemplate && selectedTemplate && !selectedTemplate.generatedTitle);
    const safeStep = Math.min(6, Math.max(1, step));

    this.setData({
      pageStatus: "form",
      initialized: true,
      draft,
      currentStep: safeStep,
      progress: (safeStep / 6) * 100,
      templateOptions,
      customGoal,
      deadlineDisplay: formatDisplayDate(draft.deadline),
      deadlineHint: this.getDeadlineHint(draft.deadline),
      categoryLabel: this.getChoiceLabel(CATEGORY_OPTIONS, draft.category),
      levelLabel: this.getChoiceLabel(LEVEL_OPTIONS, draft.currentLevel),
      intensityLabel: this.getChoiceLabel(INTENSITY_OPTIONS, draft.intensity),
    });
  },

  retryInitialize() {
    this.initializePage();
  },

  getChoiceLabel(options: Choice[], value: string | number): string {
    return options.find((item) => item.value === value)?.label || "";
  },

  getDeadlineHint(deadline: string): string {
    const remainingDays = daysUntil(deadline);
    return remainingDays > 0 && remainingDays < 7
      ? "截止日期较近，计划会优先安排最关键的任务。"
      : "";
  },

  selectCategory(event: any) {
    const category = event.currentTarget.dataset.value as GoalCategory;
    const draft: GoalDraft = {
      ...this.data.draft,
      category,
      goalTemplate: "",
      goalTitle: "",
    };
    this.setData({
      draft,
      templateOptions: TEMPLATE_OPTIONS[category],
      customGoal: false,
      categoryLabel: this.getChoiceLabel(CATEGORY_OPTIONS, category),
    });
    saveGoalDraft(draft);
  },

  selectTemplate(event: any) {
    const value = event.currentTarget.dataset.value as string;
    const option = (this.data.templateOptions as Choice[]).find((item) => item.value === value);
    if (!option) return;
    const customGoal = !option.generatedTitle;
    const draft: GoalDraft = {
      ...this.data.draft,
      goalTemplate: value,
      goalTitle: option.generatedTitle || "",
    };
    this.setData({ draft, customGoal });
    saveGoalDraft(draft);
  },

  inputCustomGoal(event: any) {
    const goalTitle = String(event.detail.value || "").slice(0, 30);
    const draft = { ...this.data.draft, goalTitle };
    this.setData({ draft });
    saveGoalDraft(draft);
  },

  selectLevel(event: any) {
    const currentLevel = event.currentTarget.dataset.value as GoalLevel;
    const draft = { ...this.data.draft, currentLevel };
    this.setData({
      draft,
      levelLabel: this.getChoiceLabel(LEVEL_OPTIONS, currentLevel),
    });
    saveGoalDraft(draft);
  },

  changeDeadline(event: any) {
    const deadline = event.detail.value;
    if (daysUntil(deadline) < 1) {
      wx.showToast({ title: "截止日期至少为明天", icon: "none" });
      return;
    }
    const draft = { ...this.data.draft, deadline };
    this.setData({
      draft,
      deadlineDisplay: formatDisplayDate(deadline),
      deadlineHint: this.getDeadlineHint(deadline),
    });
    saveGoalDraft(draft);
  },

  selectWeeklyDays(event: any) {
    const weeklyDays = Number(event.currentTarget.dataset.value);
    const draft = { ...this.data.draft, weeklyDays };
    this.setData({ draft });
    saveGoalDraft(draft);
  },

  selectMinutes(event: any) {
    const dailyMinutes = Number(event.currentTarget.dataset.value);
    const draft = { ...this.data.draft, dailyMinutes };
    this.setData({ draft });
    saveGoalDraft(draft);
  },

  selectIntensity(event: any) {
    const intensity = event.currentTarget.dataset.value as GoalIntensity;
    const draft = { ...this.data.draft, intensity };
    this.setData({
      draft,
      intensityLabel: this.getChoiceLabel(INTENSITY_OPTIONS, intensity),
    });
    saveGoalDraft(draft);
  },

  validateStep(step: number): boolean {
    const { draft } = this.data;
    if (step === 1 && !draft.category) return this.showError("请选择目标类型");
    if (step === 2 && !draft.goalTemplate) return this.showError("请选择具体目标");
    if (step === 2 && !draft.goalTitle.trim()) return this.showError("请输入具体目标");
    if (step === 2 && draft.goalTitle.trim().length > 30) return this.showError("目标最多 30 个字符");
    if (step === 3 && !draft.currentLevel) return this.showError("请选择当前水平");
    if (step === 4 && daysUntil(draft.deadline) < 1) return this.showError("截止日期至少为明天");
    if (step === 5 && (draft.weeklyDays < 3 || draft.weeklyDays > 7)) {
      return this.showError("请选择每周学习天数");
    }
    if (step === 5 && ![15, 30, 45, 60, 90, 120].includes(draft.dailyMinutes)) {
      return this.showError("请选择每天可投入时间");
    }
    if (step === 6 && !draft.intensity) return this.showError("请选择执行强度");
    return true;
  },

  showError(message: string): false {
    wx.showToast({ title: message, icon: "none" });
    return false;
  },

  nextStep() {
    if (!this.validateStep(this.data.currentStep)) return;
    if (this.data.currentStep === 6) {
      this.generatePlan();
      return;
    }
    const currentStep = this.data.currentStep + 1;
    this.setData({ currentStep, progress: (currentStep / 6) * 100 });
  },

  previousStep() {
    if (this.data.currentStep === 1) {
      wx.navigateBack();
      return;
    }
    const currentStep = this.data.currentStep - 1;
    this.setData({ currentStep, progress: (currentStep / 6) * 100 });
  },

  generatePlan() {
    if (this.data.submitting || !this.validateStep(6)) return;
    this.setData({ submitting: true });
    saveGoalDraft(this.data.draft);
    clearPlanPreview();
    wx.navigateTo({
      url: "/pages/plan-preview/index?generate=1",
      complete: () => this.setData({ submitting: false }),
    });
  },
});
