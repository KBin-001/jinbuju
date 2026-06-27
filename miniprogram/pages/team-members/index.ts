import { addDays } from "../../utils/date";
import { getMyTeam, sendEncouragement } from "../../services/team";
import { getCurrentThemeId, withAppTheme } from "../../services/theme";
import { EncouragementType, TeamMember } from "../../types/team";

type MemberRole = "leader" | "admin" | "member";
type MemberStatus = "checked" | "active" | "normal" | "unchecked";
type FilterKey = "all" | "active" | "weekly" | "admin";

interface MemberView {
  id: string;
  nickname: string;
  avatar: string;
  avatarText: string;
  avatarClass: string;
  role: MemberRole;
  roleText: string;
  weeklyFocusMinutes: number;
  streakDays: number;
  status: MemberStatus;
  statusText: string;
  isSelf: boolean;
}

interface TrendDay {
  dateLabel: string;
  minutes: number;
  isToday: boolean;
  heightPercent: number;
}

interface RecentAction {
  id: string;
  title: string;
  minutes: number;
  dateText: string;
}

interface MemberDetailView {
  id: string;
  nickname: string;
  avatar: string;
  avatarText: string;
  avatarClass: string;
  role: MemberRole;
  roleText: string;
  status: MemberStatus;
  statusText: string;
  joinedDays: number;
  statusCopy: string;
  weeklyFocusMinutes: number;
  streakDays: number;
  maxStreakDays: number;
  weeklyTrend: TrendDay[];
  recentActions: RecentAction[];
  isSelf: boolean;
  canEncourage: boolean;
  encouragedToday: boolean;
}

interface FilterTab {
  key: FilterKey;
  label: string;
}

interface TeamOverview {
  name: string;
  memberCount: number;
  maxMembers: number;
  roomCode: string;
  createdAt: string;
}

const FILTER_TABS: FilterTab[] = [
  { key: "all", label: "全部成员" },
  { key: "active", label: "活跃成员" },
  { key: "weekly", label: "本周排行" },
  { key: "admin", label: "管理员" },
];

const ENCOURAGEMENT_OPTIONS: Array<{ type: EncouragementType; label: string }> = [
  { type: "keep_going", label: "今天也要加油" },
  { type: "very_stable", label: "你太稳了" },
  { type: "continue_tomorrow", label: "明天继续" },
  { type: "stay_together", label: "一起坚持" },
];

const STATUS_COPY: Record<MemberStatus, string> = {
  checked: "最近坚持很好，继续保持！",
  active: "状态不错，今天继续加油。",
  normal: "稍微慢一点也没关系，先迈出一小步。",
  unchecked: "今天还没开始，先从最简单的一步开始吧。",
};

const AVATAR_GRADIENTS = ["grad-1", "grad-2", "grad-3", "grad-4", "grad-5", "grad-6"];

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

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

function deriveRole(member: TeamMember, firstNonSelfId: string | null): { role: MemberRole; roleText: string } {
  if (member.isSelf) return { role: "leader", roleText: "队长" };
  if (firstNonSelfId && member.id === firstNonSelfId) return { role: "admin", roleText: "管理员" };
  return { role: "member", roleText: "成员" };
}

function deriveWeeklyFocus(member: TeamMember): number {
  if (member.isSelf) return Math.min(200, Math.max(member.growthMinutes * 4, 60));
  const seed = hashSeed(member.userId || member.id);
  const statusBase =
    member.todayStatus === "completed"
      ? 120
      : member.todayStatus === "partial"
        ? 90
        : member.todayStatus === "not_started"
          ? 45
          : 25;
  return statusBase + (seed % 40);
}

function deriveStreakDays(member: TeamMember): number {
  const seed = hashSeed(member.userId || member.id);
  switch (member.todayStatus) {
    case "completed":
      return 3 + (seed % 4);
    case "partial":
      return 2 + (seed % 2);
    case "not_started":
      return seed % 2;
    case "missed":
    default:
      return 0;
  }
}

