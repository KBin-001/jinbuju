const assert = require("assert");
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const {
  analyzeSnapshot,
  buildPeriod,
  calculateMetrics,
  normalizeSnapshot,
} = require("./progress-coach");

const goal = {
  id: "goal_english",
  title: "英语四六级",
  category: "custom",
  status: "active",
  createdAt: "2026-07-01T08:00:00.000Z",
  startedAt: "2026-07-01T08:00:00.000Z",
};

function task(id, title, date, status, minutes) {
  return {
    id,
    goalId: goal.id,
    title,
    plannedDate: date,
    currentDate: date,
    status,
    estimatedMinutes: 30,
    actualMinutes: minutes,
    createdAt: `${date}T08:00:00.000Z`,
    updatedAt: `${date}T09:00:00.000Z`,
  };
}

const event = {
  goalId: goal.id,
  range: "week",
  analysisDate: "2026-07-11",
  snapshot: {
    goals: [goal],
    tasks: [
      task("task_words", "背30个单词", "2026-07-06", "completed", 25),
      task("task_listening", "听一套听力", "2026-07-11", "partially_completed", 20),
    ],
    checkins: [],
  },
};

async function run() {
  const snapshot = normalizeSnapshot(event);
  const upgradeSnapshot = normalizeSnapshot({
    ...event,
    goalId: "goal_upgrade",
    snapshot: {
      goals: [{ ...goal, id: "goal_upgrade", title: "准备专升本考试", category: "undergraduate_upgrade" }],
      tasks: [],
      checkins: [],
    },
  });
  assert.strictEqual(upgradeSnapshot.goals[0].category, "undergraduate_upgrade");
  assert.deepStrictEqual(buildPeriod("week", "2026-07-11", snapshot), {
    startDate: "2026-07-06",
    endDate: "2026-07-12",
  });
  assert.deepStrictEqual(buildPeriod("month", "2026-07-11", snapshot), {
    startDate: "2026-07-01",
    endDate: "2026-07-31",
  });

  const metrics = calculateMetrics(snapshot, buildPeriod("week", "2026-07-11", snapshot)).metrics;
  assert.strictEqual(metrics.totalTasks, 2);
  assert.strictEqual(metrics.completed, 1);
  assert.strictEqual(metrics.partial, 1);
  assert.strictEqual(metrics.actualMinutes, 45);

  let prompt = "";
  const result = await analyzeSnapshot(snapshot, "2026-07-11", async (value) => {
    prompt = value;
    return Promise.resolve({
      text: JSON.stringify({
        summary: "本周已记录单词和听力两项真实行动，完成一项、部分完成一项，当前依据仍有限，但可以看见已经开始推进英语四六级目标。",
        rhythmDiagnosis: ["听力行动尚未完整完成，当前只依据本周两条行动记录判断。"],
        nextSuggestions: ["下一次先把听力拆成更小的一段，并继续记录实际投入。"],
        evidence: [{ text: "依据单词与听力记录。", taskIds: ["task_words", "task_listening"], dates: ["2026-07-06", "2026-07-11"] }],
      }),
      metadata: { generationDurationMs: 8 },
    });
  });
  assert.strictEqual(result.status, "success");
  assert.match(prompt, /背30个单词/);
  assert.match(prompt, /听一套听力/);
  assert.match(prompt, /"startDate":"2026-07-06"/);
  assert.match(prompt, /不得编造|只能引用/);

  await assert.rejects(
    () => analyzeSnapshot(snapshot, "2026-07-11", async () => ({
      text: JSON.stringify({
        summary: "这是一段引用了不存在行动的分析，因此必须被服务端拒绝，不能作为真实 AI 结论展示给用户。",
        rhythmDiagnosis: ["存在未验证结论。"],
        nextSuggestions: ["继续记录真实行动。"],
        evidence: [{ text: "伪造依据", taskIds: ["task_fake"], dates: ["2026-07-11"] }],
      }),
    })),
    (error) => error.code === "AI_ANALYSIS_INVALID",
  );

  console.log("progress coach natural-period and real-evidence tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
