import { checkActiveGoal } from "../../services/plan";
import {
  GoalIntensity,
  GoalLevel,
  GoalTemplateId,
  LongTermGoalDraft,
  PlanDurationDays,
} from "../../types/stage";
import {
  clearStagePreviewCache,
  getLongTermGoalDraft,
  saveLongTermGoalDraft,
} from "../../utils/storage";
import { addDays, formatDate } from "../../utils/date";

interface DatasetEvent {
  currentTarget: {
    dataset: {
      value?: string | number;
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
    submitting: false,
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
        this.setData({
          pageStatus: "form",
          draft: getLongTermGoalDraft() || defaultDraft(),
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

  selectTemplate(event: DatasetEvent) {
    const templateId = String(event.currentTarget.dataset.value || "") as GoalTemplateId;
    this.setData({ draft: { ...this.data.draft, templateId } });
  },

  inputCustomGoal(event: { detail: { value?: string } }) {
    this.setData({
      draft: {
        ...this.data.draft,
        customGoalTitle: String(event.detail.value || "").slice(0, 30),
      },
    });
  },

  selectLevel(event: DatasetEvent) {
    this.setData({
      draft: {
        ...this.data.draft,
        currentLevel: String(event.currentTarget.dataset.value || "") as GoalLevel,
      },
    });
  },

  selectMinutes(event: DatasetEvent) {
    this.setData({
      draft: {
        ...this.data.draft,
        dailyMinutes: Number(event.currentTarget.dataset.value) as LongTermGoalDraft["dailyMinutes"],
      },
    });
  },

  selectWeeklyDays(event: DatasetEvent) {
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
    this.setData({
      draft: {
        ...this.data.draft,
        intensity: String(event.currentTarget.dataset.value || "") as GoalIntensity,
      },
    });
  },

  changeDeadline(event: { detail: { value?: string } }) {
    this.setData({
      draft: { ...this.data.draft, deadline: String(event.detail.value || "") },
    });
  },

  clearDeadline() {
    this.setData({ draft: { ...this.data.draft, deadline: "" } });
  },

  previousStep() {
    if (this.data.currentStep === 1) {
      wx.navigateBack();
      return;
    }
    this.setData({ currentStep: 1 });
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
    if (this.data.submitting) return;
    const draft = {
      ...this.data.draft,
      customGoalTitle: this.data.draft.customGoalTitle?.trim() || "",
    };
    saveLongTermGoalDraft(draft);
    clearStagePreviewCache();
    this.setData({ submitting: true });
    wx.navigateTo({
      url: "/pages/plan-preview/index?create=1",
      complete: () => this.setData({ submitting: false }),
    });
  },
});
