import { persistTeam } from "../services/team";
import { writeManualStore } from "../services/manualStore";
import { ActionTask, ArchivedGoal, Goal, ManualDataStore } from "../types/manual";
import {
  MemberTodayStatus,
  Team,
  TeamDisplayMode,
  TeamMember,
  TeamMemberActionDetail,
} from "../types/team";
import { addDays, formatDate } from "./date";

const MOCK_FLAG_KEY = "JINBUJU_MOCK_SEEDED_V1";

export function isMockSeeded(): boolean {
  return Boolean(wx.getStorageSync(MOCK_FLAG_KEY));
}

export function clearMockData(): void {
  wx.removeStorageSync(MOCK_FLAG_KEY);
  wx.removeStorageSync("JINBUJU_MANUAL_MVP_V1");
  wx.removeStorageSync("JINBUJU_LOCAL_TEAM_V1");
}

function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function daysAgoDate(days: number): string {
  return formatDate(addDays(new Date(), -days));
}

function makeTask(
  id: string,
  goalId: string,
  title: string,
  dayOffset: number,
  estimated: number,
  status: ActionTask["status"],
  actual?: number,
): ActionTask {
  const date = daysAgoDate(dayOffset);
  const ts = daysAgoISO(dayOffset);
  return {
    id,
    goalId,
    title,
    plannedDate: date,
    currentDate: date,
    estimatedMinutes: estimated,
    actualMinutes: actual,
    status,
    source: "manual",
    createdAt: ts,
    updatedAt: ts,
    completedAt: status === "completed" || status === "partially_completed" ? ts : undefined,
  };
}

function buildSelfGoalAndTasks(): { goal: Goal; tasks: ActionTask[]; archived: ArchivedGoal[] } {
  const goalId = "goal_mock_cet";
  const startedAt = daysAgoDate(10);
  const goal: Goal = {
    id: goalId,
    title: "通过英语四六级",
    category: "cet",
    description: "每天背单词 + 听力 + 阅读交叉推进",
    status: "active",
    createdAt: daysAgoISO(10),
    startedAt,
    updatedAt: new Date().toISOString(),
  };

  const tasks: ActionTask[] = [
    makeTask("task_d9_w", goalId, "背30个单词", 9, 30, "completed", 30),
    makeTask("task_d9_l", goalId, "听一套听力", 9, 35, "completed", 35),
    makeTask("task_d8_w", goalId, "背30个单词", 8, 30, "completed", 30),
    makeTask("task_d8_e", goalId, "整理错题", 8, 40, "partially_completed", 20),
    makeTask("task_d7_w", goalId, "背30个单词", 7, 30, "completed", 30),
    makeTask("task_d7_r", goalId, "阅读理解2篇", 7, 45, "completed", 45),
    makeTask("task_d6_w", goalId, "背30个单词", 6, 30, "completed", 30),
    makeTask("task_d6_l", goalId, "听力精听", 6, 30, "skipped"),
    makeTask("task_d5_w", goalId, "背30个单词", 5, 30, "completed", 30),
    makeTask("task_d5_wr", goalId, "写作练习", 5, 45, "completed", 45),
    makeTask("task_d4_w", goalId, "背30个单词", 4, 30, "completed", 30),
    makeTask("task_d4_t", goalId, "真题一套", 4, 60, "completed", 60),
    makeTask("task_d3_w", goalId, "背30个单词", 3, 30, "completed", 30),
    makeTask("task_d3_e", goalId, "整理错题", 3, 35, "completed", 35),
    makeTask("task_d2_w", goalId, "背30个单词", 2, 30, "completed", 30),
    makeTask("task_d2_l", goalId, "听力练习", 2, 30, "partially_completed", 15),
    makeTask("task_d1_w", goalId, "背30个单词", 1, 30, "completed", 30),
    makeTask("task_d1_r", goalId, "阅读理解", 1, 40, "completed", 40),
    makeTask("task_d0_w", goalId, "背30个单词", 0, 30, "completed", 30),
    makeTask("task_d0_l", goalId, "听一套听力", 0, 35, "pending"),
    makeTask("task_d0_e", goalId, "整理错题", 0, 30, "pending"),
  ];

  const archivedGoalId = "goal_mock_blog";
  const archivedTasks: ActionTask[] = [
    makeTask("task_a1", archivedGoalId, "完成首页布局", 20, 40, "completed", 45),
    makeTask("task_a2", archivedGoalId, "写一篇关于项目的文章", 17, 60, "completed", 55),
    makeTask("task_a3", archivedGoalId, "检查移动端适配", 15, 30, "completed", 35),
  ];
  const archived: ArchivedGoal[] = [
    {
      id: archivedGoalId,
      title: "完成个人博客",
      status: "completed",
      createdAt: daysAgoISO(25),
      startedAt: daysAgoDate(25),
      endedAt: daysAgoDate(14),
      archivedAt: daysAgoISO(14),
      updatedAt: daysAgoISO(14),
      actions: archivedTasks,
      stats: {
        totalActions: 3,
        completedActions: 3,
        estimatedMinutes: 130,
        actualMinutes: 135,
        completionRate: 100,
        totalDays: 12,
        lastReviewSummary: "博客已上线，首页、文章和移动端适配全部完成。",
      },
    },
  ];

  return { goal, tasks, archived };
}

