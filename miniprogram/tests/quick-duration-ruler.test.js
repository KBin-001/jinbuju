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

function createRuler(scheduler, events) {
  return createQuickDurationRulerController({
    minMinutes: 5,
    maxMinutes: 360,
    stepMinutes: 5,
    stepPixels: 4,
    settleDelayMs: 100,
    programmaticGuardMs: 300,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    onPreview: (minutes) => events.preview.push(minutes),
    onSnap: (snap) => events.snap.push(snap),
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

console.log("quick duration ruler controller tests passed");
