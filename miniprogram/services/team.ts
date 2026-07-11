import { getAccountRuntime } from "./account";
import { syncManualData } from "./manualSync";
import { on } from "../utils/eventBus";
import {
  CreateTeamInput,
  EncouragementType,
  JoinRoomInput,
  SendEncouragementInput,
  SendEncouragementResult,
  Team,
  TeamActivityFeedResult,
  TeamCacheEnvelope,
  TeamDisplayMode,
  TeamInviteInfo,
  TeamMember,
  TeamMemberPageResult,
  TeamMutationResult,
  TeamPageData,
  TeamPageOptions,
  TeamPageRuntime,
  TeamRuntimeInfo,
  UpdateSelfActivityInput,
  UpdateTeamSettingsInput,
} from "../types/team";

const LEGACY_CACHE_KEY = "JINBUJU_TEAM_CACHE_V2";
const CACHE_KEY_PREFIX = "JINBUJU_TEAM_CACHE_V3_";
const CACHE_REGISTRY_KEY = "JINBUJU_TEAM_CACHE_KEYS_V3";
const DEV_MOCK_KEY = "JINBUJU_TEAM_DEV_MOCK_V1";
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const REQUEST_TIMEOUT = 15000;
export const MAX_TEAM_MEMBERS = 20;

interface CloudEnvelope<T> { success: boolean; data?: T; error?: { code?: string; message?: string } }
interface LegacyTeamPage {
  team?: Record<string, unknown> | null;
  members?: Array<Record<string, unknown>>;
}

export interface TeamServiceError extends Error { code?: string }

function createError(code: string, message: string): TeamServiceError {
  return Object.assign(new Error(message), { code });
}

function friendlyMessage(code: string, message: string): string {
  if (code === "TEAM_UPGRADE_REQUIRED" || /不支持的操作/.test(message)) return "小队服务正在升级，已切换到兼容模式。";
  if (code === "REQUEST_TIMEOUT") return "小队服务响应较慢，请稍后重试。";
  if (code === "ROOM_NOT_FOUND") return "没有找到这个房间，请检查房间号。";
  if (code === "TEAM_FULL") return "小队已满 20 人。";
  if (code === "TEAM_PERMISSION_DENIED") return "当前操作仅限小队队长。";
  if (code === "NETWORK_ERROR" || code === "TEAM_NETWORK_ERROR") return "网络连接失败，请检查网络后重试。";
  return message || "小队数据暂时无法连接，请稍后重试。";
}

function call<T>(action: string, data: Record<string, unknown> = {}, timeout = REQUEST_TIMEOUT): Promise<T> {
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(createError("REQUEST_TIMEOUT", "小队服务请求超时。")), timeout);
    wx.cloud.callFunction({ name: "generatePlan", data: { action, ...data } }).then(
      (response: any) => { clearTimeout(timer); resolve(response); },
      () => { clearTimeout(timer); reject(createError("TEAM_NETWORK_ERROR", "网络连接失败。")); },
    );
  }).then((response) => {
    const result = response && response.result as CloudEnvelope<T> | undefined;
    if (!result?.success || result.data === undefined) {
      const code = result?.error?.code || "TEAM_NETWORK_ERROR";
      const raw = result?.error?.message || "小队数据暂时无法连接。";
      throw createError(code, friendlyMessage(code, raw));
    }
    return result.data;
  }, (error: TeamServiceError) => {
    throw createError(error.code || "TEAM_NETWORK_ERROR", friendlyMessage(error.code || "TEAM_NETWORK_ERROR", error.message));
  });
}

function accountUserId(): string { return getAccountRuntime()?.account.userId || ""; }
function cacheKey(userId: string): string { return `${CACHE_KEY_PREFIX}${userId}`; }

function rememberCacheKey(key: string): void {
  const keys = (wx.getStorageSync(CACHE_REGISTRY_KEY) as string[] | undefined) || [];
  if (!keys.includes(key)) wx.setStorageSync(CACHE_REGISTRY_KEY, keys.concat(key));
}

export function clearTeamCaches(): void {
  const keys = (wx.getStorageSync(CACHE_REGISTRY_KEY) as string[] | undefined) || [];
  keys.forEach((key) => wx.removeStorageSync(key));
  wx.removeStorageSync(CACHE_REGISTRY_KEY);
  wx.removeStorageSync(LEGACY_CACHE_KEY);
}

