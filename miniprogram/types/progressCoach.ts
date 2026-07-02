export type CoachRange = "week" | "month" | "overall";
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
}

export type ProgressCoachAnalysis = ProgressCoachSuccess;

export interface ProgressCoachAnswer {
  answer: string;
  evidenceTaskIds: string[];
  evidenceDates: string[];
}

export interface ProgressCoachChatMessage {
  role: "user" | "assistant";
  content: string;
}
