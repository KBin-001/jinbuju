const CATEGORY_LABELS = {
  exam: "考试提升",
  skill: "技能学习",
  career: "求职成长",
  reading: "阅读",
  fitness: "运动健康",
  habit: "习惯养成",
  other: "其他",
};
const DURATION_LABELS = {
  "1_month": "1 个月",
  "3_months": "3 个月",
  "6_months": "6 个月",
  long_term: "长期",
};
const ACTION_TYPE_LABELS = {
  practice: "实践练习",
  learning: "学习认知",
  preparation: "准备工作",
  reflection: "反思总结",
  recovery: "恢复调整",
  creation: "创作产出",
  execution: "执行落地",
};
const SKIP_REASON_LABELS = {
  not_enough_time: "时间不够",
  too_difficult: "任务太难",
  insufficient_resources: "资源不足",
  not_feeling_well: "状态不适",
  unexpected_event: "临时有事",
  task_not_realistic: "不符合实际",
  other: "其他",
};
const FEELING_LABELS = {
  easy: "轻松",
  normal: "正常",
  challenging: "有挑战",
  rewarding: "有收获",
};
const DIRECT_STAGE_PROMPT_VERSION = "stage-direct-v1";
const GOAL_ANALYSIS_PROMPT_VERSION = "goal-analysis-v1";
const STAGE_REGENERATION_PROMPT_VERSION = "stage-regeneration-v1";

function buildExecutionSummaryBlock(summary) {
  const lines = [];

  // 时间偏差分析
  if (summary.plannedDailyMinutes > 0 && summary.averageDailyMinutes > 0) {
    const ratio = summary.averageDailyMinutes / summary.plannedDailyMinutes;
    lines.push(`- 计划日均 ${summary.plannedDailyMinutes} 分钟，实际日均约 ${summary.averageDailyMinutes} 分钟（${Math.round(ratio * 100)}%）。`);
    if (ratio < 0.6) {
      const adjustedMinutes = Math.min(summary.averageDailyMinutes + 5, summary.plannedDailyMinutes);
      lines.push(`  → 用户实际投入远低于计划，下一阶段每日任务总时长应调整至约 ${adjustedMinutes} 分钟，不要继续按原计划时长安排。`);
    } else if (ratio > 1.1) {
      lines.push(`  → 用户实际投入超过计划，说明任务量可能偏大或效率偏低，适当精简。`);
    }
  } else if (summary.plannedDailyMinutes > 0 && summary.averageDailyMinutes === 0) {
    lines.push(`- 计划日均 ${summary.plannedDailyMinutes} 分钟，但实际完成记录为 0 分钟。`);
    lines.push(`  → 大幅减少每日任务量和时长，优先让用户建立连续行动习惯。`);
  }

  // 行动类型偏好
  if (summary.frequentlySkippedActionTypes && summary.frequentlySkippedActionTypes.length > 0) {
    const skippedLabels = summary.frequentlySkippedActionTypes.map((t) => ACTION_TYPE_LABELS[t] || t);
    lines.push(`- 用户经常跳过的行动类型：${skippedLabels.join("、")}。`);
    lines.push(`  → 减少这些类型的任务比例，用用户更倾向的行动类型替代。`);
  }

  if (summary.actionTypeCompletionRates && Object.keys(summary.actionTypeCompletionRates).length > 0) {
    const highCompletion = Object.entries(summary.actionTypeCompletionRates)
      .filter(([, rate]) => rate >= 70)
      .map(([type]) => ACTION_TYPE_LABELS[type] || type);
    if (highCompletion.length > 0) {
      lines.push(`- 用户完成率较高的行动类型：${highCompletion.join("、")}。`);
      lines.push(`  → 优先安排这些类型的行动作为核心任务。`);
    }
  }

  // 跳过原因
  if (summary.skipReasons && Object.keys(summary.skipReasons).length > 0) {
    const sortedReasons = Object.entries(summary.skipReasons)
      .sort((a, b) => b[1] - a[1]);
    const reasonLabels = sortedReasons.map(([reason, count]) =>
      `${SKIP_REASON_LABELS[reason] || reason}(${count}次)`
    );
    lines.push(`- 跳过原因分布：${reasonLabels.join("、")}。`);

    for (const [reason, count] of sortedReasons) {
      if (reason === "not_enough_time" && count >= 2) {
        lines.push(`  → 时间不够是主要障碍，缩短每个行动的预计时间，或将大任务拆成更小的步骤。`);
      } else if (reason === "too_difficult" && count >= 2) {
        lines.push(`  → 任务难度偏高，降低起步门槛，增加引导性说明。`);
      } else if (reason === "insufficient_resources" && count >= 2) {
        lines.push(`  → 资源不足，避免依赖用户未使用的资源。用户实际使用的资源：${(summary.actualResourceUsage || []).join("、") || "无"}。`);
      } else if (reason === "task_not_realistic" && count >= 2) {
        lines.push(`  → 用户认为任务不切实际，需要更贴近用户日常的行动设计。`);
      }
    }
  }

  // 用户难度感受
  if (summary.userDifficulty === "easy") {
    lines.push(`- 用户觉得偏轻松，可在不增加时长的前提下适当提高任务深度或成果要求。`);
  } else if (summary.userDifficulty === "hard") {
    lines.push(`- 用户觉得偏吃力，减少每日任务数量或降低单次任务复杂度，优先保持连续行动习惯。`);
  }

  // 资源使用
  if (summary.actualResourceUsage && summary.actualResourceUsage.length > 0) {
    lines.push(`- 用户实际使用的资源：${summary.actualResourceUsage.join("、")}。新阶段任务应优先围绕这些资源设计。`);
  }

  // 打卡感受
  if (summary.feelingDistribution && Object.keys(summary.feelingDistribution).length > 0) {
    const feelingLabels = Object.entries(summary.feelingDistribution)
      .map(([f, c]) => `${FEELING_LABELS[f] || f}(${c}次)`);
    lines.push(`- 打卡感受分布：${feelingLabels.join("、")}。`);
  }

  return lines.join("\n");
}