function deriveMaxStreakDays(member: TeamMember, currentStreak: number): number {
  const seed = hashSeed((member.userId || member.id) + "_max");
  return Math.max(currentStreak, 18 + (seed % 15));
}

function deriveStatus(member: TeamMember): { status: MemberStatus; statusText: string } {
  switch (member.todayStatus) {
    case "completed":
      return { status: "checked", statusText: "今日已打卡" };
    case "partial":
      return { status: "active", statusText: "活跃" };
    case "missed":
      return { status: "unchecked", statusText: "未打卡" };
    case "not_started":
    default: {
      const seed = hashSeed(member.userId || member.id);
      return seed % 2 === 0
        ? { status: "normal", statusText: "一般" }
        : { status: "unchecked", statusText: "未打卡" };
    }
  }
}

function toMemberView(member: TeamMember, firstNonSelfId: string | null): MemberView {
  const { role, roleText } = deriveRole(member, firstNonSelfId);
  const { status, statusText } = deriveStatus(member);
  const anonymous = member.displayMode === "anonymous";
  const displayName = anonymous ? (member.anonymousName || "行动伙伴") : member.nickname;
  return {
    id: member.id,
    nickname: displayName,
    avatar: member.avatar || "",
    avatarText: displayName.slice(0, 1),
    avatarClass: pickAvatarClass(member.userId || member.id || displayName),
    role,
    roleText,
    weeklyFocusMinutes: deriveWeeklyFocus(member),
    streakDays: deriveStreakDays(member),
    status,
    statusText,
    isSelf: member.isSelf,
  };
}

function buildMemberViews(members: TeamMember[]): MemberView[] {
  const firstNonSelf = members.find((member) => !member.isSelf);
  const firstNonSelfId = firstNonSelf ? firstNonSelf.id : null;
  return members.map((member) => toMemberView(member, firstNonSelfId));
}

function applyFilter(members: MemberView[], filter: FilterKey, keyword: string): MemberView[] {
  const trimmed = keyword.trim();
  let list = members;
  if (trimmed) {
    list = list.filter((member) => member.nickname.toLowerCase().includes(trimmed.toLowerCase()));
  }
  switch (filter) {
    case "active":
      list = list.filter((member) => member.status === "checked" || member.status === "active");
      break;
    case "weekly":
      list = list.slice().sort((a, b) => b.weeklyFocusMinutes - a.weeklyFocusMinutes);
      break;
    case "admin":
      list = list.filter((member) => member.role === "leader" || member.role === "admin");
      break;
    case "all":
    default:
      break;
  }
  return list;
}

function computeTop3(members: MemberView[]): MemberView[] {
  return members.slice().sort((a, b) => b.weeklyFocusMinutes - a.weeklyFocusMinutes).slice(0, 3);
}

function computeJoinedDays(createdAt: string): number {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return 1;
  const days = Math.floor((Date.now() - created) / DAY_MILLISECONDS);
  return Math.max(1, days + 1);
}

function buildWeeklyTrend(member: TeamMember, weeklyFocusMinutes: number): TrendDay[] {
  const today = new Date();
  const todayMinutes = member.growthMinutes > 0
    ? member.growthMinutes
    : Math.max(15, Math.round(weeklyFocusMinutes * 0.2));
  const raw: Array<{ dateLabel: string; minutes: number; isToday: boolean }> = [];
  let remaining = Math.max(0, weeklyFocusMinutes - todayMinutes);
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = addDays(today, -offset);
    const isToday = offset === 0;
    if (isToday) {
      raw.push({ dateLabel: "今天", minutes: todayMinutes, isToday: true });
    } else {
      const seed = hashSeed((member.userId || member.id) + date.getTime());
      const share = Math.round((remaining / (offset)) * (0.55 + (seed % 10) / 12));
      const minutes = Math.max(0, Math.min(share, remaining));
      remaining -= minutes;
      raw.push({ dateLabel: `${date.getMonth() + 1}/${date.getDate()}`, minutes, isToday: false });
    }
  }
  const max = Math.max(todayMinutes, ...raw.map((item) => item.minutes), 1);
  return raw.map((item) => ({
    dateLabel: item.dateLabel,
    minutes: item.minutes,
    isToday: item.isToday,
    heightPercent: Math.max(10, Math.round((item.minutes / max) * 100)),
  }));
}

