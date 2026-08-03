import { DailyCoachAnalysis, getDailyCoachAnalysis } from "../../services/dailyCoach";
import { askProgressCoach, prepareProgressCoach } from "../../services/progressCoach";
import { executeCoachProposal } from "../../services/manualSync";
import { getProgressSummary } from "../../services/manualStats";
import { getCurrentThemeId } from "../../services/theme";
import { getLocalUserProfile } from "../../services/profile";
import { bootstrapAccount } from "../../services/account";
import { getTodayBusinessDate } from "../../utils/date";
import { ProgressCoachChatMessage } from "../../types/progressCoach";
import { off, on } from "../../utils/eventBus";
import { openTodayActionEditor } from "../../utils/todayActionEditor";

interface DailyChatMessage extends ProgressCoachChatMessage {
  id: string;
}

interface CoachEvidence {
  id: string;
  tone: "positive" | "warning" | "info";
  icon: string;
  title: string;
  description: string;
}

interface DailyTaskPreview {
  id: string;
  title: string;
  subtitle: string;
  tone: "complete" | "active" | "pending";
  icon: string;
  statusLabel: string;
}

interface ProgressDayView {
  date: string;
  label: string;
  level: 0 | 1 | 2 | 3;
  isToday: boolean;
}

interface WorkspaceView {
  conclusionTitle: string;
  conclusionSubtitle: string;
  todayStatus: string;
  statusTone: string;
  judgementTitle: string;
  streakDays: number;
  longestStreakDays: number;
  todayAdvice: string;
  taskPreviews: DailyTaskPreview[];
  recentDays: ProgressDayView[];
  evidences: CoachEvidence[];
}

const EMPTY_ANALYSIS: DailyCoachAnalysis = {
  date: "", dateLabel: "", goalId: "", goalTitle: "暂未设置目标", completedCount: 0, pendingCount: 0,
  totalCount: 0, actualMinutes: 0, remainingEstimatedMinutes: 0, completionPercent: 0,
  completedTasks: [], pendingTasks: [], priorityTask: null, judgement: "", bottlenecks: [], suggestions: [],
};

const EMPTY_WORKSPACE: WorkspaceView = {
  conclusionTitle: "正在整理今天的行动",
  conclusionSubtitle: "真实记录越完整，教练判断越准确。",
  todayStatus: "尚未开始",
  statusTone: "idle",
  judgementTitle: "正在核对今天的行动记录。",
  streakDays: 0,
  longestStreakDays: 0,
  todayAdvice: "完成第一项行动后，教练会结合真实记录给出建议。",
  taskPreviews: [],
  recentDays: [],
  evidences: [],
};

const WEEKDAY_SHORT = ["日", "一", "二", "三", "四", "五", "六"];

function taskPreviewSubtitle(task: DailyCoachAnalysis["completedTasks"][number]): string {
  const description = String(task.description || "").trim();
  if (description) return description;
  if (task.actualMinutes > 0) return `实际 ${task.actualMinutes} 分钟 · 预计 ${task.estimatedMinutes} 分钟`;
  return `预计投入 ${task.estimatedMinutes} 分钟`;
}

function buildTaskPreviews(analysis: DailyCoachAnalysis): DailyTaskPreview[] {
  const ordered = analysis.completedTasks.concat(
    analysis.pendingTasks.filter((task) => task.status === "partially_completed"),
    analysis.pendingTasks.filter((task) => task.status !== "partially_completed"),
  );
  return ordered.slice(0, 3).map((task) => {
    if (task.status === "completed") return { id: task.id, title: task.title, subtitle: taskPreviewSubtitle(task), tone: "complete" as const, icon: "check-circle", statusLabel: "已完成" };
    if (task.status === "partially_completed") return { id: task.id, title: task.title, subtitle: taskPreviewSubtitle(task), tone: "active" as const, icon: "edit", statusLabel: "进行中" };
    return { id: task.id, title: task.title, subtitle: taskPreviewSubtitle(task), tone: "pending" as const, icon: "time", statusLabel: "待完成" };
  });
}