function buildPreviousPlanSummaryBlock(summary) {
  if (!summary) return "";
  const lines = [];
  if (summary.stageTitle) lines.push(`- 上一阶段标题：${summary.stageTitle}`);
  if (summary.stageFocus) lines.push(`- 上一阶段重点：${summary.stageFocus}`);
  if (summary.actionThemes && summary.actionThemes.length) {
    lines.push(`- 上一阶段主题：${summary.actionThemes.join("、")}`);
  }
  if (summary.actionSamples && summary.actionSamples.length) {
    lines.push(`- 上一阶段任务样例：${summary.actionSamples.join("、")}`);
  }
  if (summary.completedActionSamples && summary.completedActionSamples.length) {
    lines.push(`- 用户完成过的任务：${summary.completedActionSamples.join("、")}`);
  }
  if (summary.skippedActionSamples && summary.skippedActionSamples.length) {
    lines.push(`- 用户跳过的任务：${summary.skippedActionSamples.join("、")}`);
  }
  return lines.join("\n");
}

function buildStagePrompt(input) {
  let review;
  if (input.previousReview) {
    const base = `上一阶段重点为"${input.previousReview.previousFocus}"，完成率 ${input.previousReview.completionRate}%，实际行动 ${input.previousReview.actionDays} 天，难度感受 ${input.previousReview.difficulty}，下一阶段偏好 ${input.previousReview.nextPreference}${
      input.previousReview.focusAdjustment
        ? `，希望调整重点为：${input.previousReview.focusAdjustment}`
        : ""
    }。`;

    const adaptiveBlock = input.previousReview.executionSummary
      ? `\n\n上一阶段执行详情（据此调整任务设计）：\n${buildExecutionSummaryBlock(input.previousReview.executionSummary)}`
      : "";
    const previousPlanBlock = input.previousReview.previousPlanSummary
      ? `\n\n上一阶段计划内容（下一阶段必须承接，不要生成通用模板）：\n${buildPreviousPlanSummaryBlock(input.previousReview.previousPlanSummary)}`
      : "";

    review = `${base}${adaptiveBlock}${previousPlanBlock}\n\n基本调整规则：完成率较低时减少每日行动数量或时长；感受偏轻松时可适当增加挑战；选择保持节奏时维持相近任务量。请据此调整任务量和重点，但不要改变长期目标。`;
  } else {
    review = "这是第一个行动阶段，优先降低启动难度并建立节奏。";
  }
  return `你是一名长期目标行动拆解助手。你不是聊天助手，只负责生成可执行的短期行动阶段。

长期目标：
- 目标名称：${input.goalTitle}
- 目标分类：${CATEGORY_LABELS[input.category]}
- 期望结果：${input.desiredResult}
- 每日可投入：${input.dailyMinutes} 分钟
- 长期周期：${DURATION_LABELS[input.targetDuration]}
- 当前阶段：第 ${input.stageNumber} 阶段
- 阶段天数：${input.durationDays} 天
- 每周执行：${input.weeklyDays || 7} 天
- 当前水平：${input.currentLevel || "zero"}
- 计划强度：${input.intensity || "normal"}
- 阶段背景：${review}

必须遵守：
1. 阶段持续 durationDays 天，days 数量必须完全一致。
2. 当阶段天数等于 7 天时，按每周执行天数均匀安排任务：3 天使用每周第 1、3、5 天，5 天使用第 1、2、3、5、6 天，7 天每天执行；当阶段天数少于 7 天时，所有天数均为执行日，不安排休息日；休息日 actions 必须为空，${input.templateId ? "每个执行日只生成 1 个具体行动" : "执行日生成 1～4 个具体行动"}。
3. 每天行动总时间不得超过 ${input.dailyMinutes} 分钟；轻松强度使用约 75% 时间，普通和挑战强度不超过可投入时间，挑战强度提高任务难度而不是增加时长。
4. 第一个阶段优先降低启动难度，围绕长期目标的第一个合理步骤建立节奏。
5. 禁止用“努力学习”“坚持下去”“提升自己”等空泛鼓励代替行动。
6. 如果阶段背景中包含用户希望使用的材料、场景或练习方式，下一阶段必须把这些信息转化为具体每日行动；不得退回“准备学习环境”“理解核心概念”“完成一个可验证的小步骤”等通用模板。
7. 不承诺结果，不输出医学诊断、投资保证或高风险建议。
8. 不推荐付费课程、购物或无关产品。
9. 所有文本使用简体中文，不包含 HTML、链接或 Markdown。
10. 只能返回一个符合下述结构的 JSON 对象，不返回解释文字。

{
  "stage": {
    "title": "2～30字",
    "summary": "5～150字",
    "focus": "2～50字",
    "durationDays": ${input.durationDays}
  },
  "days": [
    {
      "dayIndex": 1,
      "theme": "2～40字",
      "actions": [
        {
          "title": "2～40字的具体行动",
          "description": "2～150字的执行说明",
          "estimatedMinutes": 20
        }
      ]
    }
  ]
}`;
}

