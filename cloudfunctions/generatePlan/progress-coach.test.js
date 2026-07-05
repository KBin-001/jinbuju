const assert = require("assert");
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const {
  analyzeSnapshot,
  answerSnapshot,
  buildPeriod,
  calculateMetrics,
  normalizeHistory,
  normalizeSnapshot,
} = require("./progress-coach");

function task(id, title, date, status, extra = {}) {
  return {
    id,
    goalId: "goal_test",
    title,
    plannedDate: extra.plannedDate || date,
    currentDate: date,
    status,
    estimatedMinutes: 30,
    actualMinutes: extra.actualMinutes || 0,
    issueReason: extra.issueReason || "",
    createdAt: "2026-06-20T08:00:00.000Z",
    updatedAt: "2026-06-30T08:00:00.000Z",
  };
}

function snapshot(title, tasks, range = "week") {
  return {
    goalId: "goal_test",
    range,
    goal: {
      id: "goal_test",
      title,
      category: "custom",
      status: "active",
      createdAt: "2026-06-01T08:00:00.000Z",
      startedAt: "2026-06-01T08:00:00.000Z",
    },
    tasks,
    checkins: [],
    sourceUpdatedAt: "2026-06-30T08:00:00.000Z",
  };
}

function modelResult(value) {
  return Promise.resolve({
    text: typeof value === "string" ? value : JSON.stringify(value),
    metadata: { generationDurationMs: 12 },
  });
}

