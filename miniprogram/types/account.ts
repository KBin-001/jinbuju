import { ManualDataStore } from "./manual";
import { UserDisplayProfile } from "./profile";

export interface CloudAccount {
  userId: string;
  displayId: string;
  status: "active" | "disabled";
  phoneBound: boolean;
  phoneMasked: string;
}

export interface CloudSyncSummary {
  lastSuccessfulAt: string;
  migrationVersion: number;
}

export interface CloudUserProfile extends UserDisplayProfile {
  themeId?: string;
  welcomeCompleted?: boolean;
  joinedAt?: string;
}

export interface AccountBootstrapResult {
  account: CloudAccount;
  profile: CloudUserProfile;
  migrationCompleted: boolean;
  sync: CloudSyncSummary;
}

export interface AccountRuntimeState extends AccountBootstrapResult {
  ready: boolean;
  source: "cloud" | "cache";
  store?: ManualDataStore;
}

export interface CloudDataOverview {
  accountStatus: "active" | "disabled";
  profileUpdatedAt: string;
  lastSuccessfulAt: string;
  migrationVersion: number;
  counts: {
    activeGoals: number;
    historicalGoals: number;
    actions: number;
    checkins: number;
    achievements: number;
  };
}
