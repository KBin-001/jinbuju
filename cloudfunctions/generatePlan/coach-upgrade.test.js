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
  const diagnosisPresentation = buildCoachPresentation(context, "为什么这样判断？", "模型声称完成 999 项、投入 9999 分钟也不能成为模板数据。");
  assert.strictEqual(diagnosisPresentation.kind, "diagnosis");
  assert.deepStrictEqual(diagnosisPresentation.sections.map((item) => item.index), ["依据", "下一步"]);
  assert.deepStrictEqual(diagnosisPresentation.sections.map((item) => item.detail), [
    "已完成 1/1 项行动，实际投入 35 分钟，预计 30 分钟",
    "当前范围内的行动已经完成，可以补充实际投入或安排下一项具体行动。",
  ]);
  assert.doesNotMatch(JSON.stringify(diagnosisPresentation.sections), /999/);
  const progressPresentation = buildCoachPresentation(context, "今天进展是什么？", "今天已经完成计划，整体节奏稳定。\n下一步可以继续巩固记录。");
  assert.strictEqual(progressPresentation.kind, "diagnosis");
  assert.strictEqual(progressPresentation.title, "结论");
  assert.deepStrictEqual(progressPresentation.sections.map((item) => item.index), ["依据", "下一步"]);
  const metricsPresentation = buildCoachPresentation(context, "当前进度怎么样？", "模型正文保持独立。");
  assert.strictEqual(metricsPresentation.kind, "metric_overview");
  assert.deepStrictEqual(metricsPresentation.metrics.map((item) => item.value), ["1/1", "35", "100"]);
  const priorityContext = { ...context, selectedDate: { tasks: [
    { title: "先处理高优先任务", status: "pending", estimatedMinutes: 45 },
    { title: "随后完成复盘", status: "pending", estimatedMinutes: 30 },
  ] } };
  const priorityPresentation = buildCoachPresentation(priorityContext, "帮我安排接下来的计划", "先完成最关键的一项，再做复盘。");
  assert.strictEqual(priorityPresentation.kind, "priority_plan");
  assert.strictEqual(priorityPresentation.priorities[0].title, "先处理高优先任务");
  const taskPresentation = buildCoachPresentation(context, "今天有什么任务？", "模型返回的杂乱任务正文不应直接展示");
  assert.strictEqual(taskPresentation.kind, "task_list");
  assert.strictEqual(taskPresentation.title, "共 1 项行动");
  assert.strictEqual(taskPresentation.priorities[0].title, "背单词");
  const clarificationPresentation = buildCoachPresentation(context, "明天八点提醒我", "提醒时间需要调整", {
    type: "needs_clarification", requiredFields: ["reminderTime"],
  });
  assert.strictEqual(clarificationPresentation.kind, "clarification");
  assert.strictEqual(clarificationPresentation.title, "提醒时间需要调整");

  const timelineContext = { ...context, selectedDate: { tasks: [
    { title: "晨间阅读", status: "pending", estimatedMinutes: 30, reminder: { time: "08:00" } },
    { title: "晚间复盘", status: "pending", estimatedMinutes: 20, reminder: { time: "21:30" } },
  ] } };
  const timelinePresentation = buildCoachPresentation(timelineContext, "按时间安排提醒顺序", "模型输出 06:00 不得进入时间轴。");
  assert.strictEqual(timelinePresentation.kind, "timeline");
  assert.deepStrictEqual(timelinePresentation.timeline.map((item) => item.time), ["08:00", "21:30"]);
  assert.doesNotMatch(JSON.stringify(timelinePresentation.timeline), /06:00/);

  const comparisonPresentation = buildCoachPresentation(context, "对比计划和实际投入", "回答里的 888 分钟不能成为对比数据。");
  assert.strictEqual(comparisonPresentation.kind, "comparison");
  assert.strictEqual(comparisonPresentation.comparison[0].current, "35 分钟");
  assert.strictEqual(comparisonPresentation.comparison[0].previous, "30 分钟");
  assert.doesNotMatch(JSON.stringify(comparisonPresentation.comparison), /888/);

  const trendContext = { ...context, scope: "week", recent: { ...context.recent, tasks: [
    { title: "行动一", currentDate: "2026-07-16", status: "completed" },
    { title: "行动二", currentDate: "2026-07-17", status: "pending" },
  ] } };
  const trendPresentation = buildCoachPresentation(trendContext, "最近一周趋势", "模型猜测 100% 不得覆盖真实趋势。");
  assert.strictEqual(trendPresentation.kind, "trend");
  assert.deepStrictEqual(trendPresentation.trend.map((item) => item.displayValue), ["1/1", "0/1", "1/1"]);

  const milestoneContext = { ...context, profile: { currentStreakDays: 5, longestStreakDays: 12 }, stageReviews: [{ stageNumber: 2, completionRate: 60 }] };
  const milestonePresentation = buildCoachPresentation(milestoneContext, "我的成长里程碑", "模型说连续 99 天不能进入指标。");
  assert.strictEqual(milestonePresentation.kind, "milestone");
  assert.deepStrictEqual(milestonePresentation.metrics.map((item) => item.value), ["5", "12", "2"]);

  const teamContext = { ...context, team: {
    team: { name: "同行小队" }, dailyStats: { date: "2026-07-18", totalMembers: 4, completedMembers: 2, totalGrowthMinutes: 180, completionRate: 50 },
    members: [{ isSelf: true, rank: 2, growthMinutes: 35 }],
  } };
  const teamPresentation = buildCoachPresentation(teamContext, "我在小队排名怎么样", "模型回答第一名不能覆盖真实排名。");
  assert.strictEqual(teamPresentation.kind, "team_snapshot");
  assert.strictEqual(teamPresentation.team[0].value, "第 2 名");

  const proposalPresentation = buildCoachPresentation(context, "帮我新增行动", "请确认后执行。", {
    type: "create_task", status: "pending", title: "阅读", estimatedMinutes: 45, currentDate: "2026-07-19", reminderTime: "20:30",
  });
  assert.strictEqual(proposalPresentation.kind, "action_proposal");
  assert.deepStrictEqual(proposalPresentation.action, {
    title: "阅读", summary: "", detail: "预计 45 分钟 · 2026-07-19", status: "pending", reminderTime: "20:30",
  });
  const directPresentation = buildCoachPresentation(context, "给我一句鼓励", "保持今天的节奏即可。");
  assert.strictEqual(directPresentation.kind, "direct");

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
