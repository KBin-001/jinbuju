import { getActiveGoal } from "../../services/manualGoal";
import { calculateTodaySummary, getTodayPageTasks, updateTaskStatus } from "../../services/manualTask";
import { getCurrentThemeId, withAppTheme } from "../../services/theme";
import {
  canManageTeam,
  createTeam,
  getMyTeam,
  joinRoom,
  sendEncouragement,
  updateSelfActivity,
  updateSelfDisplayMode,
  updateSelfTaskDetailVisible,
  updateTeamSettings,
  validateRoomCode,
} from "../../services/team";
import { ActionTask, Goal, TodaySummary } from "../../types/manual";
import {
  EncouragementType,
  MemberTodayStatus,
  Team,
  TeamActionDetailVisibility,
  TeamDailyStats,
  TeamDisplayMode,
  TeamMember,
  TeamMemberActionDetail,
  TeamVisibility,
} from "../../types/team";
import { getTodayBusinessDate } from "../../utils/date";

type PageStatus = "loading" | "empty" | "ready" | "error";

function getTeamLayout(): { menuTop: number; menuHeight: number } {
  try {
    const windowInfo = wx.getWindowInfo();
    const menu = wx.getMenuButtonBoundingClientRect();
    return {
      menuTop: Math.max(windowInfo.statusBarHeight || 0, menu.top || 0),
      menuHeight: menu.height || 32,
    };
  } catch (_) {
    return { menuTop: 28, menuHeight: 32 };
  }
}

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
  totalGrowthMinutes: number;
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
  statusLabel: string;
  actionSummary: string;
  encourageText: string;
  canEncourage: boolean;
  isSelf: boolean;
}

interface HeroAvatarSlot {
  id: string;
  avatar: string;
  avatarText: string;
  tone: "photo" | "mountain" | "robot" | "initial";
}

interface TeamActionNode {
  id: string;
  name: string;
  avatar: string;
  avatarText: string;
  statusClass: "completed" | "doing" | "pending";
  statusLabel: string;
}

function normalizeTeamDisplayName(team: Team | null): string {
  const name = (team?.name || TEAM_NAME).trim();
  if (!name || /^自律同行\s+[A-Z0-9]{4,6}\s*队$/.test(name)) return TEAM_NAME;
  return name;
}

