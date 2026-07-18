const assert = require("assert");
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const { buildUnifiedCoachContext, sanitizeTeamPage } = require("./coach-context");
const { buildCoachPresentation, buildModelMessages, buildRollingSummary, conversationIdFor, normalizeScope } = require("./coach-conversation");
const { buildCoachCommand, extractCreateIntent, extractCreateTaskTitle, extractReminderTime, isExplicitCompletionWrite, isExplicitCreateWrite, reminderLeadMinutes } = require("./progress-coach");

async function run() {
  const team = sanitizeTeamPage({
    team: { id: "secret-team", name: "同行小队", roomCode: "123456", ownerId: "secret-owner", memberCount: 2, maxMembers: 50 },
    dailyStats: { date: "2026-07-18", totalMembers: 2, completedMembers: 1, totalGrowthMinutes: 80, completionRate: 50 },
    members: [{
      id: "secret-member", userId: "secret-user", nickname: "匿名伙伴", avatar: "cloud://secret-avatar", rank: 1,
      todayStatus: "completed", growthMinutes: 50, completionRate: 100, todayActionTitle: "背单词",
      todayActionDetails: [{ id: "secret-task", title: "背单词", status: "completed", actualMinutes: 50 }],
    }], total: 2,
  });
  const serializedTeam = JSON.stringify(team);
  assert.match(serializedTeam, /同行小队/);
  assert.doesNotMatch(serializedTeam, /secret-|123456|cloud:\/\//);

  const records = {
    manual_goals: [{ id: "goal_1", title: "准备考试", status: "active", category: "custom" }],
    manual_tasks: [{ id: "task_1", goalId: "goal_1", title: "背单词", currentDate: "2026-07-18", status: "completed", estimatedMinutes: 30, actualMinutes: 35 }],
    manual_checkins: [{ id: "check_1", goalId: "goal_1", businessDate: "2026-07-18", completedCount: 1, actualMinutes: 35 }],
    manual_archived_goals: [{ id: "old_1", title: "旧目标", status: "archived" }],
    achievement_unlocks: [{ id: "first", unlockedAt: "2026-07-18T01:00:00.000Z" }],
    spark_checkins: [{ id: "2026-07-18", businessDate: "2026-07-18" }],
    stage_reviews: [{ stageNumber: 1, reviewSummary: "保持节奏" }],
    users: [{ _openid: "must-not-leak", nickname: "行动者", phoneMasked: "138****0000" }],
  };
  const context = await buildUnifiedCoachContext("owner-openid", "day", "2026-07-18", "今天怎么样", {
    listOwned: async (name) => records[name] || [],
    getTeamPage: async () => ({ team: null, members: [] }),
    getTeamActivityFeed: async () => ({ list: [], total: 0 }),
  });
  assert.strictEqual(context.selectedDate.tasks[0].title, "背单词");
  assert.strictEqual(context.aggregate.actualMinutes, 35);
  assert.strictEqual(context.partitions.archives, 1);
  assert.strictEqual(context.sourceHash.length, 64);
  const serializedContext = JSON.stringify(context);
  assert.doesNotMatch(serializedContext, /owner-openid|must-not-leak|138\*\*\*\*0000/);
  const metricsPresentation = buildCoachPresentation(context, "为什么这样判断？", "今天已形成进展。\n1. 完成情况：已完成一项行动。\n2. 投入情况：实际投入 35 分钟。");
  assert.strictEqual(metricsPresentation.kind, "metrics");
  assert.deepStrictEqual(metricsPresentation.metrics.map((item) => item.value), ["1/1", "35", "100"]);
  assert.strictEqual(metricsPresentation.sections.length, 2);
  const priorityContext = { ...context, selectedDate: { tasks: [
    { title: "先处理高优先任务", status: "pending", estimatedMinutes: 45 },
    { title: "随后完成复盘", status: "pending", estimatedMinutes: 30 },
  ] } };
  const priorityPresentation = buildCoachPresentation(priorityContext, "帮我安排接下来的计划", "先完成最关键的一项，再做复盘。");
  assert.strictEqual(priorityPresentation.kind, "priorities");
  assert.strictEqual(priorityPresentation.priorities[0].title, "先处理高优先任务");
  const taskPresentation = buildCoachPresentation(context, "今天有什么任务？", "模型返回的杂乱任务正文不应直接展示");
  assert.strictEqual(taskPresentation.kind, "tasks");
  assert.strictEqual(taskPresentation.title, "共 1 项行动");
  assert.strictEqual(taskPresentation.priorities[0].title, "背单词");
  const clarificationPresentation = buildCoachPresentation(context, "明天八点提醒我", "提醒时间需要调整", {
    type: "needs_clarification", requiredFields: ["reminderTime"],
  });
  assert.strictEqual(clarificationPresentation.kind, "clarification");
  assert.strictEqual(clarificationPresentation.title, "提醒时间需要调整");

  const rawAnswer = "第一段  保留空格\n\n**不是富文本解析**\n" + "长回复".repeat(300);
  const messages = buildModelMessages(context, [{ role: "assistant", content: rawAnswer }], "继续说", "用户喜欢晚间行动");
  assert.strictEqual(messages[messages.length - 2].content, rawAnswer);
  assert.strictEqual(messages[messages.length - 1].content, "继续说");
  assert.ok(messages.some((item) => item.role === "system" && /实时可信数据/.test(item.content)));
  assert.ok(buildRollingSummary(Array.from({ length: 24 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `消息${index}` }))).includes("消息3"));
  assert.strictEqual(normalizeScope("total"), "overall");
  assert.strictEqual(conversationIdFor("owner-openid", "session-a"), conversationIdFor("owner-openid", "session-a"));
  assert.notStrictEqual(conversationIdFor("owner-openid", "session-a"), conversationIdFor("owner-openid", "session-b"));
  assert.throws(() => normalizeScope("year"), (error) => error.code === "PROGRESS_SNAPSHOT_INVALID");
  assert.strictEqual(isExplicitCompletionWrite("今天我完成了什么？"), false);
  assert.strictEqual(isExplicitCompletionWrite("我今天完成了哪些行动"), false);
  assert.strictEqual(isExplicitCompletionWrite("把背单词标记为完成"), true);
  assert.strictEqual(isExplicitCompletionWrite("我刚刚做完了背单词"), true);
  assert.strictEqual(isExplicitCreateWrite("今天适合新增什么行动？"), false);
  assert.strictEqual(isExplicitCreateWrite("帮我新增一项背单词行动，30分钟"), true);
  const historyQueryResult = await buildCoachCommand("owner-openid", {
    goalId: "goal_1", goals: records.manual_goals,
    tasks: [{ ...records.manual_tasks[0], status: "pending" }], checkins: [],
  }, "今天我完成了什么？", [{ role: "user", content: "帮我新增一项行动", sentAt: "2026-07-18T12:00:00.000Z" }],
  "2026-07-18T13:00:00.000Z", "2026-07-18", async () => { throw new Error("查询不应创建提案"); });
  assert.strictEqual(historyQueryResult, null);
  assert.strictEqual(extractReminderTime("晚上10:00开始"), "22:00");
  assert.strictEqual(extractReminderTime("上午8点半"), "08:30");
  assert.strictEqual(extractReminderTime("明天早上八点提醒"), "08:00");
  assert.strictEqual(extractReminderTime("明天凌晨十二点十分提醒"), "00:10");
  assert.strictEqual(extractReminderTime("晚上10点；改成22:15"), "22:15");
  assert.strictEqual(reminderLeadMinutes("2026-07-18", "22:00", "2026-07-18T13:52:00.000Z"), 8);
  assert.strictEqual(extractCreateTaskTitle("帮我设定一个任务，就是晚上10:00背30分钟单词"), "背单词");
  const modelCreateIntent = await extractCreateIntent("帮我设定一个任务，就是晚上10:00背30分钟单词", "2026-07-18", async () => ({
    operation: "create_task", title: "背单词", currentDate: "2026-07-18", estimatedMinutes: 30, reminderTime: "22:00",
  }));
  assert.deepStrictEqual(modelCreateIntent, { title: "背单词", estimatedMinutes: 30, currentDate: "2026-07-18", reminderTime: "22:00" });
  const tomorrowIntent = await extractCreateIntent("帮我设定一个任务，就是明天早上八点提醒我看英语电影30分钟", "2026-07-18", async () => ({
    operation: "create_task", title: "看英语电影", currentDate: "2026-07-18", estimatedMinutes: 30, reminderTime: "08:00",
  }));
  assert.deepStrictEqual(tomorrowIntent, { title: "看英语电影", estimatedMinutes: 30, currentDate: "2026-07-19", reminderTime: "08:00" });
  let tomorrowProposal;
  const tomorrowCommand = await buildCoachCommand("owner-openid", {
    goalId: "goal_1", goals: records.manual_goals, tasks: [], checkins: [],
  }, "帮我设定一个任务，就是明天凌晨12:10提醒我看英语电影30分钟", [], "2026-07-18T15:46:00.000Z", "2026-07-18",
  async (_openid, input) => { tomorrowProposal = input; return { id: "proposal_tomorrow", ...input, status: "pending", summary: "新增看英语电影" }; },
  async () => ({ operation: "create_task", title: "看英语电影", currentDate: "2026-07-18", estimatedMinutes: 30, reminderTime: "00:10" }));
  assert.strictEqual(tomorrowProposal.currentDate, "2026-07-19");
  assert.strictEqual(tomorrowProposal.reminderTime, "00:10");
  assert.strictEqual(tomorrowCommand.actionProposal.type, "create_task");
  let capturedProposal;
  const createCommand = await buildCoachCommand("owner-openid", {
    goalId: "goal_1", goals: records.manual_goals, tasks: [], checkins: [],
  }, "帮我设定一个任务，就是晚上10:00背30分钟单词", [], "2026-07-18T13:00:00.000Z", "2026-07-18",
  async (_openid, input) => { capturedProposal = input; return { id: "proposal_1", ...input, status: "pending", summary: "新增背单词" }; },
  async () => ({ operation: "create_task", title: "背单词", currentDate: "2026-07-18", estimatedMinutes: 30, reminderTime: "22:00" }));
  assert.strictEqual(capturedProposal.title, "背单词");
  assert.strictEqual(capturedProposal.reminderTime, "22:00");
  assert.strictEqual(createCommand.actionProposal.reminderTime, "22:00");
  const tooSoonCommand = await buildCoachCommand("owner-openid", {
    goalId: "goal_1", goals: records.manual_goals, tasks: [], checkins: [],
  }, "帮我设置晚上10点背30分钟单词", [], "2026-07-18T13:52:00.000Z", "2026-07-18",
  async () => { throw new Error("时间不足时不应创建提案"); },
  async () => ({ operation: "create_task", title: "背单词", currentDate: "2026-07-18", estimatedMinutes: 30, reminderTime: "22:00" }));
  assert.strictEqual(tooSoonCommand.actionProposal.type, "needs_clarification");
  assert.deepStrictEqual(tooSoonCommand.actionProposal.requiredFields, ["reminderTime"]);
  console.log("coach unified-context, privacy and raw-message tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
