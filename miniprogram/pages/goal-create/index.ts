import { createGoal, getActiveGoals } from "../../services/manualGoal";
import { GoalCategory } from "../../types/manual";
import { getUiEventString, UiComponentEvent } from "../../utils/ui-event";
import { withAppTheme } from "../../services/theme";

const OPTIONS: Array<{ value: GoalCategory; label: string; title: string; mark: string; note: string; tone: string }> = [
  { value: "postgraduate", label: "考研", title: "准备研究生考试", mark: "研", note: "稳步备考", tone: "green" },
  { value: "civil_service", label: "考公", title: "准备公务员考试", mark: "公", note: "系统上岸", tone: "gold" },
  { value: "undergraduate_upgrade", label: "专升本", title: "准备专升本考试", mark: "本", note: "提升学历", tone: "sage" },
  { value: "teacher", label: "教师资格证", title: "通过教师资格证考试", mark: "师", note: "拿下证书", tone: "gold" },
  { value: "cet", label: "英语四六级", title: "通过英语四六级", mark: "英", note: "突破语言", tone: "sage" },
  { value: "custom", label: "自定义", title: "", mark: "+", note: "我的方向", tone: "plain" },
];

Page(withAppTheme({
  data: {
    options: OPTIONS,
    category: "" as GoalCategory | "",
    title: "",
    titleFocused: false,
    submitting: false,
    activeGoalCount: 0,
  },

  onLoad() {
    this.setData({ activeGoalCount: getActiveGoals().length });
  },

  selectCategory(event: { currentTarget: { dataset: { value?: string } } }) {
    const category = String(event.currentTarget.dataset.value || "custom") as GoalCategory;
    const option = OPTIONS.find((item) => item.value === category);
    this.setData({
      category,
      title: option?.title || "",
      titleFocused: category === "custom",
    });
  },

  inputTitle(event: UiComponentEvent<unknown>) {
    this.setData({ title: getUiEventString(event).slice(0, 30) });
  },

  focusTitle() {
    this.setData({ titleFocused: true });
  },

  blurTitle() {
    this.setData({ titleFocused: false });
  },

  submit() {
    if (this.data.submitting || !this.data.category) return;
    this.setData({ submitting: true });
    try {
      createGoal({ title: this.data.title, category: this.data.category as GoalCategory });
      wx.showToast({ title: "目标已创建", icon: "success" });
      setTimeout(() => wx.switchTab({ url: "/pages/index/index" }), 350);
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "创建失败，请重试", icon: "none" });
      this.setData({ submitting: false });
    }
  },
}));
