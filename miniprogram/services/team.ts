import { addDays, formatDate, getTodayBusinessDate } from "../utils/date";
import { getLocalUserProfile } from "./profile";
import {
  CreateTeamInput,
  EncouragementType,
  JoinRoomInput,
  LocalTeamStore,
  MemberTodayStatus,
  SendEncouragementInput,
  SendEncouragementResult,
  Team,
  TeamActionDetailVisibility,
  TeamActivity,
  TeamActivityFeedResult,
  TeamActivityType,
  TeamDailyStats,
  TeamDisplayMode,
  TeamMember,
  TeamMemberActionDetail,
  TeamPageData,
  TeamVisibility,
  UpdateSelfActivityInput,
  UpdateTeamSettingsInput,
} from "../types/team";

const STORAGE_KEY = "JINBUJU_LOCAL_TEAM_V1";
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_MEMBERS = 50;
const SELF_USER_ID = "local_user";

export interface TeamServiceError extends Error {
  code?: string;
}

function createError(code: string, message: string): TeamServiceError {
  const error = new Error(message) as TeamServiceError;
  error.code = code;
  return error;
}

function emptyStore(): LocalTeamStore {
  return {
    version: 1,
    currentTeam: null,
    teamMembers: [],
    teamDailyStats: null,
    teamRoomCode: "",
  };
}

function readStore(): LocalTeamStore {
  const value = wx.getStorageSync(STORAGE_KEY) as Partial<LocalTeamStore> | undefined;
  if (!value || value.version !== 1) return emptyStore();
  const rawMembers = Array.isArray(value.teamMembers) ? value.teamMembers as TeamMember[] : [];
  const rawTeam = value.currentTeam as Partial<Team> | null | undefined;
  const currentTeam = rawTeam ? {
    ...rawTeam,
    avatar: rawTeam.avatar || "",
    ownerId: rawTeam.ownerId || SELF_USER_ID,
    visibility: rawTeam.visibility === "private" ? "private" : "public" as TeamVisibility,
    allowAnonymous: typeof rawTeam.allowAnonymous === "boolean" ? rawTeam.allowAnonymous : true,
    actionDetailVisibility: (["all_members", "admins_only", "hidden"] as TeamActionDetailVisibility[])
      .includes(rawTeam.actionDetailVisibility as TeamActionDetailVisibility)
      ? rawTeam.actionDetailVisibility as TeamActionDetailVisibility
      : "all_members",
  } as Team : null;
  return {
    version: 1,
    currentTeam,
    teamMembers: rawMembers.map((member) => ({
      ...member,
      todayActionDetails: Array.isArray(member.todayActionDetails) ? member.todayActionDetails : [],
      taskDetailVisible: typeof member.taskDetailVisible === "boolean"
        ? member.taskDetailVisible
        : member.displayMode === "public",
    })),
    teamDailyStats: value.teamDailyStats || null,
    teamRoomCode: value.teamRoomCode || currentTeam?.roomCode || "",
  };
}

function writeStore(store: LocalTeamStore): void {
  wx.setStorageSync(STORAGE_KEY, store);
}