async function run() {
  const overallSnapshot = normalizeSnapshot({
    scope: "overall",
    snapshot: {
      goals: [
        snapshot("准备考公", []).goal,
        { ...snapshot("英语四六级", []).goal, id: "goal_english", title: "英语四六级" },
      ],
      tasks: [
        task("task_civil", "看言语理解", "2026-06-30", "completed", { actualMinutes: 30 }),
        { ...task("task_english", "背30个单词", "2026-06-30", "completed", { actualMinutes: 20 }), goalId: "goal_english" },
      ],
      checkins: [],
    },
  });
  assert.strictEqual(overallSnapshot.goalId, "overall");
  assert.strictEqual(overallSnapshot.goals.length, 2);
  assert.strictEqual(overallSnapshot.tasks.length, 2);
  assert.deepStrictEqual(normalizeHistory([{ role: "user", content: "我刚才问了什么？" }]), [{ role: "user", content: "我刚才问了什么？" }]);

  let goalOnlyCalls = 0;
  const goalOnly = await analyzeSnapshot(snapshot("准备考公", []), "2026-06-30", async (prompt) => {
    goalOnlyCalls += 1;
    assert.match(prompt, /"dataLevel":"goal_only"/);
    return modelResult({
      summary: "当前暂无行动记录，因此还不能判断真实执行节奏；这次只能结合准备考公这一目标，给出低压力的起步观察。",
      rhythmDiagnosis: ["目前没有行动数据可以判断完成规律。"],
      nextSuggestions: ["先手动记录一个容易开始的小行动，再观察实际投入。"],
      evidence: [{ text: "当前目标下尚无行动和打卡记录。", taskIds: [], dates: [] }],
    });
  });
  assert.strictEqual(goalOnly.status, "success");
  assert.strictEqual(goalOnly.dataLevel, "goal_only");
  assert.strictEqual(goalOnlyCalls, 1);

  let sparseCalls = 0;
  const sparse = await analyzeSnapshot(
    snapshot("准备考公", [task("task_1", "看言语理解", "2026-06-30", "completed", { actualMinutes: 30 })]),
    "2026-06-30",
    async (prompt) => {
      sparseCalls += 1;
      assert.match(prompt, /"dataLevel":"sparse"/);
      return modelResult({
        summary: "目前只有一次言语理解行动记录，分析依据仍然有限；可以确认已经开始投入，但还不能判断稳定节奏。",
        rhythmDiagnosis: ["当前只有一天记录，暂时无法判断持续规律。"],
        nextSuggestions: ["继续记录下一次真实行动，再比较投入和完成情况。"],
        evidence: [{ text: "已完成一次言语理解行动。", taskIds: ["task_1"], dates: ["2026-06-30"] }],
      });
    },
  );
  assert.strictEqual(sparse.status, "success");
  assert.strictEqual(sparse.dataLevel, "sparse");
  assert.strictEqual(sparseCalls, 1);

  const civilTasks = [
    task("task_verbal", "看言语理解", "2026-06-29", "completed", { actualMinutes: 35 }),
    task("task_logic", "做逻辑推理题", "2026-06-30", "completed", { actualMinutes: 40 }),
    task("task_review", "晚上复盘错题", "2026-06-30", "pending", { plannedDate: "2026-06-28" }),
  ];
  let civilPrompt = "";
  const civil = await analyzeSnapshot(snapshot("考公", civilTasks), "2026-06-30", async (prompt) => {
    civilPrompt = prompt;
    return modelResult({
      summary: "最近主要完成了言语理解和逻辑推理训练，错题复盘从原计划日期顺延后仍待继续，当前节奏有练习但复盘收尾偏弱。",
      rhythmDiagnosis: ["言语和逻辑推理均有实际投入，错题复盘更容易顺延。"],
      nextSuggestions: ["下周把晚上复盘错题拆成一次二十分钟的轻量行动。"],
      evidence: [{ text: "复盘任务发生顺延。", taskIds: ["task_review"], dates: ["2026-06-30"] }],
    });
  });
  assert.strictEqual(civil.status, "success");
  assert.match(civilPrompt, /看言语理解/);
  assert.match(civilPrompt, /做逻辑推理题/);
  assert.match(civilPrompt, /晚上复盘错题/);
  assert.strictEqual(civil.metrics.rescheduled, 1);

  const englishTasks = [
    task("task_words", "背30个单词", "2026-06-28", "completed", { actualMinutes: 20 }),
    task("task_listening", "听力练习", "2026-06-29", "partially_completed", { actualMinutes: 25 }),
    task("task_errors", "整理错题", "2026-06-30", "completed", { actualMinutes: 20 }),
  ];
  let englishPrompt = "";
  const english = await analyzeSnapshot(snapshot("英语四六级", englishTasks), "2026-06-30", async (prompt) => {
    englishPrompt = prompt;
    return modelResult({
      summary: "最近完成了单词和错题整理，听力练习只完成了一部分，说明词汇与整理环节较稳，听力仍需要更小的完成单位。",
      rhythmDiagnosis: ["听力练习出现部分完成，单词和错题整理已经形成记录。"],
      nextSuggestions: ["下一轮先保留已有三类行动，把听力练习缩短后观察完成情况。"],
      evidence: [{ text: "听力练习为部分完成。", taskIds: ["task_listening"], dates: ["2026-06-29"] }],
    });
  });
  assert.strictEqual(english.status, "success");
  assert.match(englishPrompt, /背30个单词/);
  assert.match(englishPrompt, /听力练习/);
  assert.match(englishPrompt, /整理错题/);

  let questionPrompt = "";
  const answer = await answerSnapshot(snapshot("英语四六级", englishTasks), "我下周应该怎么安排更稳？", "2026-06-30", async (prompt) => {
    questionPrompt = prompt;
    assert.match(prompt, /上次你建议我先缩短听力练习/);
    return modelResult({
      answer: "最近单词和错题整理已经完成，听力练习只完成一部分。下周可以保留这三类行动，但先缩短单次听力练习，避免同时增加新任务。",
      mode: "compact",
      summary: "词汇与错题推进稳定，听力仍需缩小任务",
      statKeys: ["completedActions", "totalMinutes", "completionRate"],
      insights: ["听力练习只完成一部分"],
      advice: "下周保留三类行动，先缩短单次听力练习。",
      followUps: ["查看听力卡点", "给我下周建议"],
      evidenceTaskIds: ["task_words", "task_listening", "task_errors"],
      evidenceDates: ["2026-06-28", "2026-06-29", "2026-06-30"],
    });
  }, [{ role: "user", content: "上次你建议我先缩短听力练习" }]);
  assert.match(questionPrompt, /我下周应该怎么安排更稳/);
  assert.match(questionPrompt, /progress-coach-v2|statKeys/);
  assert.match(answer.answer, /听力练习/);
  assert.strictEqual(answer.mode, "compact");
  assert.deepStrictEqual(answer.stats.map((item) => item.key), ["completedActions", "totalMinutes", "completionRate"]);
  assert.strictEqual(answer.stats[0].value, "2/3");
  assert.strictEqual(answer.stats[1].value, "65min");

  const detailedAnswer = await answerSnapshot(snapshot("英语四六级", englishTasks), "详细解释本周节奏", "2026-06-30", async () => modelResult({
    answer: "本周完成了单词和错题整理，听力只完成一部分。当前已有稳定基础，但听力任务还需要缩小完成单位。建议下周保持已有节奏，不额外增加任务。",
    mode: "detailed",
    summary: "本周已有稳定基础，听力任务仍需缩小",
    statKeys: ["completedActions", "totalMinutes", "activeDays", "completionRate", "recentActionDate"],
    insights: ["单词和错题已经完成", "听力任务只完成一部分"],
    advice: "下周保持已有节奏，先缩短听力任务，不额外增加任务。",
    followUps: ["听力怎么缩短", "查看下周建议", "解释投入趋势"],
    evidenceTaskIds: ["task_words", "task_listening", "task_errors"],
    evidenceDates: ["2026-06-28", "2026-06-29", "2026-06-30"],
  }));
  assert.strictEqual(detailedAnswer.mode, "detailed");
  assert.strictEqual(detailedAnswer.stats.length, 5);
  assert.strictEqual(detailedAnswer.stats[4].value, "6/30");

  const directAnswer = await answerSnapshot(snapshot("英语四六级", englishTasks), "我昨天干啥了？", "2026-06-30", async () => modelResult({
    answer: "昨天你进行了听力练习，完成了一部分，实际投入25分钟。",
    mode: "direct",
    evidenceTaskIds: ["task_listening"],
    evidenceDates: ["2026-06-29"],
  }));
  assert.strictEqual(directAnswer.mode, "direct");
  assert.match(directAnswer.answer, /听力练习/);
  assert.strictEqual(directAnswer.stats, undefined);

  const noRecordAnswer = await answerSnapshot(snapshot("英语四六级", englishTasks), "6月27日做了什么？", "2026-06-30", async () => modelResult({
    answer: "6月27日没有行动记录，因此目前无法判断当天做了什么。",
    mode: "direct",
    evidenceTaskIds: [],
    evidenceDates: [],
  }));
  assert.match(noRecordAnswer.answer, /没有行动记录/);

  const optionalCardAnswer = await answerSnapshot(snapshot("英语四六级", englishTasks), "简单说说当前状态", "2026-06-30", async () => modelResult({
    answer: "当前已经完成两项行动，听力练习完成了一部分。",
    mode: "compact",
    evidenceTaskIds: ["task_words", "task_listening", "task_errors"],
    evidenceDates: ["2026-06-28", "2026-06-29", "2026-06-30"],
  }));
  assert.strictEqual(optionalCardAnswer.mode, "compact");
  assert.deepStrictEqual(optionalCardAnswer.stats, []);
  assert.deepStrictEqual(optionalCardAnswer.followUps, []);

  let goalOnlyQuestionCalls = 0;
  const goalOnlyAnswer = await answerSnapshot(snapshot("完成个人博客", []), "我应该从哪里开始？", "2026-06-30", async (prompt) => {
    goalOnlyQuestionCalls += 1;
    assert.match(prompt, /"dataLevel":"goal_only"/);
    return modelResult({
      answer: "当前暂无行动记录，所以还不能根据你的执行情况判断优先级。只能结合完成个人博客这个目标，建议先手动记录一个你愿意开始的小行动。",
      evidenceTaskIds: [],
      evidenceDates: [],
    });
  });
  assert.match(goalOnlyAnswer.answer, /暂无行动记录/);
  assert.strictEqual(goalOnlyQuestionCalls, 1);

  await assert.rejects(
    () => answerSnapshot(snapshot("英语四六级", englishTasks), "分析一下", "2026-06-30", async () => modelResult({
      answer: "当前行动有真实记录，但这个回答使用了不允许的数据字段，因此必须被拒绝。",
      mode: "compact",
      summary: "当前行动节奏基本稳定",
      statKeys: ["completedActions", "totalMinutes", "inventedScore"],
      insights: ["已有两项行动完成"],
      advice: "先完成剩余的一项行动。",
      followUps: ["查看当前卡点", "给我下一步建议"],
      evidenceTaskIds: ["task_words"],
      evidenceDates: ["2026-06-28"],
    })),
    (error) => error.code === "AI_COACH_INVALID",
  );

  await assert.rejects(
    () => answerSnapshot(snapshot("英语四六级", englishTasks), "详细分析", "2026-06-30", async () => modelResult({
      answer: "过".repeat(501),
      mode: "detailed",
      evidenceTaskIds: ["task_words"],
      evidenceDates: ["2026-06-28"],
    })),
    (error) => error.code === "AI_COACH_INVALID",
  );

  await assert.rejects(
    () => analyzeSnapshot(snapshot("考公", civilTasks), "2026-06-30", async () => modelResult("not-json")),
    (error) => error.code === "AI_ANALYSIS_INVALID",
  );

  await assert.rejects(
    () => analyzeSnapshot(snapshot("考公", civilTasks), "2026-06-30", async () => modelResult({
      summary: "这是一段长度足够但引用了不存在行动的分析总结，因此必须被服务端拒绝，不能展示给用户。",
      rhythmDiagnosis: ["存在节奏问题。"],
      nextSuggestions: ["保持小步行动。"],
      evidence: [{ text: "伪造依据", taskIds: ["task_fake"], dates: ["2026-06-30"] }],
    })),
    (error) => error.code === "AI_ANALYSIS_INVALID",
  );

  await assert.rejects(
    () => analyzeSnapshot(snapshot("考公", civilTasks), "2026-06-30", async () => {
      const error = new Error("timeout");
      error.code = "AI_REQUEST_TIMEOUT";
      throw error;
    }),
    (error) => error.code === "AI_ANALYSIS_FAILED",
  );

  assert.deepStrictEqual(buildPeriod("week", "2026-06-30", snapshot("考公", civilTasks)), { startDate: "2026-06-24", endDate: "2026-06-30" });
  assert.deepStrictEqual(buildPeriod("month", "2026-06-30", snapshot("考公", civilTasks)), { startDate: "2026-06-01", endDate: "2026-06-30" });
  const metrics = calculateMetrics(snapshot("考公", civilTasks), { startDate: "2026-06-24", endDate: "2026-06-30" }).metrics;
  assert.strictEqual(metrics.totalTasks, 3);
  assert.strictEqual(metrics.activeDays, 2);
  assert.strictEqual(metrics.actualMinutes, 75);

  console.log("progress coach tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
