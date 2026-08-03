import { getActiveGoal } from "../../services/manualGoal";
import { getProgressSummary } from "../../services/manualStats";
import { calculateTodaySummary, getTasksByGoal } from "../../services/manualTask";
import { getLocalUserProfile } from "../../services/profile";
import { addBusinessDays, getTodayBusinessDate } from "../../utils/date";
import { MODAL_CONFIRM_COLORS } from "../../services/theme";
import { recordProductEvent } from "../../services/productEvents";

const CARD_WIDTH = 690;
const FONT_FAMILY = '"PingFang SC", "Microsoft YaHei", sans-serif';
const SERIF_FONT_FAMILY = '"STKaiti", "KaiTi", serif';

type CanvasContext = any;
type CanvasNode = any;
type CardMode = "today" | "streak" | "week" | "stage";

function cardPresentation(mode: CardMode, values: { done: number; total: number; focusMinutes: number; streak: number; totalMinutes: number; weekDone: number; weekTotal: number; weekMinutes: number; goalProgress: number }) {
  if (mode === "streak") return { cardTitle: "连续行动卡", primaryLabel: "连续行动", heroValue: `${values.streak}`, heroUnit: "天坚持", secondaryCopy: `累计真实投入 ${values.totalMinutes} 分钟`, listTitle: "最近完成行动", emptyCopy: "还没有可展示的完成行动", encouragement: "稳定不是每天完美，而是愿意继续。" };
  if (mode === "week") return { cardTitle: "本周复盘卡", primaryLabel: "本周完成", heroValue: `${values.weekDone}`, heroUnit: "项行动", secondaryCopy: `本周实际投入 ${values.weekMinutes} 分钟`, listTitle: "本周代表行动", emptyCopy: "本周还没有已完成行动", encouragement: "看见这一周，才能更好地走向下一周。" };
  if (mode === "stage") return { cardTitle: "阶段目标完成卡", primaryLabel: "阶段完成", heroValue: `${values.goalProgress}%`, heroUnit: "目标进度", secondaryCopy: `累计真实投入 ${values.totalMinutes} 分钟`, listTitle: "阶段代表行动", emptyCopy: "阶段记录暂不可展示", encouragement: "这一程已经完成，下一程从经验出发。" };
  return { cardTitle: "今日完成卡", primaryLabel: "今日完成", heroValue: `${values.done}`, heroUnit: "项行动", secondaryCopy: `实际投入 ${values.focusMinutes} 分钟`, listTitle: "已完成清单", emptyCopy: "今天还没有已完成行动", encouragement: "每天完成一点，就会靠近一点。" };
}

function weekdayText(dateValue: string): string {
  const day = new Date(`${dateValue}T00:00:00`).getDay();
  return `周${["日", "一", "二", "三", "四", "五", "六"][day]}`;
}