function buildStageRepairPrompt(input, invalidText) {
  return `${buildStagePrompt(input)}

上一份输出未通过 JSON Schema 校验。请重新生成完整 JSON，不要解释原因。
上一份输出仅用于识别格式问题：
${String(invalidText || "").slice(0, 4000)}`;
}

function listItems(items) {
  return Array.isArray(items) && items.length
    ? items.map((item) => `- ${item}`).join("\n")
    : "- 无";
}

function buildDirectStageGenerationPrompt(profile) {
  const safetyRule =
    /搏击|格斗|拳击|散打|武术|防身|对练|实战/.test(profile.title)
      ? `
安全附加要求：
- 只能生成安全、合法、循序渐进的体能准备、基础训练安排和正规教学建议。
- 涉及专业动作、实战训练或对练时，应建议在正规场馆和合格教练指导下进行。
- 不得生成用于伤害他人的技术指导，不得鼓励无保护对练或高风险自行训练。`
      : "";

  return `你是长期目标行动规划助手，不是学习笔记生成器。

请根据用户目标、期望结果、当前水平、每天可投入时间、阶段天数和限制条件，设计一个完整、具体、可执行的行动阶段。

目标领域是开放的，不得将所有目标强行转化为阅读、观看、学习知识或记录笔记。

用户目标资料：
- 目标名称：${profile.title}
- 期望结果：${profile.desiredOutcome}
- 领域标签：${profile.domainLabel}
- 目标类型：${profile.goalType}
- 分类组：${profile.categoryGroup}
- 当前水平：${profile.currentLevel}
- 计划强度：${profile.intensity}
- 每日可投入：${profile.dailyMinutes} 分钟
- 阶段天数：${profile.durationDays} 天
- 截止日期：${profile.deadline || "未设置"}
- 每周执行频率：${profile.weeklyFrequency || profile.durationDays} 天
- 限制条件：
${listItems(profile.constraints)}
- 可用资源：
${listItems(profile.availableResources)}
- 用户偏好：
${listItems(profile.preferences)}
${safetyRule}

每项行动必须包括：
1. 明确动作
2. 执行说明
3. 可验证的完成标准
4. 预计时间
5. 所需资源
6. 必要安全提示

要求：
- 每天 1～4 个行动，休息日 actions 为空。
- 每天总时间不得明显超过 dailyMinutes。
- 行动内容必须适合用户当前水平。
- 行动应循序渐进。
- 不得假设用户拥有没有提供的设备、场馆、软件或付费服务。
- 不得生成大量重复行动。
- 不得使用“努力学习”“坚持练习”“了解相关知识”等空泛表达代替行动。
- 第一阶段应优先降低启动难度。
- 只能输出规定 JSON。
- 不输出 Markdown。
- 不输出解释文字。
- 不输出隐藏推理过程。

只允许输出以下 JSON 结构：
{
  "stage": {
    "title": "2～40字",
    "objective": "5～200字",
    "focus": "2～80字",
    "durationDays": ${profile.durationDays},
    "successMetrics": ["3～80字"],
    "assumptions": ["3～80字"]
  },
  "days": [
    {
      "dayIndex": 1,
      "theme": "2～40字",
      "isRestDay": false,
      "actions": [
        {
          "title": "2～50字的具体行动",
          "actionType": "practice",
          "description": "5～200字的执行说明",
          "completionCriteria": "3～150字的完成标准",
          "estimatedMinutes": 30,
          "requiredResources": ["资源名称"],
          "safetyNotes": ["必要安全提示"]
        }
      ]
    }
  ]
}`;
}

