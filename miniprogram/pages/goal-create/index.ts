import { checkActiveGoal } from "../../services/plan";
import { LongTermGoalDraft, LongTermGoalCategory, TargetDuration } from "../../types/stage";
import {
  clearLongTermGoalDraft,
  clearStagePreviewCache,
  getLongTermGoalDraft,
  saveLongTermGoalDraft,
} from "../../utils/storage";

interface Choice {
  value: string | number;
  label: string;
  description?: string;
}

const CATEGORY_OPTIONS: Choice[] = [
  { value: "exam", label: "考试提升", description: "考试、证书与升学准备" },
  { value: "skill", label: "技能学习", description: "编程、设计、AI 与工作技能" },
  { value: "career", label: "求职成长", description: "简历、面试、作品集与职场能力" },
  { value: "reading", label: "阅读", description: "建立阅读节奏与知识积累" },
  { value: "fitness", label: "运动健康", description: "建立适合自己的日常运动习惯" },
  { value: "habit", label: "习惯养成", description: "把想坚持的事变成稳定行动" },
  { value: "other", label: "其他", description: "定义一个对你重要的长期方向" },
];
const DURATION_OPTIONS: Choice[] = [
  { value: "1_month", label: "1 个月" },
  { value: "3_months", label: "3 个月" },
  { value: "6_months", label: "6 个月" },
  { value: "long_term", label: "长期坚持" },
];
const MINUTE_OPTIONS = [10, 15, 30, 45, 60, 90, 120, 180];

function defaultDraft(): LongTermGoalDraft {
  return {
    title: "",
    category: "",
    desiredResult: "",
    dailyMinutes: 30,
    targetDuration: "3_months",
  };
}

Page({
  data: {
    pageStatus: "loading" as "loading" | "form" | "error",
    pageError: "",
    currentStep: 1,
    totalSteps: 4,
    progress: 25,
    submitting: false,
    draft: defaultDraft(),
    categoryOptions: CATEGORY_OPTIONS,
    durationOptions: DURATION_OPTIONS,
    minuteOptions: MINUTE_OPTIONS,
    categoryLabel: "",
    durationLabel: "3 个月",
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
            content: "V1 暂不支持同时创建多个长期目标。",
            showCancel: false,
            success: () => wx.switchTab({ url: "/pages/plan/index" }),
          });
          return;
        }
        const saved = getLongTermGoalDraft();
        this.applyDraft(saved || defaultDraft());
      })
      .catch((error: Error) => {
        this.setData({
          pageStatus: "error",
          pageError: error.message || "暂时无法开始创建，请稍后重试。",
        });
      });
  },

  applyDraft(draft: LongTermGoalDraft) {
    this.setData({
      pageStatus: "form",
      draft,
      categoryLabel:
        CATEGORY_OPTIONS.find((item) => item.value === draft.category)?.label || "",
      durationLabel:
        DURATION_OPTIONS.find((item) => item.value === draft.targetDuration)?.label || "",
    });
  },

  retryInitialize() {
    this.setData({ pageStatus: "loading", pageError: "" });
    this.initialize();
  },

  inputTitle(event: { detail: { value?: string } }) {
    const draft = { ...this.data.draft, title: String(event.detail.value || "").slice(0, 30) };
    this.setData({ draft });
  },

  selectCategory(event: { currentTarget: { dataset: { value?: string } } }) {
    const category = String(event.currentTarget.dataset.value || "") as LongTermGoalCategory;
    const draft = { ...this.data.draft, category };
    this.setData({
      draft,
      categoryLabel: CATEGORY_OPTIONS.find((item) => item.value === category)?.label || "",
    });
  },

  inputDesiredResult(event: { detail: { value?: string } }) {
    const draft = {
      ...this.data.draft,
      desiredResult: String(event.detail.value || "").slice(0, 200),
    };
    this.setData({ draft });
  },

  selectMinutes(event: { currentTarget: { dataset: { value?: number } } }) {
    const draft = { ...this.data.draft, dailyMinutes: Number(event.currentTarget.dataset.value) };
    this.setData({ draft });
  },

  selectDuration(event: { currentTarget: { dataset: { value?: string } } }) {
    const targetDuration = String(event.currentTarget.dataset.value || "") as TargetDuration;
    const draft = { ...this.data.draft, targetDuration };
    this.setData({
      draft,
      durationLabel:
        DURATION_OPTIONS.find((item) => item.value === targetDuration)?.label || "",
    });
  },

  validateStep(step: number): boolean {
    const draft = this.data.draft;
    if (step === 1 && (draft.title.trim().length < 2 || draft.title.trim().length > 30)) {
      return this.showError("目标名称需为 2～30 个字符");
    }
    if (step === 2 && !draft.category) return this.showError("请选择目标分类");
    if (
      step === 3 &&
      (draft.desiredResult.trim().length < 5 || draft.desiredResult.trim().length > 200)
    ) {
      return this.showError("期望结果需为 5～200 个字符");
    }
    if (step === 4 && (draft.dailyMinutes < 10 || draft.dailyMinutes > 180)) {
      return this.showError("请选择每天可投入时间");
    }
    return true;
  },

  showError(message: string): false {
    wx.showToast({ title: message, icon: "none" });
    return false;
  },

  previousStep() {
    if (this.data.currentStep === 1) {
      wx.navigateBack();
      return;
    }
    const currentStep = this.data.currentStep - 1;
    this.setData({ currentStep, progress: (currentStep / 4) * 100 });
  },

  nextStep() {
    if (!this.validateStep(this.data.currentStep)) return;
    if (this.data.currentStep < 4) {
      const currentStep = this.data.currentStep + 1;
      this.setData({ currentStep, progress: (currentStep / 4) * 100 });
      return;
    }
    if (this.data.submitting) return;
    const draft = {
      ...this.data.draft,
      title: this.data.draft.title.trim(),
      desiredResult: this.data.draft.desiredResult.trim(),
    };
    saveLongTermGoalDraft(draft);
    clearStagePreviewCache();
    this.setData({ submitting: true });
    wx.navigateTo({
      url: "/pages/plan-preview/index?generate=1",
      complete: () => this.setData({ submitting: false }),
    });
  },
});