interface MockMemberSpec {
  nickname: string;
  goalTitle: string;
  actions: Array<{ title: string; status: MemberTodayStatus; estimated: number; growth: number }>;
  displayMode: TeamDisplayMode;
  encouragementCount: number;
}

const MEMBER_SPECS: MockMemberSpec[] = [
  { nickname: "阿岚", goalTitle: "准备作品集", actions: [{ title: "整理作品集首页结构", status: "completed", estimated: 20, growth: 20 }, { title: "补充项目说明文案", status: "completed", estimated: 25, growth: 25 }], displayMode: "nicknameOnly", encouragementCount: 2 },
  { nickname: "小柏", goalTitle: "提升英语表达", actions: [{ title: "完成25分钟听力精听", status: "completed", estimated: 25, growth: 25 }, { title: "复述5句重点表达", status: "partial", estimated: 35, growth: 5 }], displayMode: "public", encouragementCount: 1 },
  { nickname: "清予", goalTitle: "阅读写作计划", actions: [{ title: "整理章节笔记", status: "not_started", estimated: 30, growth: 0 }], displayMode: "anonymous", encouragementCount: 0 },
  { nickname: "南星", goalTitle: "恢复运动习惯", actions: [{ title: "慢跑20分钟", status: "not_started", estimated: 25, growth: 0 }], displayMode: "nicknameOnly", encouragementCount: 3 },
  { nickname: "林溪", goalTitle: "考公行测练习", actions: [{ title: "言语理解40题", status: "completed", estimated: 45, growth: 45 }, { title: "资料分析1组", status: "completed", estimated: 30, growth: 30 }], displayMode: "public", encouragementCount: 4 },
  { nickname: "子谦", goalTitle: "考研政治复习", actions: [{ title: "马原章节精讲", status: "completed", estimated: 50, growth: 50 }, { title: "真题选择题1组", status: "partial", estimated: 30, growth: 15 }], displayMode: "public", encouragementCount: 2 },
  { nickname: "沐辰", goalTitle: "教资面试准备", actions: [{ title: "结构化答题练习", status: "completed", estimated: 35, growth: 35 }, { title: "试讲片段录制", status: "completed", estimated: 40, growth: 40 }], displayMode: "nicknameOnly", encouragementCount: 1 },
  { nickname: "思远", goalTitle: "Python进阶学习", actions: [{ title: "完成装饰器章节", status: "completed", estimated: 40, growth: 40 }, { title: "写一个爬虫小脚本", status: "completed", estimated: 50, growth: 50 }], displayMode: "public", encouragementCount: 5 },
  { nickname: "知夏", goalTitle: "每日阅读30分钟", actions: [{ title: "阅读《深度工作》第3章", status: "partial", estimated: 30, growth: 18 }], displayMode: "nicknameOnly", encouragementCount: 0 },
  { nickname: "言书", goalTitle: "写作日更800字", actions: [{ title: "完成今日随笔", status: "completed", estimated: 40, growth: 40 }], displayMode: "public", encouragementCount: 6 },
  { nickname: "远舟", goalTitle: "吉他指弹练习", actions: [{ title: "练习《卡农》前奏", status: "not_started", estimated: 30, growth: 0 }], displayMode: "nicknameOnly", encouragementCount: 1 },
  { nickname: "青棠", goalTitle: "水彩画临摹", actions: [{ title: "临摹一幅风景小品", status: "partial", estimated: 60, growth: 35 }], displayMode: "public", encouragementCount: 2 },
  { nickname: "见微", goalTitle: "理财记账复盘", actions: [{ title: "整理本周支出分类", status: "completed", estimated: 20, growth: 20 }], displayMode: "nicknameOnly", encouragementCount: 0 },
  { nickname: "明朗", goalTitle: "冥想10分钟", actions: [{ title: "晨间正念冥想", status: "completed", estimated: 10, growth: 10 }], displayMode: "public", encouragementCount: 3 },
  { nickname: "岁安", goalTitle: "早睡早起计划", actions: [{ title: "23点前入睡", status: "partial", estimated: 0, growth: 0 }], displayMode: "nicknameOnly", encouragementCount: 1 },
  { nickname: "时安", goalTitle: "戒糖30天", actions: [{ title: "今日无添加糖", status: "completed", estimated: 0, growth: 0 }], displayMode: "public", encouragementCount: 4 },
  { nickname: "念薇", goalTitle: "法语入门", actions: [{ title: "学习发音规则", status: "not_started", estimated: 25, growth: 0 }], displayMode: "anonymous", encouragementCount: 0 },
  { nickname: "景行", goalTitle: "健身增肌", actions: [{ title: "胸肌训练日", status: "completed", estimated: 50, growth: 50 }, { title: "蛋白粉补充记录", status: "completed", estimated: 5, growth: 5 }], displayMode: "public", encouragementCount: 5 },
  { nickname: "允知", goalTitle: "摄影构图练习", actions: [{ title: "拍摄一组街景", status: "partial", estimated: 40, growth: 25 }], displayMode: "nicknameOnly", encouragementCount: 2 },
  { nickname: "怀瑾", goalTitle: "书法每日练字", actions: [{ title: "临帖30分钟", status: "completed", estimated: 30, growth: 30 }], displayMode: "public", encouragementCount: 3 },
];

