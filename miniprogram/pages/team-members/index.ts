import { canManageTeam, dissolveTeam, getCachedTeam, getMyTeam, removeTeamMember, sendEncouragement, transferTeamOwner } from "../../services/team";
import { getCurrentThemeId, MODAL_CONFIRM_COLORS, withAppTheme } from "../../services/theme";
import {
  EncouragementType,
  MemberTodayStatus,
  Team,
  TeamMember,
  TeamMemberActionDetail,
} from "../../types/team";

type MemberState = "completed" | "doing" | "pending";
type FilterKey = "all" | MemberState;

interface FilterTab {
  key: FilterKey;
  label: string;
}

interface MemberView {
  id: string;
  name: string;
  avatar: string;
  avatarText: string;
  avatarClass: string;
  state: MemberState;
  statusText: string;
  roleText: string;
  isOwner: boolean;
  isSelf: boolean;
  actionSummary: string;
  actualMinutes: number;
  progressKnown: boolean;
  progressPercent: number;
  progressText: string;
  canEncourage: boolean;
  encouragedToday: boolean;
}

interface DetailActionRow {
  id: string;
  title: string;
  statusText: string;
  statusClass: MemberState;
  minutesText: string;
}

interface MemberDetailView extends MemberView {
  statusCopy: string;
  completedActionsText: string;
  actionTotalText: string;
  updatedText: string;
  detailVisible: boolean;
  privacyMessage: string;
  actions: DetailActionRow[];
}

interface TeamOverview {
  name: string;
  avatar: string;
  avatarText: string;
  memberCount: number;
  maxMembers: number;
  roomCode: string;
  completedMembers: number;
  doingMembers: number;
  pendingMembers: number;
}

interface ProgressView {
  known: boolean;
  percent: number;
  text: string;
  completed: number;
  total: number;
}

const FILTER_TABS: FilterTab[] = [
  { key: "all", label: "全部" },
  { key: "completed", label: "已完成" },
  { key: "doing", label: "进行中" },
  { key: "pending", label: "待开始" },
];

const ENCOURAGEMENT_OPTIONS: Array<{ type: EncouragementType; label: string }> = [
  { type: "keep_going", label: "今天也要加油" },
  { type: "very_stable", label: "你太稳了" },
  { type: "continue_tomorrow", label: "明天继续" },
  { type: "stay_together", label: "一起坚持" },
];

const AVATAR_GRADIENTS = ["grad-1", "grad-2", "grad-3", "grad-4", "grad-5", "grad-6"];

