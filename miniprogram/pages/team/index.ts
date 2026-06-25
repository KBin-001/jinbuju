import { getActiveGoal } from "../../services/manualGoal";
import { calculateTodaySummary, getTasksByDate, updateTaskStatus } from "../../services/manualTask";
import {
  createTeam,
  getMyTeam,
  joinRoom,
  sendEncouragement,
  updateSelfActivity,
  updateSelfDisplayMode,
  updateSelfTaskDetailVisible,
  validateRoomCode,
} from "../../services/team";
import { ActionTask, Goal, TodaySummary } from "../../types/manual";
import {
  EncouragementType,
  MemberTodayStatus,
  Team,
  TeamDailyStats,
  TeamDisplayMode,
  TeamMember,
  TeamMemberActionDetail,
} from "../../types/team";
import { getTodayBusinessDate } from "../../utils/date";

type PageStatus = "loading" | "empty" | "ready" | "error";

interface MemberView extends TeamMember {
  displayName: string;
  avatarText: string;
  privacyText: string;
  statusText: string;
  actionText: string;
  compactButtonText: string;
  canMarkComplete: boolean;
  canEncourage: boolean;
  canOpenDetail: boolean;
  detailHiddenText: string;
}

interface ActivitySnapshot {
  goal: Goal | null;
  tasks: ActionTask[];
  summary: TodaySummary;
  todayActionTitle: string;
  todayActionDetails: TeamMemberActionDetail[];
  todayStatus: MemberTodayStatus;
}

interface ActivityFeedItem {
  id: string;
  memberId: string;
  name: string;
  avatar: string;
  avatarText: string;
  timeText: string;
}

const TEAM_LEVEL = "Lv.3";
const TEAM_MOOD = "团结奋进";
const TEAM_NAME = "自律同行 TQLR 队";
const WEEKLY_FOCUS_MINUTES = 165;
const WEEKLY_FOCUS_GOAL = 300;
const WEEKLY_FOCUS_DELTA = "+20%";
const HONOR_TITLE = "团结之星";
const HONOR_SUBTITLE = "连续 3 周达成目标";

const ENCOURAGEMENT_OPTIONS: Array<{ type: EncouragementType; label: string }> = [
  { type: "keep_going", label: "今天也要加油" },
  { type: "very_stable", label: "你太稳了" },
  { type: "continue_tomorrow", label: "明天继续" },
  { type: "stay_together", label: "一起坚持" },
];

const DISPLAY_MODE_OPTIONS: Array<{ value: TeamDisplayMode; label: string }> = [
  { value: "nicknameOnly", label: "半公开" },
  { value: "public", label: "公开" },
  { value: "anonymous", label: "匿名" },
];

function taskStatusToMemberStatus(status: ActionTask["status"]): MemberTodayStatus {
  if (status === "completed") return "completed";
  if (status === "partially_completed") return "partial";
  if (status === "skipped") return "missed";
  return "not_started";
}

function buildActivitySnapshot(): ActivitySnapshot {
  const goal = getActiveGoal();
  const today = getTodayBusinessDate();
  const tasks = goal ? getTasksByDate(goal.id, today) : [];
  const summary = calculateTodaySummary(tasks);
  const todayAction = tasks.find((task) => task.status !== "completed") || tasks[0];
  let todayStatus: MemberTodayStatus = "not_started";

  if (summary.totalCount > 0 && summary.completedCount === summary.totalCount) {
    todayStatus = "completed";
  } else if (summary.completedCount > 0 || summary.partialCount > 0) {
    todayStatus = "partial";
  }

  return {
    goal,
    tasks,
    summary,
    todayActionTitle: todayAction?.title || "",
    todayActionDetails: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: taskStatusToMemberStatus(task.status),
      estimatedMinutes: task.estimatedMinutes,
      growthMinutes: task.actualMinutes || 0,
    })),
    todayStatus,
  };
}

function privacyText(mode: TeamDisplayMode): string {
  if (mode === "public") return "公开";
  if (mode === "anonymous") return "匿名";
  return "半公开";
}

function statusText(status: MemberTodayStatus): string {
  const labels: Record<MemberTodayStatus, string> = {
    not_started: "今日未记录",
    completed: "今日已完成",
    partial: "完成一部分",
    missed: "今天不做",
  };
  return labels[status];
}

