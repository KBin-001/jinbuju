import { deleteCurrentPlan, getCurrentPlan } from "../../services/plan";
import { CurrentPlan } from "../../types/goal";
import {
  clearGoalDraft,
  clearPlanPreview,
  getPlanPreview,
} from "../../utils/storage";

type PageStatus = "loading" | "empty" | "error" | "preview" | "active";

Page({
  data: {
    status: "loading" as PageStatus,
    errorMessage: "",
    currentPlan: null as CurrentPlan | null,
    deleting: false,
  },

  onLoad() {
    this.loadPlan();
  },

  onShow() {
    this.loadPlan();
  },

  loadPlan() {
    this.setData({ status: "loading", errorMessage: "" });
    getCurrentPlan()
      .then((currentPlan) => {
        if (currentPlan) {
          this.setData({ status: "active", currentPlan });
          return;
        }
        this.setData({
          status: getPlanPreview() ? "preview" : "empty",
          currentPlan: null,
        });
      })
      .catch((error: Error) => {
        this.setData({
          status: "error",
          errorMessage: error.message || "计划加载失败，请重试。",
        });
      });
  },

  retry() {
    this.loadPlan();
  },

  createGoal() {
    wx.navigateTo({ url: "/pages/goal-create/index" });
  },

  continuePreview() {
    wx.navigateTo({ url: "/pages/plan-preview/index" });
  },

  confirmDelete() {
    if (this.data.deleting) return;
    wx.showModal({
      title: "删除当前计划？",
      content: "目标、7 天计划和相关任务都会删除，此操作无法撤销。",
      confirmText: "确认删除",
      confirmColor: "#C65353",
      success: (result: any) => {
        if (result.confirm) {
          this.deletePlan();
        }
      },
    });
  },

  deletePlan() {
    if (this.data.deleting) return;
    this.setData({ deleting: true });
    deleteCurrentPlan()
      .then(() => {
        clearGoalDraft();
        clearPlanPreview();
        this.setData({
          deleting: false,
          currentPlan: null,
          status: "empty",
        });
        wx.showToast({
          title: "当前计划已删除",
          icon: "success",
        });
      })
      .catch((error: Error) => {
        this.setData({ deleting: false });
        wx.showModal({
          title: "删除失败",
          content: error.message || "请稍后重试。",
          showCancel: false,
        });
      });
  },
});
