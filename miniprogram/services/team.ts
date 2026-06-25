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
  TeamDailyStats,
  TeamDisplayMode,
  TeamMember,
  TeamMemberActionDetail,
  TeamPageData,
  UpdateSelfActivityInput,
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
  return {
    version: 1,
    currentTeam: value.currentTeam || null,
    teamMembers: rawMembers.map((member) => ({
      ...member,
      todayActionDetails: Array.isArray(member.todayActionDetails) ? member.todayActionDetails : [],
      taskDetailVisible: typeof member.taskDetailVisible === "boolean"
        ? member.taskDetailVisible
        : member.displayMode === "public",
    })),
    teamDailyStats: value.teamDailyStats || null,
    teamRoomCode: value.teamRoomCode || value.currentTeam?.roomCode || "",
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
  return { id, title, status, estimatedMinutes, growthMinutes };
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

function createTeamWithRoomCode(roomCode: string, input: CreateTeamInput): TeamPageData {
  const now = new Date();
  const teamId = createLocalId("team");
  const phaseStartDate = getTodayBusinessDate(now);
  const phaseEndDate = formatDate(addDays(now, 7));
  const team: Team = {
    id: teamId,
    name: `自律同行 ${roomCode.slice(-4)} 队`,
    roomCode,
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
  return createTeamWithRoomCode(generateRoomCode(), input);
}

export function joinRoom(input: JoinRoomInput): TeamPageData {
  const roomCode = validateRoomCode(input.roomCode);
  const existing = getMyTeam();
  if (existing.team) return existing;
  return createTeamWithRoomCode(roomCode, input);
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