function toMemberView(member: TeamMember): MemberView {
  const anonymous = member.displayMode === "anonymous";
  const publicMode = member.displayMode === "public";
  const displayName = anonymous ? (member.anonymousName || "行动伙伴") : member.nickname;
  const goalText = anonymous ? "目标已隐藏" : (member.goalTitle || "正在建立目标");
  const actionText = publicMode && member.todayActionTitle
    ? member.todayActionTitle
    : member.displayMode === "nicknameOnly"
      ? "具体行动已隐藏"
      : goalText;
  const canMarkComplete = member.isSelf && member.todayStatus !== "completed";
  const canOpenDetail = member.displayMode !== "anonymous";

  return {
    ...member,
    displayName,
    avatarText: displayName.slice(0, 1),
    privacyText: privacyText(member.displayMode),
    statusText: statusText(member.todayStatus),
    actionText,
    compactButtonText: member.isSelf
      ? member.todayStatus === "completed"
        ? "已完成"
        : member.todayStatus === "partial"
          ? "继续"
          : "完成"
      : member.encouragedByMeToday
        ? "已鼓励"
        : "鼓励",
    canMarkComplete,
    canEncourage: !member.isSelf && !member.encouragedByMeToday,
    canOpenDetail,
    detailHiddenText: member.displayMode === "anonymous"
      ? "匿名成员不会公开行动明细。"
      : "这位成员暂未开放行动明细。",
  };
}

function createFeed(members: MemberView[]): ActivityFeedItem[] {
  const completedMembers = members.filter((member) => member.todayStatus === "completed" && !member.isSelf);
  const source = completedMembers.length > 0 ? completedMembers : members.filter((member) => !member.isSelf);
  const fallbackNames = ["阿岚", "小柏"];
  const feedSource = source.slice(0, 2);

  if (feedSource.length === 0) {
    return fallbackNames.map((name, index) => ({
      id: `fallback_${index}`,
      memberId: "",
      name,
      avatar: "",
      avatarText: name.slice(0, 1),
      timeText: `${index + 1} 小时前`,
    }));
  }

  return feedSource.map((member, index) => ({
    id: `feed_${member.id}`,
    memberId: member.id,
    name: index < fallbackNames.length ? fallbackNames[index] : member.displayName,
    avatar: member.avatar || "",
    avatarText: (index < fallbackNames.length ? fallbackNames[index] : member.displayName).slice(0, 1),
    timeText: `${index + 1} 小时前`,
  }));
}

