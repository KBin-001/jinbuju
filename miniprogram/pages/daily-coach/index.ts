import { DailyCoachAnalysis, getDailyCoachAnalysis } from "../../services/dailyCoach";
import { askProgressCoach, prepareProgressCoach } from "../../services/progressCoach";
import { executeCoachAction } from "../../services/manualSync";
import { getLocalUserProfile } from "../../services/profile";
import { getCurrentThemeId } from "../../services/theme";
import { getTodayBusinessDate } from "../../utils/date";
import { CoachActionProposal, ProgressCoachChatMessage } from "../../types/progressCoach";

interface DailyChatMessage extends ProgressCoachChatMessage {
  id: string;
  mode: "direct" | "compact" | "detailed";
  summary: string;
  advice: string;
  insights: string[];
  metrics: Array<{ label: string; value: string }>;
  followUps: string[];
  showFull: boolean;
  canExpand: boolean;
  actionProposal?: CoachActionProposal;
}

const EMPTY_ANALYSIS: DailyCoachAnalysis = {
  date: "",
  dateLabel: "",
  goalId: "",
  goalTitle: "暂未设置目标",
  completedCount: 0,
  pendingCount: 0,
  totalCount: 0,
  actualMinutes: 0,
  remainingEstimatedMinutes: 0,
  completionPercent: 0,
  completedTasks: [],
  pendingTasks: [],
  priorityTask: null,
  judgement: "",
  bottlenecks: [],
  suggestions: [],
};

