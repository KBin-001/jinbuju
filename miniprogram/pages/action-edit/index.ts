import { getActiveGoal } from "../../services/manualGoal";
import { createTask, getTask, updateTask, updateTaskReminder } from "../../services/manualTask";
import { cancelTaskReminder, requestNotificationAuthorizationWithReceipt, upsertTaskReminder } from "../../services/notification";
import { syncManualData } from "../../services/manualSync";
import { getTodayBusinessDate } from "../../utils/date";
import { buildReminderAt, nextReminderTime, normalizeReminderTime, reminderDateRange } from "../../utils/actionReminder";
import { withAppTheme } from "../../services/theme";
import { ACTION_DURATION_VALUES } from "../../config/action";

Page(withAppTheme({
  data: {
    taskId: "",
    goalId: "",
    title: "",
    description: "",
    estimatedMinutes: 30,
    durationOptions: ACTION_DURATION_VALUES,
    currentDate: getTodayBusinessDate(),
    todayDate: getTodayBusinessDate(),
    dateEnd: reminderDateRange().end,
    reminderEnabled: false,
    reminderTime: nextReminderTime(),
    hadScheduledReminder: false,
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
      reminderEnabled: task.reminder?.status === "scheduled",
      reminderTime: task.reminder?.time || nextReminderTime(),
      hadScheduledReminder: task.reminder?.status === "scheduled",
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

  toggleReminder(event: { detail: { value?: boolean } }) {
    this.setData({ reminderEnabled: Boolean(event.detail.value), validationMessage: "" });
  },

  changeReminderTime(event: { detail: { value?: string } }) {
    try {
      this.setData({ reminderTime: normalizeReminderTime(String(event.detail.value || "")), validationMessage: "" });
    } catch (error) {
      this.setData({ validationMessage: error instanceof Error ? error.message : "请选择有效提醒时间" });
    }
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  async save() {
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

    let remindAt = "";
    if (this.data.reminderEnabled) {
      try {
        remindAt = buildReminderAt(this.data.currentDate, this.data.reminderTime);
      } catch (error) {
        this.setData({ validationMessage: error instanceof Error ? error.message : "提醒时间无效" });
        return;
      }
    }

    this.setData({ submitting: true });
    try {
      const needsAuthorization = this.data.reminderEnabled && !this.data.hadScheduledReminder;
      let receipt: Awaited<ReturnType<typeof requestNotificationAuthorizationWithReceipt>> | null = null;
      if (needsAuthorization) {
        try {
          receipt = await requestNotificationAuthorizationWithReceipt("daily_action_reminder", "task_reminder");
        } catch (_error) {
          receipt = null;
        }
      }
      const reminderAllowed = !needsAuthorization || receipt?.result === "accept";
      const input = {
        id: this.data.taskId || undefined,
        goalId,
        title,
        description: this.data.description,
        estimatedMinutes,
        currentDate: this.data.currentDate,
        reminder: this.data.reminderEnabled && reminderAllowed
          ? { time: this.data.reminderTime, remindAt, status: this.data.hadScheduledReminder ? "scheduled" as const : "pending_authorization" as const }
          : null,
      };
      const task = this.data.isEdit ? updateTask(input) : createTask(input);
      await syncManualData();
      let reminderScheduled = false;
      if (this.data.reminderEnabled && reminderAllowed) {
        try {
          await upsertTaskReminder({ taskId: task.id, remindAt, authorizationRequestId: receipt?.requestId });
          updateTaskReminder(task.id, { time: this.data.reminderTime, remindAt, status: "scheduled" });
          reminderScheduled = true;
        } catch (_error) {
          updateTaskReminder(task.id, { time: this.data.reminderTime, remindAt, status: "failed" });
        }
      } else if (this.data.hadScheduledReminder) {
        await cancelTaskReminder(task.id).catch(() => undefined);
      }
      const reminderRejected = this.data.reminderEnabled && !reminderAllowed;
      wx.showToast({ title: reminderRejected || (this.data.reminderEnabled && !reminderScheduled) ? "行动已保存，提醒未开启" : (this.data.isEdit ? "行动已更新" : "行动已添加"), icon: reminderRejected ? "none" : "success" });
      setTimeout(() => wx.navigateBack(), 300);
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "保存失败", icon: "none" });
      this.setData({ submitting: false });
    }
  },
}));
