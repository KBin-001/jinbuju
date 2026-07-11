import { getActiveGoal } from "../../services/manualGoal";
import { calculateTodaySummary, getTodayPageTasks, updateTaskStatus } from "../../services/manualTask";
import { getCurrentThemeId, withAppTheme } from "../../services/theme";
import {
  canManageTeam,
  createTeam,
  dissolveTeam,
  getTeamInviteInfo,
  getTeamActivityFeed,
  getMyTeam,
  joinRoom,
  leaveTeam,
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
  TeamDailyStats,
  TeamDisplayMode,
  TeamMember,
  TeamMemberActionDetail,
} from "../../types/team";
import { differenceInBusinessDays, getTodayBusinessDate } from "../../utils/date";

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

interface TeamStatsView {
  todayCompletionRate: number;
  completedMembers: number;
  totalMembers: number;
  totalGrowthMinutes: number;
}

interface CompanionRow {
  id: string;
  rank: number;
  name: string;
  avatar: string;
  avatarText: string;
  statusClass: "completed" | "doing" | "pending";
  statusLabel: string;
  actionSummary: string;
  growthMinutes: number;
  progressPercent: number;
  progressText: string;
  progressKnown: boolean;
  canEncourage: boolean;
  canOpenDetail: boolean;
  isSelf: boolean;
}

interface HeroAvatarSlot {
  id: string;
  avatar: string;
  avatarText: string;
  isEmpty: boolean;
  isExtra?: boolean;
}

function normalizeTeamDisplayName(team: Team | null): string {
  const name = (team?.name || TEAM_NAME).trim();
  if (!name || /^自律同行\s+[A-Z0-9]{4,6}\s*队$/.test(name)) return TEAM_NAME;
  return name;
}

function displayRoomCode(roomCode?: string): string {
  const raw = (roomCode || "").trim().toUpperCase();
  return raw || "------";
}