function setFont(ctx: CanvasContext, size: number, weight = 400, family = FONT_FAMILY): void {
  ctx.font = `${weight} ${size}px ${family}`;
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
    heroValue: "0",
    heroUnit: "项行动",
    secondaryCopy: "实际投入 0 分钟",
    listTitle: "已完成清单",
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
    const cardHeight = 1180;
    canvas.width = CARD_WIDTH * dpr;
    canvas.height = cardHeight * dpr;
    const ctx = canvas.getContext("2d") as CanvasContext;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "#F7F3EA";
    ctx.fillRect(0, 0, CARD_WIDTH, cardHeight);

    const landscapeImage = await loadCanvasImage(canvas, "/assets/today-hero-calendar-v4.jpg");
    if (landscapeImage) {
      ctx.save();
      ctx.globalAlpha = 0.62;
      ctx.drawImage(landscapeImage, -16, 330, 760, 760);
      ctx.restore();
      ctx.fillStyle = "rgba(247,243,234,0.72)";
      ctx.fillRect(0, 290, CARD_WIDTH, 250);
    }

    const avatarX = 50;
    const avatarY = 48;
    const avatarSize = 82;
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
      ctx.fillStyle = "#E4EEE9";
      ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
      ctx.fillStyle = "#245B4D";
      ctx.beginPath();
      ctx.arc(avatarX + avatarSize / 2, avatarY + 31, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(avatarX + avatarSize / 2, avatarY + 78, 30, Math.PI, 0);
      ctx.fill();
    }
    ctx.restore();

    setFont(ctx, 27, 700);
    ctx.fillStyle = "#24312D";
    ctx.fillText(ellipsis(ctx, this.data.nickname, 220), 152, 80);
    setFont(ctx, 20, 400);
    ctx.fillStyle = "#747A76";
    ctx.fillText("当前目标", 152, 116);
    setFont(ctx, 22, 400);
    ctx.fillStyle = "#245B4D";
    ctx.fillText(ellipsis(ctx, this.data.goalTitle, 190), 246, 116);

    setFont(ctx, 21, 400);
    ctx.fillStyle = "#4F5652";
    ctx.textAlign = "right";
    ctx.fillText(`${this.data.dateText} ${this.data.weekday}`, 638, 80);
    setFont(ctx, 17, 400);
    ctx.fillStyle = "#888D89";
    ctx.fillText("记录真实成长", 638, 111);
    ctx.textAlign = "left";

    setFont(ctx, 54, 600, SERIF_FONT_FAMILY);
    ctx.fillStyle = "#245B4D";
    ctx.fillText(this.data.primaryLabel, 54, 226);
    setFont(ctx, 104, 600, SERIF_FONT_FAMILY);
    ctx.fillStyle = "#C28F35";
    ctx.fillText(this.data.heroValue, 55, 350);
    const valueWidth = ctx.measureText(this.data.heroValue).width;
    setFont(ctx, 66, 500, SERIF_FONT_FAMILY);
    ctx.fillStyle = "#245B4D";
    ctx.fillText(this.data.heroUnit, Math.min(55 + valueWidth + 22, 300), 342);
    ctx.fillStyle = "#C89B4A";
    ctx.fillRect(58, 366, 86, 5);
    setFont(ctx, 25, 400);
    ctx.fillStyle = "#505854";
    ctx.fillText(this.data.secondaryCopy, 56, 423);

    const ringX = 155;
    const ringY = 586;
    ctx.beginPath();
    ctx.arc(ringX, ringY, 88, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(36,91,77,0.13)";
    ctx.lineWidth = 18;
    ctx.stroke();
    if (this.data.goalProgress > 0) {
      ctx.beginPath();
      ctx.arc(ringX, ringY, 88, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(this.data.goalProgress, 100) / 100);
      ctx.strokeStyle = "#245B4D";
      ctx.lineWidth = 18;
      ctx.lineCap = "butt";
      ctx.stroke();
    }
    setFont(ctx, 48, 500, SERIF_FONT_FAMILY);
    ctx.fillStyle = "#245B4D";
    ctx.textAlign = "center";
    ctx.fillText(`${this.data.goalProgress}%`, ringX, ringY + 3);
    setFont(ctx, 19, 400);
    ctx.fillStyle = "#666D69";
    ctx.fillText("目标进度", ringX, ringY + 34);
    ctx.textAlign = "left";

    ctx.fillStyle = "rgba(200,155,74,0.62)";
    ctx.fillRect(302, 522, 1, 128);
    ctx.beginPath();
    ctx.arc(302.5, 586, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#C89B4A";
    ctx.fill();

    const listX = 346;
    const listY = 525;
    setFont(ctx, 27, 500, SERIF_FONT_FAMILY);
    ctx.fillStyle = "#245B4D";
    ctx.fillText(this.data.listTitle, listX, listY);
    setFont(ctx, 17, 400);
    ctx.fillStyle = "#7C817D";
    ctx.textAlign = "right";
    ctx.fillText(this.data.hideTasks ? "内容已隐藏" : "真实完成记录", 635, listY);
    ctx.textAlign = "left";
    if (this.data.hideTasks) {
      setFont(ctx, 22, 500);
      ctx.fillStyle = "#626965";
      ctx.fillText(this.data.secondaryCopy, listX, listY + 54);
    } else if (visibleTaskCount > 0) {
      this.data.completedTasks.forEach((task: { title: string }, index: number) => {
        const rowY = listY + 53 + index * 43;
        drawCheck(ctx, listX + 15, rowY - 8);
        setFont(ctx, 22, 400);
        ctx.fillStyle = "#303733";
        ctx.fillText(ellipsis(ctx, task.title, 245), listX + 42, rowY);
      });
    } else {
      setFont(ctx, 21, 400);
      ctx.fillStyle = "#6F7672";
      ctx.fillText(this.data.emptyCopy, listX, listY + 54);
    }

    const encouragementY = 816;
    ctx.fillStyle = "#C89B4A";
    ctx.fillRect(52, encouragementY, 4, 116);
    setFont(ctx, 35, 500, SERIF_FONT_FAMILY);
    ctx.fillStyle = "#245B4D";
    const encouragementParts = this.data.encouragement.split("，");
    ctx.fillText(encouragementParts[0] ? `${encouragementParts[0]}，` : this.data.encouragement, 76, encouragementY + 42);
    if (encouragementParts[1]) ctx.fillText(encouragementParts.slice(1).join("，"), 76, encouragementY + 84);
    setFont(ctx, 19, 400);
    ctx.fillStyle = "#747A76";
    ctx.fillText("记录今天的成长，迎接更好的自己。", 76, encouragementY + 124);

    const growthY = 1004;
    ctx.fillStyle = "rgba(200,155,74,0.64)";
    ctx.fillRect(50, growthY, 590, 1);
    setFont(ctx, 19, 400);
    ctx.fillStyle = "#737975";
    ctx.fillText("连续坚持", 100, growthY + 54);
    setFont(ctx, 40, 500, SERIF_FONT_FAMILY);
    ctx.fillStyle = "#245B4D";
    ctx.fillText(`${this.data.streak}`, 100, growthY + 98);
    setFont(ctx, 19, 400);
    ctx.fillText("天", 150, growthY + 95);
    ctx.fillStyle = "rgba(200,155,74,0.56)";
    ctx.fillRect(337, growthY + 32, 1, 66);
    setFont(ctx, 19, 400);
    ctx.fillStyle = "#737975";
    ctx.fillText("累计投入", 390, growthY + 54);
    setFont(ctx, 40, 500, SERIF_FONT_FAMILY);
    ctx.fillStyle = "#245B4D";
    ctx.fillText(`${this.data.totalMinutes}`, 390, growthY + 98);
    const minutesWidth = ctx.measureText(`${this.data.totalMinutes}`).width;
    setFont(ctx, 19, 400);
    ctx.fillText("分钟", 400 + minutesWidth, growthY + 95);

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
