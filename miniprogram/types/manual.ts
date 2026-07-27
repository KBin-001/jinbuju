import { AchievementUnlockRecord } from "./achievement";
import { SparkCheckin } from "./spark";

export type GoalCategory =
  | "cet"
  | "teacher"
  | "postgraduate"
  | "civil_service"
  | "undergraduate_upgrade"
  | "ai_learning"
  | "custom";
export type GoalStatus = "active" | "completed" | "ended" | "archived";

export interface GoalMilestone {
  id: string;
  title: string;
  targetDate?: string;
  status: "pending" | "completed";
  completedAt?: string;
}

export interface Goal {
  id: string;
  title: string;
  category: GoalCategory;
  description?: string;
  status: GoalStatus;
  createdAt: string;
  startedAt?: string;
  targetDate?: string;
  milestones?: GoalMilestone[];
  onboardingCompletedAt?: string;
  endedAt?: string;
  archivedAt?: string;
  deletedAt?: string;
  updatedAt: string;
}

export type ActionTaskStatus = "pending" | "completed" | "partially_completed" | "skipped" | "rescheduled";
export type ActionExecutionMode = "direct" | "focus";
export type ActionSessionStatus = "running" | "paused" | "completed" | "abandoned";

export interface ActionSession {
  id: string;
  goalId: string;
  taskId: string;
  businessDate: string;
  mode: "stopwatch" | "countdown";
  targetSeconds?: number;
  elapsedSeconds: number;
  status: ActionSessionStatus;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
}
export type ActionIssueReason = "not_enough_time" | "too_difficult" | "resource_unavailable" | "physical_condition" | "temporary_event" | "not_practical" | "other";
export type ActionIconKey = "study" | "reading" | "language" | "writing" | "exam" | "work" | "coding" | "exercise" | "meal" | "movie" | "creative" | "life";

export type ActionReminderStatus = "pending_authorization" | "scheduled" | "sent" | "cancelled" | "expired" | "failed";

export interface ActionReminder {
  time: string;
  remindAt: string;
  status: ActionReminderStatus;
}

export interface ActionTask {
  id: string;
  goalId: string;
  title: string;
  description?: string;
  plannedDate: string;
  currentDate: string;
  estimatedMinutes: number;
  /** 执行方式：直接打卡或专注计时。 */
  executionMode?: ActionExecutionMode;
  /** 行动图标；未手动选择时由标题自动映射。 */
  iconKey?: ActionIconKey;
  /** true 表示用户手动固定图标；否则标题变化时继续自动映射。 */
  iconManual?: boolean;
  actualMinutes?: number;
  /** 当天的感受、收获或困难；用于日详情、AI 分析与历史复盘。 */
  reflection?: string;
  status: ActionTaskStatus;
  source: "manual" | "ai";
  issueReason?: ActionIssueReason;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  /** 软删除标记；保留记录用于跨设备同步删除。 */
  deletedAt?: string;
  /** 首次行动任务 id；顺延产生的后继任务共享同一来源。 */
  originTaskId?: string;
  rolloverCount?: number;
  rescheduledAt?: string;
  rescheduledToTaskId?: string;
  /** 顺延前的执行状态，用于保留原日期上已经发生的真实投入。 */
  statusBeforeReschedule?: "pending" | "partially_completed" | "skipped";
  /** 实际发生行动的业务日期，用于稳定统计。 */
  activityDate?: string;
  /** 用户主动设置的微信一次性订阅提醒摘要；云端 task_reminders 是投递状态真相。 */
  reminder?: ActionReminder;
  /** 重要程度：required 表示必须完成，在优先级评分中获得更高权重。未填默认 normal。 */
  importance?: "required" | "normal";
  /** 是否阻塞其他任务，标记为 true 的任务在评分中获得依赖维度加分。未填默认 false。 */
  blocksOthers?: boolean;
  /** 用户手动覆盖的分组；非 null 时直接进入对应分组，跳过自动评分。未填默认 null。 */
  priorityOverride?: "focus" | "quick" | "later" | null;
}

export interface DailyCheckin {
  id: string;
  goalId: string;
  businessDate: string;
  completedCount: number;
  partialCount: number;
  actualMinutes: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface DailyActionSummary {
  date: string;
  label: string;
  completedCount: number;
  partialCount: number;
  totalCount: number;
  isToday: boolean;
}

export interface GrowthHeatmapDay {
  date: string;
  label: string;
  monthLabel?: string;
  completedCount: number;
  partialCount: number;
  totalCount: number;
  completionRate: number;
  level: 0 | 1 | 2 | 3;
  isToday: boolean;
}

export interface GrowthBadge {
  key: string;
  title: string;
  description: string;
  unlocked: boolean;
  progressText: string;
}

export interface ProgressSummary {
  totalTasks: number;
  completedTasks: number;
  totalActualMinutes: number;
  totalActionDays: number;
  todayCompleted: number;
  todayTotal: number;
  currentStreakDays: number;
  longestStreakDays: number;
  recentDays: DailyActionSummary[];
  heatmapWeeks: GrowthHeatmapDay[][];
  badges: GrowthBadge[];
  unfinishedTasks: ActionTask[];
}

export interface TodaySummary {
  estimatedMinutes: number;
  actualMinutes: number;
  completedCount: number;
  partialCount: number;
  unfinishedCount: number;
  totalCount: number;
}

export interface ArchivedGoalStats {
  totalActions: number;
  completedActions: number;
  estimatedMinutes: number;
  actualMinutes: number;
  completionRate: number;
  totalDays?: number;
  lastReviewSummary?: string;
}

export interface ArchivedGoal {
  id: string;
  title: string;
  category?: GoalCategory;
  description?: string;
  targetDate?: string;
  milestones?: GoalMilestone[];
  status: "completed" | "ended" | "archived";
  createdAt: string;
  startedAt?: string;
  endedAt: string;
  archivedAt: string;
  updatedAt: string;
  deletedAt?: string;
  restoredAt?: string;
  purgedAt?: string;
  actions: ActionTask[];
  stats: ArchivedGoalStats;
}

export interface ManualDataStore {
  version: 1;
  activeGoalId?: string;
  goals: Goal[];
  tasks: ActionTask[];
  checkins: DailyCheckin[];
  archivedGoals: ArchivedGoal[];
  actionSessions?: ActionSession[];
  achievementUnlocks?: AchievementUnlockRecord[];
  sparkCheckins?: SparkCheckin[];
}
