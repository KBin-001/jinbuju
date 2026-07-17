import { DailyCoachAnalysis, getDailyCoachAnalysis } from "../../services/dailyCoach";
import { askProgressCoach, prepareProgressCoach } from "../../services/progressCoach";
import { executeCoachAction } from "../../services/manualSync";
import { getProgressSummary } from "../../services/manualStats";
import { getCurrentThemeId } from "../../services/theme";
import { getTodayBusinessDate } from "../../utils/date";
import { isNotificationConfigured } from "../../config/notification";
import { requestNotificationAuthorization } from "../../services/notification";
import { CoachActionProposal, CoachRange, ProgressCoachChatMessage } from "../../types/progressCoach";

interface DailyChatMessage extends ProgressCoachChatMessage {
  id: string;
  mode: "direct" | "compact" | "detailed";
  summary: string;
  advice: string;
  insights: string[];
  followUps: string[];
  showFull: boolean;
  canExpand: boolean;
  actionProposal?: CoachActionProposal;
}

interface CoachEvidence {
  id: string;
  tone: "positive" | "warning" | "info";
  icon: string;
  title: string;
  description: string;
}

interface WorkspaceView {
  conclusionTitle: string;
  conclusionSubtitle: string;
  todayStatus: string;
  statusTone: string;
  judgementTitle: string;
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
  evidences: [],
};

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
      menuRightInset: Math.max(92, windowInfo.windowWidth - menu.left + 8),
      heroHeight: menu.bottom + 42,
    };
  } catch (_error) {
    return { statusBarHeight: 44, navTop: 44, navHeight: 32, menuRightInset: 96, heroHeight: 128 };
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
    conclusionTitle, conclusionSubtitle, todayStatus, statusTone, judgementTitle, evidences: evidences.slice(0, 3),
  };
}

