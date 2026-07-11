import {
  CreateTeamInput,
  EncouragementType,
  JoinRoomInput,
  SendEncouragementInput,
  SendEncouragementResult,
  Team,
  TeamActivityFeedResult,
  TeamDisplayMode,
  TeamMember,
  TeamMemberPageResult,
  TeamMutationResult,
  TeamPageData,
  TeamPageOptions,
  UpdateSelfActivityInput,
  UpdateTeamSettingsInput,
} from "../types/team";

const STORAGE_KEY = "JINBUJU_TEAM_CACHE_V2";
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const PAGE_SIZE = 20;

interface CloudEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

export interface TeamServiceError extends Error { code?: string }

function createError(code: string, message: string): TeamServiceError {
  return Object.assign(new Error(message), { code });
}

function call<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  return wx.cloud.callFunction({ name: "generatePlan", data: { action, ...data } }).then((response: any) => {
    const result = response && response.result as CloudEnvelope<T> | undefined;
    if (!result?.success || result.data === undefined) {
      throw createError(result?.error?.code || "TEAM_NETWORK_ERROR", result?.error?.message || "小队数据暂时无法连接，请稍后重试");
    }
    return result.data;
  }, () => { throw createError("TEAM_NETWORK_ERROR", "网络连接失败，请检查网络后重试"); });
}

function readCache(): TeamPageData {
  const value = wx.getStorageSync(STORAGE_KEY) as TeamPageData | undefined;
  if (!value || !Array.isArray(value.members)) return { team: null, members: [], dailyStats: null };
  return value;
}

function writeCache(value: TeamPageData): TeamPageData {
  wx.setStorageSync(STORAGE_KEY, value);
  return value;
}

function normalizePage(data: TeamPageData): TeamPageData {
  const members = (data.members || []).slice().sort(compareTeamMembers);
  return { team: data.team || null, members, dailyStats: data.dailyStats || null };
}

export function validateRoomCode(value: string): string {
  const roomCode = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!ROOM_CODE_PATTERN.test(roomCode)) throw createError("INVALID_ROOM_CODE", "请输入 6 位房间号");
  return roomCode;
}

export function compareTeamMembers(left: TeamMember, right: TeamMember): number {
  const progress = Number(right.completionRate || 0) - Number(left.completionRate || 0);
  if (progress) return progress;
  const minutes = Number(right.growthMinutes || 0) - Number(left.growthMinutes || 0);
  if (minutes) return minutes;
  const leftCompleted = left.completedAt ? Date.parse(left.completedAt) : Number.MAX_SAFE_INTEGER;
  const rightCompleted = right.completedAt ? Date.parse(right.completedAt) : Number.MAX_SAFE_INTEGER;
  if (leftCompleted !== rightCompleted) return leftCompleted - rightCompleted;
  return String(left.id).localeCompare(String(right.id));
}

export function getCachedTeam(): TeamPageData { return readCache(); }

/** 仅供离线预览工具写入快照；正式页面不会据此创建或加入小队。 */
export function persistTeam(team: Team, members: TeamMember[]): TeamPageData {
  return writeCache(normalizePage({ team: { ...team, memberCount: members.length }, members, dailyStats: null }));
}

export async function getMyTeam(options: TeamPageOptions = {}): Promise<TeamPageData> {
  const data = await call<TeamMemberPageResult>("getTeamPage", {
    page: Math.max(1, Math.floor(options.page || 1)),
    pageSize: Math.min(50, Math.max(1, Math.floor(options.pageSize || PAGE_SIZE))),
  });
  return writeCache(normalizePage(data));
}

export async function createTeam(input: CreateTeamInput = {}): Promise<TeamPageData> {
  await call<TeamMutationResult>("createTeam", { input });
  return getMyTeam({ pageSize: 50 });
}

export async function joinRoom(input: JoinRoomInput): Promise<TeamPageData> {
  const roomCode = validateRoomCode(input.roomCode);
  const result = await call<TeamMutationResult>("joinTeamByRoomCode", { roomCode });
  if (result.pending) throw createError("JOIN_PENDING", "加入申请已提交，等待队长确认");
  return getMyTeam({ pageSize: 50 });
}

export async function updateSelfActivity(input: UpdateSelfActivityInput): Promise<TeamPageData> {
  await call<{ updated: boolean }>("syncTeamActivity", { ...input });
  return getMyTeam({ pageSize: 50 });
}

export async function updateSelfDisplayMode(displayMode: TeamDisplayMode): Promise<TeamPageData> {
  await call<{ updated: boolean }>("updateTeamMemberPrivacy", { displayMode });
  return getMyTeam({ pageSize: 50 });
}

export async function updateSelfTaskDetailVisible(taskDetailVisible: boolean): Promise<TeamPageData> {
  await call<{ updated: boolean }>("updateTeamMemberPrivacy", { taskDetailVisible });
  return getMyTeam({ pageSize: 50 });
}

export function canManageTeam(team: Team | null): boolean {
  if (!team) return false;
  const self = readCache().members.find((member) => member.isSelf);
  return self?.role === "owner";
}

export async function updateTeamSettings(input: UpdateTeamSettingsInput): Promise<TeamPageData> {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 20) throw createError("INVALID_TEAM_NAME", "小队名称需为 2 至 20 个字符");
  if ((input.announcement || "").length > 80) throw createError("INVALID_ANNOUNCEMENT", "小队公告最多 80 个字符");
  await call<{ updated: boolean }>("updateTeamSettings", { input: { ...input, name } });
  return getMyTeam({ pageSize: 50 });
}

export async function sendEncouragement(input: SendEncouragementInput): Promise<SendEncouragementResult> {
  return call<SendEncouragementResult>("sendEncouragement", input as unknown as Record<string, unknown>);
}

export async function getTeamActivityFeed(options: TeamPageOptions = {}): Promise<TeamActivityFeedResult> {
  return call<TeamActivityFeedResult>("getTeamActivityFeed", {
    page: Math.max(1, Math.floor(options.page || 1)),
    pageSize: Math.min(30, Math.max(1, Math.floor(options.pageSize || 10))),
  });
}

export async function leaveTeam(): Promise<TeamMutationResult> {
  const result = await call<TeamMutationResult>("leaveTeam");
  wx.removeStorageSync(STORAGE_KEY);
  return result;
}

export async function dissolveTeam(): Promise<TeamMutationResult> {
  const result = await call<TeamMutationResult>("dissolveTeam");
  wx.removeStorageSync(STORAGE_KEY);
  return result;
}

export async function removeTeamMember(memberId: string): Promise<TeamMutationResult> {
  return call<TeamMutationResult>("removeTeamMember", { memberId });
}

export async function transferTeamOwner(memberId: string): Promise<TeamMutationResult> {
  return call<TeamMutationResult>("transferTeamOwner", { memberId });
}

export async function reviewJoinRequest(requestId: string, approved: boolean): Promise<TeamMutationResult> {
  return call<TeamMutationResult>("reviewTeamJoinRequest", { requestId, approved });
}

export function resetLocalTeam(): void { wx.removeStorageSync(STORAGE_KEY); }

export function encouragementLabel(type: EncouragementType): string {
  return ({ keep_going: "今天也要加油", very_stable: "你太稳了", continue_tomorrow: "明天继续", stay_together: "一起坚持" } as Record<EncouragementType, string>)[type];
}