on("account:update", (state: unknown) => { if (!state) clearTeamCaches(); });

function runtime(mode: TeamPageRuntime["mode"], stale: boolean, message = "", info?: TeamRuntimeInfo): TeamPageRuntime {
  return {
    mode,
    stale,
    message,
    info,
    capabilities: {
      canMutate: mode === "live",
      canInvite: mode === "live",
      canManage: mode === "live",
      canReadActivity: mode === "live",
    },
  };
}

function readCache(userId = accountUserId()): TeamPageData | null {
  if (!userId) return null;
  const value = wx.getStorageSync(cacheKey(userId)) as TeamCacheEnvelope | undefined;
  if (!value || value.schemaVersion !== 3 || value.accountUserId !== userId || !value.data) return null;
  return {
    ...value.data,
    runtime: { ...runtime("cache", true, "当前展示的是本机缓存，联网后会自动更新。"), cachedAt: value.cachedAt },
  };
}

function writeCache(value: TeamPageData, userId = accountUserId()): TeamPageData {
  if (!userId) return value;
  const key = cacheKey(userId);
  const envelope: TeamCacheEnvelope = {
    schemaVersion: 3,
    accountUserId: userId,
    cachedAt: new Date().toISOString(),
    teamVersion: Number(value.team?.version || 0),
    data: value,
  };
  wx.setStorageSync(key, envelope);
  rememberCacheKey(key);
  return value;
}

function normalizePage(data: TeamPageData): TeamPageData {
  const members = (data.members || []).slice().sort(compareTeamMembers);
  const team = data.team || null;
  const self = members.find((member) => member.isSelf);
  const pageRuntime = data.runtime ? {
    ...data.runtime,
    capabilities: {
      ...data.runtime.capabilities,
      canManage: data.runtime.mode === "live" && self?.role === "owner",
      canInvite: data.runtime.mode === "live" && (self?.role === "owner" || team?.allowMemberInvite !== false),
    },
  } : undefined;
  return { ...data, team, members, dailyStats: data.dailyStats || null, runtime: pageRuntime };
}

function legacyMember(raw: Record<string, unknown>, teamId: string): TeamMember {
  const id = String(raw.id || raw.userId || "legacy_member");
  const completed = raw.todayCompleted === true;
  const todayRest = raw.todayRest === true;
  return {
    id,
    userId: id,
    teamId,
    role: "member",
    displayMode: "nicknameOnly",
    nickname: String(raw.nickname || "行动伙伴"),
    anonymousName: "行动伙伴",
    avatar: "",
    goalTitle: "",
    todayActionTitle: "今日行动暂不公开",
    todayActionDetails: [],
    taskDetailVisible: false,
    todayStatus: completed ? "completed" : todayRest ? "missed" : "not_started",
    estimatedMinutes: 0,
    growthMinutes: Math.max(0, Number(raw.todayMinutes || 0)),
    completionRate: Math.max(0, Math.min(100, Number(raw.stageCompletionRate || (completed ? 100 : 0)))),
    encouragementCount: Math.max(0, Number(raw.encouragementCount || 0)),
    encouragedByMeToday: raw.encouragedByMeToday === true,
    isSelf: raw.isSelf === true,
    joinedAt: "",
    updatedAt: "",
  };
}

function adaptLegacy(data: LegacyTeamPage): TeamPageData {
  const rawTeam = data.team;
  if (!rawTeam) return { team: null, members: [], dailyStats: null, runtime: runtime("legacy", false, "小队服务待升级，创建与管理功能暂不可用。") };
  const id = String(rawTeam.id || "legacy_team");
  const members = (data.members || []).map((item) => legacyMember(item, id)).sort(compareTeamMembers);
  const team: Team = {
    id,
    name: String(rawTeam.name || "我的小队"),
    roomCode: "",
    ownerId: "",
    visibility: "private",
    allowAnonymous: true,
    actionDetailVisibility: "hidden",
    maxMembers: MAX_TEAM_MEMBERS,
    memberCount: members.length,
    createdAt: "",
    phaseStartDate: String(rawTeam.stageStartDate || ""),
    phaseEndDate: String(rawTeam.stageEndDate || ""),
    description: "旧版小队只读兼容",
    status: "active",
    schemaVersion: 1,
    anonymityMode: "anonymous",
    allowMemberInvite: false,
  };
  const totalGrowthMinutes = members.reduce((sum, member) => sum + member.growthMinutes, 0);
  return {
    team,
    members,
    dailyStats: {
      teamId: id,
      date: "",
      totalMembers: members.length,
      completedMembers: members.filter((item) => item.todayStatus === "completed").length,
      partialMembers: members.filter((item) => item.todayStatus === "partial").length,
      notStartedMembers: members.filter((item) => item.todayStatus === "not_started").length,
      missedMembers: members.filter((item) => item.todayStatus === "missed").length,
      totalGrowthMinutes,
      encouragementCount: members.reduce((sum, member) => sum + member.encouragementCount, 0),
      completionRate: 0,
    },
    runtime: runtime("legacy", false, "当前为旧版小队只读模式，云函数升级后可恢复邀请和管理。"),
  };
}