function hashSeed(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function pickAvatarClass(seed: string): string {
  return AVATAR_GRADIENTS[hashSeed(seed) % AVATAR_GRADIENTS.length];
}

function stateOf(status: MemberTodayStatus): MemberState {
  if (status === "completed") return "completed";
  if (status === "partial") return "doing";
  return "pending";
}

function statusTextOf(status: MemberTodayStatus): string {
  if (status === "completed") return "已完成";
  if (status === "partial") return "进行中";
  if (status === "missed") return "今天休息";
  return "待开始";
}

function actionStatusText(detail: TeamMemberActionDetail): string {
  if (detail.status === "completed") return "已完成";
  if (detail.status === "partial") return "完成一部分";
  if (detail.status === "missed") return "今天休息";
  return "待开始";
}

function displayNameOf(member: TeamMember): string {
  return member.displayMode === "anonymous"
    ? (member.anonymousName || "行动伙伴")
    : (member.nickname || "行动伙伴");
}

function canShowDetails(team: Team, member: TeamMember): boolean {
  if (member.isSelf) return true;
  if (member.displayMode === "anonymous") return false;
  const audienceAllowed = team.actionDetailVisibility === "all_members"
    || (team.actionDetailVisibility === "admins_only" && canManageTeam(team));
  return audienceAllowed && member.taskDetailVisible;
}

function buildProgress(member: TeamMember, detailVisible: boolean): ProgressView {
  const details = detailVisible && Array.isArray(member.todayActionDetails)
    ? member.todayActionDetails
    : [];
  if (details.length > 0) {
    const completed = details.filter((detail) => detail.status === "completed").length;
    const percent = Math.round((completed / details.length) * 100);
    return { known: true, percent, text: `${percent}%`, completed, total: details.length };
  }
  // 看不到行动明细时没有可核对的分母，不把成员状态换算成 0% 或 100%。
  // 这也避免旧缓存中 completionRate 与 todayStatus 不一致时显示虚假满进度。
  if (member.todayStatus === "completed") {
    return { known: false, percent: 0, text: "已完成", completed: 0, total: 0 };
  }
  if (member.todayStatus === "partial") {
    return { known: false, percent: 0, text: "进行中", completed: 0, total: 0 };
  }
  return { known: false, percent: 0, text: "暂无行动", completed: 0, total: 0 };
}

function genericActionSummary(status: MemberTodayStatus): string {
  if (status === "completed") return "今天的行动已经完成";
  if (status === "partial") return "正在稳步推进今天的行动";
  if (status === "missed") return "今天选择休息一下";
  return "今天还未开始行动";
}

function actionSummaryOf(member: TeamMember, detailVisible: boolean): string {
  const details = detailVisible ? (member.todayActionDetails || []) : [];
  if (details.length === 0) return genericActionSummary(member.todayStatus);
  const preferred = member.todayStatus === "completed"
    ? details.find((detail) => detail.status === "completed")
    : details.find((detail) => detail.status !== "completed");
  return preferred?.title || member.todayActionTitle || genericActionSummary(member.todayStatus);
}

function buildMemberView(team: Team, member: TeamMember): MemberView {
  const name = displayNameOf(member);
  const detailVisible = canShowDetails(team, member);
  const progress = buildProgress(member, detailVisible);
  const isOwner = team.ownerId === member.userId;
  return {
    id: member.id,
    name,
    avatar: member.displayMode === "anonymous" ? "" : (member.avatar || ""),
    avatarText: name.slice(0, 1),
    avatarClass: pickAvatarClass(member.userId || member.id || name),
    state: stateOf(member.todayStatus),
    statusText: statusTextOf(member.todayStatus),
    roleText: isOwner ? "创建者" : (member.isSelf ? "我" : ""),
    isOwner,
    isSelf: member.isSelf,
    actionSummary: actionSummaryOf(member, detailVisible),
    actualMinutes: Math.max(0, member.growthMinutes || 0),
    progressKnown: progress.known,
    progressPercent: progress.percent,
    progressText: progress.text,
    canEncourage: !member.isSelf && !member.encouragedByMeToday,
    encouragedToday: member.encouragedByMeToday,
  };
}

function applyFilter(members: MemberView[], filter: FilterKey, keyword: string): MemberView[] {
  const normalized = keyword.trim().toLocaleLowerCase();
  return members.filter((member) => {
    if (normalized && !member.name.toLocaleLowerCase().includes(normalized)) return false;
    return filter === "all" || member.state === filter;
  });
}

function formatUpdatedTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚更新";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return `今天 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")} 更新`;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日更新`;
}

function privacyMessageOf(team: Team, member: TeamMember): string {
  if (member.displayMode === "anonymous") return "这位伙伴选择匿名参与，行动明细不会公开。";
  if (team.actionDetailVisibility === "hidden") return "小队已关闭成员行动明细展示。";
  if (team.actionDetailVisibility === "admins_only" && !canManageTeam(team)) {
    return "行动明细仅对小队创建者开放。";
  }
  if (!member.taskDetailVisible) return "这位伙伴暂未开放自己的行动明细。";
  return "今天还没有可展示的行动明细。";
}

