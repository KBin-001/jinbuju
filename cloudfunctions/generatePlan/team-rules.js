const crypto = require("crypto");

const ENCOURAGEMENT_TYPES = [
  "keep_going",
  "very_stable",
  "continue_tomorrow",
  "stay_together",
];
const MAX_TEAM_MEMBERS = 20;
const TEAM_CONTRACT_VERSION = 2;
const TEAM_SCHEMA_VERSION = 2;
const TEAM_BUILD_ID = "team-cloud-2026-07-12.2";
const TEAM_SUPPORTED_ACTIONS = [
  "getTeamRuntimeInfo", "getTeamInviteInfo", "getMyTeam", "getTeamPage", "createTeam", "joinTeam", "joinTeamByRoomCode",
  "getTeamActivityFeed", "updateTeamSettings", "updateTeamMemberPrivacy", "reviewTeamJoinRequest",
  "removeTeamMember", "leaveTeam", "transferTeamOwner", "dissolveTeam", "sendEncouragement", "syncTeamActivity",
];
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const TEAM_ROLES = ["owner", "member"];

function stablePublicId(prefix, value) {
  return `${prefix}_${crypto
    .createHash("sha256")
    .update(value)
    .digest("hex")
    .slice(0, 24)}`;
}

function publicMemberId(teamId, userKey) {
  return stablePublicId("member", `${teamId}:${userKey}`);
}

function isValidEncouragementType(value) {
  return ENCOURAGEMENT_TYPES.includes(value);
}

function compareRank(left, right) {
  const minutes = Number(right.growthMinutes || 0) - Number(left.growthMinutes || 0);
  if (minutes) return minutes;
  const leftReachedAt = left.lastEffectiveActionAt || left.completedAt;
  const rightReachedAt = right.lastEffectiveActionAt || right.completedAt;
  const leftCompleted = leftReachedAt ? Date.parse(leftReachedAt) : Number.MAX_SAFE_INTEGER;
  const rightCompleted = rightReachedAt ? Date.parse(rightReachedAt) : Number.MAX_SAFE_INTEGER;
  if (leftCompleted !== rightCompleted) return leftCompleted - rightCompleted;
  return String(left.id).localeCompare(String(right.id));
}

function normalizeRoomCode(value) {
  const code = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  return ROOM_CODE_PATTERN.test(code) ? code : "";
}

module.exports = {
  ENCOURAGEMENT_TYPES,
  MAX_TEAM_MEMBERS,
  TEAM_BUILD_ID,
  TEAM_CONTRACT_VERSION,
  TEAM_SCHEMA_VERSION,
  TEAM_SUPPORTED_ACTIONS,
  ROOM_CODE_PATTERN,
  TEAM_ROLES,
  compareRank,
  isValidEncouragementType,
  normalizeRoomCode,
  publicMemberId,
};
