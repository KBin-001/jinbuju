const crypto = require("crypto");
const cloud = require("wx-server-sdk");
const { formatBusinessDate } = require("./date");
const { getTeamActivityFeed, getTeamPage } = require("./team");

const db = cloud.database();
const CONTEXT_SCHEMA_VERSION = "coach-context-2026-07-18.1";
const MAX_OWNED_RECORDS = 2000;

function withoutDeleted(items) {
  return items.filter((item) => !item.deletedAt);
}

function publicTimestamp(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return "";
}

async function listOwned(collectionName, openid, limit = MAX_OWNED_RECORDS) {
  const output = [];
  for (let offset = 0; offset < limit; offset += 100) {
    const result = await db.collection(collectionName).where({ _openid: openid }).skip(offset).limit(Math.min(100, limit - offset)).get();
    const page = result.data || [];
    output.push(...page);
    if (page.length < 100) break;
  }
  return output;
}

function sanitizeGoal(goal) {
  return {
    id: String(goal.id || ""), title: String(goal.title || goal.goalTitle || "").slice(0, 80),
    category: String(goal.category || "custom"), status: String(goal.status || ""),
    createdAt: publicTimestamp(goal.createdAt), startedAt: publicTimestamp(goal.startedAt),
    deadline: String(goal.deadline || ""), updatedAt: publicTimestamp(goal.updatedAt),
  };
}

function sanitizeTask(task) {
  return {
    id: String(task.id || ""), goalId: String(task.goalId || ""), title: String(task.title || "").slice(0, 100),
    plannedDate: String(task.plannedDate || task.currentDate || ""), currentDate: String(task.currentDate || ""),
    status: String(task.status || "pending"), estimatedMinutes: Math.max(0, Number(task.estimatedMinutes || 0)),
    actualMinutes: Math.max(0, Number(task.actualMinutes || 0)), issueReason: String(task.issueReason || "").slice(0, 80),
    reflection: String(task.reflection || "").slice(0, 300), createdAt: publicTimestamp(task.createdAt), updatedAt: publicTimestamp(task.updatedAt),
    reminder: task.reminder ? { time: String(task.reminder.time || ""), status: String(task.reminder.status || "") } : null,
  };
}

function sanitizeCheckin(item) {
  return {
    id: String(item.id || ""), goalId: String(item.goalId || ""), businessDate: String(item.businessDate || ""),
    completedCount: Math.max(0, Number(item.completedCount || 0)), partialCount: Math.max(0, Number(item.partialCount || 0)),
    actualMinutes: Math.max(0, Number(item.actualMinutes || 0)), reflection: String(item.reflection || "").slice(0, 300),
  };
}

function sanitizeArchive(item) {
  return {
    id: String(item.id || ""), title: String(item.title || item.goalTitle || "").slice(0, 80), status: String(item.status || "archived"),
    archivedAt: publicTimestamp(item.archivedAt || item.updatedAt), summary: String(item.summary || item.reviewSummary || "").slice(0, 500),
    stats: item.stats ? {
      totalActions: Number(item.stats.totalActions || 0), completedActions: Number(item.stats.completedActions || 0),
      estimatedMinutes: Number(item.stats.estimatedMinutes || 0), actualMinutes: Number(item.stats.actualMinutes || 0),
      completionRate: Number(item.stats.completionRate || 0), totalDays: Number(item.stats.totalDays || 0),
      lastReviewSummary: String(item.stats.lastReviewSummary || "").slice(0, 500),
    } : null,
    recentActions: Array.isArray(item.actions) ? item.actions.slice(-10).map(sanitizeTask) : [],
  };
}

