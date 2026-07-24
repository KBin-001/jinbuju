import { getActiveGoal } from "../../services/manualGoal";
import { getProgressSummary } from "../../services/manualStats";
import { calculateTodaySummary, getTasksByGoal } from "../../services/manualTask";
import { getLocalUserProfile } from "../../services/profile";
import { addBusinessDays, getTodayBusinessDate } from "../../utils/date";
import { MODAL_CONFIRM_COLORS } from "../../services/theme";
import { recordProductEvent } from "../../services/productEvents";

const CARD_WIDTH = 690;
const FONT_FAMILY = '"PingFang SC", "Microsoft YaHei", sans-serif';

type CanvasContext = any;
type CanvasNode = any;
type CardMode = "today" | "streak" | "week" | "stage";

function cardPresentation(mode: CardMode, values: { done: number; total: number; focusMinutes: number; streak: number; totalMinutes: number; weekDone: number; weekTotal: number; weekMinutes: number; goalProgress: number }) {
  if (mode === "streak") return { cardTitle: "连续行动卡", primaryLabel: "连续行动", primaryValue: `${values.streak} 天`, secondaryCopy: `累计真实投入 ${values.totalMinutes} 分钟`, listTitle: "最近完成行动", emptyCopy: "还没有可展示的完成行动", encouragement: "稳定不是每天完美，而是愿意继续。" };
  if (mode === "week") return { cardTitle: "本周复盘卡", primaryLabel: "本周完成", primaryValue: `${values.weekDone} / ${values.weekTotal}`, secondaryCopy: `本周真实投入 ${values.weekMinutes} 分钟`, listTitle: "本周代表行动", emptyCopy: "本周还没有已完成行动", encouragement: "看见这一周，才能更好地走向下一周。" };
  if (mode === "stage") return { cardTitle: "阶段目标完成卡", primaryLabel: "目标完成", primaryValue: `${values.goalProgress}%`, secondaryCopy: `累计真实投入 ${values.totalMinutes} 分钟`, listTitle: "阶段代表行动", emptyCopy: "阶段记录暂不可展示", encouragement: "这一程已经完成，下一程从经验出发。" };
  return { cardTitle: "今日完成卡", primaryLabel: "今日完成", primaryValue: `${values.done} / ${values.total}`, secondaryCopy: `今日实际投入 ${values.focusMinutes} 分钟`, listTitle: "今日完成清单", emptyCopy: "今天还没有已完成行动", encouragement: "每天完成一点，就会靠近一点。" };
}

function weekdayText(dateValue: string): string {
  const day = new Date(`${dateValue}T00:00:00`).getDay();
  return `周${["日", "一", "二", "三", "四", "五", "六"][day]}`;
}

function roundedPath(ctx: CanvasContext, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function fillRounded(ctx: CanvasContext, x: number, y: number, width: number, height: number, radius: number, color: string): void {
  roundedPath(ctx, x, y, width, height, radius);
  ctx.fillStyle = color;
  ctx.fill();
}

function setFont(ctx: CanvasContext, size: number, weight = 400): void {
  ctx.font = `${weight} ${size}px ${FONT_FAMILY}`;
}

function ellipsis(ctx: CanvasContext, value: string, maxWidth: number): string {
  if (ctx.measureText(value).width <= maxWidth) return value;
  let output = value;
  while (output.length > 1 && ctx.measureText(`${output}…`).width > maxWidth) output = output.slice(0, -1);
  return `${output}…`;
}

function drawCheck(ctx: CanvasContext, centerX: number, centerY: number): void {
  ctx.beginPath();
  ctx.arc(centerX, centerY, 15, 0, Math.PI * 2);
  ctx.fillStyle = "#356859";
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(centerX - 7, centerY);
  ctx.lineTo(centerX - 2, centerY + 5);
  ctx.lineTo(centerX + 8, centerY - 6);
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
}

function selectCanvas(page: object): Promise<CanvasNode> {
  return new Promise((resolve, reject) => {
    wx.createSelectorQuery()
      .in(page)
      .select("#shareCanvas")
      .fields({ node: true, size: true })
      .exec((result) => {
        const canvas = result?.[0]?.node;
        if (canvas) resolve(canvas);
        else reject(new Error("分享卡画布初始化失败"));
      });
  });
}

function loadCanvasImage(canvas: CanvasNode, source: string): Promise<any | null> {
  if (!source) return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = canvas.createImage();
    let settled = false;
    const finish = (result: any | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), 3000);
    image.onload = () => finish(image);
    image.onerror = () => finish(null);
    image.src = source;
  });
}