function buildDirectStageRepairPrompt(profile, invalidText, problems) {
  return `${buildDirectStageGenerationPrompt(profile)}

上一份输出未通过校验或质量检查。请只返回修复后的完整 JSON，不要解释原因。

需要修复的问题：
${listItems(problems)}

上一份输出仅用于识别问题：
${String(invalidText || "").slice(0, 4000)}`;
}

function buildGoalAnalysisPrompt(input) {
  return `你是一名长期目标分析助手。

你的任务不是生成计划，而是理解用户真正想达成的目标，并判断当前信息是否足以制定个性化、可执行的行动方案。

用户已提供：
- 目标标题：${input.title}
- 补充描述：${input.description || "未填写"}
- 每日时间：${input.dailyMinutes || "未填写"} 分钟
- 阶段天数：${input.durationDays || "未填写"} 天
- 当前水平：${input.currentLevel || "未填写"}
- 强度：${input.intensity || "未填写"}
- 截止日期：${input.deadline || "未填写"}

你需要：
1. 将用户的模糊表达整理为清晰但不过度扩展的目标。
2. 判断目标领域、目标类型和目标歧义程度。
3. 找出真正影响行动方案的缺失信息。
4. 信息不足时，只提出 3～5 个最关键的问题。
5. 用户已经提供的信息不得重复询问。
6. 问题必须与当前目标直接相关。
7. 不得套用固定考试、学习或求职问题。
8. 不得在本步骤生成每日计划。
9. 不得输出具体任务安排。
10. 不得输出 Markdown。
11. 不得输出 JSON 以外的内容。
12. 不得输出隐藏推理过程。

提问优先级：
1. 用户真正想达到的结果
2. 当前水平或起点
3. 可投入时间和频率
4. 可用资源和环境
5. 限制条件
6. 行动偏好
7. 必要的安全边界

对搏击、格斗、健康、法律、财务等目标，采用开放理解目标 + 安全重述 + 必要澄清 + 限制后续方案范围。不得询问伤害他人的意图或危险动作细节。

只允许输出以下 JSON：
{
  "normalizedGoal": "2～80字",
  "categoryGroup": "learning",
  "domainLabel": "2～40字",
  "goalType": "skill",
  "ambiguityScore": 0.8,
  "confidenceScore": 0.6,
  "needsClarification": true,
  "missingDimensions": ["desired_outcome"],
  "questions": [
    {
      "id": "q_desired_outcome",
      "dimension": "desired_outcome",
      "question": "你主要想达到什么结果？",
      "type": "single_choice",
      "required": true,
      "options": ["提升体能和协调性", "系统学习某项搏击运动基础", "在正规场馆参加训练", "其他"]
    }
  ],
  "safetyContext": {
    "riskLevel": "low",
    "requiresProfessionalGuidance": false,
    "boundaries": []
  }
}`;
}

