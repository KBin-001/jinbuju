const BADGE_DEFINITIONS = [
  {
    code: "first_checkin",
    name: "第一次行动",
    description: "完成第一次打卡",
    target: 1,
    metric: "checkinDays",
  },
  {
    code: "streak_3",
    name: "连续 3 天",
    description: "连续行动 3 天",
    target: 3,
    metric: "longestStreak",
  },
  {
    code: "streak_7",
    name: "连续 7 天",
    description: "连续行动 7 天",
    target: 7,
    metric: "longestStreak",
  },
  {
    code: "checkin_10",
    name: "累计 10 天",
    description: "累计完成 10 天打卡",
    target: 10,
    metric: "checkinDays",
  },
  {
    code: "first_stage_completed",
    name: "完成首个阶段",
    description: "完成第一个 7 天计划",
    target: 1,
    metric: "completedStages",
  },
];

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(Number(value) || 0, minimum), maximum);
}

function buildBadges(statistics, unlockDates = {}) {
  return BADGE_DEFINITIONS.map((definition) => {
    const current = clamp(statistics[definition.metric], 0, definition.target);
    const unlocked = current >= definition.target;
    return {
      code: definition.code,
      name: definition.name,
      description: definition.description,
      unlocked,
      unlockedAt: unlocked ? unlockDates[definition.code] || "" : "",
      progressDescription: unlocked
        ? "已解锁"
        : `进度 ${current} / ${definition.target}`,
    };
  });
}

function isCommunityUnlocked(profile, requirements = {}) {
  const minimumCheckinDays = Math.max(
    Number(requirements.minimumCheckinDays || 1),
    0,
  );
  const minimumStreakDays = Math.max(
    Number(requirements.minimumStreakDays || 3),
    0,
  );
  const requiresActiveGoal = requirements.requiresActiveGoal !== false;
  return Boolean(
    (!requiresActiveGoal || profile.hasCurrentGoal) &&
      Number(profile.totalCheckinDays || 0) >= minimumCheckinDays &&
      Number(profile.longestStreak || 0) >= minimumStreakDays,
  );
}

module.exports = {
  BADGE_DEFINITIONS,
  buildBadges,
  isCommunityUnlocked,
};
