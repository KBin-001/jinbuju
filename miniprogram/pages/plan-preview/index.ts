import { adoptPlan, createRequestId, generatePlan } from "../../services/plan";
import { GoalDraft, PlanPreview } from "../../types/goal";
import {
  clearGoalDraft,
  clearPlanPreview,
  getGoalDraft,
  getPlanPreview,
  savePlanPreview,
  setGoalEditStep,
} from "../../utils/storage";

type PreviewStatus = "initial" | "generating" | "success" | "error" | "fallback";

const GENERATION_TIMEOUT = 55000;

Page({
  data: {
    status: "initial" as PreviewStatus,
    goal: null as GoalDraft | null,
    plan: null as PlanPreview | null,
    requestId: "",
    errorMessage: "",
    stageText: "正在分析你的目标",
    adopting: false,
    generating: false,
  },

  onLoad(options: { generate?: string }) {
    const goal = getGoalDraft();
    if (!goal) {
      this.setData({
        status: "error",
        errorMessage: "没有找到目标信息，请返回重新填写。",
      });
      return;
    }

    const cached = getPlanPreview();
    if (options.generate !== "1" && cached) {
      this.setData({
        goal: cached.goal,
        plan: cached.plan,
        requestId: cached.requestId,
        status: cached.plan.source === "fallback" ? "fallback" : "success",
      });
      return;
    }

    this.setData({ goal });
    this.startGeneration();
  },

  onUnload() {
    this.clearStageTimers();
  },

  startGeneration(forceFallback = false) {
    if (this.data.generating || !this.data.goal) return;
    const requestId = createRequestId();
    this.setData({
      status: "generating",
      generating: true,
      requestId,
      errorMessage: "",
      stageText: forceFallback ? "正在准备推荐计划" : "正在分析你的目标",
    });
    this.startStageTimers(forceFallback);

    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("GENERATION_TIMEOUT")), GENERATION_TIMEOUT);
    });

    Promise.race([generatePlan(this.data.goal, requestId, forceFallback), timeout])
      .then((result) => {
        const cache = {
          requestId: result.requestId,
          goal: this.data.goal as GoalDraft,
          plan: result.plan,
          generatedAt: Date.now(),
        };
        savePlanPreview(cache);
        this.setData({
          plan: result.plan,
          requestId: result.requestId,
          status: result.plan.source === "fallback" ? "fallback" : "success",
        });
      })
      .catch((error: Error & { code?: string }) => {
        const message =
          error.message === "GENERATION_TIMEOUT"
            ? "生成时间有点久，可以重新生成或直接使用推荐模板。"
            : error.message || "计划生成失败，请稍后重试。";
        this.setData({ status: "error", errorMessage: message });
      })
      .then(() => {
        this.clearStageTimers();
        this.setData({ generating: false });
      });
  },

  startStageTimers(forceFallback: boolean) {
    this.clearStageTimers();
    if (forceFallback) return;
    (this as any).stageTimers = [
      setTimeout(() => this.setData({ stageText: "正在安排每日任务" }), 4500),
      setTimeout(() => this.setData({ stageText: "正在检查任务时间" }), 9500),
      setTimeout(() => this.setData({ stageText: "正在生成最终计划" }), 15000),
    ];
  },

  clearStageTimers() {
    const timers = (this as any).stageTimers || [];
    timers.forEach((timer: number) => clearTimeout(timer));
    (this as any).stageTimers = [];
  },

  retry() {
    this.startGeneration(false);
  },

  useFallback() {
    this.startGeneration(true);
  },

  regenerate() {
    wx.showModal({
      title: "重新生成计划？",
      content: "会重新生成当前 7 天计划，尚未采用的预览将被替换。",
      confirmText: "重新生成",
      success: (result: any) => {
        if (!result.confirm) return;
        clearPlanPreview();
        this.startGeneration(false);
      },
    });
  },

  adjustTime() {
    if (this.data.generating || this.data.adopting) return;
    this.returnToGoalStep(5);
  },

  editGoal() {
    if (this.data.generating || this.data.adopting) return;
    this.returnToGoalStep(1);
  },

  returnToGoalStep(step: number) {
    const pages = getCurrentPages();
    const previousPage = pages.length > 1 ? pages[pages.length - 2] : null;
    if (previousPage && previousPage.route === "pages/goal-create/index") {
      setGoalEditStep(step);
      wx.navigateBack();
      return;
    }
    wx.redirectTo({ url: `/pages/goal-create/index?step=${step}` });
  },

  goBack() {
    if (this.data.generating || this.data.adopting) return;
    wx.navigateBack();
  },

  adopt() {
    if (this.data.adopting || !this.data.goal || !this.data.plan) return;
    this.setData({ adopting: true });
    adoptPlan(this.data.goal, this.data.plan, this.data.requestId)
      .then(() => {
        clearGoalDraft();
        clearPlanPreview();
        wx.switchTab({
          url: "/pages/index/index",
          success: () => {
            setTimeout(() => {
              wx.showToast({
                title: "计划已创建，从今天开始行动吧",
                icon: "none",
                duration: 2500,
              });
            }, 250);
          },
        });
      })
      .catch((error: Error) => {
        wx.showModal({
          title: "暂时无法采用计划",
          content: error.message || "请稍后重试。",
          showCancel: false,
        });
      })
      .then(() => this.setData({ adopting: false }));
  },
});