function createLocalId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function generateRoomCode(): string {
  let value = "";
  for (let index = 0; index < 6; index += 1) {
    value += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return value;
}

function normalizeRoomCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function validateRoomCode(value: string): string {
  const roomCode = normalizeRoomCode(value);
  if (!/^[A-Z0-9]{6}$/.test(roomCode)) {
    throw createError("INVALID_ROOM_CODE", "请输入 6 位大写字母或数字房间号");
  }
  return roomCode;
}

function statusRank(status: MemberTodayStatus): number {
  const ranks: Record<MemberTodayStatus, number> = {
    completed: 1,
    partial: 2,
    not_started: 3,
    missed: 4,
  };
  return ranks[status];
}

function createSelfMember(teamId: string, input: CreateTeamInput): TeamMember {
  const now = new Date().toISOString();
  const profile = getLocalUserProfile();
  const useProfile = Boolean(profile && profile.useProfileInTeam);
  return {
    id: "member_self",
    userId: SELF_USER_ID,
    teamId,
    displayMode: "nicknameOnly",
    nickname: useProfile ? profile!.nickname : "我",
    anonymousName: "行动伙伴 01",
    avatar: useProfile ? profile!.avatarUrl : "",
    goalTitle: input.goalTitle || "正在建立目标",
    todayActionTitle: input.todayActionTitle || "",
    todayActionDetails: input.todayActionDetails || [],
    taskDetailVisible: false,
    todayStatus: input.todayStatus || "not_started",
    estimatedMinutes: input.estimatedMinutes || 0,
    growthMinutes: input.growthMinutes || 0,
    encouragementCount: 0,
    encouragedByMeToday: false,
    isSelf: true,
    updatedAt: now,
  };
}

function detail(id: string, title: string, status: MemberTodayStatus, estimatedMinutes: number, growthMinutes: number): TeamMemberActionDetail {
  return { id, title, status, estimatedMinutes, growthMinutes, actualMinutes: growthMinutes };
}

function createDemoMembers(teamId: string): TeamMember[] {
  const now = new Date().toISOString();
  const samples: Array<Omit<TeamMember, "id" | "teamId" | "updatedAt">> = [
    {
      userId: "demo_amy",
      displayMode: "nicknameOnly",
      nickname: "阿岚",
      anonymousName: "行动伙伴 02",
      goalTitle: "准备作品集",
      todayActionTitle: "",
      todayActionDetails: [
        detail("demo_amy_1", "整理作品集首页结构", "completed", 20, 20),
        detail("demo_amy_2", "补充项目说明文案", "completed", 25, 25),
      ],
      taskDetailVisible: true,
      todayStatus: "completed",
      estimatedMinutes: 45,
      growthMinutes: 45,
      encouragementCount: 2,
      encouragedByMeToday: false,
      isSelf: false,
    },
    {
      userId: "demo_bo",
      displayMode: "public",
      nickname: "小柏",
      anonymousName: "行动伙伴 03",
      goalTitle: "提升英语表达",
      todayActionTitle: "完成 25 分钟听力精听",
      todayActionDetails: [
        detail("demo_bo_1", "完成 25 分钟听力精听", "completed", 25, 25),
        detail("demo_bo_2", "复述 5 句重点表达", "partial", 35, 5),
      ],
      taskDetailVisible: true,
      todayStatus: "partial",
      estimatedMinutes: 60,
      growthMinutes: 30,
      encouragementCount: 1,
      encouragedByMeToday: false,
      isSelf: false,
    },
    {
      userId: "demo_cyan",
      displayMode: "anonymous",
      nickname: "清予",
      anonymousName: "行动伙伴 04",
      goalTitle: "阅读写作计划",
      todayActionTitle: "整理章节笔记",
      todayActionDetails: [],
      taskDetailVisible: false,
      todayStatus: "not_started",
      estimatedMinutes: 30,
      growthMinutes: 0,
      encouragementCount: 0,
      encouragedByMeToday: false,
      isSelf: false,
    },
    {
      userId: "demo_deer",
      displayMode: "nicknameOnly",
      nickname: "南星",
      anonymousName: "行动伙伴 05",
      goalTitle: "恢复运动习惯",
      todayActionTitle: "",
      todayActionDetails: [],
      taskDetailVisible: false,
      todayStatus: "not_started",
      estimatedMinutes: 40,
      growthMinutes: 0,
      encouragementCount: 3,
      encouragedByMeToday: false,
      isSelf: false,
    },
  ];

  return samples.map((item, index) => ({
    ...item,
    id: `member_demo_${index + 1}`,
    teamId,
    updatedAt: now,
  }));
}

function calculateDailyStats(teamId: string, members: TeamMember[]): TeamDailyStats {
  const totalMembers = members.length;
  const completedMembers = members.filter((member) => member.todayStatus === "completed").length;
  const partialMembers = members.filter((member) => member.todayStatus === "partial").length;
  const missedMembers = members.filter((member) => member.todayStatus === "missed").length;
  const notStartedMembers = members.filter((member) => member.todayStatus === "not_started").length;
  const totalGrowthMinutes = members.reduce((sum, member) => sum + member.growthMinutes, 0);
  const encouragementCount = members.reduce((sum, member) => sum + member.encouragementCount, 0);
  return {
    teamId,
    date: getTodayBusinessDate(),
    totalMembers,
    completedMembers,
    partialMembers,
    notStartedMembers,
    missedMembers,
    totalGrowthMinutes,
    encouragementCount,
    completionRate: totalMembers ? Math.round((completedMembers / totalMembers) * 100) : 0,
  };
}

export function persistTeam(team: Team, members: TeamMember[]): TeamPageData {
  const sortedMembers = members.slice().sort((a, b) => {
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
    return statusRank(a.todayStatus) - statusRank(b.todayStatus);
  });
  const dailyStats = calculateDailyStats(team.id, sortedMembers);
  const nextTeam = {
    ...team,
    memberCount: sortedMembers.length,
  };
  writeStore({
    version: 1,
    currentTeam: nextTeam,
    teamMembers: sortedMembers,
    teamDailyStats: dailyStats,
    teamRoomCode: nextTeam.roomCode,
  });
  return { team: nextTeam, members: sortedMembers, dailyStats };
}

function createTeamWithRoomCode(roomCode: string, input: CreateTeamInput, ownerId: string): TeamPageData {
  const now = new Date();
  const teamId = createLocalId("team");
  const phaseStartDate = getTodayBusinessDate(now);
  const phaseEndDate = formatDate(addDays(now, 7));
  const team: Team = {
    id: teamId,
    name: `自律同行 ${roomCode.slice(-4)} 队`,
    avatar: "",
    roomCode,
    ownerId,
    visibility: "private",
    allowAnonymous: true,
    actionDetailVisibility: "all_members",
    maxMembers: MAX_MEMBERS,
    memberCount: 0,
    createdAt: now.toISOString(),
    phaseStartDate,
    phaseEndDate,
    description: "跨目标自律同行",
    status: "active",
  };
  return persistTeam(team, [createSelfMember(teamId, input), ...createDemoMembers(teamId)]);
}

export function getMyTeam(): TeamPageData {
  const store = readStore();
  if (!store.currentTeam) return { team: null, members: [], dailyStats: null };
  const members = store.teamMembers.filter((member) => member.teamId === store.currentTeam?.id);
  const data = persistTeam(store.currentTeam, members);
  return data;
}

export function createTeam(input: CreateTeamInput = {}): TeamPageData {
  const existing = getMyTeam();
  if (existing.team) return existing;
  return createTeamWithRoomCode(generateRoomCode(), input, SELF_USER_ID);
}

export function joinRoom(input: JoinRoomInput): TeamPageData {
  const roomCode = validateRoomCode(input.roomCode);
  const existing = getMyTeam();
  if (existing.team) return existing;
  return createTeamWithRoomCode(roomCode, input, "room_owner");
}

export function updateSelfActivity(input: UpdateSelfActivityInput): TeamPageData {
  const store = readStore();
  if (!store.currentTeam) return { team: null, members: [], dailyStats: null };
  const profile = getLocalUserProfile();
  const useProfile = Boolean(profile && profile.useProfileInTeam);
  const members = store.teamMembers.map((member) => {
    if (!member.isSelf) return member;
    return {
      ...member,
      nickname: useProfile ? profile!.nickname : "我",
      avatar: useProfile ? profile!.avatarUrl : "",
      goalTitle: input.goalTitle || member.goalTitle,
      todayActionTitle: input.todayActionTitle || "",
      todayActionDetails: input.todayActionDetails || [],
      estimatedMinutes: input.estimatedMinutes,
      growthMinutes: input.growthMinutes,
      todayStatus: input.todayStatus,
      updatedAt: new Date().toISOString(),
    };
  });
  return persistTeam(store.currentTeam, members);
}

export function updateSelfDisplayMode(displayMode: TeamDisplayMode): TeamPageData {
  const store = readStore();
  if (!store.currentTeam) throw createError("TEAM_NOT_FOUND", "请先创建或加入小队");
  if (displayMode === "anonymous" && !store.currentTeam.allowAnonymous) {
    throw createError("ANONYMOUS_NOT_ALLOWED", "当前小队未开放匿名参与");
  }
  const members = store.teamMembers.map((member) => member.isSelf ? {
    ...member,
    displayMode,
    taskDetailVisible: displayMode === "public"
      ? true
      : displayMode === "anonymous"
        ? false
        : member.taskDetailVisible,
    updatedAt: new Date().toISOString(),
  } : member);
  return persistTeam(store.currentTeam, members);
}

export function updateSelfTaskDetailVisible(taskDetailVisible: boolean): TeamPageData {
  const store = readStore();
  if (!store.currentTeam) throw createError("TEAM_NOT_FOUND", "请先创建或加入小队");
  const members = store.teamMembers.map((member) => member.isSelf ? {
    ...member,
    taskDetailVisible,
    updatedAt: new Date().toISOString(),
  } : member);
  return persistTeam(store.currentTeam, members);
}

export function canManageTeam(team: Team | null): boolean {
  return Boolean(team && team.ownerId === SELF_USER_ID);
}

export function updateTeamSettings(input: UpdateTeamSettingsInput): TeamPageData {
  const store = readStore();
  if (!store.currentTeam) throw createError("TEAM_NOT_FOUND", "请先创建或加入小队");
  if (!canManageTeam(store.currentTeam)) {
    throw createError("TEAM_PERMISSION_DENIED", "只有小队创建者可以修改这些设置");
  }

  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 20) {
    throw createError("INVALID_TEAM_NAME", "小队名称需为 2 至 20 个字符");
  }
  if (input.visibility !== "public" && input.visibility !== "private") {
    throw createError("INVALID_TEAM_VISIBILITY", "请选择有效的房间状态");
  }
  if (!["all_members", "admins_only", "hidden"].includes(input.actionDetailVisibility)) {
    throw createError("INVALID_DETAIL_VISIBILITY", "请选择有效的详情可见范围");
  }

  const nextTeam: Team = {
    ...store.currentTeam,
    name,
    avatar: input.avatar || "",
    visibility: input.visibility,
    allowAnonymous: Boolean(input.allowAnonymous),
    actionDetailVisibility: input.actionDetailVisibility,
  };
  return persistTeam(nextTeam, store.teamMembers);
}

