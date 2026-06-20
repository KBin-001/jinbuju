const { addBusinessDays, formatBusinessDate } = require("./date");

const CATEGORY_COPY = {
  exam: {
    summary: "建立稳定的备考节奏，完成核心知识梳理与练习",
    weeklyGoal: "明确考试重点，并完成一轮基础学习和针对性练习",
    themes: ["了解考试结构", "梳理核心知识", "基础专项练习", "错题整理", "重点强化", "阶段复习", "总结与下周准备"],
  },
  skill: {
    summary: "从基础概念出发，通过练习完成一轮技能入门",
    weeklyGoal: "掌握关键基础知识，并独立完成一个小练习",
    themes: ["认识工具与环境", "学习核心概念", "完成基础练习", "解决常见问题", "组合应用", "轻量复习", "完成阶段作品"],
  },
  career: {
    summary: "围绕求职目标整理材料，并完成一次针对性演练",
    weeklyGoal: "形成一份可继续迭代的求职材料或行动成果",
    themes: ["明确岗位方向", "梳理个人经历", "完善核心材料", "对照岗位优化", "进行表达练习", "轻量复盘", "完成最终版本"],
  },
};

const LEVEL_PREFIX = {
  zero: "先理解基础要求",
  basic: "回顾已有基础",
  intermediate: "巩固关键方法",
  experienced: "聚焦薄弱环节",
  improve: "系统梳理并提升",
};

function getStudyIndexes(weeklyDays) {
  const indexes = [];
  for (let index = 0; index < weeklyDays; index += 1) {
    indexes.push(Math.floor((index * 7) / weeklyDays));
  }
  return new Set(indexes);
}

function splitMinutes(total, intensity) {
  if (total <= 20 || intensity === "light") return [total];
  if (intensity === "intensive" && total >= 60) {
    const first = Math.floor(total / 3);
    return [first, first, total - first * 2];
  }
  const first = Math.floor(total / 2);
  return [first, total - first];
}

function buildFallbackPlan(goal, requestedStartDate) {
  const copy = CATEGORY_COPY[goal.category];
  const studyIndexes = getStudyIndexes(goal.weeklyDays);
  const startDate = requestedStartDate || formatBusinessDate();
  const studyMinutes =
    goal.intensity === "light"
      ? Math.max(15, Math.floor(goal.dailyMinutes * 0.75))
      : goal.dailyMinutes;

  const planDurationDays = Math.max(Number(goal.planDurationDays || 7), 3);
  const days = Array.from({ length: planDurationDays }, (_, index) => {
    const theme = copy.themes[index % copy.themes.length];
    const isStudyDay = studyIndexes.has(index % 7);
    const date = addBusinessDays(startDate, index);
    if (!isStudyDay) {
      return {
        day: index + 1,
        date,
        title: "休息与简单复习",
        isStudyDay: false,
        tasks: [],
      };
    }

    const parts = splitMinutes(studyMinutes, goal.intensity);
    const tasks = parts.map((minutes, taskIndex) => ({
      title:
        taskIndex === 0
          ? `${LEVEL_PREFIX[goal.currentLevel]}：${theme}`
          : taskIndex === parts.length - 1
            ? `完成与“${goal.goalTitle}”相关的具体练习并记录结果`
            : `针对当天内容完成一组练习并检查答案`,
      estimatedMinutes: minutes,
    }));

    return {
      day: index + 1,
      date,
      title: theme,
      isStudyDay: true,
      tasks,
    };
  });

  return {
    summary: copy.summary,
    weeklyGoal: `${copy.weeklyGoal}：${goal.goalTitle}`,
    days,
    fallbackAdvice: "某天未完成时，将未完成任务顺延到下一个学习日，不需要重新开始。",
    source: "fallback",
  };
}

module.exports = { buildFallbackPlan };
