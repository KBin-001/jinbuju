import { getActiveGoal } from "../../services/manualGoal";
import { createTask, getTask, updateTask } from "../../services/manualTask";
import { getTodayBusinessDate } from "../../utils/date";
import { withAppTheme } from "../../services/theme";

Page(withAppTheme({
  data: {
    taskId: "",
    goalId: "",
    title: "",
    description: "",
    estimatedMinutes: 30,
    durationOptions: [30, 45, 60, 90, 120, 240],
    currentDate: getTodayBusinessDate(),
    submitting: false,
    loading: true,
    errorMessage: "",
    isEdit: false,
    validationMessage: "",
  },

  onLoad(query: Record<string, string>) {
    const taskId = String(query.id || "");
    const goalId = String(query.goalId || "");
    const currentDate = /^\d{4}-\d{2}-\d{2}$/.test(String(query.date || "")) ? String(query.date) : this.data.currentDate;
    if (!taskId) {
      this.setData({ loading: false, goalId, currentDate });
      wx.setNavigationBarTitle({ title: "添加行动" });
      return;
    }

    const task = getTask(taskId);
    if (!task) {
      this.setData({ loading: false, errorMessage: "行动不存在或已被删除" });
      return;
    }

    this.setData({
      taskId,
      goalId: task.goalId,
      title: task.title,
      description: task.description || "",
      estimatedMinutes: task.estimatedMinutes,
      currentDate: task.currentDate,
      loading: false,
      isEdit: true,
    });
    wx.setNavigationBarTitle({ title: "编辑行动" });
  },

  inputTitle(event: { detail: { value?: string } }) {
    this.setData({ title: String(event.detail.value || "").slice(0, 40), validationMessage: "" });
  },

  inputMinutes(event: { detail: { value?: string } }) {
    this.setData({ estimatedMinutes: Number(event.detail.value), validationMessage: "" });
  },

  selectDuration(event: { currentTarget: { dataset: { value?: string | number } } }) {
    if (this.data.submitting) return;
    const estimatedMinutes = Number(event.currentTarget.dataset.value);
    if (!Number.isInteger(estimatedMinutes)) return;
    this.setData({ estimatedMinutes, validationMessage: "" });
  },

  changeDate(event: { detail: { value?: string } }) {
    this.setData({ currentDate: String(event.detail.value || "") });
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  save() {
    if (this.data.submitting) return;
    const title = this.data.title.trim();
    const estimatedMinutes = Number(this.data.estimatedMinutes);
    if (title.length < 2) {
      this.setData({ validationMessage: "请填写至少 2 个字的行动标题" });
      return;
    }
    if (!Number.isInteger(estimatedMinutes) || estimatedMinutes < 5 || estimatedMinutes > 240) {
      this.setData({ validationMessage: "预计投入需为 5～240 分钟的整数" });
      return;
    }
    const goalId = this.data.goalId || getActiveGoal()?.id || "";
    if (!goalId) {
      wx.showToast({ title: "请先创建目标", icon: "none" });
      return;
    }

    this.setData({ submitting: true });
    try {
      const input = {
        id: this.data.taskId || undefined,
        goalId,
        title,
        description: this.data.description,
        estimatedMinutes,
        currentDate: this.data.currentDate,
      };
      this.data.isEdit ? updateTask(input) : createTask(input);
      wx.showToast({ title: this.data.isEdit ? "行动已更新" : "行动已添加", icon: "success" });
      setTimeout(() => wx.navigateBack(), 300);
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "保存失败", icon: "none" });
      this.setData({ submitting: false });
    }
  },
}));