export function sendEncouragement(input: SendEncouragementInput): SendEncouragementResult {
  const store = readStore();
  if (!store.currentTeam) throw createError("TEAM_NOT_FOUND", "请先创建或加入小队");
  const members = store.teamMembers.map((member) => {
    if (member.id !== input.memberId) return member;
    if (member.isSelf) throw createError("INVALID_TARGET", "不能给自己发送鼓励");
    if (member.encouragedByMeToday) throw createError("ENCOURAGEMENT_ALREADY_SENT", "今天已经鼓励过这位伙伴");
    return {
      ...member,
      encouragementCount: member.encouragementCount + 1,
      encouragedByMeToday: true,
      updatedAt: new Date().toISOString(),
    };
  });
  if (!members.some((member) => member.id === input.memberId)) {
    throw createError("MEMBER_NOT_FOUND", "没有找到这位小队成员");
  }
  persistTeam(store.currentTeam, members);
  return { memberId: input.memberId, sent: true };
}

export function resetLocalTeam(): void {
  wx.removeStorageSync(STORAGE_KEY);
}

export function encouragementLabel(type: EncouragementType): string {
  const labels: Record<EncouragementType, string> = {
    keep_going: "今天也要加油",
    very_stable: "你太稳了",
    continue_tomorrow: "明天继续",
    stay_together: "一起坚持",
  };
  return labels[type];
}

