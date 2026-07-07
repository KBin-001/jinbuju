export interface SparkCheckin {
  businessDate: string;
  checkedAt: string;
}

export interface SparkStatus {
  checkedInToday: boolean;
  currentStreak: number;
  totalCheckins: number;
}
