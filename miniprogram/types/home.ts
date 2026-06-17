import {
  CloudFunctionResult as SharedCloudFunctionResult,
  PlanStatus,
} from "./goal";

export type CloudFunctionResult<T> = SharedCloudFunctionResult<T>;

export interface UserProgress {
  nickname: string;
  streakDays: number;
}

export interface GoalSummary {
  id: string;
  planId: string;
  title: string;
  category: string;
  currentDay: number;
  totalDays: number;
  planCompletionRate: number;
  planStatus: PlanStatus;
  stageTitle: string;
}

/** 任务执行结果状态 */
export type ActionResultStatus =
  | "completed"           // 已完成
  | "partially_completed" // 部分完成
  | "skipped"             // 跳过
  | "rescheduled";        // 重新安排

/** 跳过/未完成原因 */
export type SkipReason =
  | "not_enough_time"
  | "too_difficult"
  | "insufficient_resources"
  | "not_feeling_well"
  | "unexpected_event"
  | "task_not_realistic"
  | "other";

/** 打卡整体状态 */
export type CheckinOverallStatus = ActionResultStatus;

/** 单个任务的执行结果 */
export interface TaskActionResult {
  taskId: string;
  status: ActionResultStatus;
}

export interface TodayTask {
  id: string;
  title: string;
  description: string;
  estimatedMinutes: number;
  timePeriod: "morning" | "afternoon" | "evening" | "anytime";
  source: "manual" | "ai" | "template" | "carry_over";
  sourceLabel: string;
  planId: string;
  planTitle: string;
  completed: boolean;
  resultStatus?: ActionResultStatus;
}

export interface TodayTaskGroup {
  key: "morning" | "afternoon" | "evening" | "anytime";
  title: string;
  tasks: TodayTask[];
}

export interface TaskSourceSummary {
  key: string;
  label: string;
  count: number;
}

export interface HomeData {
  businessDate: string;
  user: UserProgress;
  goal: GoalSummary | null;
  todayTasks: TodayTask[];
  taskGroups: TodayTaskGroup[];
  sourceSummary: TaskSourceSummary[];
  completedCount: number;
  totalCount: number;
  completionRate: number;
  checkedInToday: boolean;
  todayRest: boolean;
}

export interface TodayCheckinDraft {
  goalId: string;
  planId: string;
  businessDate: string;
  tasks: TodayTask[];
  completedTaskIds: string[];
  completedCount: number;
  totalCount: number;
  preparedAt: number;
  taskResults?: TaskActionResult[];
}

export type CheckinFeeling = "easy" | "normal" | "challenging" | "rewarding";

export interface SubmitCheckinParams {
  goalId: string;
  planId: string;
  /** @deprecated 使用 taskResults 替代，保留向后兼容 */
  completedTaskIds?: string[];
  taskResults: TaskActionResult[];
  feeling: CheckinFeeling;
  note?: string;
  skipReason?: SkipReason;
  overallStatus?: CheckinOverallStatus;
}

export interface SubmitCheckinResult {
  businessDate: string;
  completedCount: number;
  totalCount: number;
  completionRate: number;
  streakDays: number;
  isFirstCheckinToday: boolean;
  overallStatus: CheckinOverallStatus;
}

export interface CheckinStatusData {
  checkedInToday: boolean;
  tasks: TodayTask[];
  completedCount: number;
  totalCount: number;
  planStatus: PlanStatus | null;
  taskResults?: TaskActionResult[];
}

/** 任务状态选项 */
export const ACTION_STATUS_OPTIONS: {
  value: ActionResultStatus;
  label: string;
  icon: string;
}[] = [
  { value: "completed", label: "已完成", icon: "✓" },
  { value: "partially_completed", label: "一部分", icon: "◐" },
  { value: "skipped", label: "没做", icon: "–" },
  { value: "rescheduled", label: "改天", icon: "→" },
];

/** 跳过/未完成原因选项 */
export const SKIP_REASON_OPTIONS: {
  value: SkipReason;
  label: string;
}[] = [
  { value: "not_enough_time", label: "时间不够" },
  { value: "too_difficult", label: "任务太难" },
  { value: "insufficient_resources", label: "资源不足" },
  { value: "not_feeling_well", label: "状态不适" },
  { value: "unexpected_event", label: "临时有事" },
  { value: "task_not_realistic", label: "不符合实际" },
  { value: "other", label: "其他" },
];