/* =========================================================
 * 小队行动动态
 * ------------------------------------------------
 * 当前为本地演示版本：基于当前小队成员合成最近 14 天的动态流，
 * 用于「全部动态」页的无限滚动展示。合成结果对同一小队稳定
 * （以 memberId + 日期为种子），便于分页与详情回看。
 * 后续接入云端后，可替换为真实动态事件流水。
 * ========================================================= */

const ACTIVITY_HISTORY_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

function activityHashSeed(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** 根据时间戳生成展示文案：今天 14:30 / 昨天 / 前天 / 6/26 */
function formatActivityTime(date: Date): { dateLabel: string; timeText: string } {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const targetStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((todayStart - targetStart) / DAY_MS);
  const hh = pad2(date.getHours());
  const mm = pad2(date.getMinutes());
  if (diffDays === 0) return { dateLabel: "今天", timeText: `今天 ${hh}:${mm}` };
  if (diffDays === 1) return { dateLabel: "昨天", timeText: "昨天" };
  if (diffDays === 2) return { dateLabel: "前天", timeText: "前天" };
  return { dateLabel: `${date.getMonth() + 1}/${date.getDate()}`, timeText: `${date.getMonth() + 1}/${date.getDate()}` };
}

function resolveDisplayName(member: TeamMember): string {
  return member.displayMode === "anonymous"
    ? (member.anonymousName || "行动伙伴")
    : member.nickname;
}

function buildActivityBase(member: TeamMember, type: TeamActivityType, when: Date, suffix: string): TeamActivity {
  const name = resolveDisplayName(member);
  const { dateLabel, timeText } = formatActivityTime(when);
  return {
    id: `act_${member.userId}_${type}_${suffix}`,
    memberId: member.id,
    name,
    avatar: member.avatar || "",
    avatarText: name.slice(0, 1),
    type,
    actionText: "",
    detail: "",
    goalTitle: member.goalTitle || "正在建立目标",
    growthMinutes: 0,
    actionCount: 0,
    timestamp: when.getTime(),
    dateLabel,
    timeText,
  };
}

function fillActivityContent(activity: TeamActivity, member: TeamMember, type: TeamActivityType, dayOffset: number): TeamActivity {
  const seed = activityHashSeed(member.userId + type + dayOffset);
  const goalTitle = activity.goalTitle;
  switch (type) {
    case "completed": {
      const actionCount = 2 + (seed % 3);
      const minutes = 25 + (seed % 45);
      activity.actionText = "完成了今日目标";
      activity.detail = `完成了今日全部 ${actionCount} 项行动，累计投入 ${minutes} 分钟。`;
      activity.growthMinutes = minutes;
      activity.actionCount = actionCount;
      break;
    }
    case "partial": {
      const done = 1 + (seed % 2);
      const target = done + 1 + (seed % 2);
      const minutes = 15 + (seed % 30);
      activity.actionText = "完成了部分行动";
      activity.detail = `今日完成 ${done}/${target} 项行动，已投入 ${minutes} 分钟，剩下的可以明天继续。`;
      activity.growthMinutes = minutes;
      activity.actionCount = done;
      break;
    }
    case "not_started": {
      activity.actionText = "开始了今日行动";
      activity.detail = `迈出了今天的第一步，目标：${goalTitle}。先从最简单的一小步开始吧。`;
      activity.growthMinutes = 5 + (seed % 10);
      activity.actionCount = 0;
      break;
    }
    case "streak": {
      const days = 3 + (seed % 12);
      activity.actionText = `连续打卡 ${days} 天`;
      activity.detail = `已经连续坚持 ${days} 天，继续保持这股稳定的节奏。`;
      activity.growthMinutes = 0;
      activity.actionCount = days;
      break;
    }
    case "encouraged": {
      activity.actionText = "收到了队友鼓励";
      activity.detail = "收到了队友送来的鼓励，一起自律，各自成长。";
      activity.growthMinutes = 0;
      activity.actionCount = 1;
      break;
    }
    case "joined": {
      activity.actionText = "加入了小队";
      activity.detail = `加入了小队，开始推进：${goalTitle}。`;
      activity.growthMinutes = 0;
      activity.actionCount = 0;
      break;
    }
    default:
      break;
  }
  return activity;
}

/** 为单个成员合成最近 N 天的动态（不含 joined 事件，joined 由调用方按入队时间补充） */
function buildMemberHistory(member: TeamMember): TeamActivity[] {
  const activities: TeamActivity[] = [];
  const now = new Date();
  for (let dayOffset = 0; dayOffset < ACTIVITY_HISTORY_DAYS; dayOffset += 1) {
    const seed = activityHashSeed(member.userId + "_day_" + dayOffset);
    // 当天动态由真实 todayStatus 决定；历史日期用种子稳定合成
    const isToday = dayOffset === 0;
    const todayType: TeamActivityType | null = isToday
      ? (member.todayStatus === "completed"
          ? "completed"
          : member.todayStatus === "partial"
            ? "partial"
            : member.todayStatus === "not_started"
              ? "not_started"
              : null)
      : null;
    if (todayType) {
      const when = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9 + (seed % 9), (seed * 7) % 60);
      activities.push(fillActivityContent(buildActivityBase(member, todayType, when, `d${dayOffset}`), member, todayType, dayOffset));
    }
    // 历史日期：约 60% 概率有完成/部分动态
    if (!isToday) {
      const roll = seed % 10;
      if (roll < 5) {
        const type: TeamActivityType = roll < 3 ? "completed" : "partial";
        const when = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOffset, 9 + (seed % 9), (seed * 13) % 60);
        activities.push(fillActivityContent(buildActivityBase(member, type, when, `d${dayOffset}`), member, type, dayOffset));
      } else if (roll === 7) {
        // 偶发连续打卡里程碑
        const when = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOffset, 20, (seed * 5) % 60);
        activities.push(fillActivityContent(buildActivityBase(member, "streak", when, `d${dayOffset}`), member, "streak", dayOffset));
      }
    }
  }
  return activities;
}

