export type TeamStatus = "active" | "closed";
export type TeamVisibility = "public" | "private";
export type TeamActionDetailVisibility = "all_members" | "admins_only" | "hidden";
export type TeamDisplayMode = "public" | "nicknameOnly" | "anonymous";
export type MemberTodayStatus = "not_started" | "completed" | "partial" | "missed";
export type EncouragementType =
  | "keep_going"
  | "very_stable"
  | "continue_tomorrow"
  | "stay_together";

export interface Team {
  id: string;
  name: string;
  avatar?: string;
  roomCode: string;
  ownerId: string;
  visibility: TeamVisibility;
  allowAnonymous: boolean;
  actionDetailVisibility: TeamActionDetailVisibility;
  maxMembers: number;
  memberCount: number;
  createdAt: string;
  phaseStartDate: string;
  phaseEndDate: string;
  description?: string;
  status: TeamStatus;
}

export interface TeamMember {
  id: string;
  userId: string;
  teamId: string;
  displayMode: TeamDisplayMode;
  nickname: string;
  anonymousName?: string;
  avatar?: string;
  goalTitle?: string;
  todayActionTitle?: string;
  todayActionDetails?: TeamMemberActionDetail[];
  taskDetailVisible: boolean;
  todayStatus: MemberTodayStatus;
  estimatedMinutes: number;
  growthMinutes: number;
  encouragementCount: number;
  encouragedByMeToday: boolean;
  isSelf: boolean;
  updatedAt: string;
}

export interface TeamMemberActionDetail {
  id: string;
  title: string;
  status: MemberTodayStatus;
  estimatedMinutes: number;
  growthMinutes: number;
}

export interface TeamDailyStats {
  teamId: string;
  date: string;
  totalMembers: number;
  completedMembers: number;
  partialMembers: number;
  notStartedMembers: number;
  missedMembers: number;
  totalGrowthMinutes: number;
  encouragementCount: number;
  completionRate: number;
}

export interface TeamPageData {
  team: Team | null;
  members: TeamMember[];
  dailyStats: TeamDailyStats | null;
}

export interface LocalTeamStore {
  version: 1;
  currentTeam: Team | null;
  teamMembers: TeamMember[];
  teamDailyStats: TeamDailyStats | null;
  teamRoomCode: string;
}

export interface CreateTeamInput {
  goalTitle?: string;
  todayActionTitle?: string;
  todayActionDetails?: TeamMemberActionDetail[];
  estimatedMinutes?: number;
  growthMinutes?: number;
  todayStatus?: MemberTodayStatus;
}

export interface JoinRoomInput extends CreateTeamInput {
  roomCode: string;
}

export interface UpdateSelfActivityInput {
  goalTitle?: string;
  todayActionTitle?: string;
  todayActionDetails: TeamMemberActionDetail[];
  estimatedMinutes: number;
  growthMinutes: number;
  todayStatus: MemberTodayStatus;
}

export interface UpdateTeamSettingsInput {
  name: string;
  avatar?: string;
  visibility: TeamVisibility;
  allowAnonymous: boolean;
  actionDetailVisibility: TeamActionDetailVisibility;
}

export interface SendEncouragementInput {
  memberId: string;
  type: EncouragementType;
}

export interface SendEncouragementResult {
  memberId: string;
  sent: boolean;
}