function progressLevel(completedCount: number, partialCount: number, totalCount: number): 0 | 1 | 2 | 3 {
  if (!totalCount) return 0;
  const ratio = (completedCount + partialCount * 0.5) / totalCount;
  if (ratio >= 1) return 3;
  if (ratio >= 0.5) return 2;
  return ratio > 0 ? 1 : 0;
}

function buildRecentDays(progress: ReturnType<typeof getProgressSummary> | null): ProgressDayView[] {
  return (progress?.recentDays || []).slice().reverse().map((day) => {
    const date = new Date(`${day.date}T00:00:00+08:00`);
    return {
      date: day.date,
      label: day.isToday ? "今" : WEEKDAY_SHORT[date.getDay()],
      level: progressLevel(day.completedCount, day.partialCount, day.totalCount),
      isToday: day.isToday,
    };
  });
}

function buildTodayAdvice(analysis: DailyCoachAnalysis): string {
  const remaining = Math.max(0, analysis.totalCount - analysis.completedCount);
  if (!analysis.totalCount) return "先添加一项今天能完成的小行动，建立第一条真实记录。";
  if (analysis.completedCount === analysis.totalCount) return "今天的行动已经全部完成，保持当前节奏，并记录一个有效做法。";
  if (analysis.priorityTask && (analysis.actualMinutes > 0 || analysis.completedCount > 0)) return `你已经开始推进，接下来优先完成“${analysis.priorityTask.title}”，先把最接近收尾的一项做好。`;
  return `今天还有 ${remaining} 项行动待完成，先从最容易开始的一项进入节奏。`;
}

function getNavigationMetrics() {
  try {
    const windowInfo = wx.getWindowInfo();
    const menu = wx.getMenuButtonBoundingClientRect();
    const navTop = Math.max(windowInfo.statusBarHeight, menu.top);
    const navHeight = Math.max(32, menu.height);
    return {
      statusBarHeight: windowInfo.statusBarHeight,
      navTop,
      navHeight,
      scopeTop: navTop + navHeight + 9,
      scopeMenuTop: navTop + navHeight + 50,
      headlineTop: navTop + navHeight + 82,
      menuRightInset: Math.max(92, windowInfo.windowWidth - menu.left + 8),
    };
  } catch (_error) {
    return { statusBarHeight: 44, navTop: 44, navHeight: 32, scopeTop: 85, scopeMenuTop: 126, headlineTop: 158, menuRightInset: 96 };
  }
}

function aiErrorMessage(rawError: unknown): string {
  const error = rawError as Error & { code?: string };
  if (error?.code === "FUNCTION_NOT_FOUND") return "AI 云函数尚未上传，请先部署服务。";
  if (error?.code === "COACH_RUNTIME_MISMATCH") return "云端 AI 教练版本较旧，请重新上传 generatePlan 云函数。";
  if (error?.code === "AI_COACH_INVALID") return "这次回答没有通过数据校验，请再试一次。";
  if (error?.code === "MANUAL_STORAGE_UNAVAILABLE") return "行动数据存储尚未初始化，请重新进入页面后再试。";
  if (error?.code === "COACH_ACTION_CONFLICT") return error.message || "行动数据已变化，请重新发送指令。";
  if (error?.code === "COACH_ACTION_EXPIRED") return "确认操作已过期，请重新发送指令。";
  if (error?.code === "FUNCTION_TIMEOUT" || error?.code === "NETWORK_ERROR") return "连接有点慢，请稍后重试。";
  return error?.message || "AI 教练暂时没有生成回答，请稍后再试。";
}

