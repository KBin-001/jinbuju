export const QUICK_DURATION_RULER_STEP_MINUTES = 5;
export const QUICK_DURATION_RULER_TICK_RPX = 24;
export const QUICK_DURATION_RULER_MARK_INTERVAL_MINUTES = 15;
export const QUICK_DURATION_RULER_SUBSTEP_RPX = QUICK_DURATION_RULER_TICK_RPX
  / (QUICK_DURATION_RULER_MARK_INTERVAL_MINUTES / QUICK_DURATION_RULER_STEP_MINUTES);
export const QUICK_DURATION_RULER_SETTLE_DELAY_MS = 120;
export const QUICK_DURATION_RULER_PROGRAMMATIC_GUARD_MS = 320;

export type QuickDurationRulerTimer = unknown;

export interface QuickDurationSnap {
  minutes: number;
  scrollLeft: number;
  animate: boolean;
}

export interface QuickDurationRulerOptions {
  minMinutes?: number;
  maxMinutes?: number;
  stepMinutes?: number;
  stepPixels?: number;
  getStepPixels?: () => number;
  settleDelayMs?: number;
  programmaticGuardMs?: number;
  schedule?: (callback: () => void, delayMs: number) => QuickDurationRulerTimer;
  cancel?: (timer: QuickDurationRulerTimer) => void;
  onPreview?: (minutes: number) => void;
  onSnap?: (snap: QuickDurationSnap) => void;
}

export interface QuickDurationScrollResult {
  ignored: boolean;
  minutes: number;
  previewChanged: boolean;
}

export interface QuickDurationRulerController {
  initialize(minutes: number): QuickDurationSnap;
  beginGesture(): void;
  onScroll(scrollLeft: number): QuickDurationScrollResult;
  endGesture(scrollLeft?: number): QuickDurationScrollResult;
  reset(): void;
  destroy(): void;
}

type ProgrammaticScrollSource = "initialization" | "snap";

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function positiveOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function clampQuickDurationMinutes(
  minutes: number,
  minMinutes = 5,
  maxMinutes = 360,
  stepMinutes = QUICK_DURATION_RULER_STEP_MINUTES,
): number {
  const min = Math.min(minMinutes, maxMinutes);
  const max = Math.max(minMinutes, maxMinutes);
  const step = positiveOr(stepMinutes, QUICK_DURATION_RULER_STEP_MINUTES);
  const numeric = finiteOr(Number(minutes), min);
  const snapped = Math.round(numeric / step) * step;
  return Math.min(max, Math.max(min, snapped));
}

export function quickDurationStepPixels(windowWidth: number): number {
  const width = positiveOr(Number(windowWidth), 375);
  return QUICK_DURATION_RULER_SUBSTEP_RPX * width / 750;
}

export function quickDurationScrollLeftForMinutes(
  minutes: number,
  stepPixels: number,
  minMinutes = 5,
  maxMinutes = 360,
  stepMinutes = QUICK_DURATION_RULER_STEP_MINUTES,
): number {
  const pixels = positiveOr(stepPixels, 1);
  const step = positiveOr(stepMinutes, QUICK_DURATION_RULER_STEP_MINUTES);
  const normalized = clampQuickDurationMinutes(minutes, minMinutes, maxMinutes, step);
  return Math.max(0, Math.round(normalized / step) * pixels);
}

export function quickDurationMinutesForScrollLeft(
  scrollLeft: number,
  stepPixels: number,
  minMinutes = 5,
  maxMinutes = 360,
  stepMinutes = QUICK_DURATION_RULER_STEP_MINUTES,
): number {
  const pixels = positiveOr(stepPixels, 1);
  const step = positiveOr(stepMinutes, QUICK_DURATION_RULER_STEP_MINUTES);
  const position = Math.max(0, finiteOr(Number(scrollLeft), 0));
  const index = Math.round(position / pixels);
  return clampQuickDurationMinutes(index * step, minMinutes, maxMinutes, step);
}