function formatTeamDate(value?: string): string {
  if (!value) return "暂未记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂未记录";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
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

interface SelfActionPrompt {
  text: string;
  buttonText: string;
  allDone: boolean;
}

interface TeamSettingsDraft {
  name: string;
}

const TEAM_NAME = "进步小队";
const COMPANION_PREVIEW_MAX = 5;
const ACTIVITY_MAX = 2;

const ENCOURAGEMENT_OPTIONS: Array<{ type: EncouragementType; label: string }> = [
  { type: "keep_going", label: "今天也要加油" },
  { type: "very_stable", label: "你太稳了" },
  { type: "continue_tomorrow", label: "明天继续" },
  { type: "stay_together", label: "一起坚持" },
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

function buildTeamStats(team: Team, dailyStats: TeamDailyStats | null, members: MemberView[]): TeamStatsView {
  const totalMembers = team.memberCount || members.length;
  const completedMembers = dailyStats?.completedMembers
    ?? members.filter((member) => member.todayStatus === "completed").length;
  const todayCompletionRate = dailyStats?.completionRate
    ?? (totalMembers > 0 ? Math.round((completedMembers / totalMembers) * 100) : 0);
  const totalGrowthMinutes = dailyStats?.totalGrowthMinutes
    ?? members.reduce((sum, member) => sum + (member.growthMinutes || 0), 0);

  return {
    todayCompletionRate,
    completedMembers,
    totalMembers,
    totalGrowthMinutes,
  };
}

function statusClassOf(status: MemberTodayStatus): CompanionRow["statusClass"] {
  if (status === "completed") return "completed";
  if (status === "partial") return "doing";
  return "pending";
}

function statusLabelOf(statusClass: CompanionRow["statusClass"]): string {
  if (statusClass === "completed") return "已完成";
  if (statusClass === "doing") return "进行中";
  return "未开始";
}

function companionActionSummary(member: MemberView): string {
  if (!member.isSelf && !member.taskDetailVisible) {
    if (member.todayStatus === "completed") return "今天的行动已经完成";
    if (member.todayStatus === "partial") return "正在稳步推进今天的行动";
    if (member.todayStatus === "missed") return "今天选择休息一下";
    return member.actionText || "今天还未开始行动";
  }
  const details = member.todayActionDetails || [];
  const completed = details.find((detail) => detail.status === "completed");
  const current = details.find((detail) => detail.status !== "completed");
  if (member.todayStatus === "completed") {
    return completed?.title || member.todayActionTitle || "完成了今天的行动";
  }
  if (member.todayStatus === "partial") {
    return current?.title || member.todayActionTitle || "正在推进今天的行动";
  }
  if (member.todayStatus === "missed") {
    return "今天选择休息一下";
  }
  return current?.title || member.todayActionTitle || member.actionText || "今天还未开始行动";
}

function buildHeroAvatarSlots(members: MemberView[]): HeroAvatarSlot[] {
  const slots = members.slice(0, 4).map((member): HeroAvatarSlot => ({
    id: member.id,
    avatar: member.avatar || "",
    avatarText: member.avatarText,
    isEmpty: false,
  }));
  if (members.length > 4) {
    slots.push({ id: "extra", avatar: "", avatarText: `+${members.length - 4}`, isEmpty: false, isExtra: true });
  }
  return slots;
}

function buildCompanionRows(members: MemberView[]): CompanionRow[] {
  const rows = members.map((member, index) => {
    const statusClass = statusClassOf(member.todayStatus);
    const detailsCanBeShown = member.isSelf || member.taskDetailVisible;
    const details = detailsCanBeShown ? (member.todayActionDetails || []) : [];
    const completedCount = details.filter((detail) => detail.status === "completed").length;
    const progressKnown = details.length > 0 || member.todayStatus !== "partial";
    const progressPercent = typeof member.completionRate === "number"
      ? member.completionRate
      : details.length > 0
      ? Math.round((completedCount / details.length) * 100)
      : member.todayStatus === "completed"
        ? 100
        : 0;

    return {
      id: member.id,
      rank: index + 1,
      name: member.displayName,
      avatar: member.avatar || "",
      avatarText: member.avatarText,
      statusClass,
      statusLabel: statusLabelOf(statusClass),
      actionSummary: companionActionSummary(member),
      growthMinutes: Math.max(0, member.growthMinutes || 0),
      progressPercent,
      progressText: progressKnown ? `${progressPercent}%` : "进行中",
      progressKnown,
      canEncourage: member.canEncourage,
      canOpenDetail: member.canOpenDetail,
      isSelf: member.isSelf,
    };
  });
  const preview = rows.slice(0, COMPANION_PREVIEW_MAX);
  const self = rows.find((item) => item.isSelf);
  if (self && !preview.some((item) => item.id === self.id)) preview.push(self);
  return preview;
}

function getTeamDays(team: Team | null): number {
  if (!team?.createdAt) return 1;
  const created = new Date(team.createdAt);
  if (Number.isNaN(created.getTime())) return 1;
  const start = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}-${String(created.getDate()).padStart(2, "0")}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return 1;
  const today = getTodayBusinessDate();
  const diff = differenceInBusinessDays(start, today);
  return Math.max(1, diff + 1);
}

function buildSelfActionPrompt(members: MemberView[]): SelfActionPrompt {
  const self = members.find((member) => member.isSelf);
  if (!self) return { text: "回到今日页，继续自己的节奏", buttonText: "去今日行动", allDone: false };
  const details = self.todayActionDetails || [];
  if (details.length === 0) {
    return { text: "今天还没有行动，先添加一小步", buttonText: "去添加行动", allDone: false };
  }
  const remaining = details.filter((detail) => detail.status !== "completed" && detail.status !== "missed").length;
  if (remaining === 0) {
    return { text: "今天的行动已完成，保持轻松节奏", buttonText: "查看今日", allDone: true };
  }
  return { text: `今天还有 ${remaining} 项行动可以继续`, buttonText: "去今日行动", allDone: false };
}

function formatMemberUpdateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function buildActivityList(members: MemberView[]): ActivityItem[] {
  return members
    .filter((member) => member.todayStatus === "completed" || member.todayStatus === "partial")
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, ACTIVITY_MAX)
    .map((member) => ({
      id: `activity_${member.id}`,
      memberId: member.id,
      name: member.displayName,
      avatar: member.avatar || "",
      avatarText: member.avatarText,
      actionText: member.todayStatus === "completed" ? "完成了今日行动" : "推进了部分行动",
      time: formatMemberUpdateTime(member.updatedAt),
    }));
}

