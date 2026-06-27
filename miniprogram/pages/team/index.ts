import { getActiveGoal } from "../../services/manualGoal";
import { calculateTodaySummary, getTodayPageTasks, updateTaskStatus } from "../../services/manualTask";
import { getCurrentThemeId, withAppTheme } from "../../services/theme";
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

/* ============ 新增视图数据结构（执行看板） ============ */
interface TeamStatsView {
  todayCompletionRate: number;
  completedMembers: number;
  totalMembers: number;
  todayActions: number;
  targetActions: number;
  todayActionsRate: number;
}

interface CommonActionView {
  desc: string;
  myCompleted: number;
  myTarget: number;
  myDone: boolean;
  teamCompleted: number;
  teamTarget: number;
}

interface MemberStatusItem {
  id: string;
  name: string;
  avatar: string;
  avatarText: string;
  statusClass: "completed" | "doing" | "pending";
  statusText: string;
  isSelf: boolean;
}

interface MemberStatusSummary {
  completed: number;
  doing: number;
  pending: number;
}

interface ActivityItem {
  id: string;
  memberId: string;
  name: string;
  avatar: string;
  avatarText: string;
  actionText: string;
  time: string;
}

interface HonorItem {
  id: string;
  title: string;
  desc: string;
  icon: string;
}

const TEAM_LEVEL = "Lv.3";
const TEAM_MOOD = "团结奋进";
const TEAM_NAME = "自律同行 TQLR 队";

/* —— 今日共同行动相关（mock，方便后续接真实接口） —— */
const COMMON_ACTION_DESC = "每人完成 3 个待办，保持连续打卡";
const COMMON_ACTION_TARGET = 3;

/* —— 今日小队战况相关（mock） —— */
const TEAM_TODAY_ACTIONS_MOCK = 38;
const TEAM_TARGET_ACTIONS_MOCK = 50;
const TODAY_COMPLETION_RATE_MOCK = 62;
const COMPLETED_MEMBERS_MOCK = 13;

const MEMBER_STATUS_MAX = 8;
const ACTIVITY_MAX = 3;

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

const HONOR_LIST: HonorItem[] = [
  { id: "honor_teamwork", title: "团结之星", desc: "连续 3 周达成目标", icon: "★" },
  { id: "honor_full", title: "全勤小队", desc: "本周 7 天都有成员完成行动", icon: "✓" },
  { id: "honor_sprint", title: "冲刺达人", desc: "今日行动数突破 50 项", icon: "↑" },
];

const ACTIVITY_FALLBACK_NAMES = ["阿岚", "林", "沲", "思"];

function taskStatusToMemberStatus(status: ActionTask["status"]): MemberTodayStatus {
  if (status === "completed") return "completed";
  if (status === "partially_completed") return "partial";
  if (status === "skipped") return "missed";
  return "not_started";
}