let runtimePromise: Promise<TeamRuntimeInfo | null> | null = null;
export function getTeamRuntimeInfo(force = false): Promise<TeamRuntimeInfo | null> {
  if (runtimePromise && !force) return runtimePromise;
  runtimePromise = call<TeamRuntimeInfo>("getTeamRuntimeInfo", {}, 8000).then(
    (info) => info,
    (error: TeamServiceError) => {
      if (error.code === "INVALID_ARGUMENT" || /升级|不支持/.test(error.message)) return null;
      throw error;
    },
  );
  return runtimePromise.then((value) => { runtimePromise = null; return value; }, (error) => { runtimePromise = null; throw error; });
}

export function validateRoomCode(value: string): string {
  const roomCode = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!ROOM_CODE_PATTERN.test(roomCode)) throw createError("INVALID_ROOM_CODE", "请输入 6 位房间号。" );
  return roomCode;
}

export function compareTeamMembers(left: TeamMember, right: TeamMember): number {
  const minutes = Number(right.growthMinutes || 0) - Number(left.growthMinutes || 0);
  if (minutes) return minutes;
  const leftReached = Date.parse(left.lastEffectiveActionAt || left.completedAt || "") || Number.MAX_SAFE_INTEGER;
  const rightReached = Date.parse(right.lastEffectiveActionAt || right.completedAt || "") || Number.MAX_SAFE_INTEGER;
  if (leftReached !== rightReached) return leftReached - rightReached;
  return String(left.id).localeCompare(String(right.id));
}

export function getCachedTeam(): TeamPageData { return readCache() || { team: null, members: [], dailyStats: null, runtime: runtime("cache", true) }; }

/** 仅供开发态 mock 预览；正式页面永远不会读取该 key。 */
export function persistTeam(team: Team, members: TeamMember[]): TeamPageData {
  const data = normalizePage({ team: { ...team, memberCount: members.length }, members, dailyStats: null, runtime: runtime("cache", true, "开发预览数据") });
  wx.setStorageSync(DEV_MOCK_KEY, data);
  return data;
}

export async function getMyTeam(options: TeamPageOptions = {}): Promise<TeamPageData> {
  const userId = accountUserId();
  try {
    const info = await getTeamRuntimeInfo();
    if (!info || !info.supportedActions.includes("getTeamPage")) {
      const legacy = adaptLegacy(await call<LegacyTeamPage>("getMyTeam"));
      return writeCache(normalizePage(legacy), userId);
    }
    await syncManualData().catch(() => undefined);
    const data = await call<TeamMemberPageResult>("getTeamPage", {
      page: Math.max(1, Math.floor(options.page || 1)),
      pageSize: Math.min(MAX_TEAM_MEMBERS, Math.max(1, Math.floor(options.pageSize || MAX_TEAM_MEMBERS))),
    });
    const normalized = normalizePage({ ...data, runtime: runtime("live", false, "", info) });
    return writeCache(normalized, userId);
  } catch (error) {
    const cached = readCache(userId);
    if (cached) return cached;
    throw error;
  }
}

async function requireAction(action: string): Promise<void> {
  const info = await getTeamRuntimeInfo(true);
  if (!info || !info.supportedActions.includes(action)) throw createError("TEAM_UPGRADE_REQUIRED", "小队服务待升级，当前操作暂不可用。" );
}