function buildRecentActions(member: TeamMember): RecentAction[] {
  const actions: RecentAction[] = [];
  const details = Array.isArray(member.todayActionDetails) ? member.todayActionDetails : [];
  details.slice(0, 2).forEach((detail) => {
    actions.push({
      id: detail.id,
      title: detail.title || "今日行动",
      minutes: detail.growthMinutes || detail.estimatedMinutes || 0,
      dateText: "今天",
    });
  });
  const goal = member.goalTitle || "";
  const historical: Array<{ title: string; minutes: number }> = [
    { title: goal.indexOf("英语") >= 0 ? "背 30 个单词" : "阅读一章节", minutes: 30 },
    { title: "写日记", minutes: 15 },
    { title: "复盘错题", minutes: 25 },
  ];
  historical.forEach((item, index) => {
    const date = addDays(new Date(), -(index + 1));
    actions.push({
      id: `hist_${index}`,
      title: item.title,
      minutes: item.minutes,
      dateText: `${date.getMonth() + 1}/${date.getDate()}`,
    });
  });
  return actions.slice(0, 5);
}

function buildMemberDetail(member: TeamMember, teamCreatedAt: string, firstNonSelfId: string | null): MemberDetailView {
  const { role, roleText } = deriveRole(member, firstNonSelfId);
  const { status, statusText } = deriveStatus(member);
  const anonymous = member.displayMode === "anonymous";
  const displayName = anonymous ? (member.anonymousName || "行动伙伴") : member.nickname;
  const streakDays = deriveStreakDays(member);
  const weeklyFocusMinutes = deriveWeeklyFocus(member);
  return {
    id: member.id,
    nickname: displayName,
    avatar: member.avatar || "",
    avatarText: displayName.slice(0, 1),
    avatarClass: pickAvatarClass(member.userId || member.id || displayName),
    role,
    roleText,
    status,
    statusText,
    joinedDays: computeJoinedDays(teamCreatedAt),
    statusCopy: STATUS_COPY[status],
    weeklyFocusMinutes,
    streakDays,
    maxStreakDays: deriveMaxStreakDays(member, streakDays),
    weeklyTrend: buildWeeklyTrend(member, weeklyFocusMinutes),
    recentActions: buildRecentActions(member),
    isSelf: member.isSelf,
    canEncourage: !member.isSelf && !member.encouragedByMeToday,
    encouragedToday: member.encouragedByMeToday,
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
    allMembers: [] as MemberView[],
    rawMembers: [] as TeamMember[],
    filteredMembers: [] as MemberView[],
    top3: [] as MemberView[],
    filterTabs: FILTER_TABS,
    activeFilter: "all" as FilterKey,
    searchKeyword: "",
    detailVisible: false,
    selectedDetail: null as MemberDetailView | null,
  },

  onLoad() {
    const windowInfo = wx.getWindowInfo();
    const menuRect = wx.getMenuButtonBoundingClientRect();
    const statusBarHeight = windowInfo.statusBarHeight || 20;
    const navBarHeight = menuRect && menuRect.height
      ? (menuRect.top - statusBarHeight) * 2 + menuRect.height
      : 44;
    const navRightPad = menuRect && menuRect.left
      ? windowInfo.windowWidth - menuRect.left + 8
      : 110;
    this.setData({
      statusBarHeight,
      navBarHeight,
      navTotalHeight: statusBarHeight + navBarHeight,
      navRightPad,
    });
    this.loadMembers();
  },

  onShow() {
    // 每次进入页面都同步最新主题（用户在「我的」页切换后回来即生效）
    this.setData({ appTheme: getCurrentThemeId() });
    if (this.data.navTotalHeight > 0) this.loadMembers();
  },

  loadMembers() {
    const { team, members } = getMyTeam();
    if (!team) {
      this.setData({
        team: null,
        allMembers: [],
        rawMembers: [],
        filteredMembers: [],
        top3: [],
      });
      return;
    }
    const views = buildMemberViews(members);
    const top3 = computeTop3(views);
    const filtered = applyFilter(views, this.data.activeFilter, this.data.searchKeyword);
    const firstNonSelf = members.find((item) => !item.isSelf);
    const firstNonSelfId = firstNonSelf ? firstNonSelf.id : null;
    const teamOverview: TeamOverview = {
      name: team.name,
      memberCount: team.memberCount,
      maxMembers: team.maxMembers,
      roomCode: team.roomCode,
      createdAt: team.createdAt,
    };
    const patch: Record<string, unknown> = {
      team: teamOverview,
      allMembers: views,
      rawMembers: members,
      filteredMembers: filtered,
      top3,
    };
    if (this.data.detailVisible && this.data.selectedDetail) {
      const current = members.find((item) => item.id === this.data.selectedDetail!.id);
      if (current) patch.selectedDetail = buildMemberDetail(current, team.createdAt, firstNonSelfId);
    }
    this.setData(patch);
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.switchTab({ url: "/pages/team/index" });
    }
  },

  onSearchInput(event: { detail: { value: string } }) {
    const keyword = String(event.detail.value || "");
    const filtered = applyFilter(this.data.allMembers, this.data.activeFilter, keyword);
    this.setData({ searchKeyword: keyword, filteredMembers: filtered });
  },

  onSearchClear() {
    const filtered = applyFilter(this.data.allMembers, this.data.activeFilter, "");
    this.setData({ searchKeyword: "", filteredMembers: filtered });
  },

  setFilter(event: { currentTarget: { dataset: { key?: string } } }) {
    const key = String(event.currentTarget.dataset.key || "all") as FilterKey;
    if (key === this.data.activeFilter) return;
    const filtered = applyFilter(this.data.allMembers, key, this.data.searchKeyword);
    this.setData({ activeFilter: key, filteredMembers: filtered });
  },

  viewAllRanking() {
    const key: FilterKey = "weekly";
    const filtered = applyFilter(this.data.allMembers, key, this.data.searchKeyword);
    this.setData({ activeFilter: key, filteredMembers: filtered });
  },

  goMemberDetail(event: { currentTarget: { dataset: { id?: string } } }) {
    const memberId = String(event.currentTarget.dataset.id || "");
    const member = this.data.rawMembers.find((item) => item.id === memberId);
    if (!member || !this.data.team) return;
    const firstNonSelf = this.data.rawMembers.find((item) => !item.isSelf);
    const firstNonSelfId = firstNonSelf ? firstNonSelf.id : null;
    const detail = buildMemberDetail(member, this.data.team.createdAt, firstNonSelfId);
    this.setData({ selectedDetail: detail, detailVisible: true });
  },

  closeDetail() {
    this.setData({ detailVisible: false, selectedDetail: null });
  },

  noop() {},

  sendEncouragementFromDetail() {
    const detail = this.data.selectedDetail;
    if (!detail || !detail.canEncourage) return;
    wx.showActionSheet({
      itemList: ENCOURAGEMENT_OPTIONS.map((item) => item.label),
      success: ({ tapIndex }) => {
        const option = ENCOURAGEMENT_OPTIONS[tapIndex];
        if (option) this.submitEncouragement(detail.id, option.type);
      },
    });
  },

  submitEncouragement(memberId: string, type: EncouragementType) {
    try {
      sendEncouragement({ memberId, type });
      this.loadMembers();
      wx.showToast({ title: "已送出鼓励", icon: "none" });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "鼓励失败", icon: "none" });
    }
  },

  viewAllRecords() {
    wx.showToast({ title: "完整记录开发中", icon: "none" });
  },
}));
