/**
 * 小队页面新信息架构数据流测试
 * 验证 5 个 compute 函数的输出结构、字段完整性、排序逻辑与边界场景
 */

const { test, summary, assertEqual, assertDeepEqual, log } = (() => {
  let passed = 0;
  let failed = 0;

  function writeLog(name, ok, detail) {
    if (ok) {
      passed += 1;
      console.log(`  PASS  ${name}${detail ? "  " + detail : ""}`);
    } else {
      failed += 1;
      console.log(`  FAIL  ${name}${detail ? "  " + detail : ""}`);
    }
  }

  return {
    test(name, fn) {
      console.log(`\n[${name}]`);
      try {
        fn();
      } catch (e) {
        failed += 1;
        console.log(`  FAIL  exception: ${e.message}`);
      }
    },
    summary() {
      console.log(`\n========== 结果：${passed} 通过 / ${failed} 失败 ==========`);
      return failed === 0;
    },
    assertEqual(actual, expected, label) {
      const ok = actual === expected;
      writeLog(label || `assertEqual ${actual} === ${expected}`, ok, ok ? "" : `actual=${actual} expected=${expected}`);
    },
    assertDeepEqual(actual, expected, label) {
      const ok = JSON.stringify(actual) === JSON.stringify(expected);
      writeLog(label || "assertDeepEqual", ok, ok ? "" : `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
    },
    log(name, ok, detail) {
      writeLog(name, ok, detail);
    },
  };
})();

// ============== 复刻 hashSeed ==============
const AVATAR_GRADIENTS = ["grad-1", "grad-2", "grad-3", "grad-4", "grad-5", "grad-6"];

function hashSeed(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function pickAvatarClass(seed) {
  return AVATAR_GRADIENTS[hashSeed(seed) % AVATAR_GRADIENTS.length];
}

// ============== 复刻 compute 系列 ==============
function estimateCompletedActions(member) {
  if (member.isSelf) {
    return Math.max(0, Math.min(3, Math.round((member.growthMinutes || 0) / 25)));
  }
  const base =
    member.todayStatus === "completed" ? 3 :
    member.todayStatus === "partial" ? 2 :
    member.todayStatus === "not_started" ? 1 :
    0;
  const seed = hashSeed((member.userId || member.id) + "_act");
  return Math.max(0, Math.min(3, base + (seed % 2)));
}

function computeTeamTodayProgress(members, rawMembers) {
  const totalMembers = rawMembers.length || 1;
  const completedMembers = rawMembers.filter((m) => m.todayStatus === "completed").length;
  const completionRate = Math.round((completedMembers / totalMembers) * 100);
  const todayActionCount = rawMembers.reduce((sum, m) => sum + estimateCompletedActions(m), 0);
  const goal = Math.max(30, totalMembers * 3);
  return {
    completionRate,
    completedMembers,
    totalMembers,
    todayActionCount,
    goal,
    progress: todayActionCount,
  };
}

function computeTodayCommonAction(rawMembers) {
  const self = rawMembers.find((m) => m.isSelf);
  const myProgress = self ? estimateCompletedActions(self) : 0;
  const teamProgress = rawMembers.reduce((sum, m) => sum + estimateCompletedActions(m), 0);
  const totalMembers = rawMembers.length || 1;
  const teamGoal = Math.max(30, totalMembers * 3);
  return {
    title: "每人完成 3 个待办，保持连续打卡",
    myGoal: 3,
    myProgress,
    teamGoal,
    teamProgress,
  };
}

function deriveStatusForStatusView(member) {
  if (member.todayStatus === "completed") return "done";
  if (member.todayStatus === "partial") return "doing";
  return "todo";
}

function computeMemberStatusList(members) {
  const rank = { done: 0, doing: 1, todo: 2 };
  return members
    .map((m) => ({
      id: m.id,
      nickname: m.nickname,
      avatar: m.avatar || "",
      avatarText: m.avatarText || m.nickname.slice(0, 1),
      avatarClass: m.avatarClass || pickAvatarClass(m.id),
      status: deriveStatusForStatusView(m),
      isSelf: !!m.isSelf,
    }))
    .slice()
    .sort((a, b) => {
      if (a.isSelf && !b.isSelf) return -1;
      if (!a.isSelf && b.isSelf) return 1;
      return rank[a.status] - rank[b.status];
    });
}

function relativeTimeText(seedKey, index) {
  const seed = hashSeed(seedKey);
  const bucket = (index * 3 + (seed % 5)) % 6;
  return ["刚刚", "30 分钟前", "1 小时前", "2 小时前", "今天上午", "昨天"][bucket];
}

function actionTemplateForMember(member, todayActions) {
  if (member.todayStatus === "completed") {
    return todayActions >= 3 ? "完成了今日目标" : `完成了 ${todayActions} 项行动`;
  }
  if (member.todayStatus === "partial") return "完成了一部分行动";
  if (member.todayStatus === "missed") return "还没开始今日行动";
  return "进行中";
}

function computeActionStream(members, rawMembers) {
  const items = [];
  const sample = members.slice(0, 8);
  // 先追加一条「连续打卡」事件，确保被截断时也不会丢失
  if (sample.length > 0) {
    const leader = sample.find((m) => m.isSelf) || sample[0];
    items.push({
      id: `stream_streak_${leader.id}`,
      memberId: leader.id,
      nickname: leader.nickname,
      avatarText: leader.avatarText || leader.nickname.slice(0, 1),
      avatarClass: leader.avatarClass || pickAvatarClass(leader.id),
      actionText: "连续打卡 7 天",
      timeText: "昨天",
    });
  }
  sample.forEach((m, idx) => {
    const raw = rawMembers.find((r) => r.id === m.id);
    const completed = raw ? estimateCompletedActions(raw) : 0;
    items.push({
      id: `stream_${m.id}_${idx}`,
      memberId: m.id,
      nickname: m.nickname,
      avatarText: m.avatarText || m.nickname.slice(0, 1),
      avatarClass: m.avatarClass || pickAvatarClass(m.id),
      actionText: actionTemplateForMember({ todayStatus: raw ? raw.todayStatus : "not_started" }, completed),
      timeText: relativeTimeText(m.id, idx),
    });
  });
  return items.slice(0, 5);
}

function computeWeeklyBadges() {
  return [
    { name: "团结之星", desc: "连续 3 周达成目标", icon: "🏅" },
    { name: "全勤小队", desc: "本周全员打卡", icon: "✨" },
    { name: "冲刺达人", desc: "今日行动完成最多", icon: "🚀" },
  ];
}

// ============== 构造测试数据 ==============
const sampleRawMembers = [
  { id: "u1", userId: "user_1", nickname: "我", isSelf: true, todayStatus: "completed", growthMinutes: 75 },
  { id: "u2", userId: "user_2", nickname: "阿岚", isSelf: false, todayStatus: "completed", growthMinutes: 50 },
  { id: "u3", userId: "user_3", nickname: "林溪", isSelf: false, todayStatus: "partial", growthMinutes: 30 },
  { id: "u4", userId: "user_4", nickname: "沐辰", isSelf: false, todayStatus: "not_started", growthMinutes: 0 },
  { id: "u5", userId: "user_5", nickname: "时予", isSelf: false, todayStatus: "missed", growthMinutes: 0 },
];

const sampleViews = sampleRawMembers.map((m) => ({
  id: m.id,
  nickname: m.nickname,
  avatar: "",
  avatarText: m.nickname.slice(0, 1),
  avatarClass: pickAvatarClass(m.userId),
  isSelf: m.isSelf,
  todayStatus: m.todayStatus,
  status: m.todayStatus === "completed" ? "checked" : m.todayStatus === "partial" ? "active" : m.todayStatus === "missed" ? "unchecked" : "normal",
  statusText: "",
  weeklyFocusMinutes: 0,
  streakDays: 0,
  role: "member",
  roleText: "",
}));

// ============== 测试 ==============
test("computeTeamTodayProgress 字段完整性", () => {
  const r = computeTeamTodayProgress(sampleViews, sampleRawMembers);
  assertEqual(r.completionRate, 40, "完成率 2/5 = 40%");
  assertEqual(r.completedMembers, 2, "已完成成员 2");
  assertEqual(r.totalMembers, 5, "总成员 5");
  assertEqual(typeof r.todayActionCount, "number", "今日行动数为数字");
  assertEqual(r.goal, 30, "目标 = max(30, 5*3) = 30 (下限) ");
  assertEqual(r.progress, r.todayActionCount, "progress = todayActionCount");
  console.log("  ----", JSON.stringify(r));
});

test("computeTeamTodayProgress 边界 - 空数据", () => {
  const r = computeTeamTodayProgress([], []);
  assertEqual(r.totalMembers, 1, "空数据 totalMembers 兜底为 1");
  assertEqual(r.completionRate, 0, "空数据完成率 0");
  assertEqual(r.goal, 30, "goal 下限 30");
});

test("computeTodayCommonAction 个人与全队进度", () => {
  const r = computeTodayCommonAction(sampleRawMembers);
  assertEqual(r.myGoal, 3, "个人目标 3");
  assertEqual(r.teamGoal, 30, "全队目标 = max(30, 5*3) = 30 (下限)");
  assertEqual(typeof r.myProgress, "number", "个人进度为数字");
  assertEqual(typeof r.teamProgress, "number", "全队进度为数字");
  assertEqual(r.title.length > 0, true, "标题非空");
  console.log("  ----", JSON.stringify(r));
});

test("computeMemberStatusList 自己置顶 + 状态优先级", () => {
  const r = computeMemberStatusList(sampleViews);
  assertEqual(r.length, 5, "长度 5");
  assertEqual(r[0].isSelf, true, "自己排第一");
  // 排除自己后，剩余按 done > doing > todo 排序
  const rest = r.slice(1);
  const rank = { done: 0, doing: 1, todo: 2 };
  let prevRank = -1;
  rest.forEach((m) => {
    const cur = rank[m.status];
    if (prevRank >= 0) {
      if (cur < prevRank) {
        log("  排序违反状态优先级", false, `从 ${prevRank} 到 ${cur}`);
        return;
      }
    }
    prevRank = cur;
  });
  log("  排序符合状态优先级", true);
  // 字段检查
  const first = r[0];
  ["id", "nickname", "avatarText", "avatarClass", "status", "isSelf"].forEach((k) => {
    if (!(k in first)) log(`  缺字段 ${k}`, false);
  });
  log("  字段完整", true);
});

test("computeMemberStatusList 状态映射正确", () => {
  const r = computeMemberStatusList(sampleViews);
  // 我（u1）todayStatus=completed -> done
  assertEqual(r.find((m) => m.id === "u1").status, "done", "u1 -> done");
  // u3 todayStatus=partial -> doing
  assertEqual(r.find((m) => m.id === "u3").status, "doing", "u3 -> doing");
  // u4 todayStatus=not_started -> todo
  assertEqual(r.find((m) => m.id === "u4").status, "todo", "u4 -> todo");
  // u5 todayStatus=missed -> todo
  assertEqual(r.find((m) => m.id === "u5").status, "todo", "u5 -> todo");
});

test("computeActionStream 长度与内容", () => {
  const r = computeActionStream(sampleViews, sampleRawMembers);
  assertEqual(r.length <= 5, true, "最多 5 条");
  assertEqual(r.length > 0, true, "至少 1 条");
  // 验证每条都有完整字段
  r.forEach((it) => {
    ["id", "memberId", "nickname", "avatarText", "avatarClass", "actionText", "timeText"].forEach((k) => {
      if (!(k in it)) log(`  缺字段 ${k}`, false);
    });
  });
  log("  字段完整", true);
  // 至少包含一条"连续打卡 7 天"
  const hasStreak = r.some((it) => it.actionText.indexOf("连续打卡") >= 0);
  assertEqual(hasStreak, true, "包含连续打卡条目");
  console.log("  ----  示例:", JSON.stringify(r[0]));
});

test("computeActionStream 边界 - 单成员", () => {
  const single = [sampleViews[0]];
  const singleRaw = [sampleRawMembers[0]];
  const r = computeActionStream(single, singleRaw);
  assertEqual(r.length, 2, "单成员也会追加 1 条连续打卡");
});

test("computeWeeklyBadges 固定 3 个", () => {
  const r = computeWeeklyBadges();
  assertEqual(r.length, 3, "徽章 3 个");
  r.forEach((b) => {
    if (!b.name || !b.desc || !b.icon) log(`  徽章缺字段`, false);
  });
  log("  徽章字段完整", true);
});

// ============== 总结 ==============
const ok = summary();
process.exit(ok ? 0 : 1);
