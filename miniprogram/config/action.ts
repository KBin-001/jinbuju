export const ACTION_DURATION_MIN_MINUTES = 5;
export const ACTION_DURATION_MAX_MINUTES = 360;

export const ACTION_DURATION_VALUES = [15, 25, 30, 45, 60, 90, 120, 180, 240] as const;

export const ACTION_DURATION_OPTIONS = ACTION_DURATION_VALUES.map((value) => ({
  label: `${value} 分钟`,
  value,
}));
