const cloud = require("wx-server-sdk");
const { generateMessagesWithMetadata } = require("./ai");
const { buildUnifiedCoachContext, CONTEXT_SCHEMA_VERSION } = require("./coach-context");
const { buildCoachCommand } = require("./progress-coach");
const { stableId } = require("./repository");
const { formatBusinessDate } = require("./date");

const db = cloud.database();
const command = db.command;
const CONVERSATION_SCHEMA_VERSION = "coach-conversation-2026-07-18.4";
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const VALID_SCOPES = new Set(["day", "week", "month", "overall"]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function normalizeScope(value) {
  const scope = String(value || "day") === "total" ? "overall" : String(value || "day");
  if (!VALID_SCOPES.has(scope)) fail("PROGRESS_SNAPSHOT_INVALID", "成长教练范围无效。");
  return scope;
}

function normalizeDate(value) {
  const date = String(value || "");
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail("PROGRESS_SNAPSHOT_INVALID", "分析日期无效。");
  return date || formatBusinessDate();
}

function publicMessage(item) {
  return {
    id: item._id, role: item.role, content: item.content, sentAt: item.sentAt,
    scope: item.scope, analysisDate: item.analysisDate, goalId: item.goalId || "",
    ...(item.presentation ? { presentation: item.presentation } : {}),
    ...(item.actionProposal ? { actionProposal: item.actionProposal } : {}),
  };
}

function conversationIdFor(openid, sessionSeed) {
  return stableId("coach_conversation", `${openid}:${sessionSeed}`);
}

async function resolveConversationId(openid, requestedConversationId, sessionSeed) {
  const requested = String(requestedConversationId || "");
  if (!requested) return conversationIdFor(openid, sessionSeed);
  const existing = await db.collection("coach_conversations").doc(requested).get().catch(() => null);
  if (!existing || !existing.data || existing.data._openid !== openid) {
    fail("PROGRESS_CONTEXT_NOT_FOUND", "当前对话已结束，请重新提问。");
  }
  return requested;
}

async function recentMessages(openid, conversationId, limit = 50) {
  const result = await db.collection("coach_messages").where({ _openid: openid, conversationId })
    .orderBy("sentAtMs", "desc").limit(limit).get();
  return (result.data || []).reverse();
}

async function getCoachConversation(openid, event = {}) {
  const requestedConversationId = String(event.conversationId || "");
  if (!requestedConversationId) return { conversationId: "", messages: [], hasMore: false };
  const conversationId = await resolveConversationId(openid, requestedConversationId, "read");
  const requestedLimit = Math.max(1, Math.min(50, Number(event.limit || 50)));
  const before = Number(event.before || 0);
  const where = { _openid: openid, conversationId };
  if (before > 0) where.sentAtMs = command.lt(before);
  const [result, count] = await Promise.all([
    db.collection("coach_messages").where(where).orderBy("sentAtMs", "desc").limit(requestedLimit).get(),
    db.collection("coach_messages").where(where).count(),
  ]);
  const records = result.data || [];
  return { conversationId, messages: records.reverse().map(publicMessage), hasMore: Number(count.total || 0) > records.length };
}

function buildModelMessages(context, history, question, summary = "") {
  const messages = [{
    role: "system",
    content: "你是用户的 AI 成长教练。基于系统提供的实时可信数据理解用户并直接回答，不要虚构数据。系统实时数据的事实优先级高于历史会话。不得声称已经修改行动；写操作只可通过系统的确认提案完成。回复要结论优先、简洁具体，删除寒暄、重复题意和空泛鼓励。简单问题尽量控制在 3 段内；分析或计划类问题先用一句话总结，再用 2～4 个短要点说明依据或优先级。不得向用户输出 goalId、taskId、openid、内部记录 ID 或 JSON 字段名。不要输出 JSON，不要为了排版堆砌 Markdown 标记。",
  }, {
    role: "system",
    content: `可信用户数据（${CONTEXT_SCHEMA_VERSION}）：\n${JSON.stringify(context)}`,
  }];
  if (summary) messages.push({ role: "system", content: `较早会话摘要（仅用于理解偏好和指代，不可作为行动事实）：\n${summary}` });
  messages.push(...history.slice(-20).map((item) => ({ role: item.role, content: item.content })));
  messages.push({ role: "user", content: question });
  return messages;
}

function buildRollingSummary(messages) {
  const older = messages.slice(0, Math.max(0, messages.length - 20));
  return older.map((item) => `${item.role === "user" ? "用户" : "教练"}：${item.content}`).join("\n").slice(-4000);
}

function cleanCoachText(value) {
  return String(value || "").replace(/^#{1,6}\s*/gm, "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}

function firstCoachSummary(answer) {
  const lines = String(answer || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const firstSentence = lines.find((line) => !/^#{1,6}\s|^\s*(?:\d{1,2}[\.、)]|[-*])\s*/.test(line));
  return cleanCoachText(firstSentence || lines[0] || answer).slice(0, 180);
}

function answerSections(answer) {
  const lines = String(answer || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const sections = [];
  lines.forEach((line) => {
    const numbered = line.match(/^\s*(\d{1,2})[\.、)]\s*(.+)$/);
    if (!numbered) return;
    const content = cleanCoachText(numbered[2]);
    const separator = content.search(/[：:，,。]/);
    const title = (separator > 0 ? content.slice(0, separator) : content).slice(0, 28);
    const detail = (separator > 0 ? content.slice(separator + 1) : "").trim().slice(0, 140);
    sections.push({ index: String(sections.length + 1).padStart(2, "0"), title, detail });
  });
  return sections.slice(0, 4);
}

function scopedCoachTasks(context) {
  const selected = context && context.selectedDate && Array.isArray(context.selectedDate.tasks) ? context.selectedDate.tasks : [];
  const recent = context && context.recent && Array.isArray(context.recent.tasks) ? context.recent.tasks : [];
  const unique = new Map();
  selected.concat(recent).forEach((item) => unique.set(String(item.id || `${item.currentDate}:${item.title}`), item));
  const tasks = Array.from(unique.values());
  if (!context || context.scope === "overall") return tasks;
  if (context.scope === "day") return selected;
  const startDate = context.scope === "month"
    ? `${String(context.analysisDate).slice(0, 7)}-01`
    : new Date(Date.parse(`${context.analysisDate}T00:00:00Z`) - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return tasks.filter((item) => String(item.currentDate || "") >= startDate && String(item.currentDate || "") <= context.analysisDate);
}

function buildCoachPresentation(context, question, answer, actionProposal) {
  const text = String(question || "");
  const summary = firstCoachSummary(answer);
  const sections = answerSections(answer);
  const selectedTasks = context && context.selectedDate && Array.isArray(context.selectedDate.tasks) ? context.selectedDate.tasks : [];
  const visibleTasks = selectedTasks.filter((item) => item.status !== "skipped");
  const metricTasks = scopedCoachTasks(context).filter((item) => item.status !== "skipped");
  const useAggregate = context && context.scope === "overall" && context.aggregate;
  const metricTotal = useAggregate ? Math.max(0, Number(context.aggregate.total || 0) - Number(context.aggregate.skipped || 0)) : metricTasks.length;
  const completed = useAggregate ? Math.max(0, Number(context.aggregate.completed || 0)) : metricTasks.filter((item) => item.status === "completed").length;
  const actualMinutes = useAggregate ? Math.max(0, Number(context.aggregate.actualMinutes || 0)) : metricTasks.reduce((sum, item) => sum + Math.max(0, Number(item.actualMinutes || 0)), 0);
  const completionRate = metricTotal ? Math.round(completed / metricTotal * 100) : 0;
  const isPlan = /计划|安排|优先|先做|调整|拆解|下一步|怎么做/.test(text);
  const isMetric = /进度|完成|投入|数据|情况|表现|复盘|分析|判断|为什么/.test(text);
  const isTaskOverview = /(?:今天|今日).*(?:任务|行动)|(?:任务|行动).*(?:有哪些|有什么|哪些|列表)/.test(text);

  if (actionProposal && actionProposal.type === "needs_clarification") {
    const needsReminder = Array.isArray(actionProposal.requiredFields) && actionProposal.requiredFields.includes("reminderTime");
    return {
      kind: "clarification", eyebrow: "需要补充",
      title: needsReminder ? "提醒时间需要调整" : "还缺少一项信息",
      summary: cleanCoachText(answer).slice(0, 220), sections: [],
    };
  }

  if (isTaskOverview) {
    const taskRows = visibleTasks.slice(0, 8).map((item) => {
      const completedTask = item.status === "completed";
      const partialTask = item.status === "partially_completed";
      return {
        label: completedTask ? "已完成" : partialTask ? "进行中" : "待完成",
        title: String(item.title || "未命名行动").slice(0, 42),
        detail: completedTask && Number(item.actualMinutes || 0) > 0
          ? `实际 ${Number(item.actualMinutes)} 分钟 · 预计 ${Number(item.estimatedMinutes || 0)} 分钟`
          : `预计 ${Number(item.estimatedMinutes || 0)} 分钟${item.reminder && item.reminder.time ? ` · ${item.reminder.time} 提醒` : ""}`,
        tone: completedTask ? "success" : partialTask ? "positive" : "neutral",
      };
    });
    const pendingCount = visibleTasks.filter((item) => item.status !== "completed").length;
    return {
      kind: "tasks", eyebrow: "今日行动", title: `共 ${visibleTasks.length} 项行动`,
      summary: `已完成 ${visibleTasks.length - pendingCount} 项，待继续 ${pendingCount} 项${visibleTasks.length > taskRows.length ? `，下方展示前 ${taskRows.length} 项` : ""}。`,
      priorities: taskRows, sections: [],
    };
  }

  if (isPlan) {
    const priorities = visibleTasks.filter((item) => item.status !== "completed").slice(0, 3).map((item, index) => ({
      label: index === 0 ? "优先处理" : index === 1 ? "随后推进" : "灵活安排",
      title: String(item.title || "未命名行动").slice(0, 42),
      detail: `预计 ${Math.max(0, Number(item.estimatedMinutes || 0))} 分钟${item.reminder && item.reminder.time ? ` · ${item.reminder.time} 提醒` : ""}`,
      tone: index === 0 ? "warning" : index === 1 ? "positive" : "neutral",
    }));
    if (priorities.length) return { kind: "priorities", eyebrow: "接下来的计划", title: "按优先级推进", summary, priorities, sections };
  }

  if (isMetric && metricTotal) {
    return {
      kind: "metrics", eyebrow: "判断依据", title: "行动数据概览", summary,
      metrics: [
        { label: "完成行动", value: `${completed}/${metricTotal}`, progress: completionRate },
        { label: "实际投入", value: String(actualMinutes), unit: "分钟" },
        { label: "完成率", value: String(completionRate), unit: "%", progress: completionRate },
      ],
      sections,
    };
  }
  return { kind: "summary", eyebrow: "教练回复", title: sections.length ? "要点整理" : "直接回答", summary: sections.length ? summary : cleanCoachText(answer).slice(0, 600), sections };
}

async function saveConversation(openid, conversationId, summary, lastMessageAtMs) {
  const existing = await db.collection("coach_conversations").doc(conversationId).get().catch(() => null);
  const now = db.serverDate();
  await db.collection("coach_conversations").doc(conversationId).set({ data: {
    _openid: openid, schemaVersion: CONVERSATION_SCHEMA_VERSION, summary,
    createdAt: existing && existing.data && existing.data.createdAt || now,
    updatedAt: now, lastMessageAtMs, expireAt: new Date(Date.now() + RETENTION_MS),
  } });
}

async function saveMessage(openid, data) {
  await db.collection("coach_messages").doc(data.id).set({ data: {
    _openid: openid, conversationId: data.conversationId, role: data.role, content: data.content,
    sentAt: data.sentAt, sentAtMs: data.sentAtMs, scope: data.scope, analysisDate: data.analysisDate,
    goalId: data.goalId || "", presentation: data.presentation || null, actionProposal: data.actionProposal || null,
    contextVersion: data.contextVersion || "", expireAt: new Date(Date.now() + RETENTION_MS), createdAt: db.serverDate(),
  } });
}

function commandSnapshot(context, requestedGoalId) {
  const goals = context.goals || [];
  const goalId = requestedGoalId && requestedGoalId !== "overall" ? requestedGoalId : "overall";
  return {
    goalId, goals, goal: goals.find((item) => item.id === requestedGoalId) || goals[0] || null,
    tasks: [...(context.selectedDate && context.selectedDate.tasks || []), ...(context.recent && context.recent.tasks || [])],
    checkins: [...(context.selectedDate && context.selectedDate.checkins || []), ...(context.recent && context.recent.checkins || [])],
    referenceDate: context.analysisDate, range: context.scope,
  };
}

async function askProgressCoach(openid, event = {}, generator = generateMessagesWithMetadata, dependencies = {}) {
  const question = typeof event.question === "string" ? event.question : "";
  if (!question.trim() || question.length > 1000) fail("PROGRESS_SNAPSHOT_INVALID", "问题需为 1～1000 个字符。");
  const scope = normalizeScope(event.scope || event.range);
  const analysisDate = normalizeDate(event.analysisDate);
  const goalId = String(event.goalId || (scope === "overall" ? "overall" : ""));
  const sentAt = typeof event.messageSentAt === "string" && !Number.isNaN(Date.parse(event.messageSentAt)) ? event.messageSentAt : new Date().toISOString();
  const sentAtMs = Date.parse(sentAt);
  if (sentAtMs > Date.now() + 5000 || Math.abs(Date.now() - sentAtMs) > 5 * 60 * 1000) fail("PROGRESS_SNAPSHOT_INVALID", "消息发送时间无效，请重新发送。");
  const conversationId = await resolveConversationId(openid, event.conversationId, sentAt);
  const questionHash = stableId("coach_question", question);
  const userMessageId = stableId("coach_message", `${conversationId}:${sentAt}:${questionHash}:user`);
  const assistantMessageId = stableId("coach_message", `${conversationId}:${sentAt}:${questionHash}:assistant`);
  const existingAnswer = await db.collection("coach_messages").doc(assistantMessageId).get().catch(() => null);
  if (existingAnswer && existingAnswer.data && existingAnswer.data._openid === openid) {
    return {
      answer: existingAnswer.data.content, conversationId, userMessageId, assistantMessageId,
      generatedAt: existingAnswer.data.sentAt, contextVersion: existingAnswer.data.contextVersion || CONTEXT_SCHEMA_VERSION,
      ...(existingAnswer.data.presentation ? { presentation: existingAnswer.data.presentation } : {}),
      ...(existingAnswer.data.actionProposal ? { actionProposal: existingAnswer.data.actionProposal } : {}),
    };
  }
  const conversation = await db.collection("coach_conversations").doc(conversationId).get().catch(() => null);
  const previousSummary = conversation && conversation.data && conversation.data._openid === openid ? String(conversation.data.summary || "") : "";
  const history = await recentMessages(openid, conversationId, 50);
  await saveMessage(openid, { id: userMessageId, conversationId, role: "user", content: question, sentAt, sentAtMs, scope, analysisDate, goalId });

  const contextBuilder = dependencies.buildUnifiedCoachContext || buildUnifiedCoachContext;
  const context = await contextBuilder(openid, scope, analysisDate, question);
  const commandBuilder = dependencies.buildCoachCommand || buildCoachCommand;
  const commandResult = await commandBuilder(openid, commandSnapshot(context, goalId), question, history, sentAt, analysisDate);
  let answer;
  let actionProposal;
  if (commandResult) {
    answer = commandResult.answer;
    actionProposal = commandResult.actionProposal;
  } else {
    const messages = buildModelMessages(context, history, question, previousSummary);
    let result;
    try {
      result = await generator(messages, 30000, { action: "askProgressCoach", promptVersion: "coach-messages-2026-07-18.1", schemaVersion: CONTEXT_SCHEMA_VERSION });
    } catch (error) {
      if (["CONTENT_SECURITY_REJECTED", "CONTENT_SECURITY_UNAVAILABLE"].includes(error && error.code)) throw error;
      fail("AI_COACH_FAILED", "AI 成长教练暂时无法回复，请稍后重试。");
    }
    answer = result && result.text;
    if (typeof answer !== "string" || !answer.trim()) fail("AI_COACH_INVALID", "AI 成长教练没有返回有效内容，请重试。");
  }
  const generatedAt = new Date().toISOString();
  const presentation = buildCoachPresentation(context, question, answer, actionProposal);
  await saveMessage(openid, {
    id: assistantMessageId, conversationId, role: "assistant", content: answer, sentAt: generatedAt,
    sentAtMs: Math.max(Date.parse(generatedAt), sentAtMs + 1), scope, analysisDate, goalId, presentation, actionProposal, contextVersion: CONTEXT_SCHEMA_VERSION,
  });
  const updatedHistory = history.concat([{ role: "user", content: question }, { role: "assistant", content: answer }]);
  const summary = `${previousSummary}\n${buildRollingSummary(updatedHistory)}`.trim().slice(-4000);
  await saveConversation(openid, conversationId, summary, Date.parse(generatedAt));
  return {
    answer, conversationId, userMessageId, assistantMessageId, generatedAt,
    contextVersion: CONTEXT_SCHEMA_VERSION, presentation, ...(actionProposal ? { actionProposal } : {}),
  };
}

module.exports = {
  CONVERSATION_SCHEMA_VERSION, RETENTION_MS, askProgressCoach, buildModelMessages,
  answerSections, buildCoachPresentation, buildRollingSummary, conversationIdFor, getCoachConversation, normalizeScope, publicMessage, resolveConversationId,
};
