/**
 * 任务优先级分组工具
 *
 * 纯函数，不依赖页面渲染逻辑或存储层。接收任务列表和上下文，
 * 按多维评分公式自动分组为"今日重点""快速推进""稍后安排"三段。
 *
 * 评分公式（内部计算，不展示给用户）：
 *   任务优先分 = 重要程度 × 35%
 *              + 截止紧迫度 × 25%
 *              + 对目标的推动价值 × 20%
 *              + 连续行动情况 × 10%
 *              + 用户执行习惯 × 10%
 */

/** 推荐理由标签 */
export interface PriorityReason {
  key: "manual_pin" | "due_today" | "streak" | "core_goal" | "rollover" | "required";
  label: string;
}

/** 理由标签展示优先级（数值越小越靠前） */
const REASON_PRIORITY: Record<string, number> = {
  manual_pin: 0,
  due_today: 1,
  core_goal: 2,
  required: 3,
  streak: 4,
  rollover: 5,
};

/** 每个任务最多展示的理由标签数量 */
const MAX_DISPLAY_REASONS = 2;

/** 按优先级截取理由标签，最多保留 MAX_DISPLAY_REASONS 个 */
function trimReasons(reasons: PriorityReason[]): PriorityReason[] {
  return reasons
    .slice()
    .sort((a, b) => (REASON_PRIORITY[a.key] ?? 99) - (REASON_PRIORITY[b.key] ?? 99))
    .slice(0, MAX_DISPLAY_REASONS);
}

/** 评分上下文 */
export interface PriorityContext {
  /** 今日业务日期 YYYY-MM-DD */
  today: string;
  /** 当前目标截止日期 YYYY-MM-DD，可选 */
  goalTargetDate?: string;
  /** 连续行动天数 */
  currentStreakDays: number;
}

/** 评分所需的最小任务字段集 */
export interface PriorityScorableTask {
  id: string;
  title: string;
  status?: string;
  currentDate: string;
  estimatedMinutes: number;
  source?: string;
  rolloverCount?: number;
  importance?: "required" | "normal";
  priorityOverride?: "focus" | "quick" | "later" | null;
}

/** 优先级分组结果 */
export interface PriorityGroup<T extends PriorityScorableTask> {
  key: "focus" | "quick" | "later";
  title: string;
  hint: string;
  icon: string;
  tone: "gold" | "green" | "muted";
  tasks: Array<T & { priorityReasons: PriorityReason[] }>;
}

const FOCUS_MAX = 2;
const QUICK_MAX = 3;
const QUICK_MAX_MINUTES = 40;
const FOCUS_THRESHOLD = 70;
const QUICK_THRESHOLD = 50;

const GROUP_DEFS: Record<"focus" | "quick" | "later", { title: string; hint: string; icon: string; tone: "gold" | "green" | "muted" }> = {
  focus: { title: "今日重点", hint: "推进核心目标", icon: "flag", tone: "gold" },
  quick: { title: "快速推进", hint: "适合现在开始", icon: "thunder", tone: "green" },
  later: { title: "稍后安排", hint: "已为你安排到专注时段", icon: "time", tone: "muted" },
};

function normalizeImportance(task: PriorityScorableTask): "required" | "normal" {
  return task.importance === "required" ? "required" : "normal";
}

function normalizeOverride(task: PriorityScorableTask): "focus" | "quick" | "later" | null {
  const override = task.priorityOverride;
  if (override === "focus" || override === "quick" || override === "later") return override;
  return null;
}

/** 计算 YYYY-MM-DD 两个业务日期相差的天数（a 到 b） */
function daysBetween(a: string, b: string): number {
  const dateA = new Date(`${a}T00:00:00`);
  const dateB = new Date(`${b}T00:00:00`);
  if (Number.isNaN(dateA.getTime()) || Number.isNaN(dateB.getTime())) return Infinity;
  return Math.round((dateB.getTime() - dateA.getTime()) / (24 * 60 * 60 * 1000));
}

interface ScoredTask {
  task: PriorityScorableTask;
  score: number;
  reasons: PriorityReason[];
}

/**
 * 计算单个任务的优先分和推荐理由。
 * 评分公式各维度满分 100，最终按权重加权。
 */
function scoreTask(task: PriorityScorableTask, context: PriorityContext): { score: number; reasons: PriorityReason[] } {
  const reasons: PriorityReason[] = [];

  // 1. 重要程度 35%
  const importance = normalizeImportance(task);
  const importanceScore = importance === "required" ? 100 : 50;
  if (importance === "required") reasons.push({ key: "required", label: "必须完成" });

  // 2. 截止紧迫度 25%
  let urgencyScore: number;
  if (task.currentDate === context.today) {
    urgencyScore = 100;
    reasons.push({ key: "due_today", label: "今天截止" });
  } else if (task.currentDate < context.today) {
    urgencyScore = 80;
  } else {
    urgencyScore = 20;
  }

  // 3. 对目标的推动价值 20%
  let goalScore = 40;
  if (task.source === "ai") {
    goalScore = 90;
    reasons.push({ key: "core_goal", label: "推进核心目标" });
  }
  if (context.goalTargetDate) {
    const daysToTarget = daysBetween(context.today, context.goalTargetDate);
    if (daysToTarget >= 0 && daysToTarget <= 7) {
      goalScore = Math.max(goalScore, 85);
      if (!reasons.some((r) => r.key === "core_goal")) reasons.push({ key: "core_goal", label: "推进核心目标" });
    }
  }
  if (task.estimatedMinutes >= 60) goalScore = Math.min(100, goalScore + 5);

  // 4. 连续行动情况 10%
  let continuityScore = 40;
  if (Number(task.rolloverCount || 0) > 0) {
    continuityScore = 75;
    reasons.push({ key: "rollover", label: `连续 ${task.rolloverCount} 天未完成` });
  }

  // 5. 用户执行习惯 10%（初期依据不足，得中性分）
  const habitScore = 50;

  // 连续行动理由标签（仅展示，不直接影响分组容量）
  if (context.currentStreakDays >= 6) {
    reasons.push({ key: "streak", label: `已连续行动 ${context.currentStreakDays} 天` });
  }

  const score = importanceScore * 0.35
    + urgencyScore * 0.25
    + goalScore * 0.20
    + continuityScore * 0.10
    + habitScore * 0.10;

  return { score, reasons };
}