function buildWorkspace(analysis: DailyCoachAnalysis): WorkspaceView {
  const completedTasks = analysis.completedTasks;
  const missingRecord = completedTasks.find((task) => task.actualMinutes <= 0);
  const allCompleted = analysis.totalCount > 0 && analysis.completedCount === analysis.totalCount;
  const hasStarted = analysis.actualMinutes > 0 || analysis.completedCount > 0
    || analysis.pendingTasks.some((task) => task.status === "partially_completed");
  const progress = analysis.goalId ? getProgressSummary(analysis.goalId, analysis.date) : null;
  const priorDays = progress?.recentDays.slice(1) || [];
  const returnedAfterGap = hasStarted && Boolean(priorDays.slice(1).some((day) => day.completedCount > 0 || day.partialCount > 0))
    && !Boolean(priorDays[0] && (priorDays[0].completedCount > 0 || priorDays[0].partialCount > 0));
  let todayStatus = "尚未开始";
  let statusTone = "idle";
  if (allCompleted) { todayStatus = "今日完成"; statusTone = "complete"; }
  else if (returnedAfterGap) { todayStatus = "重新找回节奏"; statusTone = "return"; }
  else if (analysis.completedCount > 0) { todayStatus = "稳定推进"; statusTone = "steady"; }
  else if (hasStarted) { todayStatus = "开始行动"; statusTone = "started"; }

  let conclusionTitle = "今日行动尚未开始";
  let conclusionSubtitle = "选择一项最容易启动的行动，先迈出第一步。";
  let judgementTitle = "今天还没有形成行动记录。";
  if (!analysis.totalCount) {
    conclusionTitle = "今天还没有安排行动";
    conclusionSubtitle = "添加一件具体的小事，教练会陪你开始。";
    judgementTitle = "当前数据不足，先建立第一条真实行动。";
  } else if (allCompleted && missingRecord) {
    conclusionTitle = "今天的行动已经完成\n但投入记录还不够完整";
    conclusionSubtitle = "补充真实投入，让成长记录更准确吧。";
    judgementTitle = "今天完成得不错，但记录质量偏低。";
  } else if (allCompleted) {
    conclusionTitle = "今天的行动已经完成\n投入记录也很完整";
    conclusionSubtitle = "今天的节奏已收好，可以轻松准备明天。";
    judgementTitle = "行动与记录都已完成，今天的节奏很稳定。";
  } else if (hasStarted) {
    conclusionTitle = `今天已经开始推进\n还有 ${analysis.totalCount - analysis.completedCount} 项待完成`;
    conclusionSubtitle = "保持当前节奏，先完成最接近收尾的一项。";
    judgementTitle = analysis.completedCount > 0 ? "今天已经形成进展，接下来适合集中收尾。" : "行动已经启动，但还需要完成一次明确收口。";
  }

  const evidences: CoachEvidence[] = [];
  if (analysis.totalCount) {
    evidences.push({
      id: "completion", tone: analysis.completedCount > 0 ? "positive" : "info",
      icon: analysis.completedCount > 0 ? "check-circle-filled" : "info-circle-filled",
      title: analysis.completedCount === analysis.totalCount ? `${analysis.completedCount} 项行动全部完成` : `已完成 ${analysis.completedCount} / ${analysis.totalCount} 项行动`,
      description: analysis.completedCount ? "今日行动完成率来自真实完成记录。" : "完成第一项后，教练会更新判断。",
    });
  }
  if (missingRecord) {
    evidences.push({ id: "record", tone: "warning", icon: "error-circle-filled", title: "投入记录还不完整", description: "至少有一项已完成行动尚未填写真实时长。" });
  } else if (hasStarted) {
    evidences.push({ id: "minutes", tone: "info", icon: "time-filled", title: `今天已记录 ${analysis.actualMinutes} 分钟投入`, description: "实际投入与预计投入分开统计。" });
  }
  if (progress?.currentStreakDays && hasStarted) {
    evidences.push({ id: "streak", tone: "positive", icon: "check-circle-filled", title: `连续行动 ${progress.currentStreakDays} 天`, description: "今天的有效行动延续了当前节奏。" });
  } else if (!analysis.totalCount) {
    evidences.push({ id: "empty", tone: "info", icon: "info-circle-filled", title: "暂无可分析的今日行动", description: "添加行动后，这里只会展示真实依据。" });
  }

  return {
    conclusionTitle, conclusionSubtitle, todayStatus, statusTone, judgementTitle,
    streakDays: Math.max(0, Number(progress?.currentStreakDays || 0)),
    longestStreakDays: Math.max(0, Number(progress?.longestStreakDays || 0)),
    todayAdvice: buildTodayAdvice(analysis),
    taskPreviews: buildTaskPreviews(analysis),
    recentDays: buildRecentDays(progress),
    evidences: evidences.slice(0, 3),
  };
}

