import { createGoal, getActiveGoals } from "../../services/manualGoal";
import { createTask, updateTaskReminder } from "../../services/manualTask";
import { requestNotificationAuthorizationWithReceipt, upsertTaskReminder } from "../../services/notification";
import { syncManualData } from "../../services/manualSync";
import { withAppTheme } from "../../services/theme";
import { GoalCategory } from "../../types/manual";
import { buildReminderAt, nextReminderTime, reminderDateRange } from "../../utils/actionReminder";
import { addBusinessDays, getTodayBusinessDate } from "../../utils/date";
import { getUiEventString, UiComponentEvent } from "../../utils/ui-event";
import { recordProductEvent } from "../../services/productEvents";

const DRAFT_KEY = "TODAY_PROGRESS_GOAL_DRAFT_V2";
const DURATION_OPTIONS = [30, 45, 60, 90, 120, 240];

const OPTIONS: Array<{ value: GoalCategory; label: string; title: string; note: string }> = [
  { value: "postgraduate", label: "考研", title: "通过研究生考试", note: "把备考拆成每天可执行的行动" },
  { value: "civil_service", label: "考公", title: "通过公务员考试", note: "按阶段建立稳定复习节奏" },
  { value: "undergraduate_upgrade", label: "专升本", title: "通过专升本考试", note: "持续积累关键科目能力" },
  { value: "teacher", label: "教师资格证", title: "通过教师资格证考试", note: "围绕考试周期稳步推进" },
  { value: "cet", label: "英语四六级", title: "通过英语四六级考试", note: "把语言练习落实到每天" },
  { value: "custom", label: "自定义", title: "", note: "创建属于自己的成长目标" },
];

interface GoalDraft {
  step: number;
  category: GoalCategory | "";
  title: string;
  targetDate: string;
  milestoneTitle: string;
  actionTitle: string;
  estimatedMinutes: number;
  reminderEnabled: boolean;
  reminderTime: string;
}

function readDraft(): Partial<GoalDraft> {
  try { return wx.getStorageSync(DRAFT_KEY) || {}; } catch (_error) { return {}; }
}