/**
 * 获取小队行动动态流（按时间倒序，支持分页）。
 * 当未创建/加入小队时返回空流。
 */
export function getTeamActivityFeed(options?: { page?: number; pageSize?: number }): TeamActivityFeedResult {
  const page = Math.max(1, Math.floor(options?.page || 1));
  const pageSize = Math.max(1, Math.floor(options?.pageSize || 10));
  const store = readStore();
  if (!store.currentTeam) {
    // pageSize: 0 作为「未加入小队」的哨兵，便于页面区分空动态与无小队
    return { list: [], hasMore: false, total: 0, page, pageSize: 0 };
  }
  const team = store.currentTeam;
  const members = store.teamMembers.filter((member) => member.teamId === team.id);

  const all: TeamActivity[] = [];
  members.forEach((member) => {
    all.push(...buildMemberHistory(member));
    // 入队动态：基于小队创建日 + 成员种子错开时间
    const joinSeed = activityHashSeed(member.userId + "_join");
    const teamCreated = new Date(team.createdAt).getTime();
    const joinOffset = joinSeed % Math.min(ACTIVITY_HISTORY_DAYS, 14);
    const joinDate = new Date(teamCreated + joinOffset * DAY_MS + (8 + (joinSeed % 10)) * 60 * 60 * 1000);
    if (joinDate.getTime() <= Date.now()) {
      all.push(fillActivityContent(buildActivityBase(member, "joined", joinDate, "join"), member, "joined", joinOffset));
    }
    // 鼓励动态：有鼓励记录的成员补充一条
    if (member.encouragementCount > 0) {
      const encSeed = activityHashSeed(member.userId + "_enc");
      const encDate = new Date(Date.now() - (encSeed % 5) * 60 * 60 * 1000 - 60 * 60 * 1000);
      all.push(fillActivityContent(buildActivityBase(member, "encouraged", encDate, "enc"), member, "encouraged", 0));
    }
  });

  all.sort((a, b) => b.timestamp - a.timestamp);

  const total = all.length;
  const start = (page - 1) * pageSize;
  const list = all.slice(start, start + pageSize);
  return { list, hasMore: start + pageSize < total, total, page, pageSize };
}