Page({
  data: {
    appTheme: getCurrentThemeId(), ...getNavigationMetrics(), status: "loading" as "loading" | "ready" | "error", errorMessage: "",
    requestedDate: "", requestedGoalId: "", analysis: EMPTY_ANALYSIS, workspace: EMPTY_WORKSPACE,
    messages: [] as DailyChatMessage[], asking: false, chatError: "", failedQuestion: "", executingProposalId: "",
    conversationId: "", userAvatarUrl: "", scopeMenuOpen: false,
    quickQuestions: ["为什么这样建议", "今日总结", "找出今日卡点"],
  },
  profileHandler: null as null | (() => void),

  onLoad(query: Record<string, string>) {
    this.profileHandler = () => this.refreshUserProfile();
    on("profile:update", this.profileHandler);
    const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(query.date || "")) ? String(query.date) : getTodayBusinessDate();
    const requestedGoalId = String(query.goalId || "");
    const goalQuery = requestedGoalId ? `&goalId=${encodeURIComponent(requestedGoalId)}` : "";
    wx.redirectTo({
      url: `/pages/ai-coach/index?scope=day&date=${encodeURIComponent(requestedDate)}${goalQuery}`,
      fail: () => {
        this.setData({ requestedDate, requestedGoalId, messages: [], conversationId: "", chatError: "", failedQuestion: "", userAvatarUrl: getLocalUserProfile()?.avatarUrl || "", scopeMenuOpen: false });
        this.loadAnalysis();
      },
    });
  },

  onShow() {
    this.setData({ appTheme: getCurrentThemeId(), ...getNavigationMetrics() });
    this.refreshUserProfile();
    bootstrapAccount().catch(() => undefined).then(() => this.refreshUserProfile());
    if (this.data.status === "ready") this.refreshAnalysis(false);
  },

  onUnload() {
    if (this.profileHandler) {
      off("profile:update", this.profileHandler);
      this.profileHandler = null;
    }
  },

  refreshUserProfile() {
    this.setData({ userAvatarUrl: getLocalUserProfile()?.avatarUrl || "" });
  },

  loadAnalysis() {
    this.refreshAnalysis(true);
  },

  refreshAnalysis(showLoading = true) {
    if (showLoading) this.setData({ status: "loading", errorMessage: "" });
    try {
      const analysis = getDailyCoachAnalysis(this.data.requestedDate || getTodayBusinessDate(), this.data.requestedGoalId);
      const workspace = buildWorkspace(analysis);
      this.setData({ status: "ready", errorMessage: "", analysis, workspace, asking: false });
      if (analysis.goalId) prepareProgressCoach("day", analysis.goalId, false, analysis.date).catch(() => undefined);
    } catch (error) {
      this.setData({ status: "error", errorMessage: error instanceof Error ? error.message : "今日分析暂时无法读取" });
    }
  },

  goBack() { wx.navigateBack({ delta: 1 }); },
  openTodayRecords() { wx.navigateTo({ url: `/pages/today-data/index?date=${encodeURIComponent(this.data.analysis.date || getTodayBusinessDate())}` }); },
  openTask(event: { currentTarget: { dataset: { taskId?: string } } }) {
    const taskId = String(event.currentTarget.dataset.taskId || "");
    if (taskId) openTodayActionEditor({ mode: "edit", taskId });
  },
  addTodayAction() {
    if (!this.data.analysis.goalId) {
      wx.navigateTo({ url: "/pages/goal-create/index" });
      return;
    }
    openTodayActionEditor({ mode: "create", goalId: this.data.analysis.goalId, date: this.data.analysis.date || getTodayBusinessDate() });
  },
  toggleScopeMenu() {
    this.setData({ scopeMenuOpen: !this.data.scopeMenuOpen });
  },
  selectCoachScope(event: { currentTarget: { dataset: { scope?: string } } }) {
    const scope = String(event.currentTarget.dataset.scope || "day");
    this.setData({ scopeMenuOpen: false });
    if (scope === "day") return;
    const goalQuery = this.data.analysis.goalId ? `&goalId=${encodeURIComponent(this.data.analysis.goalId)}` : "";
    wx.navigateTo({ url: `/pages/ai-coach/index?scope=${encodeURIComponent(scope)}${goalQuery}` });
  },

  handleChatSend(event: { detail: { question?: string } }) {
    const question = String(event.detail.question || "").slice(0, 1000);
    if (!question || this.data.asking) return;
    if (question === "分析最近一周") {
      wx.navigateTo({ url: `/pages/ai-coach/index?scope=week&goalId=${encodeURIComponent(this.data.analysis.goalId)}` });
      return;
    }
    this.askQuestion(question, true);
  },
  sendGuidedQuestion(event: { currentTarget: { dataset: { question?: string } } }) {
    this.handleChatSend({ detail: { question: String(event.currentTarget.dataset.question || "") } });
  },
  scrollChatToLatest() {
    wx.nextTick(() => {
      const chat = this.selectComponent("#coach-chat") as unknown as { scrollToLatest?: () => void };
      chat?.scrollToLatest?.();
    });
  },
  async askQuestion(question: string, showUser: boolean) {
    if (this.data.asking || !question) return;
    const history = this.data.messages.map((item) => ({ role: item.role, content: item.content, sentAt: item.sentAt })).slice(-20);
    const now = Date.now();
    const userMessage: DailyChatMessage = { id: `daily_user_${now}`, role: "user", content: question, sentAt: new Date(now).toISOString(), scope: "day", analysisDate: this.data.analysis.date, goalId: this.data.analysis.goalId };
    const nextMessages = showUser ? this.data.messages.concat(userMessage).slice(-50) : this.data.messages;
    this.setData({ messages: nextMessages, asking: true, chatError: "", failedQuestion: "" }, () => this.scrollChatToLatest());
    try {
      const result = await askProgressCoach("day", this.data.analysis.goalId, question, history, this.data.analysis.date, new Date(now).toISOString(), this.data.conversationId || undefined);
      const assistantMessage: DailyChatMessage = { id: result.assistantMessageId || `daily_ai_${Date.now()}`, role: "assistant", content: result.answer,
        sentAt: result.generatedAt, scope: "day", analysisDate: this.data.analysis.date, goalId: this.data.analysis.goalId, presentation: result.presentation, actionProposal: result.actionProposal };
      this.setData({ conversationId: result.conversationId || this.data.conversationId, messages: this.data.messages.concat(assistantMessage).slice(-50), asking: false }, () => this.scrollChatToLatest());
    } catch (error) { this.setData({ asking: false, chatError: aiErrorMessage(error), failedQuestion: question }, () => this.scrollChatToLatest()); }
  },
  retryLastQuestion() { if (this.data.failedQuestion && !this.data.asking) this.askQuestion(this.data.failedQuestion, false); },
  async confirmCoachAction(event: { detail: { proposalId?: string } }) {
    const proposalId = String(event.detail.proposalId || "");
    if (!proposalId || this.data.executingProposalId) return;
    const proposal = this.data.messages.find((item) => item.actionProposal?.id === proposalId)?.actionProposal;
    if (!proposal) { wx.showToast({ title: "操作确认信息已失效", icon: "none" }); return; }
    this.setData({ executingProposalId: proposalId, chatError: "", failedQuestion: "" });
    try {
      const outcome = await executeCoachProposal(proposal);
      this.setData({ executingProposalId: "", chatError: "", failedQuestion: "", messages: this.data.messages.map((item) => item.actionProposal?.id === proposalId ? { ...item, actionProposal: { ...item.actionProposal, status: "executed" as const } } : item) }, () => this.scrollChatToLatest());
      this.refreshAnalysis(false);
      const title = outcome.reminder === "scheduled" ? "行动与提醒已设置"
        : outcome.reminder === "rejected" ? "行动已创建，提醒未开启"
          : outcome.reminder === "invalid" ? "行动已创建，提醒时间无效"
            : outcome.reminder === "failed" ? "行动已创建，提醒设置失败" : "已同步到今日行动";
      wx.showToast({ title, icon: outcome.reminder === "rejected" || outcome.reminder === "invalid" || outcome.reminder === "failed" ? "none" : "success" });
    } catch (error) { this.setData({ executingProposalId: "", chatError: aiErrorMessage(error) }, () => this.scrollChatToLatest()); }
  },
});