Page({
  data: {
    status: "loading" as PageStatus,
    errorMessage: "",
    team: null as Team | null,
    members: [] as MemberView[],
    dailyStats: null as TeamDailyStats | null,
    displayTeamName: TEAM_NAME,
    teamLevel: TEAM_LEVEL,
    teamMood: TEAM_MOOD,
    weeklyFocusMinutes: WEEKLY_FOCUS_MINUTES,
    weeklyFocusGoal: WEEKLY_FOCUS_GOAL,
    weeklyFocusDeltaText: WEEKLY_FOCUS_DELTA,
    weeklyFocusRate: Math.round((WEEKLY_FOCUS_MINUTES / WEEKLY_FOCUS_GOAL) * 100),
    honorTitle: HONOR_TITLE,
    honorSubtitle: HONOR_SUBTITLE,
    avatarMembers: [] as MemberView[],
    extraAvatarCount: 0,
    activityFeed: [] as ActivityFeedItem[],
    roomCodeInput: "",
    joinPopupVisible: false,
    teamInfoVisible: false,
    memberDetailVisible: false,
    selectedMember: null as MemberView | null,
    creating: false,
    joining: false,
    markingComplete: false,
    encouragingMemberId: "",
    currentScrollTop: 0,
  },

  onShow() {
    this.load();
  },

  onPageScroll(event: { scrollTop: number }) {
    this.setData({ currentScrollTop: event.scrollTop });
  },

  onShareAppMessage() {
    const team = this.data.team;
    return {
      title: team ? `加入我的进步局小队：${team.roomCode}` : "一起加入进步局小队",
      path: "/pages/team/index",
    };
  },

  load() {
    try {
      const current = getMyTeam();
      const synced = current.team ? this.syncCurrentActivity() || current : current;
      this.applyTeamData(synced.team, synced.members, synced.dailyStats);
    } catch (error) {
      this.setData({
        status: "error",
        errorMessage: error instanceof Error ? error.message : "小队数据读取失败",
      });
    }
  },

  syncCurrentActivity() {
    const snapshot = buildActivitySnapshot();
    return updateSelfActivity({
      goalTitle: snapshot.goal?.title || "",
      todayActionTitle: snapshot.todayActionTitle,
      todayActionDetails: snapshot.todayActionDetails,
      estimatedMinutes: snapshot.summary.estimatedMinutes,
      growthMinutes: snapshot.summary.actualMinutes,
      todayStatus: snapshot.todayStatus,
    });
  },

  applyTeamData(team: Team | null, members: TeamMember[], dailyStats: TeamDailyStats | null) {
    const memberViews = members.map(toMemberView);
    const avatarMembers = memberViews.slice(0, 7);

    this.setData({
      status: team ? "ready" : "empty",
      team,
      members: memberViews,
      dailyStats,
      displayTeamName: TEAM_NAME,
      avatarMembers,
      extraAvatarCount: Math.max(0, memberViews.length - avatarMembers.length),
      activityFeed: createFeed(memberViews),
      errorMessage: "",
      creating: false,
      joining: false,
      markingComplete: false,
      encouragingMemberId: "",
    });
  },

  retry() {
    this.load();
  },

  createLocalTeam() {
    if (this.data.creating) return;
    this.setData({ creating: true });
    try {
      const snapshot = buildActivitySnapshot();
      const data = createTeam({
        goalTitle: snapshot.goal?.title || "",
        todayActionTitle: snapshot.todayActionTitle,
        todayActionDetails: snapshot.todayActionDetails,
        estimatedMinutes: snapshot.summary.estimatedMinutes,
        growthMinutes: snapshot.summary.actualMinutes,
        todayStatus: snapshot.todayStatus,
      });
      this.applyTeamData(data.team, data.members, data.dailyStats);
      wx.showToast({ title: "小队已创建", icon: "success" });
    } catch (error) {
      this.setData({ creating: false });
      wx.showToast({ title: error instanceof Error ? error.message : "创建失败", icon: "none" });
    }
  },

  openJoinPopup() {
    this.setData({ joinPopupVisible: true, roomCodeInput: "" });
  },

  closeJoinPopup() {
    if (this.data.joining) return;
    this.setData({ joinPopupVisible: false, roomCodeInput: "" });
  },

  inputRoomCode(event: { detail: { value?: string } }) {
    const value = String(event.detail.value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    this.setData({ roomCodeInput: value });
  },

  submitJoinRoom() {
    if (this.data.joining) return;
    this.setData({ joining: true });
    try {
      const roomCode = validateRoomCode(this.data.roomCodeInput);
      const snapshot = buildActivitySnapshot();
      const data = joinRoom({
        roomCode,
        goalTitle: snapshot.goal?.title || "",
        todayActionTitle: snapshot.todayActionTitle,
        todayActionDetails: snapshot.todayActionDetails,
        estimatedMinutes: snapshot.summary.estimatedMinutes,
        growthMinutes: snapshot.summary.actualMinutes,
        todayStatus: snapshot.todayStatus,
      });
      this.applyTeamData(data.team, data.members, data.dailyStats);
      this.setData({ joinPopupVisible: false, roomCodeInput: "" });
      wx.showModal({
        title: "已加入本地演示小队",
        content: "当前只保存到本机。真实跨设备加入需要后续接入云端小队数据。",
        showCancel: false,
      });
    } catch (error) {
      this.setData({ joining: false });
      wx.showToast({ title: error instanceof Error ? error.message : "加入失败", icon: "none" });
    }
  },

  openTeamInfo() {
    this.setData({ teamInfoVisible: true });
  },

  closeTeamInfo() {
    this.setData({ teamInfoVisible: false });
  },

  copyRoomCode() {
    const roomCode = this.data.team?.roomCode;
    if (!roomCode) return;
    wx.setClipboardData({
      data: roomCode,
      success: () => wx.showToast({ title: "房间号已复制", icon: "success" }),
    });
  },

  inviteFriends() {
    const roomCode = this.data.team?.roomCode;
    if (!roomCode) return;
    wx.showModal({
      title: "邀请好友",
      content: `把房间号 ${roomCode} 发给朋友。当前版本为本地演示，真实加入需要云端小队能力。`,
      confirmText: "复制房间号",
      success: (result) => {
        if (result.confirm) this.copyRoomCode();
      },
    });
  },

  openTeamSettings() {
    const self = this.data.members.find((member) => member.isSelf);
    const detailLabel = self?.taskDetailVisible ? "关闭行动明细" : "开放行动明细";
    wx.showActionSheet({
      itemList: DISPLAY_MODE_OPTIONS.map((item) => item.label).concat(detailLabel),
      success: ({ tapIndex }) => {
        if (tapIndex === DISPLAY_MODE_OPTIONS.length) {
          this.toggleSelfTaskDetailVisible();
          return;
        }
        const option = DISPLAY_MODE_OPTIONS[tapIndex];
        if (!option) return;
        try {
          updateSelfDisplayMode(option.value);
          const data = this.syncCurrentActivity();
          this.applyTeamData(data.team, data.members, data.dailyStats);
          wx.showToast({ title: `已切换为${option.label}`, icon: "none" });
        } catch (error) {
          wx.showToast({ title: error instanceof Error ? error.message : "设置失败", icon: "none" });
        }
      },
    });
  },

  toggleSelfTaskDetailVisible() {
    const self = this.data.members.find((member) => member.isSelf);
    if (!self || self.displayMode === "anonymous") {
      wx.showToast({ title: "匿名模式下不会开放明细", icon: "none" });
      return;
    }
    try {
      updateSelfTaskDetailVisible(!self.taskDetailVisible);
      const data = this.syncCurrentActivity();
      this.applyTeamData(data.team, data.members, data.dailyStats);
      wx.showToast({
        title: self.taskDetailVisible ? "已关闭行动明细" : "已开放行动明细",
        icon: "none",
      });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "设置失败", icon: "none" });
    }
  },

  markSelfCompleted() {
    if (this.data.markingComplete) return;
    const snapshot = buildActivitySnapshot();
    if (!snapshot.goal || snapshot.tasks.length === 0) {
      wx.showToast({ title: "请先添加今日行动", icon: "none" });
      return;
    }
    const prevScrollTop = this.data.currentScrollTop;
    this.setData({ markingComplete: true });
    try {
      snapshot.tasks
        .filter((task) => task.status !== "completed" && task.status !== "rescheduled")
        .forEach((task) => updateTaskStatus(task.id, "completed", task.actualMinutes || task.estimatedMinutes));
      const nextSnapshot = buildActivitySnapshot();
      const data = updateSelfActivity({
        goalTitle: nextSnapshot.goal?.title || "",
        todayActionTitle: nextSnapshot.todayActionTitle,
        todayActionDetails: nextSnapshot.todayActionDetails,
        estimatedMinutes: nextSnapshot.summary.estimatedMinutes,
        growthMinutes: nextSnapshot.summary.actualMinutes,
        todayStatus: nextSnapshot.todayStatus,
      });
      this.applyTeamData(data.team, data.members, data.dailyStats);
      wx.showToast({ title: "今日行动已完成", icon: "success" });
      wx.nextTick(() => wx.pageScrollTo({ scrollTop: prevScrollTop, duration: 0 }));
    } catch (error) {
      this.setData({ markingComplete: false });
      wx.showToast({ title: error instanceof Error ? error.message : "保存失败", icon: "none" });
    }
  },

  encourageMember(event: { currentTarget: { dataset: { id?: string } } }) {
    const memberId = String(event.currentTarget.dataset.id || "");
    const member = this.data.members.find((item) => item.id === memberId);
    if (!member || !member.canEncourage || this.data.encouragingMemberId) return;
    wx.showActionSheet({
      itemList: ENCOURAGEMENT_OPTIONS.map((item) => item.label),
      success: ({ tapIndex }) => {
        const option = ENCOURAGEMENT_OPTIONS[tapIndex];
        if (option) this.submitEncouragement(memberId, option.type);
      },
    });
  },

  submitEncouragement(memberId: string, type: EncouragementType) {
    if (this.data.encouragingMemberId) return;
    const prevScrollTop = this.data.currentScrollTop;
    this.setData({ encouragingMemberId: memberId });
    try {
      sendEncouragement({ memberId, type });
      const data = getMyTeam();
      this.applyTeamData(data.team, data.members, data.dailyStats);
      wx.showToast({ title: "已送出鼓励", icon: "none" });
      wx.nextTick(() => wx.pageScrollTo({ scrollTop: prevScrollTop, duration: 0 }));
    } catch (error) {
      this.setData({ encouragingMemberId: "" });
      wx.showToast({ title: error instanceof Error ? error.message : "鼓励失败", icon: "none" });
    }
  },

  openMemberDetail(event: { currentTarget: { dataset: { id?: string } } }) {
    const memberId = String(event.currentTarget.dataset.id || "");
    let member = this.data.members.find((item) => item.id === memberId);
    if (!member) return;
    if (member.isSelf) {
      const data = this.syncCurrentActivity();
      const memberViews = data.members.map(toMemberView);
      this.applyTeamData(data.team, data.members, data.dailyStats);
      member = memberViews.find((item) => item.id === memberId) || member;
    }
    if (!member.canOpenDetail) {
      wx.showToast({ title: "匿名成员未开放信息", icon: "none" });
      return;
    }
    this.setData({ selectedMember: member, memberDetailVisible: true });
  },

  closeMemberDetail() {
    this.setData({ selectedMember: null, memberDetailVisible: false });
  },

  noop() {},
});