function buildGoalAnalysisRepairPrompt(input, invalidText) {
  return `${buildGoalAnalysisPrompt(input)}

上一份输出未通过 JSON 或 Schema 校验。请修复为完整 JSON，不要解释。
上一份输出：
${String(invalidText || "").slice(0, 4000)}`;
}

const FEEDBACK_TYPE_LABELS = {
  too_many_tasks: "任务太多",
  too_few_tasks: "任务太少",
  too_difficult: "难度太高",
  too_easy: "难度太低",
  too_theoretical: "太偏理论",
  not_enough_practice: "缺少实践",
  time_unreasonable: "时间安排不合理",
  resource_unavailable: "需要的资源我没有",
  direction_mismatch: "方向不符合预期",
  too_repetitive: "任务内容太重复",
  other: "其他",
};

const FEEDBACK_RESOLUTION_RULES = {
  too_many_tasks: "减少每天行动数量或缩短总时间，确保每日行动数明显少于上一版。",
  too_few_tasks: "在不超过时间预算的前提下增加合理行动。",
  too_difficult: "降低起步难度，拆小行动，减少复杂资源依赖。",
  too_easy: "在用户能力范围内增加挑战和可验证成果。",
  too_theoretical: "减少阅读、观看、记录类行动，增加实践性行动。",
  not_enough_practice: "增加 practice、execution、creation 类行动的比例。",
  time_unreasonable: "重新分配每天时间，使其符合 dailyMinutes 限制且分布合理。",
  resource_unavailable: "移除依赖用户没有的设备、场地、软件或服务，只使用用户已声明的资源。",
  direction_mismatch: "重新围绕 desiredOutcome 和用户说明确定阶段重点。",
  too_repetitive: "增加行动形式差异，但不能为了多样而偏离目标。",
  other: "根据用户补充说明实质调整方案。",
};

function buildFeedbackInstructions(feedbackTypes, feedbackNote) {
  const lines = feedbackTypes.map(
    (type) => `- ${FEEDBACK_TYPE_LABELS[type] || type}：${FEEDBACK_RESOLUTION_RULES[type] || "根据反馈调整。"}`,
  );
  if (feedbackNote) {
    lines.push(`- 用户补充说明：${feedbackNote}`);
  }
  return lines.join("\n");
}

function buildCurrentPlanSummary(currentPlan) {
  const actions = currentPlan.days.flatMap((day) => day.actions);
  const actionTypeDistribution = {};
  actions.forEach((action) => {
    const type = action.actionType || "practice";
    actionTypeDistribution[type] = (actionTypeDistribution[type] || 0) + 1;
  });
  const totalMinutes = actions.reduce((sum, a) => sum + (a.estimatedMinutes || 0), 0);
  const activeDays = currentPlan.days.filter((d) => !d.isRestDay && d.actions.length > 0);
  const requiredResources = Array.from(
    new Set(actions.flatMap((a) => a.requiredResources || [])),
  );
  return {
    stageTitle: currentPlan.stage.title,
    objective: currentPlan.stage.objective || currentPlan.stage.summary || "",
    focus: currentPlan.stage.focus,
    durationDays: currentPlan.stage.durationDays,
    totalActionCount: actions.length,
    averageDailyMinutes: activeDays.length ? Math.round(totalMinutes / activeDays.length) : 0,
    actionTypeDistribution,
    requiredResources,
  };
}

