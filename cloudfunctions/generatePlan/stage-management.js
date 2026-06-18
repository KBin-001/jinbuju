const cloud = require("wx-server-sdk");
const { addBusinessDays, formatBusinessDate, formatReviewEligibleDate } = require("./date");
const { stableId } = require("./repository");
const { generateTrustedStagePlan } = require("./stage-generation");
const { validateStageRequestId } = require("./stage-validate");

const db = cloud.database();
const DIFFICULTIES = ["easy", "suitable", "hard"];
const PREFERENCES = ["lighter", "same", "stronger", "change_focus"];

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function validateId(value, label) {
  if (typeof value !== "string" || !value.trim() || value.length > 100) {
    fail("INVALID_ARGUMENT", `${label}无效。`);
  }
  return value.trim();
}

function compactText(value, maximum) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, maximum);
}

function resolveGoalTitle(goal, stage) {
  const candidates = [
    goal.goalTitle,
    goal.title,
    stage.goalTitle,
    stage.stageTitle,
    stage.title,
    stage.weeklyGoal,
    goal.desiredResult,
  ]
    .map((value) => compactText(value, 80))
    .filter(Boolean);
  const validTitle = candidates.find((value) => value.length >= 2 && value.length <= 30);
  if (validTitle) return validTitle;
  const longTitle = candidates.find((value) => value.length > 30);
  return longTitle ? longTitle.slice(0, 30) : "我的成长目标";
}

function resolveDesiredResult(goal, goalTitle) {
  const desiredResult = compactText(goal.desiredResult, 200);
  if (desiredResult.length >= 5) return desiredResult;
  return `围绕“${goalTitle}”完成一个可验证的行动阶段`;
}

function summarizePreviousPlan(stage, tasks) {
  const actionThemes = Array.from(
    new Set(tasks.map((task) => compactText(task.theme || task.dayTitle, 40)).filter(Boolean)),
  ).slice(0, 10);
  const actionSamples = tasks
    .map((task) => compactText(task.title, 50))
    .filter(Boolean)
    .slice(0, 12);
  const completedActionSamples = tasks
    .filter((task) => task.status === "completed")
    .map((task) => compactText(task.title, 50))
    .filter(Boolean)
    .slice(0, 12);
  const skippedActionSamples = tasks
    .filter((task) => task.status === "skipped")
    .map((task) => compactText(task.title, 50))
    .filter(Boolean)
    .slice(0, 12);
  return {
    stageTitle: compactText(stage.stageTitle || stage.title, 40),
    stageFocus: compactText(stage.focus || stage.weeklyGoal, 80),
    actionThemes,
    actionSamples,
    completedActionSamples,
    skippedActionSamples,
  };
}

async function getPreviewRecord(openid, previewId) {
  const result = await db
    .collection("stage_previews")
    .doc(validateId(previewId, "预览 ID"))
    .get()
    .catch(() => null);
  const preview = result && result.data;
  if (!preview || preview._openid !== openid) {
    fail("STAGE_PREVIEW_NOT_FOUND", "阶段预览不存在。");
  }
  const expiresAt =
    preview.expiresAt instanceof Date
      ? preview.expiresAt.getTime()
      : new Date(preview.expiresAt || 0).getTime();
  if (
    preview.status === "preview" &&
    preview.expiresAt &&
    Number.isFinite(expiresAt) &&
    expiresAt <= Date.now()
  ) {
    fail("STAGE_PREVIEW_NOT_FOUND", "阶段预览已过期。");
  }
  return preview;
}

