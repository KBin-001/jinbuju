import type { ActionIconKey } from "../types/manual";

export interface ActionIconOption {
  key: ActionIconKey;
  label: string;
  icon: string;
  asset: string;
  tone: "jade" | "blue" | "gold" | "orange" | "purple";
}

export const ACTION_ICON_OPTIONS: ActionIconOption[] = [
  { key: "study", label: "学习", icon: "book-open", asset: "/assets/action-icons/study.svg", tone: "jade" },
  { key: "reading", label: "阅读", icon: "book", asset: "/assets/action-icons/reading.svg", tone: "blue" },
  { key: "language", label: "听说", icon: "audio", asset: "/assets/action-icons/language.svg", tone: "purple" },
  { key: "writing", label: "写作", icon: "edit-1", asset: "/assets/action-icons/writing.svg", tone: "gold" },
  { key: "exam", label: "考试", icon: "task-checked", asset: "/assets/action-icons/exam.svg", tone: "jade" },
  { key: "work", label: "工作", icon: "work", asset: "/assets/action-icons/work.svg", tone: "blue" },
  { key: "coding", label: "编程", icon: "code", asset: "/assets/action-icons/coding.svg", tone: "purple" },
  { key: "exercise", label: "运动", icon: "activity", asset: "/assets/action-icons/exercise.svg", tone: "orange" },
  { key: "meal", label: "用餐", icon: "rice", asset: "/assets/action-icons/meal.svg", tone: "orange" },
  { key: "movie", label: "观影", icon: "film", asset: "/assets/action-icons/movie.svg", tone: "purple" },
  { key: "creative", label: "创作", icon: "palette", asset: "/assets/action-icons/creative.svg", tone: "gold" },
  { key: "life", label: "生活", icon: "home", asset: "/assets/action-icons/life.svg", tone: "blue" },
];

const ICON_BY_KEY = new Map(ACTION_ICON_OPTIONS.map((option) => [option.key, option]));

export function inferActionIconKey(title: string, description = ""): ActionIconKey {
  const copy = `${title} ${description}`.toLowerCase();
  if (/跑步|健身|运动|瑜伽|跳绳|游泳|骑行|篮球|足球|散步|拉伸/.test(copy)) return "exercise";
  if (/吃饭|早餐|午餐|晚餐|用餐|做饭|饮食|喝水|咖啡/.test(copy)) return "meal";
  if (/电影|观影|看剧|纪录片|视频|影院/.test(copy)) return "movie";
  if (/代码|编程|开发|算法|刷题平台|bug|程序|前端|后端|python|java/.test(copy)) return "coding";
  if (/工作|会议|汇报|项目|方案|邮件|客户|复盘会|办公/.test(copy)) return "work";
  if (/考试|真题|模拟题|行测|申论|试卷|测验|备考/.test(copy)) return "exam";
  if (/听力|口语|跟读|朗读|发音|音频|播客|背诵/.test(copy)) return "language";
  if (/写作|写文章|作文|日记|笔记|摘抄|总结|输出/.test(copy)) return "writing";
  if (/阅读|读书|看书|读完|章节|文献|论文/.test(copy)) return "reading";
  if (/画画|绘画|设计|摄影|剪辑|音乐|练琴|创作/.test(copy)) return "creative";
  if (/背单词|单词|词汇|学习|复习|预习|课程|上课|练习|知识/.test(copy)) return "study";
  return "life";
}

export function getActionIconOption(key?: ActionIconKey): ActionIconOption {
  return (key ? ICON_BY_KEY.get(key) : undefined) || ICON_BY_KEY.get("life")!;
}

export function resolveActionIcon(title: string, description = "", manualKey?: ActionIconKey): ActionIconOption {
  return getActionIconOption(manualKey || inferActionIconKey(title, description));
}