function buildStageRegenerationPrompt(context) {
  const profile = context.goalProfile;
  const summary = context.currentPlanSummary;
  const feedback = context.feedback;

  const safetyRule =
    /搏击|格斗|拳击|散打|武术|防身|对练|实战/.test(profile.title)
      ? `
安全附加要求：
- 只能生成安全、合法、循序渐进的体能准备、基础训练安排和正规教学建议。
- 涉及专业动作、实战训练或对练时，应建议在正规场馆和合格教练指导下进行。
- 不得生成用于伤害他人的技术指导，不得鼓励无保护对练或高风险自行训练。`
      : "";

  return `你是一名长期目标行动规划助手。

用户已经查看了上一版行动阶段，并反馈该方案不适合。

你需要根据：
1. 用户完整 GoalProfile
2. 上一版方案摘要
3. 用户选择的结构化反馈
4. 上一版质量问题
5. 用户时间和资源限制

重新设计完整阶段方案。

这不是修改文案任务。

你可以重新决定：
- 阶段标题
- 阶段目标
- 阶段重点
- 每天主题
- 每天行动数量
- 行动类型
- 行动顺序
- 时间分配
- 完成标准
- 所需资源
- 安全提示

不得只对原方案换词。必须实质解决用户反馈的问题。

用户目标资料：
- 目标名称：${profile.title}
- 期望结果：${profile.desiredOutcome}
- 领域标签：${profile.domainLabel}
- 目标类型：${profile.goalType}
- 分类组：${profile.categoryGroup}
- 当前水平：${profile.currentLevel}
- 计划强度：${profile.intensity}
- 每日可投入：${profile.dailyMinutes} 分钟
- 阶段天数：${profile.durationDays} 天
- 截止日期：${profile.deadline || "未设置"}
- 每周执行频率：${profile.weeklyFrequency || profile.durationDays} 天
- 限制条件：
${listItems(profile.constraints)}
- 可用资源：
${listItems(profile.availableResources)}
- 用户偏好：
${listItems(profile.preferences)}
${safetyRule}

上一版方案摘要：
- 阶段标题：${summary.stageTitle}
- 阶段目标：${summary.objective}
- 阶段重点：${summary.focus}
- 阶段天数：${summary.durationDays}
- 总行动数：${summary.totalActionCount}
- 日均时间：${summary.averageDailyMinutes} 分钟
- 行动类型分布：${JSON.stringify(summary.actionTypeDistribution)}
- 所需资源：${summary.requiredResources.join("、") || "无"}

用户结构化反馈：
${buildFeedbackInstructions(feedback.types, feedback.note)}

${context.previousQualityProblems.length ? `上一版质量问题：\n${listItems(context.previousQualityProblems)}` : ""}

这是第 ${context.regenerationAttempt} 次重新生成。

每项行动必须包括：
1. 明确动作
2. 执行说明
3. 可验证的完成标准
4. 预计时间
5. 所需资源
6. 必要安全提示

要求：
- 每天 1～4 个行动，休息日 actions 为空。
- 每天总时间不得明显超过 dailyMinutes。
- 行动内容必须适合用户当前水平。
- 行动应循序渐进。
- 不得假设用户拥有没有提供的设备、场馆、软件或付费服务。
- 不得生成大量重复行动。
- 不得使用"努力学习""坚持练习""了解相关知识"等空泛表达代替行动。
- 只能输出规定 JSON。
- 不输出 Markdown。
- 不输出解释文字。

只允许输出以下 JSON 结构：
{
  "stage": {
    "title": "2～40字",
    "objective": "5～200字",
    "focus": "2～80字",
    "durationDays": ${profile.durationDays},
    "successMetrics": ["3～80字"],
    "assumptions": ["3～80字"]
  },
  "days": [
    {
      "dayIndex": 1,
      "theme": "2～40字",
      "isRestDay": false,
      "actions": [
        {
          "title": "2～50字的具体行动",
          "actionType": "practice",
          "description": "5～200字的执行说明",
          "completionCriteria": "3～150字的完成标准",
          "estimatedMinutes": 30,
          "requiredResources": ["资源名称"],
          "safetyNotes": ["必要安全提示"]
        }
      ]
    }
  ]
}`;
}

function buildStageRegenerationRepairPrompt(context, invalidText, problems) {
  return `${buildStageRegenerationPrompt(context)}

上一份输出未通过校验或质量检查。请只返回修复后的完整 JSON，不要解释原因。

需要修复的问题：
${listItems(problems)}

上一份输出仅用于识别问题：
${String(invalidText || "").slice(0, 4000)}`;
}

module.exports = {
  DIRECT_STAGE_PROMPT_VERSION,
  GOAL_ANALYSIS_PROMPT_VERSION,
  STAGE_REGENERATION_PROMPT_VERSION,
  buildCurrentPlanSummary,
  buildDirectStageGenerationPrompt,
  buildDirectStageRepairPrompt,
  buildGoalAnalysisPrompt,
  buildGoalAnalysisRepairPrompt,
  buildStagePrompt,
  buildStageRegenerationPrompt,
  buildStageRegenerationRepairPrompt,
  buildStageRepairPrompt,
  FEEDBACK_TYPE_LABELS,
};