Page({
  data: {
    status: "loading",
    errorMessage: "",
    cardMode: "today" as CardMode,
    cardModes: [] as Array<{ value: CardMode; label: string; enabled: boolean }>,
    cardTitle: "今日完成卡",
    primaryLabel: "今日完成",
    primaryValue: "0 / 0",
    secondaryCopy: "今日实际投入 0 分钟",
    listTitle: "今日完成清单",
    emptyCopy: "今天还没有已完成行动",
    encouragement: "每天完成一点，就会靠近一点。",
    dateText: "",
    weekday: "",
    nickname: "微信用户",
    avatarUrl: "",
    avatarText: "微",
    goalTitle: "",
    done: 0,
    total: 0,
    focusMinutes: 0,
    goalProgress: 0,
    streak: 0,
    totalMinutes: 0,
    completedTasks: [] as Array<{ id: string; title: string }>,
    weekDone: 0,
    weekTotal: 0,
    weekMinutes: 0,
    hideTasks: false,
    saving: false,
    navButtonTop: 52,
    navButtonSize: 34,
    contentTop: 122,
  },

  onLoad(query: Record<string, string>) {
    const requestedMode = ["today", "streak", "week", "stage"].includes(String(query.mode)) ? String(query.mode) as CardMode : "today";
    this.setData({ cardMode: requestedMode });
    this.setupViewport();
    this.load();
  },

  setupViewport() {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const menuButton = wx.getMenuButtonBoundingClientRect();
    const statusBarHeight = Number(windowInfo.statusBarHeight || 20);
    const navButtonTop = menuButton.top > 0 ? menuButton.top : statusBarHeight + 8;
    const navButtonSize = menuButton.height > 0 ? menuButton.height : 34;
    const menuBottom = menuButton.bottom > navButtonTop ? menuButton.bottom : navButtonTop + navButtonSize;
    this.setData({
      navButtonTop,
      navButtonSize,
      contentTop: menuBottom + 34,
    });
  },

  load() {
    this.setData({ status: "loading", errorMessage: "" });
    try {
      const goal = getActiveGoal();
      if (!goal) throw new Error("请先创建一个目标，再生成今日完成卡");
      const today = getTodayBusinessDate();
      const tasks = getTasksByGoal(goal.id);
      const todayTasks = tasks.filter((task) => task.currentDate === today);
      const summary = calculateTodaySummary(todayTasks);
      const progress = getProgressSummary(goal.id, today);
      const weekStart = addBusinessDays(today, -6);
      const weekTasks = tasks.filter((task) => {
        const date = task.activityDate || task.currentDate;
        return date >= weekStart && date <= today && task.status !== "skipped" && task.status !== "rescheduled";
      });
      const weekDone = weekTasks.filter((task) => task.status === "completed").length;
      const weekMinutes = weekTasks.reduce((sum, task) => sum + (task.actualMinutes || 0), 0);
      const goalProgress = progress.totalTasks ? Math.round((progress.completedTasks / progress.totalTasks) * 100) : 0;
      const requestedMode = this.data.cardMode === "stage" && goalProgress < 100 ? "today" : this.data.cardMode;
      const presentation = cardPresentation(requestedMode, { done: summary.completedCount, total: summary.totalCount, focusMinutes: summary.actualMinutes, streak: progress.currentStreakDays, totalMinutes: progress.totalActualMinutes, weekDone, weekTotal: weekTasks.length, weekMinutes, goalProgress });
      const profile = getLocalUserProfile();
      const nickname = profile?.nickname || "微信用户";
      this.setData({
        status: "ready",
        dateText: today.replace(/-/g, "."),
        weekday: weekdayText(today),
        nickname,
        avatarUrl: profile?.avatarUrl || "",
        avatarText: nickname.slice(0, 1) || "微",
        goalTitle: goal.title,
        done: summary.completedCount,
        total: summary.totalCount,
        focusMinutes: summary.actualMinutes,
        goalProgress,
        streak: progress.currentStreakDays,
        totalMinutes: progress.totalActualMinutes,
        weekDone,
        weekTotal: weekTasks.length,
        weekMinutes,
        cardMode: requestedMode,
        cardModes: [
          { value: "today", label: "今日完成", enabled: true },
          { value: "streak", label: "连续行动", enabled: progress.currentStreakDays > 0 },
          { value: "week", label: "周复盘", enabled: weekTasks.length > 0 },
          { value: "stage", label: "阶段完成", enabled: goalProgress === 100 && progress.totalTasks > 0 },
        ],
        ...presentation,
        completedTasks: todayTasks
          .filter((task) => task.status === "completed")
          .slice(0, 3)
          .map((task) => ({ id: task.id, title: task.title })),
      });
    } catch (error) {
      this.setData({
        status: "error",
        errorMessage: error instanceof Error ? error.message : "本地数据读取失败",
      });
    }
  },

  selectCardMode(event: { currentTarget: { dataset: { mode?: CardMode } } }) {
    const mode = event.currentTarget.dataset.mode;
    const option = this.data.cardModes.find((item) => item.value === mode);
    if (!mode || !option?.enabled) { wx.showToast({ title: "当前记录还不足以生成这张卡", icon: "none" }); return; }
    const presentation = cardPresentation(mode, this.data);
    this.setData({ cardMode: mode, hideTasks: mode !== "today", ...presentation });
  },

  closePage() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.switchTab({ url: "/pages/index/index" });
  },

  toggleTaskPrivacy(event: { detail: { value?: boolean } }) {
    this.setData({ hideTasks: Boolean(event.detail.value) });
  },

  async drawShareCard(): Promise<{ canvas: CanvasNode; dpr: number; height: number }> {
    recordProductEvent("share_generated", { type: this.data.cardMode });
    const canvas = await selectCanvas(this as any);
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const dpr = Math.min(Number(windowInfo.pixelRatio || 2), 3);
    const visibleTaskCount = this.data.hideTasks ? 0 : this.data.completedTasks.length;
    const listHeight = this.data.hideTasks || visibleTaskCount === 0 ? 142 : 112 + visibleTaskCount * 52;
    const cardHeight = 799 + listHeight;
    canvas.width = CARD_WIDTH * dpr;
    canvas.height = cardHeight * dpr;
    const ctx = canvas.getContext("2d") as CanvasContext;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "#FBFCF8";
    ctx.fillRect(0, 0, CARD_WIDTH, cardHeight);
    ctx.fillStyle = "#356859";
    ctx.fillRect(0, 0, CARD_WIDTH, 96);

    setFont(ctx, 25, 700);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(`今日进度｜目标计划打卡 · ${this.data.cardTitle}`, 36, 61);
    setFont(ctx, 21, 400);
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.textAlign = "right";
    ctx.fillText(`${this.data.dateText} ${this.data.weekday}`, 654, 60);
    ctx.textAlign = "left";

    const avatarX = 40;
    const avatarY = 132;
    const avatarSize = 84;
    const avatarImage = await loadCanvasImage(canvas, this.data.avatarUrl || "/images/icons/avatar.png");
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.clip();
    if (avatarImage) {
      const sourceWidth = avatarImage.width || avatarSize;
      const sourceHeight = avatarImage.height || avatarSize;
      const sourceRatio = sourceWidth / sourceHeight;
      const offset = sourceRatio > 1 ? (sourceWidth - sourceHeight) / 2 : 0;
      const top = sourceRatio < 1 ? (sourceHeight - sourceWidth) / 2 : 0;
      const crop = Math.min(sourceWidth, sourceHeight);
      ctx.drawImage(avatarImage, offset, top, crop, crop, avatarX, avatarY, avatarSize, avatarSize);
    } else {
      ctx.fillStyle = "#E3F1E8";
      ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
      ctx.fillStyle = "#356859";
      ctx.beginPath();
      ctx.arc(avatarX + avatarSize / 2, avatarY + 31, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(avatarX + avatarSize / 2, avatarY + 78, 30, Math.PI, 0);
      ctx.fill();
    }
    ctx.restore();

    setFont(ctx, 30, 700);
    ctx.fillStyle = "#233B34";
    ctx.fillText(ellipsis(ctx, this.data.nickname, 280), 146, 166);
    fillRounded(ctx, 146, 179, 92, 30, 15, "#FFF1C7");
    setFont(ctx, 18, 600);
    ctx.fillStyle = "#A87B18";
    ctx.textAlign = "center";
    ctx.fillText("当前目标", 192, 200);
    ctx.textAlign = "left";
    setFont(ctx, 22, 400);
    ctx.fillStyle = "#71827A";
    ctx.fillText(ellipsis(ctx, this.data.goalTitle, 372), 250, 201);

    fillRounded(ctx, 34, 252, 622, 220, 28, "#FFFFFF");
    setFont(ctx, 22, 400);
    ctx.fillStyle = "#71827A";
    ctx.fillText(this.data.primaryLabel, 68, 305);
    setFont(ctx, 52, 800);
    ctx.fillStyle = "#233B34";
    ctx.fillText(this.data.primaryValue, 68, 370);
    setFont(ctx, 21, 400);
    ctx.fillText(this.data.secondaryCopy, 68, 418);

    ctx.fillStyle = "#E9EFEA";
    ctx.fillRect(337, 300, 1, 124);
    const ringX = 526;
    const ringY = 362;
    ctx.beginPath();
    ctx.arc(ringX, ringY, 66, 0, Math.PI * 2);
    ctx.strokeStyle = "#DDEBDD";
    ctx.lineWidth = 14;
    ctx.stroke();
    if (this.data.goalProgress > 0) {
      ctx.beginPath();
      ctx.arc(ringX, ringY, 66, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(this.data.goalProgress, 100) / 100);
      ctx.strokeStyle = "#356859";
      ctx.lineWidth = 14;
      ctx.lineCap = "round";
      ctx.stroke();
    }
    setFont(ctx, 38, 800);
    ctx.fillStyle = "#356859";
    ctx.textAlign = "center";
    ctx.fillText(`${this.data.goalProgress}%`, ringX, ringY + 5);
    setFont(ctx, 18, 400);
    ctx.fillStyle = "#71827A";
    ctx.fillText("目标进度", ringX, ringY + 32);
    ctx.textAlign = "left";

    const listY = 496;
    fillRounded(ctx, 34, listY, 622, listHeight, 28, "#FFFFFF");
    setFont(ctx, 24, 700);
    ctx.fillStyle = "#233B34";
    ctx.fillText(this.data.listTitle, 66, listY + 48);
    setFont(ctx, 19, 400);
    ctx.fillStyle = "#71827A";
    ctx.textAlign = "right";
    ctx.fillText(this.data.hideTasks ? "已隐藏" : "隐藏内容：关", 624, listY + 47);
    ctx.textAlign = "left";
    if (this.data.hideTasks) {
      setFont(ctx, 24, 700);
      ctx.fillStyle = "#356859";
      ctx.fillText(this.data.secondaryCopy, 66, listY + 100);
    } else if (visibleTaskCount > 0) {
      this.data.completedTasks.forEach((task: { title: string }, index: number) => {
        const rowY = listY + 95 + index * 52;
        drawCheck(ctx, 80, rowY - 8);
        setFont(ctx, 23, 400);
        ctx.fillStyle = "#233B34";
        ctx.fillText(ellipsis(ctx, task.title, 500), 108, rowY);
      });
    } else {
      setFont(ctx, 23, 600);
      ctx.fillStyle = "#71827A";
      ctx.fillText(this.data.emptyCopy, 66, listY + 100);
    }

    const growthY = listY + listHeight + 24;
    fillRounded(ctx, 34, growthY, 622, 78, 24, "#EAF5EF");
    setFont(ctx, 20, 400);
    ctx.fillStyle = "#71827A";
    ctx.fillText("连续坚持", 64, growthY + 48);
    setFont(ctx, 23, 800);
    ctx.fillStyle = "#233B34";
    ctx.fillText(`${this.data.streak} 天`, 190, growthY + 48);
    ctx.fillStyle = "#CFDED6";
    ctx.fillRect(332, growthY + 22, 1, 34);
    setFont(ctx, 20, 400);
    ctx.fillStyle = "#71827A";
    ctx.fillText("累计投入", 360, growthY + 48);
    setFont(ctx, 23, 800);
    ctx.fillStyle = "#233B34";
    ctx.fillText(`${this.data.totalMinutes} 分钟`, 492, growthY + 48);

    const encouragementY = growthY + 132;
    setFont(ctx, 27, 700);
    ctx.fillStyle = "#233B34";
    ctx.textAlign = "center";
    ctx.fillText(this.data.encouragement, CARD_WIDTH / 2, encouragementY);
    ctx.fillStyle = "#E6EEE9";
    ctx.fillRect(52, encouragementY + 44, 586, 1);
    setFont(ctx, 20, 400);
    ctx.fillStyle = "#71827A";
    ctx.fillText("我在「今日进度」记录今天的成长", CARD_WIDTH / 2, encouragementY + 92);
    ctx.textAlign = "left";

    return { canvas, dpr, height: cardHeight };
  },

  exportCanvas(canvas: CanvasNode, dpr: number, height: number): Promise<string> {
    return new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvas,
        x: 0,
        y: 0,
        width: CARD_WIDTH,
        height,
        destWidth: CARD_WIDTH * dpr,
        destHeight: height * dpr,
        fileType: "png",
        quality: 1,
        success: (result) => resolve(result.tempFilePath),
        fail: () => reject(new Error("分享卡图片生成失败")),
      });
    });
  },

  saveToAlbum(filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      wx.saveImageToPhotosAlbum({
        filePath,
        success: () => resolve(),
        fail: (error) => reject(error),
      });
    });
  },

  handleAlbumPermission(error: unknown) {
    const message = String((error as { errMsg?: string })?.errMsg || "");
    if (!/auth deny|auth denied|authorize/.test(message)) {
      wx.showToast({ title: "保存失败，请稍后重试", icon: "none" });
      return;
    }
    wx.showModal({
      title: "需要相册权限",
      content: "请在设置中允许保存到相册，分享卡只会保存在你的设备中。",
      confirmText: "去设置",
      confirmColor: MODAL_CONFIRM_COLORS.confirm,
      success: (result) => {
        if (result.confirm) wx.openSetting();
      },
    });
  },

  async saveImage() {
    if (this.data.saving || this.data.status !== "ready") return;
    this.setData({ saving: true });
    try {
      const { canvas, dpr, height } = await this.drawShareCard();
      const filePath = await this.exportCanvas(canvas, dpr, height);
      await this.saveToAlbum(filePath);
      wx.showToast({ title: "已保存到相册", icon: "success" });
      recordProductEvent("share_saved", { type: this.data.cardMode });
    } catch (error) {
      this.handleAlbumPermission(error);
    } finally {
      this.setData({ saving: false });
    }
  },
});