function displayRoomCode(roomCode?: string): string {
  const raw = (roomCode || "").trim().toUpperCase();
  if (!raw) return "2846";
  let seed = 0;
  for (let index = 0; index < raw.length; index += 1) {
    seed = (seed * 33 + raw.charCodeAt(index)) % 10000;
  }
  return String(seed || 2846).padStart(4, "0");
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

interface TeamSettingsDraft {
  name: string;
  avatar: string;
  visibility: TeamVisibility;
  allowAnonymous: boolean;
  actionDetailVisibility: TeamActionDetailVisibility;
  displayMode: TeamDisplayMode;
  taskDetailVisible: boolean;
}

const TEAM_LEVEL = "Lv.3";
const TEAM_MOOD = "稳定同行";
const TEAM_NAME = "进步小队";

/* —— 今日共同行动相关（mock，方便后续接真实接口） —— */
const COMMON_ACTION_DESC = "每人完成 3 个行动，保持连续打卡";
const COMMON_ACTION_TARGET = 3;

/* —— 今日小队战况相关（mock） —— */
const TEAM_TODAY_ACTIONS_MOCK = 8;
const TEAM_TARGET_ACTIONS_MOCK = 50;
const TODAY_COMPLETION_RATE_MOCK = 67;
const COMPLETED_MEMBERS_MOCK = 3;

const MEMBER_STATUS_MAX = 8;
const ACTIVITY_MAX = 3;

function persistTeamAvatar(tempFilePath: string, currentAvatar: string): Promise<string> {
  if (!tempFilePath || tempFilePath === currentAvatar) return Promise.resolve(tempFilePath);
  return new Promise((resolve, reject) => {
    wx.saveFile({
      tempFilePath,
      success: ({ savedFilePath }) => resolve(savedFilePath),
      fail: () => reject(new Error("头像保存失败，请重新选择")),
    });
  });
}

const ENCOURAGEMENT_OPTIONS: Array<{ type: EncouragementType; label: string }> = [
  { type: "keep_going", label: "今天也要加油" },
  { type: "very_stable", label: "你太稳了" },
  { type: "continue_tomorrow", label: "明天继续" },
  { type: "stay_together", label: "一起坚持" },
];

const DISPLAY_MODE_OPTIONS: Array<{ value: TeamDisplayMode; label: string }> = [
  { value: "nicknameOnly", label: "仅昵称" },
  { value: "public", label: "公开" },
  { value: "anonymous", label: "匿名参与" },
];

const ACTION_DETAIL_OPTIONS: Array<{ value: TeamActionDetailVisibility; label: string; desc: string }> = [
  { value: "all_members", label: "全体成员", desc: "成员可查看已主动开放的行动详情" },
  { value: "admins_only", label: "仅管理员", desc: "只有创建者可查看已开放的行动详情" },
  { value: "hidden", label: "全部隐藏", desc: "所有成员只展示行动状态摘要" },
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

function toMemberView(member: TeamMember, team: Team | null): MemberView {
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
  const detailAudienceAllowed = team?.actionDetailVisibility === "all_members"
    || (team?.actionDetailVisibility === "admins_only" && canManageTeam(team));
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
    taskDetailVisible: canOpenDetail && Boolean(detailAudienceAllowed) && member.taskDetailVisible,
    detailHiddenText: member.displayMode === "anonymous"
      ? "匿名成员不会公开行动明细。"
      : team?.actionDetailVisibility === "hidden"
        ? "小队已关闭行动详情展示。"
        : team?.actionDetailVisibility === "admins_only" && !canManageTeam(team)
          ? "行动详情仅对小队管理员可见。"
          : "这位成员暂未开放行动明细。",
  };
}

/* ============ 今日小队战况 ============ */
function buildTeamStats(team: Team, dailyStats: TeamDailyStats | null, members: MemberView[]): TeamStatsView {
  const totalMembers = team.memberCount || members.length;
  const completedMembers = dailyStats?.completedMembers
    ?? members.filter((member) => member.todayStatus === "completed").length;
  const todayCompletionRate = dailyStats?.completionRate
    ?? (totalMembers > 0 ? Math.round((completedMembers / totalMembers) * 100) : 0);
  const todayActions = members.reduce((sum, member) => {
    const details = Array.isArray(member.todayActionDetails) ? member.todayActionDetails : [];
    return sum + details.length;
  }, 0);
  const targetActions = Math.max(totalMembers * COMMON_ACTION_TARGET, todayActions, 1);
  const todayActionsRate = Math.min(100, Math.round((todayActions / targetActions) * 100));
  const totalGrowthMinutes = dailyStats?.totalGrowthMinutes
    ?? members.reduce((sum, member) => sum + (member.growthMinutes || 0), 0);

  return {
    todayCompletionRate,
    completedMembers,
    totalMembers,
    todayActions,
    targetActions,
    todayActionsRate,
    totalGrowthMinutes,
  };
}

function statusClassOf(status: MemberTodayStatus): MemberStatusItem["statusClass"] {
  if (status === "completed") return "completed";
  if (status === "partial") return "doing";
  return "pending";
}

function statusLabelOf(statusClass: MemberStatusItem["statusClass"]): string {
  if (statusClass === "completed") return "已完成";
  if (statusClass === "doing") return "进行中";
  return "未开始";
}

function actionSummaryOf(member: MemberView): string {
  const details = member.todayActionDetails || [];
  const completed = details.find((detail) => detail.status === "completed");
  const current = details.find((detail) => detail.status !== "completed");
  if (member.todayStatus === "completed") {
    return `完成：${completed?.title || member.todayActionTitle || member.actionText}`;
  }
  if (member.todayStatus === "partial") {
    return `进行中：${current?.title || member.todayActionTitle || member.actionText}`;
  }
  if (member.todayStatus === "missed") {
    return "今天休息：保留节奏，不做比较";
  }
  return `进行中：${current?.title || member.todayActionTitle || member.actionText}`;
}

function buildHeroAvatarSlots(members: MemberView[]): HeroAvatarSlot[] {
  const slots = members.slice(0, 4).map((member): HeroAvatarSlot => ({
    id: member.id,
    avatar: member.avatar || "",
    avatarText: member.avatarText,
    tone: member.avatar ? "photo" : "initial",
  }));
  const fallbacks: HeroAvatarSlot[] = [
    { id: "hero_mountain", avatar: "/assets/progress-mountain-path-v2.jpg", avatarText: "山", tone: "mountain" },
    { id: "hero_robot", avatar: "/assets/today-coach-watercolor-v2.jpg", avatarText: "AI", tone: "robot" },
    { id: "hero_leaf", avatar: "", avatarText: "叶", tone: "initial" },
    { id: "hero_star", avatar: "", avatarText: "星", tone: "initial" },
  ];
  return [...slots, ...fallbacks].slice(0, 4);
}

function buildTeamActionNodes(members: MemberView[]): TeamActionNode[] {
  const nodes = members.slice(0, 4).map((member) => {
    const statusClass = statusClassOf(member.todayStatus);
    return {
      id: member.id,
      name: member.displayName,
      avatar: member.avatar || "",
      avatarText: member.avatarText,
      statusClass,
      statusLabel: statusLabelOf(statusClass),
    };
  });
  const fallbacks: TeamActionNode[] = [
    { id: "node_1", name: "伙伴", avatar: "", avatarText: "叶", statusClass: "pending", statusLabel: "未开始" },
    { id: "node_2", name: "伙伴", avatar: "", avatarText: "叶", statusClass: "pending", statusLabel: "未开始" },
    { id: "node_3", name: "伙伴", avatar: "", avatarText: "叶", statusClass: "pending", statusLabel: "未开始" },
    { id: "node_4", name: "伙伴", avatar: "", avatarText: "叶", statusClass: "pending", statusLabel: "未开始" },
  ];
  return [...nodes, ...fallbacks].slice(0, 4);
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

  const teamCompleted = members.reduce((sum, member) => (
    sum + (member.todayActionDetails || []).filter((detail) => detail.status === "completed").length
  ), 0);
  const teamTarget = Math.max(COMMON_ACTION_TARGET * members.length, teamCompleted, 1);
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
    const statusLabel = statusLabelOf(statusClass);

    return {
      id: member.id,
      name: member.displayName,
      avatar: member.avatar || "",
      avatarText: member.avatarText,
      statusClass,
      statusText,
      statusLabel,
      actionSummary: actionSummaryOf(member),
      encourageText: member.isSelf ? "查看详情" : (member.encouragedByMeToday ? "已鼓励" : "送一句鼓励"),
      canEncourage: member.canEncourage,
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
    ...getTeamLayout(),
    appTheme: getCurrentThemeId() as string,
    status: "loading" as PageStatus,
    errorMessage: "",
    team: null as Team | null,
    members: [] as MemberView[],
    dailyStats: null as TeamDailyStats | null,
    displayTeamName: TEAM_NAME,
    displayRoomCode: "2846",
    teamLevel: TEAM_LEVEL,
    teamMood: TEAM_MOOD,
    avatarMembers: [] as MemberView[],
    heroAvatarSlots: [] as HeroAvatarSlot[],
    teamActionNodes: [] as TeamActionNode[],
    extraAvatarCount: 0,
    /* —— 执行看板新数据 —— */
    teamStats: {
      todayCompletionRate: 0,
      completedMembers: 0,
      totalMembers: 0,
      todayActions: 0,
      targetActions: 0,
      todayActionsRate: 0,
      totalGrowthMinutes: 0,
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
    settingsVisible: false,
    settingsCanEditTeam: false,
    savingSettings: false,
    teamAvatar: "",
    teamAvatarText: "队",
    displayModeOptions: DISPLAY_MODE_OPTIONS,
    actionDetailOptions: ACTION_DETAIL_OPTIONS,
    settingsDraft: {
      name: "",
      avatar: "",
      visibility: "private",
      allowAnonymous: true,
      actionDetailVisibility: "all_members",
      displayMode: "nicknameOnly",
      taskDetailVisible: false,
    } as TeamSettingsDraft,
    memberDetailVisible: false,
    selectedMember: null as MemberView | null,
    creating: false,
    joining: false,
    markingComplete: false,
    encouragingMemberId: "",
    currentScrollTop: 0,
  },

  onShow() {
    (this as any).getTabBar?.()?.syncSelected?.();
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
    const memberViews = members.map((member) => toMemberView(member, team));
    const avatarMembers = memberViews.slice(0, 5);
    const memberStatusList = buildMemberStatusList(memberViews);

    this.setData({
      status: team ? "ready" : "empty",
      team,
      members: memberViews,
      dailyStats,
      displayTeamName: normalizeTeamDisplayName(team),
      displayRoomCode: displayRoomCode(team?.roomCode),
      teamAvatar: team?.avatar || "",
      teamAvatarText: (team?.name || TEAM_NAME).slice(0, 1),
      avatarMembers,
      heroAvatarSlots: buildHeroAvatarSlots(memberViews),
      teamActionNodes: buildTeamActionNodes(memberViews),
      extraAvatarCount: Math.max(0, memberViews.length - avatarMembers.length),
      teamStats: team ? buildTeamStats(team, dailyStats, memberViews) : this.data.teamStats,
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
    const team = this.data.team;
    const self = this.data.members.find((member) => member.isSelf);
    if (!team || !self) return;
    const allowAnonymous = team.allowAnonymous;
    this.setData({
      settingsVisible: true,
      settingsCanEditTeam: canManageTeam(team),
      settingsDraft: {
        name: team.name,
        avatar: team.avatar || "",
        visibility: team.visibility,
        allowAnonymous,
        actionDetailVisibility: team.actionDetailVisibility,
        displayMode: !allowAnonymous && self.displayMode === "anonymous" ? "nicknameOnly" : self.displayMode,
        taskDetailVisible: self.displayMode === "anonymous" ? false : self.taskDetailVisible,
      } as TeamSettingsDraft,
    });
  },

  closeTeamSettings() {
    if (this.data.savingSettings) return;
    this.setData({ settingsVisible: false });
  },

  inputTeamName(event: { detail: { value?: string } }) {
    if (!this.data.settingsCanEditTeam) return;
    this.setData({ "settingsDraft.name": String(event.detail.value || "").slice(0, 20) });
  },

  chooseTeamAvatar(event: { detail: { avatarUrl?: string } }) {
    if (!this.data.settingsCanEditTeam) return;
    const avatar = String(event.detail.avatarUrl || "");
    if (avatar) this.setData({ "settingsDraft.avatar": avatar });
  },

  selectRoomVisibility(event: { currentTarget: { dataset: { value?: TeamVisibility } } }) {
    if (!this.data.settingsCanEditTeam) return;
    const value = event.currentTarget.dataset.value;
    if (value === "public" || value === "private") {
      this.setData({ "settingsDraft.visibility": value });
    }
  },

  toggleAnonymousParticipation() {
    if (!this.data.settingsCanEditTeam) return;
    const allowAnonymous = !this.data.settingsDraft.allowAnonymous;
    const patch: Record<string, boolean | TeamDisplayMode> = {
      "settingsDraft.allowAnonymous": allowAnonymous,
    };
    if (!allowAnonymous && this.data.settingsDraft.displayMode === "anonymous") {
      patch["settingsDraft.displayMode"] = "nicknameOnly";
      patch["settingsDraft.taskDetailVisible"] = false;
    }
    this.setData(patch);
  },

  selectActionDetailVisibility(event: { currentTarget: { dataset: { value?: TeamActionDetailVisibility } } }) {
    if (!this.data.settingsCanEditTeam) return;
    const value = event.currentTarget.dataset.value;
    if (value && ["all_members", "admins_only", "hidden"].includes(value)) {
      this.setData({ "settingsDraft.actionDetailVisibility": value });
    }
  },

  selectSelfDisplayMode(event: { currentTarget: { dataset: { value?: TeamDisplayMode } } }) {
    const value = event.currentTarget.dataset.value;
    if (!value || !DISPLAY_MODE_OPTIONS.some((option) => option.value === value)) return;
    if (value === "anonymous" && !this.data.settingsDraft.allowAnonymous) {
      wx.showToast({ title: "当前小队未开放匿名参与", icon: "none" });
      return;
    }
    const patch: Record<string, boolean | TeamDisplayMode> = { "settingsDraft.displayMode": value };
    if (value === "anonymous") patch["settingsDraft.taskDetailVisible"] = false;
    this.setData(patch);
  },

  toggleDraftTaskDetailVisible() {
    if (this.data.settingsDraft.displayMode === "anonymous") {
      wx.showToast({ title: "匿名参与时不会展示行动详情", icon: "none" });
      return;
    }
    if (this.data.settingsDraft.actionDetailVisibility === "hidden") {
      wx.showToast({ title: "小队已设置为全部隐藏", icon: "none" });
      return;
    }
    this.setData({ "settingsDraft.taskDetailVisible": !this.data.settingsDraft.taskDetailVisible });
  },

  async saveTeamSettings() {
    if (this.data.savingSettings || !this.data.team) return;
    const draft = this.data.settingsDraft;
    this.setData({ savingSettings: true });
    try {
      const avatar = this.data.settingsCanEditTeam
        ? await persistTeamAvatar(draft.avatar, this.data.team.avatar || "")
        : this.data.team.avatar || "";
      if (this.data.settingsCanEditTeam) {
        updateTeamSettings({
          name: draft.name,
          avatar,
          visibility: draft.visibility,
          allowAnonymous: draft.allowAnonymous,
          actionDetailVisibility: draft.actionDetailVisibility,
        });
      }
      updateSelfDisplayMode(draft.displayMode);
      updateSelfTaskDetailVisible(draft.displayMode === "anonymous" ? false : draft.taskDetailVisible);
      const data = this.syncCurrentActivity();
      this.applyTeamData(data.team, data.members, data.dailyStats);
      this.setData({ settingsVisible: false, savingSettings: false });
      wx.showToast({ title: "小队设置已保存", icon: "success" });
    } catch (error) {
      this.setData({ savingSettings: false });
      wx.showToast({ title: error instanceof Error ? error.message : "设置保存失败", icon: "none" });
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

  openAllMembers() {
    wx.navigateTo({ url: "/pages/team-members/index" });
  },

  openAllActivities() {
    wx.navigateTo({ url: "/pages/team-activity/index" });
  },

  openMemberDetail(event: { currentTarget: { dataset: { id?: string } } }) {
    const memberId = String(event.currentTarget.dataset.id || "");
    let member = this.data.members.find((item) => item.id === memberId);
    if (!member) return;
    if (member.isSelf) {
      const data = this.syncCurrentActivity();
      const memberViews = data.members.map((item) => toMemberView(item, data.team));
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