export function createQuickDurationRulerController(options: QuickDurationRulerOptions = {}): QuickDurationRulerController {
  const minMinutes = finiteOr(Number(options.minMinutes), 5);
  const maxMinutes = finiteOr(Number(options.maxMinutes), 360);
  const stepMinutes = positiveOr(Number(options.stepMinutes), QUICK_DURATION_RULER_STEP_MINUTES);
  const settleDelayMs = Math.max(0, finiteOr(Number(options.settleDelayMs), QUICK_DURATION_RULER_SETTLE_DELAY_MS));
  const programmaticGuardMs = Math.max(0, finiteOr(Number(options.programmaticGuardMs), QUICK_DURATION_RULER_PROGRAMMATIC_GUARD_MS));
  const schedule = options.schedule || ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
  const cancel = options.cancel || ((timer: QuickDurationRulerTimer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const getStepPixels = options.getStepPixels || (() => positiveOr(Number(options.stepPixels), 1));

  let settleTimer: QuickDurationRulerTimer | null = null;
  let programmaticTimer: QuickDurationRulerTimer | null = null;
  let programmaticToken = 0;
  let interactionToken = 0;
  let destroyed = false;
  let programmaticTarget: number | null = null;
  let lastRealScrollLeft = quickDurationScrollLeftForMinutes(minMinutes, getStepPixels(), minMinutes, maxMinutes, stepMinutes);
  let previewMinutes = clampQuickDurationMinutes(minMinutes, minMinutes, maxMinutes, stepMinutes);

  const clearSettleTimer = (): void => {
    if (settleTimer === null) return;
    cancel(settleTimer);
    settleTimer = null;
  };

  const clearProgrammaticGuard = (): void => {
    programmaticToken += 1;
    if (programmaticTimer !== null) {
      cancel(programmaticTimer);
      programmaticTimer = null;
    }
    programmaticTarget = null;
  };

  const activateProgrammaticGuard = (target: number, source: ProgrammaticScrollSource): void => {
    clearProgrammaticGuard();
    programmaticTarget = target;
    if (source === "snap") return;
    const token = programmaticToken;
    programmaticTimer = schedule(() => {
      if (destroyed || token !== programmaticToken) return;
      programmaticTarget = null;
      programmaticTimer = null;
    }, programmaticGuardMs);
  };

  const notifySnap = (minutes: number, scrollLeft: number, previousScrollLeft: number): void => {
    activateProgrammaticGuard(scrollLeft, "snap");
    options.onSnap?.({
      minutes,
      scrollLeft,
      animate: Math.abs(scrollLeft - previousScrollLeft) > Math.max(0.5, getStepPixels() * 0.02),
    });
  };

  const scheduleSettle = (): void => {
    clearSettleTimer();
    const token = interactionToken;
    settleTimer = schedule(() => {
      settleTimer = null;
      if (destroyed || token !== interactionToken || programmaticTarget !== null) return;
      const previousScrollLeft = lastRealScrollLeft;
      const minutes = quickDurationMinutesForScrollLeft(
        previousScrollLeft,
        getStepPixels(),
        minMinutes,
        maxMinutes,
        stepMinutes,
      );
      const target = quickDurationScrollLeftForMinutes(
        minutes,
        getStepPixels(),
        minMinutes,
        maxMinutes,
        stepMinutes,
      );
      previewMinutes = minutes;
      lastRealScrollLeft = target;
      notifySnap(minutes, target, previousScrollLeft);
    }, settleDelayMs);
  };

  const initialize = (minutes: number): QuickDurationSnap => {
    if (destroyed) return { minutes: previewMinutes, scrollLeft: lastRealScrollLeft, animate: false };
    interactionToken += 1;
    clearSettleTimer();
    const normalized = clampQuickDurationMinutes(minutes, minMinutes, maxMinutes, stepMinutes);
    const scrollLeft = quickDurationScrollLeftForMinutes(normalized, getStepPixels(), minMinutes, maxMinutes, stepMinutes);
    previewMinutes = normalized;
    lastRealScrollLeft = scrollLeft;
    activateProgrammaticGuard(scrollLeft, "initialization");
    return { minutes: normalized, scrollLeft, animate: false };
  };

  const beginGesture = (): void => {
    if (destroyed) return;
    interactionToken += 1;
    clearSettleTimer();
    clearProgrammaticGuard();
  };

  const onScroll = (scrollLeft: number): QuickDurationScrollResult => {
    if (destroyed) return { ignored: true, minutes: previewMinutes, previewChanged: false };
    if (programmaticTarget !== null) {
      return { ignored: true, minutes: previewMinutes, previewChanged: false };
    }
    lastRealScrollLeft = Math.max(0, finiteOr(Number(scrollLeft), lastRealScrollLeft));
    const minutes = quickDurationMinutesForScrollLeft(
      lastRealScrollLeft,
      getStepPixels(),
      minMinutes,
      maxMinutes,
      stepMinutes,
    );
    const previewChanged = minutes !== previewMinutes;
    previewMinutes = minutes;
    if (previewChanged) options.onPreview?.(minutes);
    scheduleSettle();
    return { ignored: false, minutes, previewChanged };
  };

  const endGesture = (scrollLeft?: number): QuickDurationScrollResult => {
    const result = scrollLeft === undefined
      ? { ignored: false, minutes: previewMinutes, previewChanged: false }
      : onScroll(scrollLeft);
    if (!destroyed && !result.ignored) scheduleSettle();
    return result;
  };

  const reset = (): void => {
    if (destroyed) return;
    interactionToken += 1;
    clearSettleTimer();
    clearProgrammaticGuard();
    previewMinutes = clampQuickDurationMinutes(minMinutes, minMinutes, maxMinutes, stepMinutes);
    lastRealScrollLeft = quickDurationScrollLeftForMinutes(previewMinutes, getStepPixels(), minMinutes, maxMinutes, stepMinutes);
  };

  const destroy = (): void => {
    if (destroyed) return;
    reset();
    destroyed = true;
  };

  return {
    initialize,
    beginGesture,
    onScroll,
    endGesture,
    reset,
    destroy,
  };
}