function buildDetailActions(member: TeamMember, detailVisible: boolean): DetailActionRow[] {
  if (!detailVisible) return [];
  return (member.todayActionDetails || []).map((detail) => {
    const actual = Math.max(0, detail.actualMinutes || detail.growthMinutes || 0);
    const planned = Math.max(0, detail.estimatedMinutes || 0);
    return {
      id: detail.id,
      title: detail.title || "今日行动",
      statusText: actionStatusText(detail),
      statusClass: stateOf(detail.status),
      minutesText: actual > 0 ? `实际 ${actual} 分钟` : `预计 ${planned} 分钟`,
    };
  });
}

function buildMemberDetail(team: Team, member: TeamMember): MemberDetailView {
  const base = buildMemberView(team, member);
  const detailVisible = canShowDetails(team, member);
  const progress = buildProgress(member, detailVisible);
  const actions = buildDetailActions(member, detailVisible);
  return {
    ...base,
    statusCopy: member.todayStatus === "completed"
      ? "今天的行动已经收好，保持自己的节奏就很好。"
      : member.todayStatus === "partial"
        ? "已经迈出了一步，剩下的可以慢慢继续。"
        : member.todayStatus === "missed"
          ? "偶尔休息也没关系，明天再回来。"
          : "今天还没开始，先做最容易的一小步。",
    completedActionsText: progress.total > 0 ? `${progress.completed}/${progress.total}` : "—",
    actionTotalText: progress.total > 0 ? String(progress.total) : "—",
    updatedText: formatUpdatedTime(member.updatedAt),
    detailVisible,
    privacyMessage: privacyMessageOf(team, member),
    actions,
  };
}

