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

const REVIEW_TEMPLATES = {
  oralEnglish: {
    title: "口语跟读与镜前练习",
    focus: "视频跟读、镜前模仿和复盘",
    summary: (input) =>
      `围绕“${cleanText(input.goalTitle, 24)}”安排低压力口语练习，把复盘中提到的材料和场景转成每日行动。`,
    themes: [
      "选择跟读片段",
      "拆分口语句子",
      "镜前慢速模仿",
      "跟读教学视频",
      "录音对比调整",
      "整段影子跟读",
      "整理下一步素材",
    ],
    primaryActions: [
      "选定一个口语片段并标出3句",
      "跟读3句并记录卡顿位置",
      "对着镜子模仿表情和口型",
      "观看一个口语教学视频并摘出2个表达",
      "录一遍跟读并听回一个问题",
      "完成一段影子跟读练习",
      "整理下周继续练的片段清单",
    ],
    descriptions: [
      "从你想看的美剧片段或口语视频里选一小段，只保留今天能练完的3句话。",
      "逐句暂停跟读，重点观察发音、连读和语气，把最不顺的一句记下来。",
      "晚上对着镜子练习口型和语调，保持慢速，不追求一次说完美。",
      "从一个排名靠前或你认可的教学视频里提取2个可模仿表达，并各读3遍。",
      "用手机录下30秒跟读，听回后只改一个最明显的问题。",
      "跟着原视频连续影子跟读一小段，结束后标记一个明天继续练的句子。",
      "把本周用过的视频、片段和最有效的练习方式整理成下一阶段素材。",
    ],
    reflectionTitle: (dayIndex) => `第 ${dayIndex} 天记录口语练习反馈`,
    reflectionDescription: "用一句话记录今天最顺的一处和最卡的一处，明确明天从哪个句子继续。",
  },
  videoEditing: {
    title: "原创视频剪辑推进",
    focus: "素材整理、粗剪、节奏和复盘",
    summary: (input) =>
      `围绕“${cleanText(input.goalTitle, 24)}”安排视频剪辑行动，把素材、场景和成片推进拆成每日可完成步骤。`,
    themes: [
      "整理素材和脚本",
      "完成粗剪结构",
      "处理画面节奏",
      "补齐字幕和音频",
      "检查转场和节奏",
      "导出小样复看",
      "整理下一版修改点",
    ],
    primaryActions: [
      "整理素材并标出可用片段",
      "完成30秒粗剪时间线",
      "调整3处画面节奏",
      "补齐关键字幕和音频",
      "检查转场并删掉冗余镜头",
      "导出一版小样并完整复看",
      "写出下一版剪辑修改清单",
    ],
    descriptions: [
      "把现有素材按场景或用途分组，选出今天最适合进入时间线的片段。",
      "先不追求精修，完成一个能看出开头、发展和结尾的粗剪版本。",
      "围绕观感最拖沓的位置调整镜头长度，至少优化3处节奏点。",
      "补齐必要字幕、环境音或背景音乐，让观众能理解核心内容。",
      "检查转场是否突兀，删掉不服务主题的镜头，保持画面推进清楚。",
      "导出一版低码率小样，从头看一遍，只记录最影响观看的3个问题。",
      "把需要补拍、重剪、调音或加字幕的事项整理成下一阶段清单。",
    ],
    reflectionTitle: (dayIndex) => `第 ${dayIndex} 天记录剪辑反馈`,
    reflectionDescription: "用一句话记录今天完成的剪辑产出和下一次最应该修改的一处。",
  },
};

function splitMinutes(total) {
  if (total < 25) return [total];
  const first = Math.floor(total / 2);
  return [first, total - first];
}

function cleanText(value, maximum) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, maximum);
}

function hasReviewFocus(input) {
  return Boolean(
    input &&
      input.previousReview &&
      cleanText(input.previousReview.focusAdjustment, 200),
  );
}

function inferReviewTemplate(input) {
  const reviewText = cleanText(input.previousReview.focusAdjustment, 200);
  const goalText = cleanText(`${input.goalTitle} ${input.desiredResult} ${reviewText}`, 400);
  const hasOralSignal = /英语|口语|跟读|镜子|镜前|模仿|美剧|无耻之徒/i.test(goalText);
  if (hasOralSignal) return REVIEW_TEMPLATES.oralEnglish;

  const hasVideoEditingSignal = /视频剪辑|剪辑|粗剪|成片|素材|字幕|转场|音频|调色|导出|时间线|原创视频/i.test(goalText);
  if (hasVideoEditingSignal) return REVIEW_TEMPLATES.videoEditing;

  return null;
}

function buildReviewFallback(input) {
  const reviewTemplate = inferReviewTemplate(input);
  if (!reviewTemplate) return null;
  const actionMinutes = Math.max(10, Math.min(input.dailyMinutes, 180));
  const parts = splitMinutes(actionMinutes);
  return {
    stage: {
      title: reviewTemplate.title,
      summary: reviewTemplate.summary(input),
      focus: reviewTemplate.focus,
      durationDays: input.durationDays,
    },
    days: Array.from({ length: input.durationDays }, (_, index) => {
      const dayIndex = index + 1;
      const theme = reviewTemplate.themes[index % reviewTemplate.themes.length];
      return {
        dayIndex,
        theme,
        actions: parts.map((minutes, actionIndex) => {
          if (actionIndex === 0) {
            return {
              title: reviewTemplate.primaryActions[index % reviewTemplate.primaryActions.length],
              description: reviewTemplate.descriptions[index % reviewTemplate.descriptions.length],
              estimatedMinutes: minutes,
            };
          }
          return {
            title: reviewTemplate.reflectionTitle(dayIndex),
            description: reviewTemplate.reflectionDescription,
            estimatedMinutes: minutes,
          };
        }),
      };
    }),
  };
}

function buildCategoryFallback(input) {
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
              ? `第 ${index + 1} 天${theme}练习`
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

function buildStageFallback(input) {
  if (hasReviewFocus(input)) {
    const reviewFallback = buildReviewFallback(input);
    if (reviewFallback) return reviewFallback;
  }
  return buildCategoryFallback(input);
}

module.exports = { buildStageFallback };
