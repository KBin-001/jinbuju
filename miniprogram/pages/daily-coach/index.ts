import { buildDailyCoachReply, DailyCoachAnalysis, getDailyCoachAnalysis } from "../../services/dailyCoach";
import { getLocalUserProfile } from "../../services/profile";
import { getCurrentThemeId } from "../../services/theme";
import { getTodayBusinessDate } from "../../utils/date";

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
    coachReply: "",
    scrollIntoView: "",
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
      this.setData({ status: "ready", errorMessage: "", analysis });
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
    if (!question) return;
    this.setData({ question });
  },

  acknowledgeReport() {
    wx.showToast({ title: "已记录今天的状态", icon: "none" });
  },

  viewReportDetails() {
    this.setData({ question: "告诉我今天最需要关注的细节" });
  },

  sendQuestion() {
    const question = this.data.question.trim();
    if (!question) {
      wx.showToast({ title: "先写下今天遇到的问题", icon: "none" });
      return;
    }
    this.setData({
      coachReply: buildDailyCoachReply(question, this.data.analysis),
      question: "",
      scrollIntoView: "coach-reply",
    });
  },
});
