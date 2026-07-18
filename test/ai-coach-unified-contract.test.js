const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("coach public contract keeps raw answer and page-session metadata", () => {
  const types = read("miniprogram/types/progressCoach.ts");
  const service = read("miniprogram/services/progressCoach.ts");

  for (const field of ["answer: string", "conversationId", "userMessageId", "assistantMessageId", "generatedAt", "contextVersion"]) {
    assert.match(types, new RegExp(field), `ProgressCoachAnswer 缺少 ${field}`);
  }
  assert.match(types, /interface CoachConversation[\s\S]*conversationId:[\s\S]*messages:[\s\S]*hasMore:/);
  assert.match(service, /action: "getCoachConversation"/);
  assert.match(service, /if \(!conversationId\) return \{ conversationId: "", messages: \[\], hasMore: false \}/);
  assert.match(service, /Math\.max\(1, Math\.min\(50,/);
  assert.match(service, /history: history\.slice\(-20\)/);
  const askImplementation = service.slice(service.indexOf("export async function askProgressCoach"), service.indexOf("export async function getCoachConversation"));
  assert.match(askImplementation, /await verifyCoachRuntime\(\);[\s\S]*await syncManualData\(\);/);
  assert.doesNotMatch(askImplementation, /prepareProgressCoach\(/, "普通问答不应依赖旧快照或进行中目标");
  assert.match(service, /\n\s*question,\n/);
  assert.doesNotMatch(service, /question:\s*question\.trim\(\)/, "客户端不得改写用户问题");
});

test("coach response is safety checked and returned without JSON parsing or truncation", () => {
  const entry = read("cloudfunctions/generatePlan/index.js");
  const conversation = read("cloudfunctions/generatePlan/coach-conversation.js");
  const ai = read("cloudfunctions/generatePlan/ai.js");

  assert.match(entry, /assertEventContentSafe\(context\.OPENID, action, event \|\| \{\}\)/);
  assert.match(conversation, /generateMessagesWithMetadata/);
  assert.match(ai, /generateMessagesWithMetadata[\s\S]*await assertAiOutputSafe\(text\)/);
  assert.match(conversation, /answer\s*=\s*result\s*&&\s*result\.text/);
  assert.match(conversation, /buildCoachPresentation\(context, question, answer, actionProposal\)/);
  assert.match(conversation, /contextVersion: CONTEXT_SCHEMA_VERSION, presentation,/);
  assert.match(conversation, /return \{[\s\S]*answer, conversationId, userMessageId, assistantMessageId, generatedAt,/);
  assert.doesNotMatch(conversation, /parseAiJson|JSON\.parse|answer\s*=\s*answer\.(?:trim|slice)/);
});

test("unified context is server-owned, scoped, and excludes sensitive team fields", () => {
  const context = read("cloudfunctions/generatePlan/coach-context.js");
  const conversation = read("cloudfunctions/generatePlan/coach-conversation.js");

  assert.match(context, /async function buildUnifiedCoachContext\(openid,/);
  assert.match(context, /sanitizeTeamPage/);
  assert.match(context, /sourceHash/);
  assert.match(context, /schemaVersion/);
  assert.doesNotMatch(context, /event\.(?:openid|_openid|userId)/);
  const teamProjection = context.slice(context.indexOf("function sanitizeTeamPage"), context.indexOf("function taskAggregate"));
  for (const sensitiveField of ["openid", "userId", "phone", "avatarUrl", "roomCode"]) {
    assert.doesNotMatch(teamProjection, new RegExp(sensitiveField), `小队投影泄露 ${sensitiveField}`);
  }
  assert.match(conversation, /contextBuilder\(openid, scope, analysisDate, question\)/);
});

test("conversation lifecycle is isolated per page entry, bounded, and included in data deletion", () => {
  const repository = read("cloudfunctions/generatePlan/repository.js");
  const account = read("cloudfunctions/generatePlan/account.js");
  const accountTypes = read("miniprogram/types/account.ts");
  const profileRules = read("cloudfunctions/generatePlan/profile-rules.js");
  const conversation = read("cloudfunctions/generatePlan/coach-conversation.js");

  for (const collection of ["coach_conversations", "coach_messages"]) {
    assert.match(repository, new RegExp(`"${collection}"`));
    assert.match(account, new RegExp(`"${collection}"`));
    assert.match(profileRules, new RegExp(`"${collection}"`));
    assert.match(conversation, new RegExp(`"${collection}"`));
  }
  assert.match(conversation, /30\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000|30_DAYS|MESSAGE_RETENTION/);
  assert.match(conversation, /Math\.min\(50, Number\(event\.limit/);
  assert.match(conversation, /slice\(-20\)|MODEL_HISTORY_LIMIT\s*=\s*20/);
  assert.match(conversation, /conversationIdFor\(openid, sessionSeed\)/);
  assert.match(conversation, /`\$\{openid\}:\$\{sessionSeed\}`/);
  assert.match(conversation, /if \(!requestedConversationId\) return \{ conversationId: "", messages: \[\], hasMore: false \}/);
  assert.match(conversation, /existing\.data\._openid !== openid/);
  assert.match(account, /counts:\s*\{[^}]*coachConversations[^}]*coachMessages/);
  assert.match(accountTypes, /coachConversations:\s*number/);
  assert.match(accountTypes, /coachMessages:\s*number/);
});

test("coach write requests remain proposal-only until explicit execution", () => {
  const conversation = read("cloudfunctions/generatePlan/coach-conversation.js");
  const actions = read("cloudfunctions/generatePlan/manual-sync.js");
  const ai = read("cloudfunctions/generatePlan/ai.js");
  const coach = read("cloudfunctions/generatePlan/progress-coach.js");
  const clientActions = read("miniprogram/services/manualSync.ts");
  const entry = read("cloudfunctions/generatePlan/index.js");

  assert.match(conversation, /buildCoachCommand|createCoachProposal/);
  assert.match(conversation, /actionProposal/);
  assert.match(entry, /action === "executeCoachAction"/);
  assert.match(actions, /db\.runTransaction/);
  assert.match(actions, /status:\s*"executed"/);
  assert.match(actions, /async function reconcileCreateCoachAction/);
  assert.match(actions, /logAction\("create_reconciled"/);
  assert.match(actions, /getCoachActionStatus[\s\S]*recoverExistingCreatedTask\(openid, proposalId, proposal, event\)/);
  assert.match(actions, /coach proposal commit deferred/);
  assert.match(actions, /function executedProposalData\(proposal, actionResult\)/);
  assert.match(actions, /ref\.set\(\{ data: executedProposalData\(proposal, actionResult\) \}\)/, "proposal.result 从 null 变对象时必须整文档 set，不能使用路径 update");
  assert.match(actions, /source: "ai", userId: account\.userId/);
  assert.match(actions, /task = publicRecord\(storedTask\)/, "返回客户端前不得泄露内部 userId");
  assert.match(actions, /if \(!String\(error && error\.code \|\| ""\)\.startsWith\("COACH_ACTION_"\)\)/);
  const executeTransaction = actions.slice(actions.indexOf("async function executeCoachAction"), actions.indexOf("async function getCoachActionStatus"));
  assert.doesNotMatch(executeTransaction, /transaction\.collection\([^\n]+\)\.where\(/, "云开发事务内不得使用集合查询");
  assert.match(executeTransaction, /stableId\(COLLECTIONS\.goals, `\$\{openid\}:\$\{proposal\.goalId\}`\)/);
  assert.match(executeTransaction, /stableId\(COLLECTIONS\.tasks, `\$\{openid\}:\$\{proposal\.taskId\}`\)/);
  const statusImplementation = actions.slice(actions.indexOf("async function getCoachActionStatus"), actions.indexOf("module.exports"));
  assert.doesNotMatch(statusImplementation, /\.set\(/, "只读状态查询不得创建任务，只能识别已写入任务并修复 proposal");
  assert.match(ai, /propose_coach_action/);
  assert.match(ai, /toolChoice:\s*"auto"/);
  assert.match(coach, /reminderTime/);
  assert.match(actions, /reminderTime:\s*input\.reminderTime/);
  const confirmationFlow = clientActions.slice(clientActions.indexOf("export async function executeCoachProposal"));
  assert.match(confirmationFlow, /authorizationPromise\s*=\s*requestNotificationAuthorizationWithReceipt/);
  assert.ok(
    confirmationFlow.indexOf("authorizationPromise = requestNotificationAuthorizationWithReceipt") < confirmationFlow.indexOf("const action = await executeCoachAction"),
    "微信订阅授权必须在确认按钮的同步调用链中、云端执行前触发",
  );
  assert.match(confirmationFlow, /upsertTaskReminder/);
  assert.match(confirmationFlow, /updateTaskReminder/);
  assert.match(clientActions, /status\.status === "pending"[\s\S]*action: "executeCoachAction"/);
  for (const code of ["COACH_ACTION_INVALID", "COACH_ACTION_NOT_FOUND", "COACH_ACTION_EXPIRED", "COACH_ACTION_CONFLICT"]) {
    assert.match(entry, new RegExp(`"${code}"`), `${code} 不应再被映射为 INTERNAL_ERROR`);
  }
});

test("client and cloud require the same unified coach runtime", () => {
  const client = read("miniprogram/services/manualSync.ts");
  const cloud = read("cloudfunctions/generatePlan/index.js");
  const expected = "coach-unified-2026-07-19.10";

  assert.match(client, new RegExp(expected.replaceAll(".", "\\.")));
  assert.match(cloud, new RegExp(expected.replaceAll(".", "\\.")));
});
