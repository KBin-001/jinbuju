import { getActiveGoal } from "../../services/manualGoal";
import { createTask, getTask, updateTask } from "../../services/manualTask";
import { formatDate } from "../../utils/date";
import { withAppTheme } from "../../services/theme";

Page(withAppTheme({
  data: {
    taskId: "",
    goalId: "",
    title: "",
    description: "",
    estimatedMinutes: 30,
    currentDate: formatDate(new Date()),
    submitting: false,
    loading: true,
    errorMessage: "",
    isEdit: false,
  },

  onLoad(query: Record<string, string>) {
    const taskId = String(query.id || "");
    const goalId = String(query.goalId || "");
    const currentDate = /^\d{4}-\d{2}-\d{2}$/.test(String(query.date || "")) ? String(query.date) : this.data.currentDate;
    if (!taskId) {
      this.setData({ loading: false, goalId, currentDate });
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
  },

  inputTitle(event: { detail: { value?: string } }) {
    this.setData({ title: String(event.detail.value || "").slice(0, 40) });
  },

  inputDescription(event: { detail: { value?: string } }) {
    this.setData({ description: String(event.detail.value || "").slice(0, 150) });
  },

  inputMinutes(event: { detail: { value?: string } }) {
    this.setData({ estimatedMinutes: Number(event.detail.value) });
  },

  changeDate(event: { detail: { value?: string } }) {
    this.setData({ currentDate: String(event.detail.value || "") });
  },

  save() {
    if (this.data.submitting) return;
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
        title: this.data.title,
        description: this.data.description,
        estimatedMinutes: Number(this.data.estimatedMinutes),
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