function buildMember(spec: MockMemberSpec, index: number, teamId: string): TeamMember {
  const now = new Date().toISOString();
  const details: TeamMemberActionDetail[] = spec.actions.map((action, i) => ({
    id: `mock_act_${index + 1}_${i + 1}`,
    title: action.title,
    status: action.status,
    estimatedMinutes: action.estimated,
    growthMinutes: action.growth,
  }));

  const hasCompleted = details.some((d) => d.status === "completed");
  const hasPartial = details.some((d) => d.status === "partial");
  const allCompleted = details.length > 0 && details.every((d) => d.status === "completed");
  const todayStatus: MemberTodayStatus = allCompleted
    ? "completed"
    : hasCompleted || hasPartial
      ? "partial"
      : details.some((d) => d.status === "missed")
        ? "missed"
        : "not_started";

  const estimated = details.reduce((sum, d) => sum + d.estimatedMinutes, 0);
  const growth = details.reduce((sum, d) => sum + d.growthMinutes, 0);
  const publicMode = spec.displayMode === "public";

  return {
    id: `member_mock_${index + 1}`,
    userId: `mock_user_${index + 1}`,
    teamId,
    displayMode: spec.displayMode,
    nickname: spec.nickname,
    anonymousName: `行动伙伴 ${String(index + 2).padStart(2, "0")}`,
    avatar: "",
    goalTitle: spec.goalTitle,
    todayActionTitle: publicMode && details.length > 0 ? details[0].title : "",
    todayActionDetails: publicMode ? details : [],
    taskDetailVisible: publicMode,
    todayStatus,
    estimatedMinutes: estimated,
    growthMinutes: growth,
    encouragementCount: spec.encouragementCount,
    encouragedByMeToday: false,
    isSelf: false,
    updatedAt: now,
  };
}

function buildSelfMember(teamId: string, goalTitle: string): TeamMember {
  const now = new Date().toISOString();
  const details: TeamMemberActionDetail[] = [
    { id: "mock_self_1", title: "背30个单词", status: "completed", estimatedMinutes: 30, growthMinutes: 30 },
    { id: "mock_self_2", title: "听一套听力", status: "not_started", estimatedMinutes: 35, growthMinutes: 0 },
    { id: "mock_self_3", title: "整理错题", status: "not_started", estimatedMinutes: 30, growthMinutes: 0 },
  ];
  return {
    id: "member_self",
    userId: "local_user",
    teamId,
    displayMode: "nicknameOnly",
    nickname: "我",
    anonymousName: "行动伙伴 01",
    avatar: "",
    goalTitle,
    todayActionTitle: "听一套听力",
    todayActionDetails: details,
    taskDetailVisible: false,
    todayStatus: "partial",
    estimatedMinutes: 95,
    growthMinutes: 30,
    encouragementCount: 0,
    encouragedByMeToday: false,
    isSelf: true,
    updatedAt: now,
  };
}

function seedTeamStore(selfGoalTitle: string): void {
  const teamId = "team_mock_1";
  const now = new Date();
  const team: Team = {
    id: teamId,
    name: "自律同行 TQLR 队",
    avatar: "",
    roomCode: "TQLR26",
    ownerId: "local_user",
    visibility: "private",
    allowAnonymous: true,
    actionDetailVisibility: "all_members",
    maxMembers: 50,
    memberCount: 0,
    createdAt: daysAgoISO(10),
    phaseStartDate: daysAgoDate(10),
    phaseEndDate: formatDate(addDays(now, 7)),
    description: "跨目标自律同行 · 各行各业一起推进",
    status: "active",
  };

  const selfMember = buildSelfMember(teamId, selfGoalTitle);
  const demoMembers = MEMBER_SPECS.map((spec, index) => buildMember(spec, index, teamId));
  persistTeam(team, [selfMember, ...demoMembers]);
}

function seedManualStore(): string {
  const { goal, tasks, archived } = buildSelfGoalAndTasks();
  const store: ManualDataStore = {
    version: 1,
    activeGoalId: goal.id,
    goals: [goal],
    tasks,
    checkins: [],
    archivedGoals: archived,
  };
  writeManualStore(store);
  return goal.title;
}

export function seedMockData(): void {
  clearMockData();
  const goalTitle = seedManualStore();
  seedTeamStore(goalTitle);
  wx.setStorageSync(MOCK_FLAG_KEY, true);
}