function publicPreview(preview) {
  const generatedBy = ["ai", "ai_repaired", "template", "regenerated_ai", "regenerated_ai_repaired"].includes(preview.generatedBy)
    ? preview.generatedBy
    : "template";
  return {
    previewId: String(preview._id),
    requestId: String(preview.requestId),
    stageNumber: Number(preview.stageNumber),
    previousStageId: String(preview.previousStageId || ""),
    generatedBy,
    generationSource: generatedBy,
    stagePlan: preview.stagePlan,
    reused: true,
    revision: Number(preview.revision || 1),
    editedSlotIds: Array.isArray(preview.editedSlotIds) ? preview.editedSlotIds : [],
    optimizationStatus: preview.optimizationStatus || "idle",
    optimizationAttempts: Number(preview.optimizationAttempts || 0),
    fallbackReason: preview.fallbackReason || "",
    currentVersion: Number(preview.currentVersion || 1),
    regenerationCount: Number(preview.regenerationCount || 0),
    maxRegenerationCount: Number(preview.maxRegenerationCount || 2),
    generationStatus: preview.generationStatus || "ready",
    lastFeedback: preview.lastFeedback || null,
  };
}

async function getStagePreview(openid, event) {
  return publicPreview(await getPreviewRecord(openid, event && event.previewId));
}