function sanitizeTeamPage(page) {
  if (!page || !page.team) return null;
  const members = Array.isArray(page.members) ? page.members : [];
  return {
    team: {
      name: String(page.team.name || "").slice(0, 40), announcement: String(page.team.announcement || "").slice(0, 200),
      memberCount: Math.max(0, Number(page.team.memberCount || members.length)), maxMembers: Math.max(0, Number(page.team.maxMembers || 50)),
    },
    dailyStats: page.dailyStats ? {
      date: String(page.dailyStats.date || ""), totalMembers: Number(page.dailyStats.totalMembers || 0),
      completedMembers: Number(page.dailyStats.completedMembers || 0), partialMembers: Number(page.dailyStats.partialMembers || 0),
      notStartedMembers: Number(page.dailyStats.notStartedMembers || 0), totalGrowthMinutes: Number(page.dailyStats.totalGrowthMinutes || 0),
      completionRate: Number(page.dailyStats.completionRate || 0),
    } : null,
    members: members.map((member) => ({
      name: String(member.nickname || "").slice(0, 40), rank: Number(member.rank || 0), isSelf: member.isSelf === true,
      role: String(member.role || "member"), todayStatus: String(member.todayStatus || "not_started"),
      growthMinutes: Number(member.growthMinutes || 0), completionRate: Number(member.completionRate || 0),
      todayActionTitle: String(member.todayActionTitle || "").slice(0, 80),
      todayActionDetails: Array.isArray(member.todayActionDetails) ? member.todayActionDetails.map((task) => ({
        title: String(task.title || "").slice(0, 80), status: String(task.status || ""),
        estimatedMinutes: Number(task.estimatedMinutes || 0), actualMinutes: Number(task.actualMinutes || task.growthMinutes || 0),
      })) : [],
    })),
  };
}

function taskAggregate(tasks) {
  const completed = tasks.filter((item) => item.status === "completed");
  const dates = new Set(tasks.filter((item) => item.actualMinutes > 0 || item.status === "completed").map((item) => item.currentDate));
  return {
    total: tasks.length, completed: completed.length, partial: tasks.filter((item) => item.status === "partially_completed").length,
    skipped: tasks.filter((item) => item.status === "skipped").length,
    estimatedMinutes: tasks.reduce((sum, item) => sum + item.estimatedMinutes, 0),
    actualMinutes: tasks.reduce((sum, item) => sum + item.actualMinutes, 0), activeDays: dates.size,
  };
}

function latestSourceUpdate(groups) {
  return groups.flat().map((item) => publicTimestamp(item.serverUpdatedAt || item.updatedAt || item.createdAt || item.archivedAt)).filter(Boolean).sort().pop() || "";
}