function buildActivitySnapshot(): ActivitySnapshot {
  const goal = getActiveGoal();
  const today = getTodayBusinessDate();
  // 与「今日」页保持同一取数口径：包含今日行动 + 过去未完成的顺延行动，
  // 避免小队页统计数量与今日页不一致（例如今日 3 项 + 顺延 2 项 = 5 项）。
  const tasks = goal ? getTodayPageTasks(goal.id, today, today) : [];
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

/* ============ 今日小队战况 ============ */
function buildTeamStats(team: Team, dailyStats: TeamDailyStats | null): TeamStatsView {
  const totalMembers = team.memberCount;
  const completedMembers = dailyStats?.completedMembers ?? COMPLETED_MEMBERS_MOCK;
  const todayCompletionRate = dailyStats?.completionRate ?? TODAY_COMPLETION_RATE_MOCK;
  const todayActions = TEAM_TODAY_ACTIONS_MOCK;
  const targetActions = TEAM_TARGET_ACTIONS_MOCK;
  const todayActionsRate = Math.min(100, Math.round((todayActions / targetActions) * 100));

  return {
    todayCompletionRate,
    completedMembers,
    totalMembers,
    todayActions,
    targetActions,
    todayActionsRate,
  };
}

/* ============ 今日共同行动 ============ */
function buildCommonAction(members: MemberView[]): CommonActionView {
  const self = members.find((member) => member.isSelf);

  let myCompleted = 0;
  let myTarget = COMMON_ACTION_TARGET;

  if (self) {
    const details = self.todayActionDetails || [];
    if (details.length > 0) {
      myTarget = details.length;
      myCompleted = details.filter((detail) => detail.status === "completed").length;
    }
  }

  const teamCompleted = TEAM_TODAY_ACTIONS_MOCK;
  const teamTarget = TEAM_TARGET_ACTIONS_MOCK;
  const myDone = myTarget > 0 && myCompleted >= myTarget;

  return {
    desc: COMMON_ACTION_DESC,
    myCompleted,
    myTarget,
    myDone,
    teamCompleted,
    teamTarget,
  };
}

/* ============ 成员状态 ============ */
function buildMemberStatusList(members: MemberView[]): MemberStatusItem[] {
  return members.slice(0, MEMBER_STATUS_MAX).map((member) => {
    let statusClass: MemberStatusItem["statusClass"] = "pending";
    let completedCount = 0;
    let targetCount = COMMON_ACTION_TARGET;

    const details = member.todayActionDetails || [];
    if (member.isSelf && details.length > 0) {
      targetCount = details.length;
      completedCount = details.filter((detail) => detail.status === "completed").length;
    }

    if (member.todayStatus === "completed") {
      statusClass = "completed";
      completedCount = member.isSelf ? completedCount : COMMON_ACTION_TARGET;
    } else if (member.todayStatus === "partial") {
      statusClass = "doing";
      if (!member.isSelf) {
        completedCount = details.length > 0
          ? details.filter((detail) => detail.status === "completed").length
          : 2;
      }
    } else {
      statusClass = "pending";
      completedCount = 0;
    }

    const statusText = statusClass === "completed"
      ? `已完成 ${completedCount}/${targetCount}`
      : statusClass === "doing"
        ? `进行中 ${completedCount}/${targetCount}`
        : `未开始 0/${targetCount}`;

    return {
      id: member.id,
      name: member.displayName,
      avatar: member.avatar || "",
      avatarText: member.avatarText,
      statusClass,
      statusText,
      isSelf: member.isSelf,
    };
  });
}

function buildMemberStatusSummary(members: MemberView[]): MemberStatusSummary {
  const summary: MemberStatusSummary = { completed: 0, doing: 0, pending: 0 };
  members.forEach((member) => {
    if (member.todayStatus === "completed") {
      summary.completed += 1;
    } else if (member.todayStatus === "partial") {
      summary.doing += 1;
    } else {
      summary.pending += 1;
    }
  });
  return summary;
}

/* ============ 行动动态 ============ */
function buildActivityList(members: MemberView[]): ActivityItem[] {
  const ordered = [...members].sort((a, b) => {
    const rank: Record<MemberTodayStatus, number> = {
      completed: 1,
      partial: 2,
      not_started: 3,
      missed: 4,
    };
    return rank[a.todayStatus] - rank[b.todayStatus];
  });

  const visible = ordered.filter((member) => !member.isSelf).slice(0, ACTIVITY_MAX);

  if (visible.length === 0) {
    return [];
  }

  return visible.map((member, index) => {
    const fallbackName = ACTIVITY_FALLBACK_NAMES[index] || member.displayName;
    const name = member.displayMode === "anonymous" ? fallbackName : member.displayName;

    let actionText = "加入了小队";
    if (member.todayStatus === "completed") {
      actionText = "完成了今日目标";
    } else if (member.todayStatus === "partial") {
      actionText = "完成了部分行动";
    } else if (member.todayStatus === "not_started") {
      actionText = "开始了今日行动";
    }

    const timeOptions = ["1 小时前", "2 小时前", "昨天", "昨天"];
    const time = timeOptions[index] || `${index + 1} 小时前`;

    return {
      id: `activity_${member.id}`,
      memberId: member.id,
      name,
      avatar: member.avatar || "",
      avatarText: name.slice(0, 1),
      actionText,
      time,
    };
  });
}

Page(withAppTheme({
  data: {
    appTheme: getCurrentThemeId() as string,
    status: "loading" as PageStatus,
    errorMessage: "",
    team: null as Team | null,
    members: [] as MemberView[],
    dailyStats: null as TeamDailyStats | null,
    displayTeamName: TEAM_NAME,
    teamLevel: TEAM_LEVEL,
    teamMood: TEAM_MOOD,
    avatarMembers: [] as MemberView[],
    extraAvatarCount: 0,
    /* —— 执行看板新数据 —— */
    teamStats: {
      todayCompletionRate: 0,
      completedMembers: 0,
      totalMembers: 0,
      todayActions: 0,
      targetActions: 0,
      todayActionsRate: 0,
    } as TeamStatsView,
    commonAction: {
      desc: COMMON_ACTION_DESC,
      myCompleted: 0,
      myTarget: COMMON_ACTION_TARGET,
      myDone: false,
      teamCompleted: TEAM_TODAY_ACTIONS_MOCK,
      teamTarget: TEAM_TARGET_ACTIONS_MOCK,
    } as CommonActionView,
    memberStatusList: [] as MemberStatusItem[],
    memberStatusSummary: { completed: 0, doing: 0, pending: 0 } as MemberStatusSummary,
    memberStatusExtra: 0,
    activityList: [] as ActivityItem[],
    honorList: HONOR_LIST,
    /* —— 弹窗与状态 —— */
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
    this.setData({ appTheme: getCurrentThemeId() });
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
    const avatarMembers = memberViews.slice(0, 5);
    const memberStatusList = buildMemberStatusList(memberViews);

    this.setData({
      status: team ? "ready" : "empty",
      team,
      members: memberViews,
      dailyStats,
      displayTeamName: TEAM_NAME,
      avatarMembers,
      extraAvatarCount: Math.max(0, memberViews.length - avatarMembers.length),
      teamStats: team ? buildTeamStats(team, dailyStats) : this.data.teamStats,
      commonAction: buildCommonAction(memberViews),
      memberStatusList,
      memberStatusSummary: buildMemberStatusSummary(memberViews),
      memberStatusExtra: Math.max(0, memberViews.length - MEMBER_STATUS_MAX),
      activityList: buildActivityList(memberViews),
      honorList: HONOR_LIST,
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

  /* 跳转到「今日」页完成待办（tabBar 页，使用 switchTab） */
  goToTodayAction() {
    wx.switchTab({ url: "/pages/index/index" });
  },

  openAllMembers() {
    wx.navigateTo({ url: "/pages/team-members/index" });
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
}));
