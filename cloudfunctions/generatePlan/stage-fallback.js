const CATEGORY_TEMPLATES = {
  exam: {
    title: "建立稳定的基础备考节奏",
    focus: "考试结构与核心基础",
    themes: ["明确考试范围", "梳理基础知识", "完成基础练习", "检查薄弱点"],
  },
  skill: {
    title: "完成技能入门与基础练习",
    focus: "核心概念与动手练习",
    themes: ["准备学习环境", "理解核心概念", "完成基础练习", "组合应用"],
  },
  career: {
    title: "明确方向并整理求职基础",
    focus: "岗位方向与个人材料",
    themes: ["明确目标岗位", "梳理个人经历", "完善核心材料", "进行表达练习"],
  },
  default: {
    title: "建立可持续的行动节奏",
    focus: "降低启动难度并形成习惯",
    themes: ["明确起点", "完成基础行动", "巩固行动方式", "进行轻量复盘"],
  },
};

function splitMinutes(total) {
  if (total < 25) return [total];
  const first = Math.floor(total / 2);
  return [first, total - first];
}

function buildStageFallback(input) {
  const template =
    CATEGORY_TEMPLATES[input.category] || CATEGORY_TEMPLATES.default;
  const actionMinutes = Math.max(
    10,
    Math.min(
      input.intensity === "light"
        ? Math.round((input.dailyMinutes * 0.75) / 5) * 5
        : input.dailyMinutes,
      180,
    ),
  );
  return {
    stage: {
      title: template.title,
      summary: `围绕“${input.goalTitle}”完成一个低压力、可执行的起步阶段，逐步接近期望结果。`,
      focus: template.focus,
      durationDays: input.durationDays,
    },
    days: Array.from({ length: input.durationDays }, (_, index) => {
      const weekDay = (index % 7) + 1;
      const activeDays =
        input.durationDays <= 7
          ? [1, 2, 3, 4, 5, 6, 7]
          : {
              3: [1, 3, 5],
              5: [1, 2, 3, 5, 6],
              7: [1, 2, 3, 4, 5, 6, 7],
            }[input.weeklyDays || 7];
      if (!activeDays.includes(weekDay)) {
        return {
          dayIndex: index + 1,
          theme: "休息与整理",
          actions: [],
        };
      }
      const theme = template.themes[index % template.themes.length];
      const parts = input.templateId ? [actionMinutes] : splitMinutes(actionMinutes);
      return {
        dayIndex: index + 1,
        theme,
        actions: parts.map((minutes, actionIndex) => ({
          title:
            actionIndex === 0
              ? `第 ${index + 1} 天 ${theme}：完成一个可验证的小步骤`
              : `第 ${index + 1} 天记录结果并整理下一步`,
          description:
            actionIndex === 0
              ? `围绕“${input.goalTitle}”完成当天的具体练习，并保留可以检查的结果。`
              : "用简短记录总结完成情况，明确下一次行动从哪里开始。",
          estimatedMinutes: minutes,
        })),
      };
    }),
  };
}

module.exports = { buildStageFallback };