async function buildUnifiedCoachContext(openid, scope, analysisDate, question, dependencies = {}) {
  const today = formatBusinessDate();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(analysisDate || "")) ? String(analysisDate) : today;
  const loader = dependencies.listOwned || listOwned;
  const teamLoader = dependencies.getTeamPage || getTeamPage;
  const activityLoader = dependencies.getTeamActivityFeed || getTeamActivityFeed;
  const [rawGoals, rawTasks, rawCheckins, rawArchives, rawAchievements, rawSparks, rawReviews, rawUser, rawTeam, rawTeamActivity, legacyGoals, legacyTasks, legacyCheckins, legacyPlans] = await Promise.all([
    loader("manual_goals", openid), loader("manual_tasks", openid), loader("manual_checkins", openid),
    loader("manual_archived_goals", openid, 500), loader("achievement_unlocks", openid, 500), loader("spark_checkins", openid, 500),
    loader("stage_reviews", openid, 200), loader("users", openid, 1), teamLoader(openid, { page: 1, pageSize: 50 }).catch(() => null),
    activityLoader(openid, { page: 1, pageSize: 20 }).catch(() => null), loader("goals", openid, 500), loader("tasks", openid),
    loader("checkins", openid, 500), loader("plans", openid, 200),
  ]);
  const goals = withoutDeleted(rawGoals).map(sanitizeGoal);
  const tasks = withoutDeleted(rawTasks).map(sanitizeTask).sort((a, b) => b.currentDate.localeCompare(a.currentDate) || b.updatedAt.localeCompare(a.updatedAt));
  const checkins = withoutDeleted(rawCheckins).map(sanitizeCheckin).sort((a, b) => b.businessDate.localeCompare(a.businessDate));
  const matchedTasks = tasks.filter((item) => item.currentDate === date);
  const recentTasks = tasks.filter((item) => item.currentDate !== date).slice(0, 120);
  const sourceUpdatedAt = latestSourceUpdate([rawGoals, rawTasks, rawCheckins, rawArchives, rawAchievements, rawSparks, rawReviews]);
  const context = {
    schemaVersion: CONTEXT_SCHEMA_VERSION, scope, analysisDate: date, businessDate: today, sourceUpdatedAt,
    partitions: {
      goals: goals.length, tasks: tasks.length, checkins: checkins.length, archives: rawArchives.length,
      achievements: rawAchievements.length, streakRecords: rawSparks.length, stageReviews: rawReviews.length,
      legacyGoals: legacyGoals.length, legacyTasks: legacyTasks.length, legacyCheckins: legacyCheckins.length, plans: legacyPlans.length,
      teamMembers: rawTeam && rawTeam.total || 0, teamActivities: rawTeamActivity && rawTeamActivity.total || 0,
    },
    profile: rawUser[0] ? {
      nickname: String(rawUser[0].nickname || "").slice(0, 40), currentStreakDays: Number(rawUser[0].currentStreakDays || 0),
      longestStreakDays: Number(rawUser[0].longestStreakDays || 0),
    } : null,
    goals, selectedDate: { tasks: matchedTasks, checkins: checkins.filter((item) => item.businessDate === date) },
    recent: { tasks: recentTasks, checkins: checkins.slice(0, 120) }, aggregate: taskAggregate(tasks),
    archives: withoutDeleted(rawArchives).slice(0, 50).map(sanitizeArchive),
    achievements: withoutDeleted(rawAchievements).slice(0, 100).map((item) => ({ achievementId: String(item.achievementId || item.id || ""), unlockedAt: publicTimestamp(item.unlockedAt || item.updatedAt) })),
    streaks: withoutDeleted(rawSparks).slice(0, 120).map((item) => ({ businessDate: String(item.businessDate || item.id || ""), checkedAt: publicTimestamp(item.checkedAt || item.updatedAt) })),
    stageReviews: withoutDeleted(rawReviews).slice(0, 40).map((item) => ({
      stageNumber: Number(item.stageNumber || 0), completionRate: Number(item.completionRate || 0), actionDays: Number(item.actionDays || 0),
      reviewSummary: String(item.reviewSummary || item.summary || "").slice(0, 500), updatedAt: publicTimestamp(item.updatedAt || item.createdAt),
    })),
    team: sanitizeTeamPage(rawTeam),
    teamActivities: rawTeamActivity && Array.isArray(rawTeamActivity.list) ? rawTeamActivity.list.slice(0, 20).map((item) => ({
      name: String(item.name || "").slice(0, 40), type: String(item.type || ""), actionText: String(item.actionText || "").slice(0, 100),
      detail: String(item.detail || "").slice(0, 120), growthMinutes: Number(item.growthMinutes || 0),
      actionCount: Number(item.actionCount || 0), timeText: String(item.timeText || ""),
    })) : [],
    legacy: {
      goals: withoutDeleted(legacyGoals).slice(0, 100).map(sanitizeGoal), tasks: withoutDeleted(legacyTasks).slice(0, 120).map(sanitizeTask),
      checkins: withoutDeleted(legacyCheckins).slice(0, 120).map(sanitizeCheckin),
      plans: withoutDeleted(legacyPlans).slice(0, 50).map((item) => ({
        status: String(item.status || ""), summary: String(item.summary || "").slice(0, 500),
        weeklyGoal: String(item.weeklyGoal || "").slice(0, 300), updatedAt: publicTimestamp(item.updatedAt || item.createdAt),
      })),
    },
  };
  context.sourceHash = crypto.createHash("sha256").update(JSON.stringify(context)).digest("hex");
  console.info("coach context built", { schemaVersion: context.schemaVersion, scope, analysisDate: date, sourceUpdatedAt, sourceHashPrefix: context.sourceHash.slice(0, 12), partitions: context.partitions, questionLength: String(question || "").length });
  return context;
}

module.exports = { CONTEXT_SCHEMA_VERSION, buildUnifiedCoachContext, sanitizeTeamPage, taskAggregate };