async function confirmStagePlan(openid, event) {
  const preview = await getPreviewRecord(openid, event && event.previewId);
  if (preview.status === "confirmed" && preview.goalId && preview.stageId) {
    return {
      goalId: preview.goalId,
      stageId: preview.stageId,
      confirmed: false,
    };
  }
  if (preview.status !== "preview") {
    fail("STAGE_ALREADY_CONFIRMED", "阶段已经确认。");
  }
  const clientVersion = event && event.version !== undefined ? Number(event.version) : undefined;
  const currentVersion = Number(preview.currentVersion || 1);
  if (clientVersion !== undefined && clientVersion !== currentVersion) {
    fail("PREVIEW_VERSION_MISMATCH", "方案版本不匹配，请刷新后重试。");
  }
  if (
    event &&
    event.revision !== undefined &&
    Number(event.revision) !== Number(preview.revision || 1)
  ) {
    fail("STAGE_PREVIEW_CONFLICT", "计划已发生变化，请刷新后重试。");
  }

  const goalId =
    preview.stageNumber === 1
      ? stableId("goal", `${openid}:${preview.requestId}`)
      : String(preview.goalId || "");
  const stageId = stableId("stage", `${openid}:${preview.requestId}`);
  const userId = stableId("user", openid);
  const input = preview.generationInput;
  const stagePlan = preview.stagePlan;
  const startDate = formatBusinessDate();
  const endDate = addBusinessDays(startDate, stagePlan.stage.durationDays - 1);

  return db.runTransaction(async (transaction) => {
    const currentPreviewResult = await transaction
      .collection("stage_previews")
      .doc(preview._id)
      .get()
      .catch(() => null);
    const currentPreview = currentPreviewResult && currentPreviewResult.data;
    if (!currentPreview || currentPreview._openid !== openid) {
      fail("STAGE_PREVIEW_NOT_FOUND", "阶段预览不存在。");
    }
    if (currentPreview.status !== "preview") {
      if (currentPreview.status === "confirmed" && currentPreview.goalId && currentPreview.stageId) {
        return {
          goalId: currentPreview.goalId,
          stageId: currentPreview.stageId,
          confirmed: false,
        };
      }
      fail("STAGE_ALREADY_CONFIRMED", "阶段已经确认。");
    }
    const currentVersionInner = Number(currentPreview.currentVersion || 1);
    if (clientVersion !== undefined && clientVersion !== currentVersionInner) {
      fail("PREVIEW_VERSION_MISMATCH", "方案版本不匹配，请刷新后重试。");
    }
    if (
      event &&
      event.revision !== undefined &&
      Number(event.revision) !== Number(currentPreview.revision || 1)
    ) {
      fail("STAGE_PREVIEW_CONFLICT", "计划已发生变化，请刷新后重试。");
    }
    const existingStage = await transaction
      .collection("plans")
      .doc(stageId)
      .get()
      .catch(() => null);
    if (existingStage && existingStage.data) {
      return { goalId, stageId, confirmed: false };
    }

    const now = db.serverDate();
    let dailyReminderTime = "21:00";
    if (preview.stageNumber === 1) {
      const activeGoals = await transaction
        .collection("goals")
        .where({ _openid: openid, status: "active" })
        .limit(1)
        .get();
      if (activeGoals.data.length) {
        fail("ACTIVE_GOAL_ALREADY_EXISTS", "你已经有一个进行中的长期目标。");
      }
      await transaction.collection("goals").doc(goalId).set({
        data: {
          _openid: openid,
          title: input.goalTitle,
          goalTitle: input.goalTitle,
          category: input.category,
          desiredResult: input.desiredResult,
          dailyMinutes: input.dailyMinutes,
          targetDuration: input.targetDuration,
          templateId: input.templateId || "",
          currentLevel: input.currentLevel || "zero",
          weeklyDays: Number(input.weeklyDays || 7),
          intensity: input.intensity || "normal",
          durationDays: Number(input.durationDays || stagePlan.stage.durationDays),
          deadline: input.deadline || "",
          status: "active",
          currentStageId: stageId,
          requestId: preview.requestId,
          createdAt: now,
          updatedAt: now,
        },
      });
    } else {
      const goalResult = await transaction
        .collection("goals")
        .doc(goalId)
        .get()
        .catch(() => null);
      if (!goalResult || !goalResult.data || goalResult.data._openid !== openid) {
        fail("GOAL_NOT_FOUND", "长期目标不存在。");
      }
      const previousStageId = String(preview.previousStageId || "");
      if (!previousStageId || goalResult.data.currentStageId !== previousStageId) {
        fail("STAGE_PREVIEW_NOT_FOUND", "当前阶段已变化，请重新生成下一阶段。");
      }
      const previousStageResult = await transaction
        .collection("plans")
        .doc(previousStageId)
        .get()
        .catch(() => null);
      const previousStage = previousStageResult && previousStageResult.data;
      if (
        !previousStage ||
        previousStage._openid !== openid ||
        previousStage.status !== "reviewing"
      ) {
        fail("STAGE_REVIEW_NOT_ALLOWED", "请先完成当前阶段复盘。");
      }
      dailyReminderTime = String(previousStage.dailyReminderTime || "21:00");
      await transaction.collection("plans").doc(previousStageId).update({
        data: { status: "completed", completedAt: now, updatedAt: now },
      });
      await transaction.collection("goals").doc(goalId).update({
        data: { currentStageId: stageId, updatedAt: now },
      });
    }

    await transaction.collection("plans").doc(stageId).set({
      data: {
        _openid: openid,
        goalId,
        stageNumber: preview.stageNumber,
        stageTitle: stagePlan.stage.title,
        title: stagePlan.stage.title,
        summary: stagePlan.stage.summary,
        focus: stagePlan.stage.focus,
        weeklyGoal: stagePlan.stage.focus,
        durationDays: stagePlan.stage.durationDays,
        totalDays: stagePlan.stage.durationDays,
        status: "active",
        generatedBy: preview.generatedBy,
        source: preview.generatedBy === "template" ? "fallback" : "ai",
        startDate,
        endDate,
        dailyReminderTime,
        requestId: preview.requestId,
        previousStageId: preview.previousStageId || "",
        createdAt: now,
        updatedAt: now,
      },
    });

    for (const day of stagePlan.days) {
      for (let index = 0; index < day.actions.length; index += 1) {
        const action = day.actions[index];
        const taskId = stableId(
          "action",
          `${openid}:${preview.requestId}:${day.dayIndex}:${index}`,
        );
        await transaction.collection("tasks").doc(taskId).set({
          data: {
            _openid: openid,
            goalId,
            stageId,
            planId: stageId,
            dayIndex: day.dayIndex,
            day: day.dayIndex,
            scheduledDate: addBusinessDays(startDate, day.dayIndex - 1),
            taskDate: addBusinessDays(startDate, day.dayIndex - 1),
            theme: day.theme,
            dayTitle: day.theme,
            title: action.title,
            description: action.description,
            actionType: action.actionType || "",
            completionCriteria: action.completionCriteria || "",
            requiredResources: Array.isArray(action.requiredResources) ? action.requiredResources : [],
            safetyNotes: Array.isArray(action.safetyNotes) ? action.safetyNotes : [],
            estimatedMinutes: action.estimatedMinutes,
            slotId: action.slotId || `slot_day_${day.dayIndex}_${index + 1}`,
            order: index + 1,
            status: "pending",
            createdAt: now,
            updatedAt: now,
          },
        });
      }
    }

    const userResult = await transaction
      .collection("users")
      .doc(userId)
      .get()
      .catch(() => null);
    if (userResult && userResult.data) {
      await transaction.collection("users").doc(userId).update({
        data: { currentGoalId: goalId, updatedAt: now },
      });
    } else {
      await transaction.collection("users").doc(userId).set({
        data: { _openid: openid, currentGoalId: goalId, createdAt: now, updatedAt: now },
      });
    }
    await transaction.collection("stage_previews").doc(preview._id).update({
      data: {
        status: "confirmed",
        goalId,
        stageId,
        confirmedVersion: currentVersion,
        confirmedAt: now,
        updatedAt: now,
      },
    });
    return { goalId, stageId, confirmed: true };
  });
}

