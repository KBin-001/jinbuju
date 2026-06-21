import { CloudFunctionResult as SharedCloudFunctionResult } from "./goal";

export type CloudFunctionResult<T> = SharedCloudFunctionResult<T>;
export type TeamStatus = "active" | "completed" | "closed";
export type EncouragementType =
  | "keep_going"
  | "very_stable"
  | "continue_tomorrow"
  | "stay_together";

export interface TeamSummary {
  id: string;
  name: string;
  goalCategory: string;
  stageTitle: string;
  stageStartDate: string;
  stageEndDate: string;
  memberCount: number;
  maxMembers: number;
  todayCompletedCount: number;
  status: TeamStatus;
}

export interface TeamMemberSummary {
  id: string;
  nickname: string;
  avatarUrl: string;
  isSelf: boolean;
  streakDays: number;
  todayCompleted: boolean;
  todayRest: boolean;
  stageCompletionRate: number;
  encouragementCount: number;
  encouragedByMeToday: boolean;
  goalTitle: string;
  todayMinutes: number;
}

export interface TeamPageData {
  team: TeamSummary | null;
  members: TeamMemberSummary[];
}

export interface JoinTeamInput {
  goalTitle?: string;
}

export interface SyncTeamActivityInput {
  goalTitle: string;
  tasks: Array<{
    id: string;
    status: string;
    actualMinutes?: number;
    estimatedMinutes: number;
  }>;
}

export interface JoinTeamResult {
  teamId: string;
  joined: boolean;
}

export interface SendEncouragementInput {
  memberId: string;
  type: EncouragementType;
}

export interface SendEncouragementResult {
  memberId: string;
  sent: boolean;
}