/**
 * 按优先级评分将任务分为三个分组。
 *
 * - `priorityOverride` 非 null 的任务直接进入对应分组（"手动置顶"理由），超额时降级。
 * - 高优先分任务进入"今日重点"（最多 2 个），超出降级。
 * - 中等优先分且 `estimatedMinutes <= 40` 的任务进入"快速推进"（最多 3 个）。
 * - 其余任务进入"稍后安排"。
 * - 依据不足时（评分较低）默认放入"稍后安排"，不擅自判定为重点。
 * - 只返回非空分组，不返回空框架。
 */
export function groupTasksByPriority<T extends PriorityScorableTask>(
  tasks: T[],
  context: PriorityContext,
): PriorityGroup<T>[] {
  if (!tasks.length) return [];

  const manualPinReason: PriorityReason = { key: "manual_pin", label: "手动置顶" };

  // 为 override 任务生成额外理由（如连续行动标签），只保留展示类理由
  function buildOverrideReasons(task: PriorityScorableTask, context: PriorityContext): PriorityReason[] {
    const extra: PriorityReason[] = [];
    if (context.currentStreakDays >= 6) {
      extra.push({ key: "streak", label: `已连续行动 ${context.currentStreakDays} 天` });
    }
    return extra;
  }

  // 分离 override 任务和普通任务
  const overrideBuckets: Record<"focus" | "quick" | "later", T[]> = { focus: [], quick: [], later: [] };
  const normalTasks: T[] = [];
  for (const task of tasks) {
    const override = normalizeOverride(task);
    if (override) overrideBuckets[override].push(task);
    else normalTasks.push(task);
  }

  // 对普通任务评分并按分数降序排列
  const scored: ScoredTask[] = normalTasks.map((task) => {
    const { score, reasons } = scoreTask(task, context);
    return { task, score, reasons };
  });
  scored.sort((a, b) => b.score - a.score);

  const focusTasks: Array<T & { priorityReasons: PriorityReason[] }> = [];
  const quickTasks: Array<T & { priorityReasons: PriorityReason[] }> = [];
  const laterTasks: Array<T & { priorityReasons: PriorityReason[] }> = [];

  // 先放置 override 任务（手动覆盖优先于自动评分）
  for (const task of overrideBuckets.focus) {
    const augmented = { ...task, priorityReasons: trimReasons([manualPinReason, ...buildOverrideReasons(task, context)]) } as T & { priorityReasons: PriorityReason[] };
    if (focusTasks.length < FOCUS_MAX) focusTasks.push(augmented);
    else if (task.estimatedMinutes <= QUICK_MAX_MINUTES && quickTasks.length < QUICK_MAX) quickTasks.push(augmented);
    else laterTasks.push(augmented);
  }
  for (const task of overrideBuckets.quick) {
    const augmented = { ...task, priorityReasons: trimReasons([manualPinReason, ...buildOverrideReasons(task, context)]) } as T & { priorityReasons: PriorityReason[] };
    if (quickTasks.length < QUICK_MAX) quickTasks.push(augmented);
    else laterTasks.push(augmented);
  }
  for (const task of overrideBuckets.later) {
    laterTasks.push({ ...task, priorityReasons: trimReasons([manualPinReason, ...buildOverrideReasons(task, context)]) } as T & { priorityReasons: PriorityReason[] });
  }

  // 再放置评分任务
  for (const { task, score, reasons } of scored) {
    const augmented = { ...task, priorityReasons: trimReasons(reasons) } as T & { priorityReasons: PriorityReason[] };
    if (focusTasks.length < FOCUS_MAX && score >= FOCUS_THRESHOLD) {
      focusTasks.push(augmented);
    } else if (quickTasks.length < QUICK_MAX && score >= QUICK_THRESHOLD && task.estimatedMinutes <= QUICK_MAX_MINUTES) {
      quickTasks.push(augmented);
    } else {
      laterTasks.push(augmented);
    }
  }

  // 只返回非空分组
  const groups: PriorityGroup<T>[] = [];
  if (focusTasks.length) groups.push({ key: "focus", ...GROUP_DEFS.focus, tasks: focusTasks });
  if (quickTasks.length) groups.push({ key: "quick", ...GROUP_DEFS.quick, tasks: quickTasks });
  if (laterTasks.length) groups.push({ key: "later", ...GROUP_DEFS.later, tasks: laterTasks });
  return groups;
}
