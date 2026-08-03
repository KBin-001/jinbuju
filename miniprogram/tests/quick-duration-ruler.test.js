const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  module._compile(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
  }).outputText, filename);
};

const {
  createQuickDurationRulerController,
  isQuickDurationFeedbackEnabled,
  quickDurationMinutesForScrollLeft,
  quickDurationScrollLeftForMinutes,
  quickDurationStepPixels,
} = require("../utils/quickDurationRuler.ts");

const pageLogic = fs.readFileSync(path.join(__dirname, "../pages/index/index.ts"), "utf8");
const pageTemplate = fs.readFileSync(path.join(__dirname, "../pages/index/index.wxml"), "utf8");
assert.match(pageTemplate, /enable-passive="\{\{true\}\}"/, "时间尺应启用 passive 滚动能力");
assert.match(pageTemplate, /fast-deceleration="\{\{true\}\}"/, "时间尺应启用 iOS 快速减速");
assert.match(pageTemplate, /binddragstart="onQuickDurationDragStart"/, "新手势应能取消上一轮停稳任务");
assert.match(pageTemplate, /scroll-with-animation="\{\{quickDurationScrollWithAnimation\}\}"/, "滚动动画只能由停稳吸附阶段控制");
assert.doesNotMatch(pageLogic, /quickDurationScrollTimer/, "页面不应在每个滚动事件中维护旧的回写定时器");
assert.doesNotMatch(pageLogic, /createInnerAudioContext|tick-minor\.wav|tick-major\.wav|playTickSound|tickAudio/, "时间尺不应再创建或播放刻度音频");
assert.match(pageLogic, /onFeedback:\s*\(\)\s*=>\s*vibrateQuickDurationStep/, "时间尺档位反馈应走独立的系统触感回调");
assert.match(pageLogic, /wx\.vibrateShort\(\{ type: "light" \}\)/, "时间尺应使用 light 原生短触感");
assert.match(pageLogic, /durationFeedbackEnabled/, "时间尺应保留新的触感偏好状态");
assert.match(pageLogic, /tickSoundEnabled/, "迁移触感偏好时必须兼容旧的刻度反馈键");
assert.equal(isQuickDurationFeedbackEnabled(undefined, false), false, "旧的关闭偏好不得被迁移逻辑重新开启");
assert.equal(isQuickDurationFeedbackEnabled(true, false), false, "新旧偏好冲突时旧的关闭选择仍应保持关闭");

function createScheduler() {
  const tasks = [];
  return {
    schedule(callback, delayMs) {
      const task = { callback, delayMs, cancelled: false };
      tasks.push(task);
      return task;
    },
    cancel(task) {
      task.cancelled = true;
    },
    runNext(delayMs) {
      const task = tasks.find((item) => !item.cancelled && (delayMs === undefined || item.delayMs === delayMs));
      assert.ok(task, `expected a pending ${delayMs === undefined ? "" : `${delayMs}ms `}timer`);
      task.cancelled = true;
      task.callback();
    },
    active() {
      return tasks.filter((item) => !item.cancelled);
    },
  };
}

function createRuler(scheduler, events, options = {}) {
  return createQuickDurationRulerController({
    minMinutes: 5,
    maxMinutes: 360,
    stepMinutes: 5,
    stepPixels: 4,
    settleDelayMs: 100,
    programmaticGuardMs: 300,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    ...options,
    onPreview: options.onPreview || ((minutes) => events.preview.push(minutes)),
    onSnap: options.onSnap || ((snap) => events.snap.push(snap)),
    onFeedback: options.disableFeedbackCallback ? undefined : options.onFeedback || ((minutes) => events.feedback?.push(minutes)),
  });
}

for (const width of [320, 375, 430]) {
  const stepPixels = quickDurationStepPixels(width);
  for (const minutes of [30, 45, 60, 90, 120, 240, 360]) {
    const scrollLeft = quickDurationScrollLeftForMinutes(minutes, stepPixels);
    assert.equal(
      quickDurationMinutesForScrollLeft(scrollLeft, stepPixels),
      minutes,
      `${width}px should round-trip ${minutes} minutes`,
    );
  }
}

{
  const scheduler = createScheduler();
  const events = { preview: [], snap: [] };
  const ruler = createRuler(scheduler, events);
  const initial = ruler.initialize(30);

  assert.deepEqual(events, { preview: [], snap: [] }, "initial positioning must be silent");
  assert.equal(ruler.onScroll(initial.scrollLeft).ignored, true, "initial scroll callback must not start settling");

  ruler.beginGesture();
  ruler.onScroll(initial.scrollLeft + 0.3);
  ruler.onScroll(initial.scrollLeft + 0.4);
  ruler.endGesture(initial.scrollLeft + 0.4);
  assert.deepEqual(events.preview, [], "events inside the same 5-minute bucket must not update the preview");

  scheduler.runNext(100);
  assert.equal(events.snap.length, 1, "one real scroll end produces one snap");
  assert.equal(events.snap[0].minutes, 30, "30 minutes must remain 30 after settling");
  assert.equal(ruler.onScroll(events.snap[0].scrollLeft).ignored, true, "programmatic snap events must be isolated");
  assert.equal(scheduler.active().some((task) => task.delayMs === 100), false, "programmatic snap must not schedule a second settle");
  assert.equal(ruler.onScroll(events.snap[0].scrollLeft).ignored, true, "late programmatic snap events must remain isolated");
  ruler.beginGesture();
  assert.equal(ruler.onScroll(events.snap[0].scrollLeft + 4).ignored, false, "a new gesture must release the snap guard");
}

