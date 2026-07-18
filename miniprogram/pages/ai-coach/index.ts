import { getActiveGoal, getActiveGoals, getGoal } from "../../services/manualGoal";
import { getTasksByGoal } from "../../services/manualTask";
import { getProgressSummary } from "../../services/manualStats";
import { getLocalUserProfile } from "../../services/profile";
import { askProgressCoach } from "../../services/progressCoach";
import { executeCoachProposal } from "../../services/manualSync";
import { getCurrentThemeId } from "../../services/theme";
import { addDays, formatDate, getTodayBusinessDate } from "../../utils/date";
import { ActionTask } from "../../types/manual";
import { CoachActionProposal, CoachRange, ProgressCoachChatMessage } from "../../types/progressCoach";

interface ChatMessage extends ProgressCoachChatMessage {
  id: string;
  actionProposal?: CoachActionProposal;
}

interface PeriodStats {
  minutes: number;
  completedActions: number;
  totalActions: number;
  completionRate: number;
}

function normalizeScope(value?: string): CoachRange {
  if (value === "week" || value === "month") return value;
  return "overall";
}

function toDate(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

function periodStart(scope: CoachRange, today: string): string | undefined {
  const date = toDate(today);
  if (scope === "week") return formatDate(addDays(date, -6));
  if (scope === "month") {
    const day = date.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    return formatDate(addDays(date, mondayOffset - 28));
  }
  return undefined;
}

function summarize(tasks: ActionTask[]): PeriodStats {
  const completedActions = tasks.filter((task) => task.status === "completed").length;
  return {
    minutes: tasks.reduce((sum, task) => sum + (task.actualMinutes || 0), 0),
    completedActions,
    totalActions: tasks.length,
    completionRate: tasks.length ? Math.round((completedActions / tasks.length) * 100) : 0,
  };
}

function getNavigationMetrics() {
  try {
    const windowInfo = wx.getWindowInfo();
    const menu = wx.getMenuButtonBoundingClientRect();
    return {
      statusBarHeight: windowInfo.statusBarHeight,
      navTop: Math.max(windowInfo.statusBarHeight, menu.top),
      navHeight: Math.max(32, menu.height),
      menuRightInset: Math.max(92, windowInfo.windowWidth - menu.left + 8),
    };
  } catch (_error) {
    return { statusBarHeight: 44, navTop: 44, navHeight: 32, menuRightInset: 96 };
  }
}

function scopeCopy(scope: CoachRange) {
  if (scope === "week") return {
    label: "本周复盘",
    subtitle: "只分析本周行动，不做长期评价",
    reportName: "本周完成情况",
    prompt: "帮我分析一下本周的完成情况",
    questions: ["帮我分析一下本周的完成情况", "我本周最需要调整什么", "告诉我下周最适合做的下一步"],
  };
  if (scope === "month") return {
    label: "本月观察",
    subtitle: "只分析本月行动，不做长期评价",
    reportName: "本月完成情况",
    prompt: "帮我分析一下本月的完成情况",
    questions: ["帮我分析一下本月的完成情况", "我本月最需要调整什么", "告诉我下个月最适合做的下一步"],
  };
  return {
    label: "整体成长",
    subtitle: "结合当前目标与累计行动分析",
    reportName: "累计完成情况",
    prompt: "帮我分析一下当前的整体成长情况",
    questions: ["帮我分析整体成长情况", "我目前最大的卡点是什么", "告诉我接下来最值得做的一步"],
  };
}

function judgement(stats: PeriodStats, scopeLabel: string): string {
  if (!stats.totalActions) return `${scopeLabel}还没有行动记录，先完成一件低启动成本的小事。`;
  if (stats.completionRate === 100) return `${scopeLabel}计划内行动已经全部完成，当前节奏稳定，可以记录有效做法。`;
  if (stats.completionRate >= 60) return `${scopeLabel}已经完成大部分行动，保持当前节奏并优先收尾剩余事项。`;
  if (stats.completedActions > 0) return `${scopeLabel}已经开始推进，但完成节奏仍有提升空间，建议缩小下一步。`;
  return `${scopeLabel}尚未形成完成记录，先选择最容易开始的一项行动。`;
}

function bottleneck(stats: PeriodStats, streakDays: number): string {
  const pending = Math.max(0, stats.totalActions - stats.completedActions);
  if (!stats.totalActions) return "当前更需要建立第一条行动记录，而不是继续增加任务。";
  if (pending > 0) return `还有 ${pending} 项行动待推进，建议先处理最接近完成的一项。`;
  if (!stats.minutes) return "行动已完成但尚未记录实际投入，补充时间后分析会更准确。";
  return streakDays > 0 ? `已经连续行动 ${streakDays} 天，注意保持节奏，不必临时加码。` : "当前没有明显卡点，继续保持稳定投入。";
}

function errorMessage(rawError: unknown): string {
  const error = rawError as Error & { code?: string };
  if (error?.code === "FUNCTION_NOT_FOUND") return "AI 云函数尚未上传，请先部署服务。";
  if (error?.code === "COACH_RUNTIME_MISMATCH") return "云端 AI 教练版本较旧，请重新上传 generatePlan 云函数。";
  if (error?.code === "AI_COACH_INVALID") return "这次回答没有通过数据校验，请再试一次。";
  if (error?.code === "AI_COACH_FAILED") return "AI 服务尚未配置或暂时不可用。";
  if (error?.code === "MANUAL_STORAGE_UNAVAILABLE") return "行动数据存储尚未初始化，请重新进入页面后再试。";
  if (error?.code === "COACH_ACTION_CONFLICT") return error.message || "行动数据已变化，请重新发送指令。";
  if (error?.code === "COACH_ACTION_EXPIRED") return "确认操作已过期，请重新发送指令。";
  if (error?.code === "FUNCTION_TIMEOUT" || error?.code === "NETWORK_ERROR") return "连接有点慢，请稍后重试。";
  return error?.message || "暂时没有生成回答，请稍后重试。";
}

Page({
  data: {
    appTheme: getCurrentThemeId(),
    ...getNavigationMetrics(),
    scope: "overall" as CoachRange,
    requestedGoalId: "",
    goalId: "",
    scopeLabel: "整体成长",
    scopeSubtitle: "结合当前目标与累计行动分析",
    reportName: "累计完成情况",
    initialPrompt: "帮我分析一下当前的整体成长情况",
    displayName: "微信用户", userAvatarUrl: "",
    goalTitle: "当前目标",
    completedCount: 0,
    totalCount: 0,
    periodMinutes: 0,
    completionRate: 0,
    activeDays: 0,
    streakDays: 0,
    recentActionDate: "暂无",
    judgement: "正在整理你的行动记录。",
    bottleneck: "完成更多行动后，会形成更具体的建议。",
    quickQuestions: [] as string[],
    messages: [] as ChatMessage[],
    asking: false,
    chatError: "",
    failedQuestion: "",
    scrollIntoView: "",
    executingProposalId: "",
    conversationId: "",
  },

  onLoad(query: Record<string, string>) {
    const scope = normalizeScope(query.scope || query.range);
    const copy = scopeCopy(scope);
    this.setData({
      scope,
      requestedGoalId: String(query.goalId || ""),
      scopeLabel: copy.label,
      scopeSubtitle: copy.subtitle,
      reportName: copy.reportName,
      initialPrompt: copy.prompt,
      quickQuestions: copy.questions,
      messages: [],
      conversationId: "",
      chatError: "",
      failedQuestion: "",
    }, () => {
      this.loadLocalOverview();
    });
  },

  onShow() {
    this.setData({ appTheme: getCurrentThemeId(), ...getNavigationMetrics(), userAvatarUrl: getLocalUserProfile()?.avatarUrl || "" });
  },

  loadLocalOverview() {
    const requested = this.data.requestedGoalId ? getGoal(this.data.requestedGoalId) : null;
    const selectedGoal = requested?.status === "active" ? requested : getActiveGoal();
    const goals = this.data.scope === "overall" ? getActiveGoals() : selectedGoal ? [selectedGoal] : [];
    const today = getTodayBusinessDate();
    const start = periodStart(this.data.scope, today);
    const tasks = goals.reduce<ActionTask[]>((all, goal) => all.concat(getTasksByGoal(goal.id)), [])
      .filter((task) => !start || (task.currentDate >= start && task.currentDate <= today));
    const stats = summarize(tasks);
    const streakDays = goals.reduce((max, goal) => Math.max(max, getProgressSummary(goal.id, today).currentStreakDays || 0), 0);
    const activeDates = Array.from(new Set(tasks
      .filter((task) => task.status === "completed" || task.status === "partially_completed" || (task.actualMinutes || 0) > 0)
      .map((task) => task.currentDate)));
    const recentActionDate = activeDates.sort().pop();
    const profile = getLocalUserProfile();
    const title = goals.length > 1 ? `${goals.length} 个进行中目标` : goals[0]?.title || "当前目标";
    this.setData({
      goalId: this.data.scope === "overall" ? "" : selectedGoal?.id || "",
      displayName: profile?.nickname || "微信用户",
      userAvatarUrl: profile?.avatarUrl || "",
      goalTitle: title,
      completedCount: stats.completedActions,
      totalCount: stats.totalActions,
      periodMinutes: stats.minutes,
      completionRate: stats.completionRate,
      activeDays: activeDates.length,
      streakDays,
      recentActionDate: recentActionDate ? `${Number(recentActionDate.slice(5, 7))}/${Number(recentActionDate.slice(8, 10))}` : "暂无",
      judgement: judgement(stats, this.data.scopeLabel),
      bottleneck: bottleneck(stats, streakDays),
    });
  },

  goBack() { wx.navigateBack({ delta: 1 }); },

  sendGuidedQuestion(event: { currentTarget: { dataset: { question?: string } } }) {
    if (this.data.asking) return;
    const question = String(event.currentTarget.dataset.question || "").slice(0, 1000);
    if (!question) return;
    this.askQuestion(question, true);
  },

  handleChatSend(event: { detail: { question?: string } }) {
    this.askQuestion(String(event.detail.question || "").slice(0, 1000), true);
  },

  async askQuestion(question: string, showUser: boolean) {
    if (this.data.asking) return;
    if (!question) {
      wx.showToast({ title: "先写下你想问的问题", icon: "none" });
      return;
    }
    const history = this.data.messages.map((item) => ({ role: item.role, content: item.content, sentAt: item.sentAt })).slice(-20);
    const messageSentAt = new Date().toISOString();
    const userMessage: ChatMessage = { id: `user_${Date.now()}`, role: "user", content: question, sentAt: messageSentAt,
      scope: this.data.scope, analysisDate: getTodayBusinessDate(), goalId: this.data.goalId || undefined };
    this.setData({
      messages: showUser ? this.data.messages.concat(userMessage).slice(-50) : this.data.messages,
      asking: true,
      chatError: "",
      failedQuestion: "",
      scrollIntoView: userMessage.id,
    });
    try {
      const result = await askProgressCoach(this.data.scope, this.data.goalId || undefined, question, history, getTodayBusinessDate(), messageSentAt, this.data.conversationId || undefined);
      const assistantMessage: ChatMessage = {
        id: result.assistantMessageId || `assistant_${Date.now()}`,
        role: "assistant",
        content: result.answer,
        sentAt: result.generatedAt,
        scope: this.data.scope,
        analysisDate: getTodayBusinessDate(),
        goalId: this.data.goalId || undefined,
        presentation: result.presentation,
        actionProposal: result.actionProposal,
      };
      this.setData({ conversationId: result.conversationId || this.data.conversationId, messages: this.data.messages.concat(assistantMessage).slice(-50), asking: false, scrollIntoView: assistantMessage.id });
    } catch (error) {
      this.setData({ asking: false, chatError: errorMessage(error), failedQuestion: question, scrollIntoView: "chat-error" });
    }
  },

  retryLastQuestion() {
    if (!this.data.failedQuestion || this.data.asking) return;
    const failedQuestion = this.data.failedQuestion;
    this.setData({ failedQuestion: "", chatError: "" }, () => this.askQuestion(failedQuestion, false));
  },

  async confirmCoachAction(event: { detail: { proposalId?: string } }) {
    const proposalId = String(event.detail.proposalId || "");
    if (!proposalId || this.data.executingProposalId) return;
    const proposal = this.data.messages.find((item) => item.actionProposal?.id === proposalId)?.actionProposal;
    if (!proposal) { wx.showToast({ title: "操作确认信息已失效", icon: "none" }); return; }
    this.setData({ executingProposalId: proposalId, chatError: "", failedQuestion: "" });
    try {
      const outcome = await executeCoachProposal(proposal);
      this.setData({
        executingProposalId: "",
        chatError: "",
        messages: this.data.messages.map((item) => item.actionProposal?.id === proposalId
          ? { ...item, actionProposal: { ...item.actionProposal, status: "executed" as const } }
          : item),
      }, () => this.loadLocalOverview());
      const title = outcome.reminder === "scheduled" ? "行动与提醒已设置"
        : outcome.reminder === "rejected" ? "行动已创建，提醒未开启"
          : outcome.reminder === "invalid" ? "行动已创建，提醒时间无效"
            : outcome.reminder === "failed" ? "行动已创建，提醒设置失败" : "已同步到今日行动";
      wx.showToast({ title, icon: outcome.reminder === "rejected" || outcome.reminder === "invalid" || outcome.reminder === "failed" ? "none" : "success" });
    } catch (error) {
      this.setData({ executingProposalId: "", chatError: errorMessage(error) });
    }
  },

  goToday() { wx.switchTab({ url: "/pages/index/index" }); },
});
