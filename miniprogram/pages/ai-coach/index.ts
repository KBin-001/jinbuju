import { getActiveGoal, getActiveGoals, getGoal } from "../../services/manualGoal";
import { getTasksByGoal } from "../../services/manualTask";
import { getProgressSummary } from "../../services/manualStats";
import { getLocalUserProfile } from "../../services/profile";
import { askProgressCoach, prepareProgressCoach } from "../../services/progressCoach";
import { addDays, formatDate, getTodayBusinessDate } from "../../utils/date";
import { ActionTask } from "../../types/manual";
import { CoachRange, ProgressCoachChatMessage } from "../../types/progressCoach";

interface CoachMetric {
  key: string;
  label: string;
  value: number;
  unit: string;
  helper: string;
  signal: string;
  signalTone: string;
}

interface ChatMessage extends ProgressCoachChatMessage {
  id: string;
}

interface PeriodStats {
  minutes: number;
  completedActions: number;
  totalActions: number;
  completionRate: number;
}

const QUICK_QUESTIONS = ["我最近最大的不足是什么？", "下一步怎么安排更稳？", "哪些行动应该优先？", "我的节奏适合什么方式？"];

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

function errorMessage(rawError: unknown): string {
  const error = rawError as Error & { code?: string };
  if (error?.code === "FUNCTION_NOT_FOUND") return "AI 云函数尚未上传，请先部署服务。";
  if (error?.code === "AI_COACH_INVALID") return "这次回答没有通过数据校验，请再试一次。";
  if (error?.code === "AI_COACH_FAILED") return "AI 服务尚未配置或暂时不可用。";
  if (error?.code === "FUNCTION_TIMEOUT" || error?.code === "NETWORK_ERROR") return "连接有点慢，请稍后重试。";
  return error?.message || "暂时没有生成回答，请稍后重试。";
}

Page({
  data: {
    scope: "overall" as CoachRange,
    requestedGoalId: "",
    goalId: "",
    pageTitle: "AI 成长教练",
    scopeLabel: "整体成长",
    displayName: "阿岚",
    goalTitle: "当前目标",
    periodMinutes: 0,
    completionRate: 0,
    statusText: "正在了解你",
    metrics: [] as CoachMetric[],
    quickQuestions: QUICK_QUESTIONS,
    messages: [] as ChatMessage[],
    question: "",
    asking: false,
    chatError: "",
    failedQuestion: "",
    scrollIntoView: "",
  },

  onLoad(query: Record<string, string>) {
    const scope = normalizeScope(query.scope || query.range);
    this.setData({
      scope,
      requestedGoalId: String(query.goalId || ""),
      pageTitle: scope === "overall" ? "AI 成长教练" : "AI 进度教练",
      scopeLabel: scope === "week" ? "本周复盘" : scope === "month" ? "本月观察" : "整体成长",
    }, () => {
      this.loadLocalOverview();
    });
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
    const profile = getLocalUserProfile();
    const title = goals.length > 1 ? `${goals.length} 个进行中目标` : goals[0]?.title || "当前目标";
    const scopePrefix = this.data.scope === "week" ? "本周" : this.data.scope === "month" ? "本月" : "累计";
    this.setData({
      goalId: this.data.scope === "overall" ? "" : selectedGoal?.id || "",
      displayName: profile?.nickname || "阿岚",
      goalTitle: title,
      periodMinutes: stats.minutes,
      completionRate: stats.completionRate,
      statusText: stats.totalActions ? "已了解你的行动节奏" : "已了解你的目标方向",
      metrics: [
        { key: "focus", label: `${scopePrefix}专注`, value: stats.minutes, unit: "分", helper: stats.minutes ? "每一分钟都算数。" : "有记录后会更了解你的节奏。", signal: "↗", signalTone: "up" },
        { key: "streak", label: "连续坚持", value: streakDays, unit: "天", helper: streakDays ? `已经连续行动 ${streakDays} 天。` : "从第一次行动开始认识你。", signal: "🔥", signalTone: "warm" },
        { key: "actions", label: "完成行动", value: stats.completedActions, unit: "项", helper: stats.completedActions ? "真实行动正在沉淀。" : "完成后会形成更具体的建议。", signal: "↗", signalTone: "up" },
        { key: "rate", label: "完成率", value: stats.completionRate, unit: "%", helper: stats.totalActions ? `已读取 ${stats.totalActions} 项行动。` : "目前先基于目标与你对话。", signal: "📊", signalTone: "chart" },
      ],
    }, () => this.prepareContext());
  },

  prepareContext(force = false): Promise<unknown> {
    const goalId = this.data.scope === "overall" ? undefined : this.data.goalId;
    if (this.data.scope !== "overall" && !goalId) return Promise.reject(new Error("当前没有可以分析的目标。"));
    return prepareProgressCoach(this.data.scope, goalId, force).catch(() => undefined);
  },

  goBack() { wx.navigateBack({ delta: 1 }); },

  chooseQuestion(event: { currentTarget: { dataset: { question?: string } } }) {
    if (this.data.asking) return;
    this.setData({ question: String(event.currentTarget.dataset.question || ""), chatError: "" });
  },

  inputQuestion(event: { detail: { value?: string } }) {
    this.setData({ question: String(event.detail.value || "").slice(0, 120), chatError: "" });
  },

  async sendQuestion() {
    if (this.data.asking) return;
    const question = this.data.question.trim();
    if (!question) {
      wx.showToast({ title: "先写下你想问的问题", icon: "none" });
      return;
    }
    const history = this.data.messages.map((item) => ({ role: item.role, content: item.content })).slice(-12);
    const userMessage: ChatMessage = { id: `user_${Date.now()}`, role: "user", content: question };
    this.setData({
      messages: this.data.messages.concat(userMessage),
      question: "",
      asking: true,
      chatError: "",
      failedQuestion: "",
      scrollIntoView: userMessage.id,
    });
    try {
      const result = await askProgressCoach(this.data.scope, this.data.goalId || undefined, question, history);
      const assistantMessage: ChatMessage = { id: `assistant_${Date.now()}`, role: "assistant", content: result.answer };
      this.setData({
        messages: this.data.messages.concat(assistantMessage),
        asking: false,
        scrollIntoView: assistantMessage.id,
      });
    } catch (error) {
      this.setData({ asking: false, chatError: errorMessage(error), failedQuestion: question, scrollIntoView: "chat-error" });
    }
  },

  retryLastQuestion() {
    if (!this.data.failedQuestion || this.data.asking) return;
    const failedQuestion = this.data.failedQuestion;
    const messages = this.data.messages.filter((item) => !(item.role === "user" && item.content === failedQuestion && item === this.data.messages[this.data.messages.length - 1]));
    this.setData({ messages, question: failedQuestion, failedQuestion: "", chatError: "" }, () => this.sendQuestion());
  },

  switchMainTab(event: { currentTarget: { dataset: { url?: string } } }) {
    const url = String(event.currentTarget.dataset.url || "");
    if (url) wx.switchTab({ url });
  },
});