Page({
  data: {
    appTheme: getCurrentThemeId(), ...getNavigationMetrics(), status: "loading" as "loading" | "ready" | "error", errorMessage: "",
    requestedDate: "", requestedGoalId: "", analysis: EMPTY_ANALYSIS, workspace: EMPTY_WORKSPACE,
    question: "", messages: [] as DailyChatMessage[], asking: false, chatError: "", failedQuestion: "", executingProposalId: "",
    aiNotificationAvailable: isNotificationConfigured("ai_coach_advice"), notificationAuthorizing: false,
  },

  onLoad(query: Record<string, string>) {
    const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(query.date || "")) ? String(query.date) : getTodayBusinessDate();
    this.setData({ requestedDate, requestedGoalId: String(query.goalId || "") });
    this.loadAnalysis();
  },

  onShow() {
    this.setData({ appTheme: getCurrentThemeId(), ...getNavigationMetrics() });
    if (this.data.status === "ready") this.refreshAnalysis(false);
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
  addTodayAction() {
    if (!this.data.analysis.goalId) {
      wx.navigateTo({ url: "/pages/goal-create/index" });
      return;
    }
    wx.navigateTo({ url: `/pages/action-edit/index?goalId=${encodeURIComponent(this.data.analysis.goalId)}&date=${encodeURIComponent(this.data.analysis.date || getTodayBusinessDate())}` });
  },
  async subscribeAiCoachAdvice() {
    if (this.data.notificationAuthorizing) return;
    this.setData({ notificationAuthorizing: true });
    try {
      const result = await requestNotificationAuthorization("ai_coach_advice", "daily_coach");
      wx.showToast({ title: result === "accept" ? "明日建议已订阅" : "未获得订阅授权", icon: result === "accept" ? "success" : "none" });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "订阅未完成", icon: "none" });
    } finally {
      this.setData({ notificationAuthorizing: false });
    }
  },
  selectSection(event: { currentTarget: { dataset: { section?: string } } }) {
    const section = String(event.currentTarget.dataset.section || "review");
    if (section === "insights") {
      if (!this.data.analysis.goalId) { wx.showToast({ title: "持续行动后会生成更多洞察", icon: "none" }); return; }
      wx.navigateTo({ url: `/pages/ai-coach/index?scope=week&goalId=${encodeURIComponent(this.data.analysis.goalId)}` });
      return;
    }
    wx.pageScrollTo({ selector: "#today-review", duration: 240 });
  },

  inputQuestion(event: { detail: { value?: string } }) { this.setData({ question: String(event.detail.value || "").slice(0, 120), chatError: "" }); },
  chooseSuggestion(event: { currentTarget: { dataset: { question?: string; scope?: CoachRange } } }) {
    const question = String(event.currentTarget.dataset.question || "").slice(0, 120);
    const scope = event.currentTarget.dataset.scope || "day";
    if (!question || this.data.asking) return;
    if (scope === "week") {
      wx.navigateTo({ url: `/pages/ai-coach/index?scope=week&goalId=${encodeURIComponent(this.data.analysis.goalId)}` });
      return;
    }
    this.askQuestion(question, true);
  },
  toggleFullReply(event: { currentTarget: { dataset: { id?: string } } }) {
    const id = String(event.currentTarget.dataset.id || "");
    this.setData({ messages: this.data.messages.map((item) => item.id === id ? { ...item, showFull: !item.showFull } : item) });
  },
  async askQuestion(question: string, showUser: boolean) {
    if (this.data.asking || !question) return;
    if (!this.data.analysis.goalId) { wx.showToast({ title: "请先创建目标", icon: "none" }); return; }
    const history = this.data.messages.map((item) => ({ role: item.role, content: item.content, sentAt: item.sentAt })).slice(-6);
    const now = Date.now();
    const userMessage: DailyChatMessage = { id: `daily_user_${now}`, role: "user", content: question, sentAt: new Date(now).toISOString(), mode: "direct", summary: "", advice: "", insights: [], followUps: [], showFull: false, canExpand: false };
    const nextMessages = showUser ? this.data.messages.concat(userMessage).slice(-5) : this.data.messages;
    this.setData({ messages: nextMessages, asking: true, chatError: "", failedQuestion: "", question: "" });
    try {
      const result = await askProgressCoach("day", this.data.analysis.goalId, question, history, this.data.analysis.date, new Date(now).toISOString());
      const mode = result.mode || "direct";
      const assistantMessage: DailyChatMessage = { id: `daily_ai_${Date.now()}`, role: "assistant", content: result.answer, mode,
        summary: mode === "direct" ? "" : result.summary || result.answer, advice: mode === "direct" ? "" : result.advice || "",
        insights: mode === "direct" ? [] : (result.insights || []).slice(0, 3), followUps: (result.followUps || []).slice(0, 2),
        showFull: false, canExpand: mode !== "direct" && result.answer.length > 180, actionProposal: result.actionProposal };
      this.setData({ messages: this.data.messages.concat(assistantMessage).slice(-6), asking: false });
    } catch (error) { this.setData({ asking: false, chatError: aiErrorMessage(error), failedQuestion: question }); }
  },
  sendQuestion() {
    const question = this.data.question.trim();
    if (!question) { wx.showToast({ title: "先写下你想聊的情况", icon: "none" }); return; }
    this.askQuestion(question, true);
  },
  retryLastQuestion() { if (this.data.failedQuestion && !this.data.asking) this.askQuestion(this.data.failedQuestion, false); },
  async confirmCoachAction(event: { currentTarget: { dataset: { proposalId?: string } } }) {
    const proposalId = String(event.currentTarget.dataset.proposalId || "");
    if (!proposalId || this.data.executingProposalId) return;
    this.setData({ executingProposalId: proposalId });
    try {
      await executeCoachAction(proposalId);
      this.setData({ executingProposalId: "", messages: this.data.messages.map((item) => item.actionProposal?.id === proposalId ? { ...item, actionProposal: { ...item.actionProposal, status: "executed" as const } } : item) });
      this.refreshAnalysis(false); wx.showToast({ title: "已同步到今日行动", icon: "success" });
    } catch (error) { this.setData({ executingProposalId: "", chatError: aiErrorMessage(error) }); }
  },
});
