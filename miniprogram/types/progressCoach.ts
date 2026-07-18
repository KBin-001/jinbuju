export type CoachRange = "day" | "week" | "month" | "overall";
export type ProgressCoachDataLevel = "goal_only" | "sparse" | "rich";

export interface CoachDailyMetric {
  date: string;
  totalTasks: number;
  completed: number;
  partial: number;
  skipped: number;
  rescheduled: number;
  actualMinutes: number;
}

export interface ProgressCoachMetrics {
  totalTasks: number;
  completed: number;
  partial: number;
  skipped: number;
  rescheduled: number;
  pending: number;
  actualMinutes: number;
  activeDays: number;
  streakDays: number;
  completionRate: number;
  daily: CoachDailyMetric[];
}

export interface ProgressCoachEvidence {
  text: string;
  taskIds: string[];
  dates: string[];
}

export interface ProgressCoachSuccess {
  status: "success";
  range: CoachRange;
  dataLevel: ProgressCoachDataLevel;
  period: { startDate: string; endDate: string };
  summary: string;
  metrics: ProgressCoachMetrics;
  rhythmDiagnosis: string[];
  nextSuggestions: string[];
  evidence: ProgressCoachEvidence[];
  generatedAt?: string;
  sourceUpdatedAt?: string;
}

export type ProgressCoachAnalysis = ProgressCoachSuccess;

export type ProgressCoachReplyMode = "direct" | "compact" | "detailed";
export type ProgressCoachStatKey =
  | "completedActions"
  | "totalMinutes"
  | "activeDays"
  | "completionRate"
  | "currentStreakDays"
  | "recentActionDate";

export interface ProgressCoachReplyStat {
  key: ProgressCoachStatKey;
  label: string;
  value: string;
}

export type CoachPresentationKind = "summary" | "metrics" | "priorities" | "tasks" | "clarification";
export type CoachPresentationTone = "positive" | "warning" | "neutral" | "success";

export interface CoachPresentationMetric {
  label: string;
  value: string;
  unit?: string;
  progress?: number;
}

export interface CoachPresentationSection {
  index: string;
  title: string;
  detail: string;
}

export interface CoachPresentationPriority {
  label: string;
  title: string;
  detail: string;
  tone: CoachPresentationTone;
}

export interface CoachPresentation {
  kind: CoachPresentationKind;
  eyebrow: string;
  title: string;
  summary: string;
  metrics?: CoachPresentationMetric[];
  sections?: CoachPresentationSection[];
  priorities?: CoachPresentationPriority[];
}

export interface ProgressCoachAnswer {
  answer: string;
  conversationId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
  generatedAt?: string;
  contextVersion?: string;
  evidenceTaskIds?: string[];
  evidenceDates?: string[];
  mode?: ProgressCoachReplyMode;
  summary?: string;
  statKeys?: ProgressCoachStatKey[];
  stats?: ProgressCoachReplyStat[];
  insights?: string[];
  advice?: string;
  followUps?: string[];
  presentation?: CoachPresentation;
  actionProposal?: CoachActionProposal;
}

export type CoachActionRequiredField = "taskId" | "actualMinutes" | "title" | "estimatedMinutes" | "goalId" | "reminderTime";
export type CoachActionType = "complete_task" | "create_task" | "needs_clarification";

export interface CoachActionProposal {
  id?: string;
  type: CoachActionType;
  status: "pending" | "needs_input" | "executed" | "failed";
  summary?: string;
  requiredFields?: CoachActionRequiredField[];
  taskId?: string;
  taskTitle?: string;
  candidateTaskIds?: string[];
  candidateTaskTitles?: string[];
  actualMinutes?: number;
  completedAt?: string;
  title?: string;
  estimatedMinutes?: number;
  reminderTime?: string;
  currentDate?: string;
  expiresAt?: string;
}

export interface CoachActionResult {
  proposalId: string;
  type: "complete_task" | "create_task";
  status: "executed";
  task: import("./manual").ActionTask;
  reminderTime?: string;
}

export interface CoachActionStatusResult {
  proposalId: string;
  type: "complete_task" | "create_task";
  status: "pending" | "executed" | "expired";
  result?: CoachActionResult;
}

export interface ProgressCoachChatMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  sentAt?: string;
  scope?: CoachRange;
  analysisDate?: string;
  goalId?: string;
  presentation?: CoachPresentation;
  actionProposal?: CoachActionProposal;
}

export interface CoachConversation {
  conversationId: string;
  messages: ProgressCoachChatMessage[];
  hasMore: boolean;
}