async function getOwnedStage(openid, stageId) {
  const result = await db.collection("plans").doc(validateId(stageId, "阶段 ID")).get().catch(() => null);
  const stage = result && result.data;
  if (!stage || stage._openid !== openid) fail("STAGE_NOT_FOUND", "行动阶段不存在。");
  return stage;
}

async function buildReviewData(openid, stage) {
  const [tasksResult, checkinsResult, reviewResult] = await Promise.all([
    db.collection("tasks").where({ _openid: openid, planId: stage._id }).limit(1000).get(),
    db.collection("checkins").where({ _openid: openid, planId: stage._id }).limit(1000).get(),
    db.collection("stage_reviews").doc(stableId("stage_review", `${openid}:${stage._id}`)).get().catch(() => null),
  ]);
  const tasks = tasksResult.data || [];
  const checkins = checkinsResult.data || [];
  const review = reviewResult && reviewResult.data;
  let reviewed = Boolean(review);
  let previewId = String((review && review.previewId) || "");
  if (previewId) {
    const previewResult = await db.collection("stage_previews").doc(previewId).get().catch(() => null);
    const preview = previewResult && previewResult.data;
    if (preview && preview._openid === openid && preview.generatedBy === "template" && preview.status === "preview") {
      reviewed = false;
    }
  }

  // --- 基础统计 ---
  const completedActionCount = tasks.filter((task) => task.status === "completed").length;
  const completionRate = tasks.length ? Math.round((completedActionCount / tasks.length) * 100) : 0;
  const actionDays = new Set(checkins.map((item) => item.businessDate)).size;
  const streakDays = Math.max(0, ...checkins.map((item) => Number(item.streakDays || 0)));

  // --- taskId → task 映射 ---
  const taskMap = new Map(tasks.map((t) => [String(t._id), t]));

  // --- 日均实际分钟数 ---
  let totalActualMinutes = 0;
  let actualDaysWithTasks = 0;
  for (const checkin of checkins) {
    if (!Array.isArray(checkin.taskResults)) continue;
    const dayMinutes = checkin.taskResults
      .filter((r) => r.status === "completed" || r.status === "partially_completed")
      .reduce((sum, r) => {
        const task = taskMap.get(String(r.taskId));
        const minutes = task ? Number(task.estimatedMinutes || 0) : 0;
        return sum + (r.status === "partially_completed" ? Math.round(minutes * 0.5) : minutes);
      }, 0);
    if (dayMinutes > 0) {
      totalActualMinutes += dayMinutes;
      actualDaysWithTasks += 1;
    }
  }
  const averageDailyMinutes = actualDaysWithTasks ? Math.round(totalActualMinutes / actualDaysWithTasks) : 0;

  // --- 计划日均分钟数 ---
  const activeDaySet = new Set();
  tasks.forEach((t) => activeDaySet.add(t.dayIndex));
  const activeDayCount = activeDaySet.size || 1;
  const plannedTotalMinutes = tasks.reduce((sum, t) => sum + Number(t.estimatedMinutes || 0), 0);
  const plannedDailyMinutes = Math.round(plannedTotalMinutes / activeDayCount);

  // --- 行动类型分析 ---
  const completedActionTypesSet = new Set();
  const skippedByActionType = {};
  const actionTypeTotals = {};
  const actionTypeCompleted = {};

  for (const task of tasks) {
    const type = task.actionType || "practice";
    actionTypeTotals[type] = (actionTypeTotals[type] || 0) + 1;
    if (task.status === "completed") {
      completedActionTypesSet.add(type);
      actionTypeCompleted[type] = (actionTypeCompleted[type] || 0) + 1;
    }
    if (task.status === "skipped") {
      skippedByActionType[type] = (skippedByActionType[type] || 0) + 1;
    }
  }

  const completedActionTypes = Array.from(completedActionTypesSet);
  const frequentlySkippedActionTypes = Object.entries(skippedByActionType)
    .filter(([type, count]) => {
      const total = actionTypeTotals[type] || 1;
      return count >= 2 || count / total >= 0.3;
    })
    .map(([type]) => type);

  const actionTypeCompletionRates = {};
  for (const [type, total] of Object.entries(actionTypeTotals)) {
    const completed = actionTypeCompleted[type] || 0;
    actionTypeCompletionRates[type] = Math.round((completed / total) * 100);
  }

  // --- 跳过原因统计 ---
  const skipReasons = {};
  for (const checkin of checkins) {
    if (checkin.skipReason) {
      skipReasons[checkin.skipReason] = (skipReasons[checkin.skipReason] || 0) + 1;
    }
  }

  // --- 实际资源使用 ---
  const actualResourceSet = new Set();
  for (const task of tasks) {
    if (task.status === "completed" && Array.isArray(task.requiredResources)) {
      task.requiredResources.forEach((r) => actualResourceSet.add(r));
    }
  }
  const actualResourceUsage = Array.from(actualResourceSet);

  // --- 打卡感受分布 ---
  const feelingDistribution = {};
  for (const checkin of checkins) {
    if (checkin.feeling) {
      feelingDistribution[checkin.feeling] = (feelingDistribution[checkin.feeling] || 0) + 1;
    }
  }

  // --- 组装执行摘要 ---
  const executionSummary = {
    completionRate,
    actionDays,
    streakDays,
    completedActionCount,
    totalActionCount: tasks.length,
    averageDailyMinutes,
    plannedDailyMinutes,
    completedActionTypes,
    frequentlySkippedActionTypes,
    skipReasons,
    actualResourceUsage,
    userDifficulty: "",
    actionTypeCompletionRates,
    feelingDistribution,
  };
  const previousPlanSummary = summarizePreviousPlan(stage, tasks);

  return {
    stageId: String(stage._id),
    completionRate,
    actionDays,
    streakDays,
    completedActionCount,
    totalActionCount: tasks.length,
    canReview: formatReviewEligibleDate() >= stage.endDate,
    reviewed,
    previewId,
    executionSummary,
    previousPlanSummary,
  };
}