Page(withAppTheme({
  data: {
    appTheme: getCurrentThemeId() as string,
    statusBarHeight: 20,
    navBarHeight: 44,
    navTotalHeight: 64,
    navRightPad: 110,
    team: null as TeamOverview | null,
    rawTeam: null as Team | null,
    allMembers: [] as MemberView[],
    rawMembers: [] as TeamMember[],
    filteredMembers: [] as MemberView[],
    filterTabs: FILTER_TABS,
    activeFilter: "all" as FilterKey,
    searchKeyword: "",
    detailVisible: false,
    selectedDetail: null as MemberDetailView | null,
    status: "loading" as "loading" | "ready" | "empty" | "error",
    errorMessage: "",
    showCacheNotice: false,
    canManage: false,
    managingMember: false,
  },

  onLoad() {
    const windowInfo = wx.getWindowInfo();
    const menuRect = wx.getMenuButtonBoundingClientRect();
    const statusBarHeight = windowInfo.statusBarHeight || 20;
    const navBarHeight = menuRect?.height
      ? (menuRect.top - statusBarHeight) * 2 + menuRect.height
      : 44;
    const navRightPad = menuRect?.left
      ? windowInfo.windowWidth - menuRect.left + 8
      : 110;
    this.setData({
      statusBarHeight,
      navBarHeight,
      navTotalHeight: statusBarHeight + navBarHeight,
      navRightPad,
    });
  },

  onShow() {
    this.setData({ appTheme: getCurrentThemeId() });
    if (this.data.navTotalHeight > 0) this.loadMembers();
  },

  async loadMembers() {
    if (!this.data.rawTeam) this.setData({ status: "loading", errorMessage: "", showCacheNotice: false });
    try {
      const { team, members, runtime } = await getMyTeam({ pageSize: 50 });
      this.applyMembers(team, members, Boolean(runtime?.stale || runtime?.mode === "legacy"));
    } catch (error) {
      const cached = getCachedTeam();
      if (cached.team) {
        this.applyMembers(cached.team, cached.members, true);
        return;
      }
      this.setData({ status: "error", errorMessage: error instanceof Error ? error.message : "成员列表加载失败" });
    }
  },

  applyMembers(team: Team | null, members: TeamMember[], showCacheNotice: boolean) {
    if (!team) {
      this.setData({
        team: null,
        rawTeam: null,
        allMembers: [],
        rawMembers: [],
        filteredMembers: [],
        detailVisible: false,
        selectedDetail: null,
        status: "empty",
        showCacheNotice,
        canManage: false,
      });
      return;
    }
    const views = members.map((member) => buildMemberView(team, member));
    const completedMembers = views.filter((member) => member.state === "completed").length;
    const doingMembers = views.filter((member) => member.state === "doing").length;
    const pendingMembers = Math.max(0, views.length - completedMembers - doingMembers);
    const overview: TeamOverview = {
      name: team.name,
      avatar: team.avatar || "",
      avatarText: (team.name || "队").slice(0, 1),
      memberCount: team.memberCount,
      maxMembers: team.maxMembers,
      roomCode: team.roomCode,
      completedMembers,
      doingMembers,
      pendingMembers,
    };
    const patch: Record<string, unknown> = {
      team: overview,
      rawTeam: team,
      allMembers: views,
      rawMembers: members,
      filteredMembers: applyFilter(views, this.data.activeFilter, this.data.searchKeyword),
      status: "ready",
      errorMessage: "",
      showCacheNotice,
      canManage: canManageTeam(team),
    };
    if (this.data.detailVisible && this.data.selectedDetail) {
      const current = members.find((member) => member.id === this.data.selectedDetail!.id);
      if (current) patch.selectedDetail = buildMemberDetail(team, current);
    }
    this.setData(patch);
  },

  retry() { this.loadMembers(); },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.switchTab({ url: "/pages/team/index" });
  },

  onSearchInput(event: { detail: { value?: string } }) {
    const keyword = String(event.detail.value || "");
    this.setData({
      searchKeyword: keyword,
      filteredMembers: applyFilter(this.data.allMembers, this.data.activeFilter, keyword),
    });
  },

  onSearchClear() {
    this.setData({
      searchKeyword: "",
      filteredMembers: applyFilter(this.data.allMembers, this.data.activeFilter, ""),
    });
  },

  setFilter(event: { currentTarget: { dataset: { key?: FilterKey } } }) {
    const key = event.currentTarget.dataset.key || "all";
    this.setData({
      activeFilter: key,
      filteredMembers: applyFilter(this.data.allMembers, key, this.data.searchKeyword),
    });
  },

  openMemberDetail(event: { currentTarget: { dataset: { id?: string } } }) {
    const memberId = String(event.currentTarget.dataset.id || "");
    const member = this.data.rawMembers.find((item) => item.id === memberId);
    if (!member || !this.data.rawTeam) return;
    this.setData({ selectedDetail: buildMemberDetail(this.data.rawTeam, member), detailVisible: true });
  },

  closeDetail() {
    this.setData({ detailVisible: false, selectedDetail: null });
  },

  onTeamAvatarError() {
    if (this.data.team?.avatar) this.setData({ "team.avatar": "" });
  },

  onMemberAvatarError(event: { currentTarget: { dataset: { index?: number } } }) {
    const index = Number(event.currentTarget.dataset.index);
    if (Number.isInteger(index) && index >= 0 && index < this.data.filteredMembers.length) {
      this.setData({ [`filteredMembers[${index}].avatar`]: "" });
    }
  },

  onDetailAvatarError() {
    if (this.data.selectedDetail?.avatar) this.setData({ "selectedDetail.avatar": "" });
  },

  quickEncourage(event: { currentTarget: { dataset: { id?: string } } }) {
    const memberId = String(event.currentTarget.dataset.id || "");
    const member = this.data.allMembers.find((item) => item.id === memberId);
    if (!member?.canEncourage) return;
    this.openEncouragementSheet(memberId);
  },

  sendEncouragementFromDetail() {
    const detail = this.data.selectedDetail;
    if (!detail?.canEncourage) return;
    this.openEncouragementSheet(detail.id);
  },

  openEncouragementSheet(memberId: string) {
    wx.showActionSheet({
      itemList: ENCOURAGEMENT_OPTIONS.map((item) => item.label),
      success: ({ tapIndex }) => {
        const option = ENCOURAGEMENT_OPTIONS[tapIndex];
        if (option) this.submitEncouragement(memberId, option.type);
      },
    });
  },

  async submitEncouragement(memberId: string, type: EncouragementType) {
    try {
      await sendEncouragement({ memberId, type });
      await this.loadMembers();
      wx.showToast({ title: "已送出鼓励", icon: "none" });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "鼓励失败", icon: "none" });
    }
  },

  removeSelectedMember() {
    const detail = this.data.selectedDetail;
    if (!this.data.canManage || !detail || detail.isSelf || detail.isOwner || this.data.managingMember) return;
    wx.showModal({
      title: "移出小队？",
      content: `移出“${detail.name}”后，对方需要重新使用房间号加入。`,
      confirmText: "确认移出",
      confirmColor: MODAL_CONFIRM_COLORS.danger,
      success: async ({ confirm }) => {
        if (!confirm) return;
        this.setData({ managingMember: true });
        try {
          await removeTeamMember(detail.id);
          this.setData({ detailVisible: false, selectedDetail: null, managingMember: false });
          await this.loadMembers();
          wx.showToast({ title: "成员已移出", icon: "success" });
        } catch (error) {
          this.setData({ managingMember: false });
          wx.showToast({ title: error instanceof Error ? error.message : "移出失败", icon: "none" });
        }
      },
    });
  },

  transferToSelectedMember() {
    const detail = this.data.selectedDetail;
    if (!this.data.canManage || !detail || detail.isSelf || detail.isOwner || this.data.managingMember) return;
    wx.showModal({
      title: "转让队长？",
      content: `转让给“${detail.name}”后，你将成为普通成员。`,
      confirmText: "确认转让",
      success: async ({ confirm }) => {
        if (!confirm) return;
        this.setData({ managingMember: true });
        try {
          await transferTeamOwner(detail.id);
          this.setData({ detailVisible: false, selectedDetail: null, managingMember: false });
          await this.loadMembers();
          wx.showToast({ title: "队长已转让", icon: "success" });
        } catch (error) {
          this.setData({ managingMember: false });
          wx.showToast({ title: error instanceof Error ? error.message : "转让失败", icon: "none" });
        }
      },
    });
  },

  dissolveCurrentTeam() {
    const detail = this.data.selectedDetail;
    if (!this.data.canManage || !detail?.isSelf || !detail.isOwner || this.data.managingMember) return;
    wx.showModal({
      title: "解散小队？",
      content: "解散后所有成员都将退出，个人行动记录不会删除。此操作不可撤销。",
      confirmText: "确认解散",
      confirmColor: MODAL_CONFIRM_COLORS.danger,
      success: async ({ confirm }) => {
        if (!confirm) return;
        this.setData({ managingMember: true });
        try {
          await dissolveTeam();
          wx.showToast({ title: "小队已解散", icon: "none" });
          setTimeout(() => wx.switchTab({ url: "/pages/team/index" }), 300);
        } catch (error) {
          this.setData({ managingMember: false });
          wx.showToast({ title: error instanceof Error ? error.message : "解散失败", icon: "none" });
        }
      },
    });
  },

  ownerExitGuidance() {
    if (!this.data.canManage) return;
    wx.showActionSheet({
      itemList: ["先转让队长", "解散小队"],
      success: ({ tapIndex }) => {
        if (tapIndex === 0) {
          this.setData({ detailVisible: false, selectedDetail: null });
          wx.showToast({ title: "请选择一名成员并转让队长", icon: "none" });
          return;
        }
        if (tapIndex === 1) this.dissolveCurrentTeam();
      },
    });
  },

  noop() {},
}));
