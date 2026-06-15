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

function buildStagePrompt(input) {
  const review = input.previousReview
    ? `上一阶段重点为“${input.previousReview.previousFocus}”，完成率 ${input.previousReview.completionRate}%，实际行动 ${input.previousReview.actionDays} 天，难度感受 ${input.previousReview.difficulty}，下一阶段偏好 ${input.previousReview.nextPreference}${
        input.previousReview.focusAdjustment
          ? `，希望调整重点为：${input.previousReview.focusAdjustment}`
          : ""
      }。完成率较低时减少每日行动数量或时长；感受偏轻松时可适当增加挑战；选择保持节奏时维持相近任务量。请据此调整任务量和重点，但不要改变长期目标。`
    : "这是第一个行动阶段，优先降低启动难度并建立节奏。";
  return `你是一名长期目标行动拆解助手。你不是聊天助手，只负责生成可执行的短期行动阶段。

长期目标：
- 目标名称：${input.goalTitle}
- 目标分类：${CATEGORY_LABELS[input.category]}
- 期望结果：${input.desiredResult}
- 每日可投入：${input.dailyMinutes} 分钟
- 长期周期：${DURATION_LABELS[input.targetDuration]}
- 当前阶段：第 ${input.stageNumber} 阶段
- 阶段天数：${input.durationDays} 天
- 阶段背景：${review}

必须遵守：
1. 阶段持续 durationDays 天，days 数量必须完全一致。
2. 每天生成 1～4 个具体、可执行、可验证的行动。
3. 每天行动总时间不得超过 ${Math.ceil(input.dailyMinutes * 1.2)} 分钟，并尽量接近 ${input.dailyMinutes} 分钟。
4. 第一个阶段优先降低启动难度，围绕长期目标的第一个合理步骤建立节奏。
5. 禁止用“努力学习”“坚持下去”“提升自己”等空泛鼓励代替行动。
6. 不承诺结果，不输出医学诊断、投资保证或高风险建议。
7. 不推荐付费课程、购物或无关产品。
8. 所有文本使用简体中文，不包含 HTML、链接或 Markdown。
9. 只能返回一个符合下述结构的 JSON 对象，不返回解释文字。

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

module.exports = {
  buildStagePrompt,
  buildStageRepairPrompt,
};
