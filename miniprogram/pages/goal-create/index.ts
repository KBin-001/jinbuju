import { FEATURE_FLAGS } from "../../config/features";
import { createGoal, getActiveGoals } from "../../services/manualGoal";
import { GoalCategory } from "../../types/manual";
import { getUiEventString, UiComponentEvent } from "../../utils/ui-event";

const OPTIONS: Array<{ value: GoalCategory; label: string; title: string }> = [
  { value: "cet", label: "英语四六级", title: "通过英语四六级" },
  { value: "teacher", label: "教师资格证", title: "通过教师资格证考试" },
  { value: "postgraduate", label: "考研", title: "准备研究生考试" },
  { value: "civil_service", label: "考公", title: "准备公务员考试" },
  { value: "ai_learning", label: "AI 学习", title: "系统学习 AI" },
  { value: "custom", label: "自定义目标", title: "" },
];

Page({
  data: {
    options: OPTIONS,
    category: "cet" as GoalCategory,
    title: OPTIONS[0].title,
    description: "",
    submitting: false,
    activeGoalCount: 0,
    aiEnabled: FEATURE_FLAGS.ENABLE_AI_PLANNER,
  },

  onLoad() {
    this.setData({ activeGoalCount: getActiveGoals().length });
  },

  selectCategory(event: { currentTarget: { dataset: { value?: string } } }) {
    const category = String(event.currentTarget.dataset.value || "custom") as GoalCategory;
    const option = OPTIONS.find((item) => item.value === category);
    this.setData({ category, title: option?.title || "" });
  },

  inputTitle(event: UiComponentEvent<unknown>) {
    this.setData({ title: getUiEventString(event).slice(0, 30) });
  },

  inputDescription(event: { detail: { value?: string } }) {
    this.setData({ description: String(event.detail.value || "").slice(0, 150) });
  },

  submit() {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      createGoal({ title: this.data.title, category: this.data.category, description: this.data.description });
      wx.showToast({ title: "目标已创建", icon: "success" });
      setTimeout(() => wx.switchTab({ url: "/pages/index/index" }), 350);
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "创建失败，请重试", icon: "none" });
      this.setData({ submitting: false });
    }
  },
});