{
  const scheduler = createScheduler();
  const events = { preview: [], snap: [] };
  const ruler = createRuler(scheduler, events);
  ruler.initialize(30);

  ruler.beginGesture();
  ruler.onScroll(4 * 7);
  ruler.endGesture(4 * 7);
  ruler.beginGesture();
  ruler.onScroll(4 * 9);
  ruler.endGesture(4 * 9);
  scheduler.runNext(100);

  assert.deepEqual(events.snap.map((item) => item.minutes), [45], "a new gesture must cancel the previous settle");
}

{
  const scheduler = createScheduler();
  const events = { preview: [], snap: [] };
  const ruler = createRuler(scheduler, events);

  ruler.initialize(30);
  ruler.beginGesture();
  ruler.onScroll(-100);
  ruler.endGesture(-100);
  scheduler.runNext(100);
  assert.equal(events.snap[0].minutes, 5, "the lower boundary must clamp to 5 minutes");

  ruler.reset();
  ruler.beginGesture();
  ruler.onScroll(99999);
  ruler.endGesture(99999);
  scheduler.runNext(100);
  assert.equal(events.snap[1].minutes, 360, "the upper boundary must clamp to 360 minutes");
}

{
  const scheduler = createScheduler();
  const events = { preview: [], snap: [], feedback: [] };
  let now = 0;
  const ruler = createRuler(scheduler, events, {
    feedbackMinIntervalMs: 70,
    now: () => now,
  });

  ruler.initialize(30);
  assert.deepEqual(events.feedback, [], "initial positioning must not vibrate");

  ruler.beginGesture();
  ruler.onScroll(4 * 7);
  ruler.onScroll(4 * 7 + 0.2);
  assert.deepEqual(events.feedback, [35], "the first entry into a new bucket vibrates once");

  now = 20;
  ruler.onScroll(4 * 8);
  now = 69;
  ruler.onScroll(4 * 9);
  assert.deepEqual(events.feedback, [35], "rapid bucket crossings may skip feedback within the throttle window");

  now = 70;
  ruler.onScroll(4 * 10);
  assert.deepEqual(events.feedback, [35, 50], "feedback resumes after the minimum interval");

  now = 150;
  ruler.onScroll(4 * 9);
  now = 230;
  ruler.onScroll(4 * 10);
  assert.deepEqual(events.feedback, [35, 50, 45, 50], "returning to a bucket after leaving it starts a new feedback opportunity");
}

{
  const disabledScheduler = createScheduler();
  const disabledEvents = { preview: [], snap: [], feedback: [] };
  const disabled = createRuler(disabledScheduler, disabledEvents, {
    isFeedbackEnabled: () => false,
  });
  disabled.initialize(30);
  disabled.beginGesture();
  disabled.onScroll(4 * 7);
  disabled.endGesture(4 * 7);
  disabledScheduler.runNext(100);

  const failedScheduler = createScheduler();
  const failedEvents = { preview: [], snap: [], feedback: [] };
  let failedCalls = 0;
  const failed = createRuler(failedScheduler, failedEvents, {
    now: () => 100,
    onFeedback: () => {
      failedCalls += 1;
      return Promise.reject(new Error("vibration unavailable"));
    },
  });
  failed.initialize(30);
  failed.beginGesture();
  failed.onScroll(4 * 7);
  failed.onScroll(4 * 7 + 0.2);
  failed.endGesture(4 * 7 + 0.2);
  failedScheduler.runNext(100);

  assert.deepEqual(disabledEvents.preview, failedEvents.preview, "feedback off and API failure must preserve the same preview");
  assert.deepEqual(disabledEvents.snap, failedEvents.snap, "feedback off and API failure must preserve the same snap");
  assert.equal(disabledEvents.snap[0].minutes, 35, "feedback failures must not change the snapped value");
  assert.equal(failedCalls, 1, "a failed feedback call must not retry for the same bucket");

  const missingScheduler = createScheduler();
  const missingEvents = { preview: [], snap: [], feedback: [] };
  const missing = createRuler(missingScheduler, missingEvents, { disableFeedbackCallback: true });
  missing.initialize(30);
  missing.beginGesture();
  missing.onScroll(4 * 7);
  missing.endGesture(4 * 7);
  missingScheduler.runNext(100);
  assert.deepEqual(missingEvents.preview, disabledEvents.preview, "missing feedback API must preserve the same preview");
  assert.deepEqual(missingEvents.snap, disabledEvents.snap, "missing feedback API must preserve the same snap");
  assert.deepEqual(missingEvents.feedback, [], "missing feedback API must stay silent");
}

{
  const scheduler = createScheduler();
  const events = { preview: [], snap: [], feedback: [] };
  const ruler = createRuler(scheduler, events);
  ruler.initialize(30);
  ruler.beginGesture();
  ruler.onScroll(4 * 6 + 0.2);
  ruler.endGesture(4 * 6 + 0.2);
  scheduler.runNext(100);
  assert.deepEqual(events.feedback, [], "a programmatic snap after a same-bucket drag must stay silent");
  assert.equal(events.snap[0].minutes, 30, "the same-bucket drag should still settle to the nearest valid bucket");

  ruler.reset();
  ruler.initialize(30);
  ruler.beginGesture();
  ruler.onScroll(4 * 7);
  assert.deepEqual(events.feedback, [35], "reset and panel reopen must clear the previous feedback bucket");
}

console.log("quick duration ruler controller tests passed");