Page(withAppTheme({
  data: {
    step: 1,
    options: OPTIONS,
    durationOptions: DURATION_OPTIONS,
    category: "" as GoalCategory | "",
    title: "",
    targetDate: "",
    milestoneTitle: "",
    actionTitle: "",
    estimatedMinutes: 45,
    reminderEnabled: false,
    reminderTime: nextReminderTime(),
    today: getTodayBusinessDate(),
    dateEnd: addBusinessDays(getTodayBusinessDate(), 730),
    reminderDateEnd: reminderDateRange().end,
    activeGoalCount: 0,
    submitting: false,
    errorMessage: "",
    createdGoalId: "",
  },

  onLoad() {
    const draft = readDraft();
    this.setData({
      activeGoalCount: getActiveGoals().length,
      step: Math.min(3, Math.max(1, Number(draft.step) || 1)),
      category: draft.category || "",
      title: draft.title || "",
      targetDate: draft.targetDate || "",
      milestoneTitle: draft.milestoneTitle || "",
      actionTitle: draft.actionTitle || "",
      estimatedMinutes: DURATION_OPTIONS.includes(Number(draft.estimatedMinutes)) ? Number(draft.estimatedMinutes) : 45,
      reminderEnabled: Boolean(draft.reminderEnabled),
      reminderTime: draft.reminderTime || nextReminderTime(),
    });
  },

  onHide() { this.saveDraft(); },
  onUnload() { if (!this.data.createdGoalId) this.saveDraft(); },

  saveDraft() {
    if (this.data.createdGoalId) return;
    wx.setStorageSync(DRAFT_KEY, {
      step: this.data.step,
      category: this.data.category,
      title: this.data.title,
      targetDate: this.data.targetDate,
      milestoneTitle: this.data.milestoneTitle,
      actionTitle: this.data.actionTitle,
      estimatedMinutes: this.data.estimatedMinutes,
      reminderEnabled: this.data.reminderEnabled,
      reminderTime: this.data.reminderTime,
    });
  },

  selectCategory(event: { currentTarget: { dataset: { value?: string } } }) {
    const category = String(event.currentTarget.dataset.value || "custom") as GoalCategory;
    const option = OPTIONS.find((item) => item.value === category);
    this.setData({ category, title: option?.title || "", errorMessage: "" });
  },

  inputTitle(event: UiComponentEvent<unknown>) { this.setData({ title: getUiEventString(event).slice(0, 30), errorMessage: "" }); },
  inputMilestone(event: UiComponentEvent<unknown>) { this.setData({ milestoneTitle: getUiEventString(event).slice(0, 30) }); },
  inputAction(event: UiComponentEvent<unknown>) { this.setData({ actionTitle: getUiEventString(event).slice(0, 40), errorMessage: "" }); },
  changeTargetDate(event: { detail: { value?: string } }) { this.setData({ targetDate: String(event.detail.value || "") }); },
  clearTargetDate() { this.setData({ targetDate: "", milestoneTitle: "" }); },
  selectDuration(event: { currentTarget: { dataset: { value?: number | string } } }) { this.setData({ estimatedMinutes: Number(event.currentTarget.dataset.value) }); },
  toggleReminder(event: { detail: { value?: boolean } }) { this.setData({ reminderEnabled: Boolean(event.detail.value), errorMessage: "" }); },
  changeReminderTime(event: { detail: { value?: string } }) { this.setData({ reminderTime: String(event.detail.value || nextReminderTime()), errorMessage: "" }); },

  previousStep() { if (!this.data.submitting && this.data.step > 1) this.setData({ step: this.data.step - 1, errorMessage: "" }); },

  nextStep() {
    if (this.data.step === 1 && (!this.data.category || this.data.title.trim().length < 2)) {
      this.setData({ errorMessage: "先选择方向，并写下一个清晰的目标结果" });
      return;
    }
    this.setData({ step: Math.min(3, this.data.step + 1), errorMessage: "" });
    this.saveDraft();
  },

  async submit() {
    if (this.data.submitting) return;
    const actionTitle = this.data.actionTitle.trim();
    if (actionTitle.length < 2) {
      this.setData({ errorMessage: "请先创建一项今天可以开始的行动" });
      return;
    }

    let remindAt = "";
    if (this.data.reminderEnabled) {
      try { remindAt = buildReminderAt(this.data.today, this.data.reminderTime); }
      catch (error) { this.setData({ errorMessage: error instanceof Error ? error.message : "提醒时间无效" }); return; }
    }

    this.setData({ submitting: true, errorMessage: "" });
    try {
      let goalId = this.data.createdGoalId;
      if (!goalId) {
        const now = new Date().toISOString();
        const milestoneTitle = this.data.milestoneTitle.trim();
        const goal = createGoal({
          title: this.data.title,
          category: this.data.category as GoalCategory,
          targetDate: this.data.targetDate || undefined,
          milestones: milestoneTitle ? [{ id: `milestone_${Date.now()}`, title: milestoneTitle, targetDate: this.data.targetDate || undefined, status: "pending" }] : undefined,
          onboardingCompletedAt: now,
        });
        goalId = goal.id;
        this.setData({ createdGoalId: goalId });
        recordProductEvent("goal_created", { hasTargetDate: Boolean(this.data.targetDate), hasMilestone: Boolean(milestoneTitle) });
      }

      let receipt: Awaited<ReturnType<typeof requestNotificationAuthorizationWithReceipt>> | null = null;
      if (this.data.reminderEnabled) {
        try { receipt = await requestNotificationAuthorizationWithReceipt("daily_action_reminder", "task_reminder"); }
        catch (_error) { receipt = null; }
      }
      const reminderAllowed = !this.data.reminderEnabled || receipt?.result === "accept";
      const task = createTask({
        goalId,
        title: actionTitle,
        currentDate: this.data.today,
        estimatedMinutes: this.data.estimatedMinutes,
        reminder: this.data.reminderEnabled && reminderAllowed
          ? { time: this.data.reminderTime, remindAt, status: "pending_authorization" }
          : null,
      });
      recordProductEvent("first_action_created", { estimatedMinutes: this.data.estimatedMinutes, reminderRequested: this.data.reminderEnabled });

      if (this.data.reminderEnabled && reminderAllowed) {
        try {
          await upsertTaskReminder({ taskId: task.id, remindAt, authorizationRequestId: receipt?.requestId });
          updateTaskReminder(task.id, { time: this.data.reminderTime, remindAt, status: "scheduled" });
        } catch (_error) {
          updateTaskReminder(task.id, { time: this.data.reminderTime, remindAt, status: "failed" });
        }
      }
      await syncManualData().catch(() => undefined);
      wx.removeStorageSync(DRAFT_KEY);
      wx.showToast({ title: "第一项行动已就绪", icon: "success" });
      setTimeout(() => wx.switchTab({ url: "/pages/index/index" }), 350);
    } catch (error) {
      const message = error instanceof Error ? error.message : "创建失败，请重试";
      this.setData({ submitting: false, errorMessage: this.data.createdGoalId ? `目标已保留，行动创建失败：${message}` : message });
    }
  },
}));
