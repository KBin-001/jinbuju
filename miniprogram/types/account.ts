import { ManualDataStore } from "./manual";
import { UserDisplayProfile } from "./profile";

export interface CloudAccount {
  userId: string;
  status: "active" | "disabled";
  phoneBound: boolean;
  phoneMasked: string;
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
}

export interface AccountRuntimeState extends AccountBootstrapResult {
  ready: boolean;
  store?: ManualDataStore;
}