export async function createTeam(input: CreateTeamInput = {}): Promise<TeamPageData> { await requireAction("createTeam"); await call<TeamMutationResult>("createTeam", { input }); return getMyTeam(); }
export async function getTeamInviteInfo(): Promise<TeamInviteInfo> { await requireAction("getTeamInviteInfo"); return call<TeamInviteInfo>("getTeamInviteInfo"); }
export async function joinRoom(input: JoinRoomInput): Promise<TeamPageData> { const roomCode = validateRoomCode(input.roomCode); await requireAction("joinTeamByRoomCode"); const result = await call<TeamMutationResult>("joinTeamByRoomCode", { roomCode, inviterMemberId: input.inviterMemberId }); if (result.pending) throw createError("JOIN_PENDING", "加入申请已提交，等待队长确认。" ); return getMyTeam(); }
export async function updateSelfActivity(input: UpdateSelfActivityInput): Promise<TeamPageData> { await requireAction("syncTeamActivity"); await syncManualData(); await call<{ updated: boolean }>("syncTeamActivity", { ...input }); return getMyTeam(); }
export async function updateSelfDisplayMode(displayMode: TeamDisplayMode): Promise<TeamPageData> { await requireAction("updateTeamMemberPrivacy"); await call<{ updated: boolean }>("updateTeamMemberPrivacy", { displayMode, taskDetailVisible: displayMode === "public" }); return getMyTeam(); }
export async function updateSelfTaskDetailVisible(taskDetailVisible: boolean): Promise<TeamPageData> { await requireAction("updateTeamMemberPrivacy"); await call<{ updated: boolean }>("updateTeamMemberPrivacy", { taskDetailVisible }); return getMyTeam(); }
export function canManageTeam(team: Team | null): boolean { if (!team) return false; return Boolean(readCache()?.members.find((member) => member.isSelf && member.role === "owner")); }
export async function updateTeamSettings(input: UpdateTeamSettingsInput): Promise<TeamPageData> { const name = input.name.trim().replace(/\s+/g, " "); if (name.length < 2 || name.length > 20) throw createError("INVALID_TEAM_NAME", "小队名称需为 2 至 20 个字符。" ); const slogan = (input.slogan || "").trim().replace(/\s+/g, " ").slice(0, 30); await requireAction("updateTeamSettings"); await call<{ updated: boolean }>("updateTeamSettings", { input: { name, anonymityMode: input.anonymityMode, allowMemberInvite: input.allowMemberInvite, slogan } }); return getMyTeam(); }
export async function sendEncouragement(input: SendEncouragementInput): Promise<SendEncouragementResult> { await requireAction("sendEncouragement"); return call<SendEncouragementResult>("sendEncouragement", input as unknown as Record<string, unknown>); }
export async function getTeamActivityFeed(options: TeamPageOptions = {}): Promise<TeamActivityFeedResult> { await requireAction("getTeamActivityFeed"); return call<TeamActivityFeedResult>("getTeamActivityFeed", { page: Math.max(1, Math.floor(options.page || 1)), pageSize: Math.min(20, Math.max(1, Math.floor(options.pageSize || 10))) }); }
export async function leaveTeam(): Promise<TeamMutationResult> { await requireAction("leaveTeam"); const result = await call<TeamMutationResult>("leaveTeam"); clearTeamCaches(); return result; }
export async function dissolveTeam(): Promise<TeamMutationResult> { await requireAction("dissolveTeam"); const result = await call<TeamMutationResult>("dissolveTeam"); clearTeamCaches(); return result; }
export async function removeTeamMember(memberId: string): Promise<TeamMutationResult> { await requireAction("removeTeamMember"); return call<TeamMutationResult>("removeTeamMember", { memberId }); }
export async function transferTeamOwner(memberId: string): Promise<TeamMutationResult> { await requireAction("transferTeamOwner"); return call<TeamMutationResult>("transferTeamOwner", { memberId }); }
export async function reviewJoinRequest(requestId: string, approved: boolean): Promise<TeamMutationResult> { await requireAction("reviewTeamJoinRequest"); return call<TeamMutationResult>("reviewTeamJoinRequest", { requestId, approved }); }
export function resetLocalTeam(): void { clearTeamCaches(); }
export function encouragementLabel(type: EncouragementType): string { return ({ keep_going: "今天也要加油", very_stable: "你太稳了", continue_tomorrow: "明天继续", stay_together: "一起坚持" } as Record<EncouragementType, string>)[type]; }
