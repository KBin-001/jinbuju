import { abandonActionSession, completeActionSession, getActionSession, pauseActionSession, resumeActionSession, startActionSession } from "../../services/actionSession";
import { getGoal } from "../../services/manualGoal";
import { syncManualData } from "../../services/manualSync";
import { getTask } from "../../services/manualTask";
import { withAppTheme } from "../../services/theme";
import { ActionSession, ActionTask } from "../../types/manual";

function clock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  const pair = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${pair(hours)}:${pair(minutes)}:${pair(rest)}` : `${pair(minutes)}:${pair(rest)}`;
}

Page(withAppTheme({
  data: {
    loading: true,
    errorMessage: "",
    task: null as ActionTask | null,
    goalTitle: "",
    session: null as ActionSession | null,
    elapsedSeconds: 0,
    elapsedResultText: "不足 1 分钟",
    displayTime: "00:00",
    remainingText: "",
    progressPercent: 0,
    completionVisible: false,
    actualMinutes: 1,
    reflection: "",
    submitting: false,
  },
  timer: null as ReturnType<typeof setInterval> | null,

  onLoad(query: Record<string, string>) {
    const taskId = String(query.taskId || query.id || "");
    const mode = query.mode === "stopwatch" ? "stopwatch" : "countdown";
    const task = getTask(taskId);
    if (!task) { this.setData({ loading: false, errorMessage: "行动不存在或已被删除" }); return; }
    try {
      const session = startActionSession(task.id, mode);
      this.setData({ task, goalTitle: getGoal(task.goalId)?.title || "当前目标", session, loading: false });
      this.refreshClock();
      wx.setKeepScreenOn({ keepScreenOn: true });
    } catch (error) {
      this.setData({ task, loading: false, errorMessage: error instanceof Error ? error.message : "无法开始行动" });
    }
  },

  onShow() {
    this.startTicker();
    this.refreshClock();
  },

  onHide() { this.stopTicker(); },
  onUnload() { this.stopTicker(); wx.setKeepScreenOn({ keepScreenOn: false }); },

  startTicker() {
    this.stopTicker();
    this.timer = setInterval(() => this.refreshClock(), 1000);
  },

  stopTicker() { if (this.timer) { clearInterval(this.timer); this.timer = null; } },

  refreshClock() {
    const sessionId = this.data.session?.id;
    if (!sessionId) return;
    const session = getActionSession(sessionId);
    if (!session) return;
    const elapsed = session.elapsedSeconds;
    const remaining = Math.max(0, Number(session.targetSeconds || 0) - elapsed);
    const progress = session.targetSeconds ? Math.min(100, Math.round((elapsed / session.targetSeconds) * 100)) : 0;
    this.setData({
      session,
      elapsedSeconds: elapsed,
      elapsedResultText: elapsed < 60 ? "不足 1 分钟" : `${Math.max(1, Math.round(elapsed / 60))} 分钟`,
      displayTime: clock(session.mode === "countdown" ? remaining : elapsed),
      remainingText: session.mode === "countdown" ? (remaining > 0 ? `已投入 ${clock(elapsed)}` : `已超过预计 ${clock(elapsed - Number(session.targetSeconds || 0))}`) : "自由计时",
      progressPercent: progress,
    });
  },

  pause() {
    const id = this.data.session?.id;
    if (!id) return;
    try { this.setData({ session: pauseActionSession(id) }); this.refreshClock(); }
    catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "暂停失败", icon: "none" }); }
  },

  resume() {
    const id = this.data.session?.id;
    if (!id) return;
    try { this.setData({ session: resumeActionSession(id) }); this.refreshClock(); }
    catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "继续失败", icon: "none" }); }
  },

  prepareComplete() {
    const id = this.data.session?.id;
    if (!id) return;
    try {
      const session = this.data.session?.status === "running" ? pauseActionSession(id) : this.data.session;
      const minutes = Math.max(1, Math.min(480, Math.round(Number(session?.elapsedSeconds || 0) / 60)));
      this.setData({ session, actualMinutes: minutes, completionVisible: true });
      this.refreshClock();
    } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "暂时无法完成", icon: "none" }); }
  },

  closeCompletion() { if (!this.data.submitting) this.setData({ completionVisible: false }); },
  inputMinutes(event: { detail: { value?: string } }) { this.setData({ actualMinutes: Number(event.detail.value) }); },
  inputReflection(event: { detail: { value?: string } }) { this.setData({ reflection: String(event.detail.value || "").slice(0, 200) }); },

  async submitComplete() {
    const id = this.data.session?.id;
    if (!id || this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      completeActionSession(id, Number(this.data.actualMinutes), this.data.reflection);
      let offline = false;
      await syncManualData().catch(() => { offline = true; });
      wx.showToast({ title: offline ? "已保存，稍后自动同步" : "行动已完成", icon: offline ? "none" : "success" });
      setTimeout(() => wx.navigateBack(), 350);
    } catch (error) {
      this.setData({ submitting: false });
      wx.showToast({ title: error instanceof Error ? error.message : "保存失败，请重试", icon: "none" });
    }
  },

  abandon() {
    const id = this.data.session?.id;
    if (!id) return;
    wx.showModal({
      title: "放弃本次行动？",
      content: "你可以保留已经投入的时间，作为“完成一部分”记录。",
      confirmText: "继续选择",
      success: (result) => {
        if (!result.confirm) return;
        wx.showActionSheet({
          itemList: ["保留时间并记录一部分", "不计入本次时间"],
          success: async ({ tapIndex }) => {
            try {
              abandonActionSession(id, tapIndex === 0);
              await syncManualData().catch(() => undefined);
              wx.showToast({ title: tapIndex === 0 ? "已保留本次投入" : "本次未计入", icon: "none" });
              setTimeout(() => wx.navigateBack(), 300);
            } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "操作失败", icon: "none" }); }
          },
        });
      },
    });
  },

  goBack() { wx.navigateBack(); },
}));