function getTopInset(): number {
  try {
    return wx.getWindowInfo().statusBarHeight + 8;
  } catch (_error) {
    return 52;
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

Page({
  data: {
    appTheme: getCurrentThemeId(),
    topInset: getTopInset(),
    status: "loading" as "loading" | "ready" | "error",
    errorMessage: "",
    displayName: "阿岚",
    requestedDate: "",
    requestedGoalId: "",
    analysis: EMPTY_ANALYSIS,
    question: "",
    replyQuestions: ["查看今日卡点", "给我明日建议", "解释今日完成率"],
    messages: [] as DailyChatMessage[],
    asking: false,
    chatError: "",
    failedQuestion: "",
    scrollIntoView: "",
    executingProposalId: "",
  },

  onLoad(query: Record<string, string>) {
    const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(query.date || ""))
      ? String(query.date)
      : getTodayBusinessDate();
    const profile = getLocalUserProfile();
    this.setData({ requestedDate, requestedGoalId: String(query.goalId || ""), displayName: profile?.nickname || "阿岚" });
    this.loadAnalysis();
  },

  onShow() {
    this.setData({ appTheme: getCurrentThemeId(), topInset: getTopInset() });
  },

  loadAnalysis() {
    try {
      const analysis = getDailyCoachAnalysis(this.data.requestedDate || getTodayBusinessDate(), this.data.requestedGoalId);
      this.setData({ status: "ready", errorMessage: "", analysis, asking: false }, () => {
        if (!analysis.goalId) return;
        prepareProgressCoach("day", analysis.goalId, false, analysis.date)
          .catch((error) => this.setData({ chatError: aiErrorMessage(error) }));
      });
    } catch (error) {
      this.setData({
        status: "error",
        errorMessage: error instanceof Error ? error.message : "今日分析暂时无法读取",
      });
    }
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  inputQuestion(event: { detail: { value?: string } }) {
    this.setData({ question: String(event.detail.value || "").slice(0, 160) });
  },

  chooseSuggestion(event: { currentTarget: { dataset: { suggestion?: string } } }) {
    const question = String(event.currentTarget.dataset.suggestion || "").slice(0, 160);
    if (!question || this.data.asking) return;
    this.askQuestion(question, true);
  },

  toggleFullReply(event: { currentTarget: { dataset: { id?: string } } }) {
    const id = String(event.currentTarget.dataset.id || "");
    this.setData({ messages: this.data.messages.map((item) => item.id === id ? { ...item, showFull: !item.showFull } : item) });
  },

  async askQuestion(question: string, showUser: boolean) {
    if (this.data.asking || !question) return;
    if (!this.data.analysis.goalId) {
      wx.showToast({ title: "请先创建目标", icon: "none" });
      return;
    }
    const history = this.data.messages.map((item) => ({ role: item.role, content: item.content, sentAt: item.sentAt })).slice(-12);
    const now = Date.now();
    const userMessage: DailyChatMessage = {
      id: `daily_user_${now}`, role: "user", content: question, sentAt: new Date(now).toISOString(), mode: "direct", summary: "", advice: "", insights: [], metrics: [], followUps: [], showFull: false, canExpand: false,
    };
    const nextMessages = showUser ? this.data.messages.concat(userMessage) : this.data.messages;
    this.setData({ messages: nextMessages, asking: true, chatError: "", failedQuestion: "", question: "", scrollIntoView: showUser ? userMessage.id : "coach-thinking" });
    try {
      const result = await askProgressCoach("day", this.data.analysis.goalId, question, history, this.data.analysis.date, new Date(now).toISOString());
      const mode = result.mode || "direct";
      const fallbackMetrics = [
        { label: "完成任务", value: `${this.data.analysis.completedCount}/${this.data.analysis.totalCount}` },
        { label: "实际投入", value: `${this.data.analysis.actualMinutes}min` },
        { label: "完成率", value: `${this.data.analysis.completionPercent}%` },
      ];
      const assistantMessage: DailyChatMessage = {
        id: `daily_ai_${Date.now()}`,
        role: "assistant",
        content: result.answer,
        mode,
        summary: mode === "direct" ? "" : result.summary || result.answer,
        advice: mode === "direct" ? "" : result.advice || "",
        insights: mode === "direct" ? [] : result.insights || [],
        metrics: mode === "direct" ? [] : (result.stats?.length ? result.stats.map((item) => ({ label: item.label, value: item.value })) : fallbackMetrics),
        followUps: result.followUps || [],
        showFull: false,
        canExpand: mode !== "direct" && result.answer.length > 180,
        actionProposal: result.actionProposal,
      };
      this.setData({ messages: this.data.messages.concat(assistantMessage), asking: false, scrollIntoView: assistantMessage.id });
    } catch (error) {
      this.setData({ asking: false, chatError: aiErrorMessage(error), failedQuestion: question, scrollIntoView: "daily-chat-error" });
    }
  },

  sendQuestion() {
    const question = this.data.question.trim();
    if (!question) {
      wx.showToast({ title: "先写下今天遇到的问题", icon: "none" });
      return;
    }
    this.askQuestion(question, true);
  },

  retryLastQuestion() {
    if (!this.data.failedQuestion || this.data.asking) return;
    this.askQuestion(this.data.failedQuestion, false);
  },

  async confirmCoachAction(event: { currentTarget: { dataset: { proposalId?: string } } }) {
    const proposalId = String(event.currentTarget.dataset.proposalId || "");
    if (!proposalId || this.data.executingProposalId) return;
    this.setData({ executingProposalId: proposalId });
    try {
      await executeCoachAction(proposalId);
      const analysis = getDailyCoachAnalysis(this.data.requestedDate || getTodayBusinessDate(), this.data.requestedGoalId);
      this.setData({
        analysis,
        executingProposalId: "",
        messages: this.data.messages.map((item) => item.actionProposal?.id === proposalId
          ? { ...item, actionProposal: { ...item.actionProposal, status: "executed" as const } }
          : item),
      });
      wx.showToast({ title: "已同步到今日行动", icon: "success" });
    } catch (error) {
      this.setData({ executingProposalId: "", chatError: aiErrorMessage(error) });
    }
  },

  goToday() {
    wx.switchTab({ url: "/pages/index/index" });
  },
});