Page(withAppTheme({
  data: {
    ...getTeamLayout(),
    appTheme: getCurrentThemeId() as string,
    status: "loading" as PageStatus,
    errorMessage: "",
    serviceNotice: "",
    team: null as Team | null,
    members: [] as MemberView[],
    dailyStats: null as TeamDailyStats | null,
    displayTeamName: TEAM_NAME,
    displayRoomCode: "2846",
    teamDays: 1,
    heroAvatarSlots: [] as HeroAvatarSlot[],
    teamStats: {
      todayCompletionRate: 0,
      completedMembers: 0,
      totalMembers: 0,
      totalGrowthMinutes: 0,
    } as TeamStatsView,
    companionRows: [] as CompanionRow[],
    companionExtra: 0,
    selfActionPrompt: {
      text: "回到今日页，继续自己的节奏",
      buttonText: "去今日行动",
      allDone: false,
    } as SelfActionPrompt,
    activityList: [] as ActivityItem[],
    /* —— 弹窗与状态 —— */
    roomCodeInput: "",
    inviterMemberId: "",
    joinPopupVisible: false,
    teamInfoVisible: false,
    settingsVisible: false,
    settingsCanEditTeam: false,
    isOwner: false,
    canInviteFriends: false,
    teamOwnerName: "队长",
    teamJoinedDate: "暂未记录",
    teamRuleText: "凭房间号加入",
    savingSettings: false,
    teamAvatar: "",
    teamAvatarText: "队",
    settingsDraft: {
      name: "",
    } as TeamSettingsDraft,
    memberDetailVisible: false,
    selectedMember: null as MemberView | null,
    creating: false,
    joining: false,
    markingComplete: false,
    encouragingMemberId: "",
    currentScrollTop: 0,
  },

  onLoad(query: Record<string, string>) {
    const roomCode = String(query.roomCode || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    const inviterMemberId = String(query.inviterMemberId || "").trim().slice(0, 80);
    if (query.from === "invite" && roomCode) {
      this.setData({ roomCodeInput: roomCode, inviterMemberId, joinPopupVisible: true });
    }
  },

  onShow() {
    (this as any).getTabBar?.()?.syncSelected?.();
    this.setData({ appTheme: getCurrentThemeId() });
    this.load();
    this.startBusinessDateWatcher();
  },

  onHide() {
    this.stopBusinessDateWatcher();
  },

  onUnload() {
    this.stopBusinessDateWatcher();
  },

  startBusinessDateWatcher() {
    this.stopBusinessDateWatcher();
    (this as any)._teamBusinessDate = getTodayBusinessDate();
    (this as any)._teamDateTimer = setInterval(() => {
      const nextDate = getTodayBusinessDate();
      if (nextDate === (this as any)._teamBusinessDate) return;
      (this as any)._teamBusinessDate = nextDate;
      this.load();
    }, 30 * 1000);
  },

  stopBusinessDateWatcher() {
    const timer = (this as any)._teamDateTimer;
    if (timer) clearInterval(timer);
    (this as any)._teamDateTimer = null;
  },

  onPageScroll(event: { scrollTop: number }) {
    this.setData({ currentScrollTop: event.scrollTop });
  },

  onShareAppMessage() {
    const team = this.data.team;
    const inviteReady = Boolean(team?.roomCode && this.data.canInviteFriends && this.data.inviterMemberId);
    return {
      title: inviteReady && team ? `${team.name} 邀请你一起行动` : "进步局 · 一起自律，各自成长",
      path: inviteReady && team
        ? `/pages/team/index?roomCode=${encodeURIComponent(team.roomCode)}&from=invite&inviterMemberId=${encodeURIComponent(this.data.inviterMemberId)}`
        : "/pages/team/index",
    };
  },

  async load() {
    this.setData({ status: this.data.team ? this.data.status : "loading", errorMessage: "" });
    try {
      const current = await getMyTeam({ pageSize: 20 });
      this.applyTeamData(current.team, current.members, current.dailyStats);
      const self = current.members.find((member) => member.isSelf);
      const owner = current.members.find((member) => member.role === "owner");
      this.setData({
        serviceNotice: current.runtime?.message || "",
        isOwner: self?.role === "owner",
        canInviteFriends: self?.role === "owner" || Boolean((current.team as (Team & { allowMemberInvite?: boolean }) | null)?.allowMemberInvite),
        teamOwnerName: owner?.nickname || "队长",
        teamJoinedDate: self?.joinedAt
          ? formatTeamDate(self.joinedAt)
          : self?.role === "owner" && current.team?.createdAt
            ? formatTeamDate(current.team.createdAt)
            : "暂未记录",
        teamRuleText: current.team?.joinMode === "approval" ? "加入申请需队长确认" : "凭房间号可直接加入",
      });
      if (current.team && (self?.role === "owner" || current.team.allowMemberInvite !== false) && current.runtime?.mode === "live") {
        getTeamInviteInfo().then((invite) => this.setData({ inviterMemberId: invite.inviterMemberId }), () => undefined);
      }
      if (!current.team) return;
      if (current.runtime?.capabilities.canMutate) {
        try {
          const synced = await this.syncCurrentActivity();
          this.applyTeamData(synced.team, synced.members, synced.dailyStats);
        } catch (_) {
          this.setData({ serviceNotice: "今日行动暂未同步，小队首页仍可继续查看。" });
        }
      }
      if (current.runtime?.capabilities.canReadActivity) await this.loadActivityPreview();
    } catch (error) {
      this.setData({
        status: "error",
        errorMessage: error instanceof Error ? error.message : "小队数据读取失败",
      });
    }
  },

  async loadActivityPreview() {
    try {
      const feed = await getTeamActivityFeed({ page: 1, pageSize: ACTIVITY_MAX });
      this.setData({
        activityList: feed.list.map((item) => ({
          id: item.id,
          memberId: item.memberId,
          name: item.name,
          avatar: item.avatar,
          avatarText: item.avatarText,
          actionText: item.actionText,
          time: item.timeText,
        })),
      });
    } catch (_) {
      // 榜单仍可用时不因动态预览失败阻断整个小队页。
    }
  },

  async syncCurrentActivity() {
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
    const companionRows = buildCompanionRows(memberViews);

    this.setData({
      status: team ? "ready" : "empty",
      team,
      members: memberViews,
      dailyStats,
      displayTeamName: normalizeTeamDisplayName(team),
      displayRoomCode: displayRoomCode(team?.roomCode),
      teamDays: getTeamDays(team),
      teamAvatar: team?.avatar || "",
      teamAvatarText: (team?.name || TEAM_NAME).slice(0, 1),
      heroAvatarSlots: buildHeroAvatarSlots(memberViews),
      teamStats: team ? buildTeamStats(team, dailyStats, memberViews) : this.data.teamStats,
      companionRows,
      companionExtra: Math.max(0, memberViews.length - COMPANION_PREVIEW_MAX),
      selfActionPrompt: buildSelfActionPrompt(memberViews),
      activityList: buildActivityList(memberViews),
      errorMessage: "",
      creating: false,
      joining: false,
      markingComplete: false,
      encouragingMemberId: "",
      isOwner: members.find((member) => member.isSelf)?.role === "owner",
      settingsCanEditTeam: members.find((member) => member.isSelf)?.role === "owner",
      canInviteFriends: members.find((member) => member.isSelf)?.role === "owner"
        || Boolean((team as (Team & { allowMemberInvite?: boolean }) | null)?.allowMemberInvite),
    });
  },

  retry() { this.setData({ status: "loading" }); this.load(); },

  async createLocalTeam() {
    if (this.data.creating) return;
    this.setData({ creating: true });
    try {
      const snapshot = buildActivitySnapshot();
      const data = await createTeam({
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

  async submitJoinRoom() {
    if (this.data.joining) return;
    this.setData({ joining: true });
    try {
      const roomCode = validateRoomCode(this.data.roomCodeInput);
      const snapshot = buildActivitySnapshot();
      const data = await joinRoom({
        roomCode,
        inviterMemberId: this.data.inviterMemberId || undefined,
        goalTitle: snapshot.goal?.title || "",
        todayActionTitle: snapshot.todayActionTitle,
        todayActionDetails: snapshot.todayActionDetails,
        estimatedMinutes: snapshot.summary.estimatedMinutes,
        growthMinutes: snapshot.summary.actualMinutes,
        todayStatus: snapshot.todayStatus,
      });
      this.applyTeamData(data.team, data.members, data.dailyStats);
      this.setData({ joinPopupVisible: false, roomCodeInput: "" });
      wx.showToast({ title: "已加入小队", icon: "success" });
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

  openMemberManagement() {
    this.closeTeamSettings();
    wx.navigateTo({ url: "/pages/team-members/index?manage=1" });
  },

  async toggleTeamAnonymousMode(event: { detail?: { value?: boolean } }) {
    if (!this.data.isOwner || !this.data.team || this.data.savingSettings) return;
    const enabled = Boolean(event.detail?.value);
    this.setData({ savingSettings: true });
    try {
      const data = await updateTeamSettings({
        name: this.data.team.name,
        anonymityMode: enabled ? "anonymous" : "public",
        allowMemberInvite: this.data.team.allowMemberInvite,
      });
      this.applyTeamData(data.team, data.members, data.dailyStats);
      this.setData({ savingSettings: false });
      wx.showToast({ title: enabled ? "匿名模式已开启" : "匿名模式已关闭", icon: "success" });
    } catch (error) {
      this.setData({ savingSettings: false });
      wx.showToast({ title: error instanceof Error ? error.message : "更新失败", icon: "none" });
    }
  },

  copyRoomCode() {
    const roomCode = this.data.team?.roomCode;
    if (!roomCode) return;
    wx.setClipboardData({
      data: roomCode,
      success: () => wx.showToast({ title: "房间号已复制", icon: "success" }),
    });
  },

  async inviteFriends() {
    const roomCode = this.data.team?.roomCode;
    if (!roomCode || !this.data.canInviteFriends) return;
    let inviterMemberId = this.data.inviterMemberId;
    if (!inviterMemberId) {
      try {
        const invite = await getTeamInviteInfo();
        inviterMemberId = invite.inviterMemberId;
        this.setData({ inviterMemberId });
      } catch (error) {
        wx.showToast({ title: error instanceof Error ? error.message : "暂时无法邀请", icon: "none" });
        return;
      }
    }
    wx.navigateTo({
      url: `/pages/team-invite/index?roomCode=${encodeURIComponent(roomCode)}&inviterMemberId=${encodeURIComponent(inviterMemberId)}`,
      fail: () => wx.showToast({ title: "邀请页打开失败，请重试", icon: "none" }),
    });
  },

  openTeamSettings() {
    const team = this.data.team;
    const self = this.data.members.find((member) => member.isSelf);
    if (!team || !self) return;
    this.setData({
      settingsVisible: true,
      settingsCanEditTeam: canManageTeam(team),
      settingsDraft: { name: team.name } as TeamSettingsDraft,
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

  async saveTeamSettings() {
    if (this.data.savingSettings || !this.data.team) return;
    const draft = this.data.settingsDraft;
    const name = draft.name.trim().replace(/\s+/g, " ");
    if (name.length < 2) {
      wx.showToast({ title: "小队名称至少 2 个字符", icon: "none" });
      return;
    }
    this.setData({ savingSettings: true });
    try {
      if (this.data.settingsCanEditTeam) {
        await updateTeamSettings({ name });
      }
      const data = await getMyTeam({ pageSize: 20 });
      this.applyTeamData(data.team, data.members, data.dailyStats);
      this.setData({ settingsVisible: false, savingSettings: false });
      wx.showToast({ title: "小队名称已保存", icon: "success" });
    } catch (error) {
      this.setData({ savingSettings: false });
      wx.showToast({ title: error instanceof Error ? error.message : "设置保存失败", icon: "none" });
    }
  },

  confirmLeaveOrDissolve() {
    if (this.data.savingSettings) return;
    const isOwner = this.data.isOwner;
    wx.showModal({
      title: isOwner ? "解散小队" : "退出小队",
      content: isOwner ? "解散后所有成员都将退出，历史行动不会被删除。此操作不可撤销。" : "退出后将不再参与小队榜单，个人行动记录不会受影响。",
      confirmText: isOwner ? "确认解散" : "确认退出",
      confirmColor: "#B54A43",
      success: async ({ confirm }) => {
        if (!confirm) return;
        this.setData({ savingSettings: true });
        try {
          if (isOwner) await dissolveTeam(); else await leaveTeam();
          this.setData({ settingsVisible: false, teamInfoVisible: false, memberDetailVisible: false, selectedMember: null, savingSettings: false });
          this.applyTeamData(null, [], null);
          wx.showToast({ title: isOwner ? "小队已解散" : "已退出小队", icon: "none" });
        } catch (error) {
          this.setData({ savingSettings: false });
          wx.showToast({ title: error instanceof Error ? error.message : "操作失败", icon: "none" });
        }
      },
    });
  },

  async markSelfCompleted() {
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
      const data = await updateSelfActivity({
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

  async submitEncouragement(memberId: string, type: EncouragementType) {
    if (this.data.encouragingMemberId) return;
    const prevScrollTop = this.data.currentScrollTop;
    this.setData({ encouragingMemberId: memberId });
    try {
      await sendEncouragement({ memberId, type });
      const data = await getMyTeam({ pageSize: 20 });
      this.applyTeamData(data.team, data.members, data.dailyStats);
      wx.showToast({ title: "已送出鼓励", icon: "none" });
      wx.nextTick(() => wx.pageScrollTo({ scrollTop: prevScrollTop, duration: 0 }));
    } catch (error) {
      this.setData({ encouragingMemberId: "" });
      wx.showToast({ title: error instanceof Error ? error.message : "鼓励失败", icon: "none" });
    }
  },

  openSelfPrivacyOptions() {
    if (!this.data.selectedMember?.isSelf) return;
    const options: Array<{ label: string; mode: TeamDisplayMode; detail: boolean }> = [
      { label: "显示昵称与行动", mode: "public", detail: true },
      { label: "仅显示昵称", mode: "nicknameOnly", detail: false },
    ];
    if (this.data.team?.allowAnonymous) options.push({ label: "匿名参与", mode: "anonymous", detail: false });
    wx.showActionSheet({
      itemList: options.map((item) => item.label),
      success: async ({ tapIndex }) => {
        const option = options[tapIndex];
        if (!option) return;
        try {
          await updateSelfDisplayMode(option.mode);
          await updateSelfTaskDetailVisible(option.detail);
          const data = await this.syncCurrentActivity();
          this.applyTeamData(data.team, data.members, data.dailyStats);
          this.setData({ memberDetailVisible: false, selectedMember: null });
          wx.showToast({ title: "展示方式已更新", icon: "success" });
        } catch (error) {
          wx.showToast({ title: error instanceof Error ? error.message : "更新失败", icon: "none" });
        }
      },
    });
  },

  openAllMembers() {
    wx.navigateTo({ url: "/pages/team-members/index" });
  },

  openAllActivities() {
    wx.navigateTo({ url: "/pages/team-activity/index" });
  },

  goToday() {
    wx.switchTab({ url: "/pages/index/index" });
  },

  async openMemberDetail(event: { currentTarget: { dataset: { id?: string } } }) {
    const memberId = String(event.currentTarget.dataset.id || "");
    let member = this.data.members.find((item) => item.id === memberId);
    if (!member) return;
    if (member.isSelf) {
      const data = await this.syncCurrentActivity();
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
