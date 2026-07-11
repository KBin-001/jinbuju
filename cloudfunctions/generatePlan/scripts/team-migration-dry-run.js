#!/usr/bin/env node
"use strict";

// Offline-only analyzer. It reads an exported JSON file and never loads wx-server-sdk,
// opens a network connection, or writes Cloud Database data.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SCHEMA_VERSION = 2;
const MAX_MEMBERS = 20;
const args = process.argv.slice(2);
if (args.includes("--apply") || args.includes("--write") || args.includes("--online")) {
  throw new Error("This tool is dry-run only; online/apply flags are forbidden.");
}
function valueAfter(flag) { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : ""; }
const inputPath = valueAfter("--input");
const outputPath = valueAfter("--output");
if (!inputPath) {
  console.error("Usage: node scripts/team-migration-dry-run.js --input exported-team-data.json [--output report.json] [--fail-on-risk]");
  process.exitCode = 2;
  return;
}

function stableId(prefix, value) {
  return `${prefix}_${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24)}`;
}
function records(input, key) { return Array.isArray(input[key]) ? input[key] : []; }
function schemaOfTeam(team) { return team && team.schemaVersion === 2 && team.roomCode && team.ownerUserId ? 2 : 1; }
function schemaOfMember(member) { return member && member.userId ? 2 : member && member.userKey ? 1 : 0; }

const absoluteInput = path.resolve(inputPath);
const input = JSON.parse(fs.readFileSync(absoluteInput, "utf8"));
const teams = records(input, "teams");
const members = records(input, "team_members");
const encouragements = records(input, "encouragements");
const legacyActivity = records(input, "team_activity");
const accountMap = new Map(records(input, "account_map").map((item) => [String(item.userKey || item.openid || ""), String(item.userId || "")]));
const roomCodes = new Map();
const risks = [];
const plan = [];

for (const team of teams) {
  const teamId = String(team._id || team.id || "");
  const teamMembers = members.filter((member) => String(member.teamId || "") === teamId && member.status === "active");
  if (!teamId) { risks.push({ code: "TEAM_ID_MISSING" }); continue; }
  if (teamMembers.length > MAX_MEMBERS) risks.push({ code: "TEAM_OVER_CAPACITY", teamId, count: teamMembers.length, max: MAX_MEMBERS });
  if (schemaOfTeam(team) === 2) {
    const code = String(team.roomCode || "");
    if (roomCodes.has(code) && roomCodes.get(code) !== teamId) risks.push({ code: "ROOM_CODE_DUPLICATE", roomCode: code, teamIds: [roomCodes.get(code), teamId] });
    roomCodes.set(code, teamId);
    continue;
  }
  const ordered = teamMembers.slice().sort((a, b) => Number(a.joinOrder || 999999) - Number(b.joinOrder || 999999));
  const mapped = ordered.map((member) => ({ member, userId: accountMap.get(String(member.userKey || member._openid || "")) || "" }));
  const unresolved = mapped.filter((item) => !item.userId);
  if (unresolved.length) risks.push({ code: "ACCOUNT_MAPPING_MISSING", teamId, memberIds: unresolved.map((item) => item.member._id || item.member.userKey) });
  const ownerUserId = mapped.find((item) => item.userId)?.userId || "";
  plan.push({
    operation: "migrate_team",
    teamId,
    target: {
      schemaVersion: SCHEMA_VERSION,
      ownerUserId,
      maxMembers: MAX_MEMBERS,
      announcement: String(team.stageTitle || "一起行动，各自成长"),
      joinMode: "direct",
      visibility: "private",
      allowAnonymous: true,
      anonymityMode: "anonymous",
      allowMemberInvite: true,
      actionDetailVisibility: "hidden",
    },
    members: mapped.filter((item) => item.userId).map((item, index) => ({
      sourceId: item.member._id || "",
      targetId: stableId("team_member", `${teamId}:${item.userId}`),
      userId: item.userId,
      role: index === 0 ? "owner" : "member",
      displayMode: "nicknameOnly",
      taskDetailVisible: false,
    })),
  });
}

for (const item of encouragements) {
  if (item.senderUserKey || item.receiverUserKey) {
    const senderUserId = accountMap.get(String(item.senderUserKey || ""));
    const receiverUserId = accountMap.get(String(item.receiverUserKey || ""));
    if (!senderUserId || !receiverUserId) risks.push({ code: "ENCOURAGEMENT_MAPPING_MISSING", id: item._id || "" });
  }
}

const report = {
  dryRun: true,
  onlineAccess: false,
  generatedAt: new Date().toISOString(),
  input: absoluteInput,
  contract: { schemaVersion: SCHEMA_VERSION, maxMembers: MAX_MEMBERS },
  inventory: {
    teams: teams.length,
    legacyTeams: teams.filter((item) => schemaOfTeam(item) === 1).length,
    currentTeams: teams.filter((item) => schemaOfTeam(item) === 2).length,
    members: members.length,
    legacyMembers: members.filter((item) => schemaOfMember(item) === 1).length,
    currentMembers: members.filter((item) => schemaOfMember(item) === 2).length,
    encouragements: encouragements.length,
    legacyActivity: legacyActivity.length,
  },
  plan,
  risks,
};
const output = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) fs.writeFileSync(path.resolve(outputPath), output, "utf8");
else process.stdout.write(output);
if (args.includes("--fail-on-risk") && risks.length) process.exitCode = 1;
