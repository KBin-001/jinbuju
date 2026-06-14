const CATEGORY_LABELS = {
  exam: "考试备考",
  skill: "技能学习",
  career: "求职提升",
};

const LEVEL_LABELS = {
  zero: "完全没接触过",
  basic: "了解一点",
  intermediate: "有一定基础",
  experienced: "已经学习一段时间",
  improve: "希望系统提升",
};

const INTENSITY_LABELS = {
  light: "轻松",
  normal: "普通",
  intensive: "冲刺",
};

function buildPrompt(goal, currentDate) {
  return `你是一名成长计划设计师。请严格只返回一个 JSON 对象，不要返回 Markdown、代码块、解释或额外文字。

用户信息：
- 当前日期：${currentDate}
- 目标类型：${CATEGORY_LABELS[goal.category]}
- 具体目标：${goal.goalTitle}
- 当前水平：${LEVEL_LABELS[goal.currentLevel]}
- 截止日期：${goal.deadline}
- 每周学习天数：${goal.weeklyDays}
- 每日可投入：${goal.dailyMinutes} 分钟
- 执行强度：${INTENSITY_LABELS[goal.intensity]}

生成规则：
1. 固定生成连续 7 天，days 必须恰好有 7 项，day 为 1 到 7 且不重复。
2. 学习日数量必须恰好为 ${goal.weeklyDays} 天，并均匀分布；其余为休息或轻量复习日。
3. 学习日每日至少一个具体、可执行、可打卡的任务，任务总时长不得超过 ${goal.dailyMinutes} 分钟。
4. 休息日 isStudyDay=false 且 tasks=[]。
5. 禁止“努力学习”“继续提升”“了解相关内容”“保持坚持”等模糊任务。
6. 禁止推荐付费课程、高成本产品或购物。
7. 所有字符串使用简体中文，不包含 HTML、脚本或链接。

只允许以下 JSON 结构：
{
  "summary": "不超过100字",
  "weeklyGoal": "不超过100字",
  "days": [
    {
      "day": 1,
      "title": "当天主题",
      "isStudyDay": true,
      "tasks": [
        {
          "title": "具体任务",
          "estimatedMinutes": 20
        }
      ]
    }
  ],
  "fallbackAdvice": "未完成时的顺延建议，不超过160字"
}`;
}

function buildRepairPrompt(goal, invalidText, currentDate) {
  return `${buildPrompt(goal, currentDate)}

上一份输出未通过结构校验。请重新生成完整 JSON，不要解释原因。
上一份输出仅供识别问题，不要复制其中的额外格式：
${String(invalidText).slice(0, 4000)}`;
}

module.exports = { buildPrompt, buildRepairPrompt };