async function getStageReview(openid, event) {
  const stage = await getOwnedStage(openid, event && event.stageId);
  return buildReviewData(openid, stage);
}

async function submitStageReview(openid, event) {
  const stage = await getOwnedStage(openid, event && event.stageId);
  const data = await buildReviewData(openid, stage);
  if (!data.canReview) fail("STAGE_REVIEW_NOT_ALLOWED", "当前阶段结束后才可以复盘。");
  if (data.reviewed) {
    if (data.previewId) {
      return getStagePreview(openid, { previewId: data.previewId });
    }
    fail("STAGE_REVIEW_ALREADY_EXISTS", "当前阶段已经完成复盘。");
  }
  const difficulty = String(event.difficulty || "");
  const nextPreference = String(event.nextPreference || "");
  const focusAdjustment = String(event.focusAdjustment || "").trim();
  if (!DIFFICULTIES.includes(difficulty) || !PREFERENCES.includes(nextPreference)) {
    fail("INVALID_ARGUMENT", "复盘选项无效。");
  }
  if (
    nextPreference === "change_focus" &&
    (focusAdjustment.length < 2 || focusAdjustment.length > 200)
  ) {
    fail("INVALID_ARGUMENT", "重点调整需为 2～200 个字符。");
  }
  const goalResult = await db.collection("goals").doc(stage.goalId).get().catch(() => null);
  const goal = goalResult && goalResult.data;
  if (
    !goal ||
    goal._openid !== openid ||
    goal.status !== "active" ||
    goal.currentStageId !== stage._id ||
    !["active", "reviewing"].includes(stage.status)
  ) {
    fail("GOAL_NOT_FOUND", "长期目标不存在。");
  }
  const reviewId = stableId("stage_review", `${openid}:${stage._id}`);
  const requestId = validateStageRequestId(event.requestId);

  // 注入 userDifficulty 到执行摘要
  const executionSummary = data.executionSummary
    ? { ...data.executionSummary, userDifficulty: difficulty }
    : null;

  const resolvedGoalTitle = resolveGoalTitle(goal, stage);
  const resolvedDesiredResult = resolveDesiredResult(goal, resolvedGoalTitle);

  const result = await generateTrustedStagePlan(
    openid,
    { requestId, regenerate: false, forceFallback: event.forceFallback === true },
    {
      goalTitle: resolvedGoalTitle,
      category: goal.category || "other",
      desiredResult: resolvedDesiredResult,
      dailyMinutes: Number(goal.dailyMinutes || 30),
      targetDuration: goal.targetDuration || "long_term",
      templateId: goal.templateId || "",
      currentLevel: goal.currentLevel || "zero",
      weeklyDays: Number(goal.weeklyDays || 7),
      intensity: goal.intensity || "normal",
      deadline: goal.deadline || "",
      stageNumber: Number(stage.stageNumber || 1) + 1,
      durationDays: Number(stage.durationDays || stage.totalDays || 7),
      previousReview: {
        completionRate: data.completionRate,
        actionDays: data.actionDays,
        previousFocus: String(stage.focus || stage.weeklyGoal || stage.title || "建立行动节奏"),
        difficulty,
        nextPreference,
        focusAdjustment,
        executionSummary,
        previousPlanSummary: data.previousPlanSummary,
      },
    },
  );
  if (result.generatedBy === "template") {
    console.warn("submitStageReview returned template fallback", {
      action: "submitStageReview",
      stageId: stage._id,
      stageNumber: Number(stage.stageNumber || 1) + 1,
      fallbackReason: result.fallbackReason || "",
      hasFocusAdjustment: Boolean(focusAdjustment),
      hasPreviousPlanSummary: Boolean(data.previousPlanSummary),
    });
  }
  await db.collection("stage_previews").doc(result.previewId).update({
    data: {
      goalId: goal._id,
      previousStageId: stage._id,
      reviewId,
      updatedAt: db.serverDate(),
    },
  });
  await db.collection("stage_reviews").doc(reviewId).set({
    data: {
      _openid: openid,
      goalId: goal._id,
      stageId: stage._id,
      completionRate: data.completionRate,
      actionDays: data.actionDays,
      streakDays: data.streakDays,
      completedActionCount: data.completedActionCount,
      totalActionCount: data.totalActionCount,
      difficulty,
      nextPreference,
      focusAdjustment: nextPreference === "change_focus" ? focusAdjustment : "",
      executionSummary,
      previewId: result.previewId,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
    },
  });
  await db.collection("plans").doc(stage._id).update({
    data: { status: "reviewing", reviewedAt: db.serverDate(), updatedAt: db.serverDate() },
  });
  return result;
}

module.exports = {
  confirmStagePlan,
  getStagePreview,
  getStageReview,
  submitStageReview,
};
