const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const typescript = require("../node_modules/typescript");

const STORAGE_KEY = "pendingTodayActionEditorRequest";
const storage = new Map();
const tabCalls = [];
const toastCalls = [];

global.wx = {
  setStorageSync(key, value) {
    storage.set(key, value);
  },
  getStorageSync(key) {
    return storage.get(key);
  },
  removeStorageSync(key) {
    storage.delete(key);
  },
  showToast(options) {
    toastCalls.push(options);
  },
  switchTab(options) {
    tabCalls.push(options);
  },
};

const source = fs.readFileSync(path.join(__dirname, "..", "utils", "todayActionEditor.ts"), "utf8");
const compiled = typescript.transpileModule(source, {
  compilerOptions: {
    module: typescript.ModuleKind.CommonJS,
    target: typescript.ScriptTarget.ES2017,
  },
}).outputText;
const moduleRecord = { exports: {} };
vm.runInNewContext(compiled, {
  module: moduleRecord,
  exports: moduleRecord.exports,
  require(request) {
    if (request === "./date") return require("../utils/date.ts");
    return require(request);
  },
  wx: global.wx,
  console,
}, { filename: "todayActionEditor.ts" });

const {
  consumeTodayActionEditor,
  openTodayActionEditor,
  queueTodayActionEditor,
} = moduleRecord.exports;

const coachRequest = { mode: "create", goalId: "goal-1", date: "2026-08-05" };
queueTodayActionEditor(coachRequest);
assert.equal(JSON.stringify(consumeTodayActionEditor()), JSON.stringify(coachRequest), "有效教练安排请求应保留目标和业务日期");
assert.equal(consumeTodayActionEditor(), null, "同一请求只能被今日页消费一次");
assert.equal(storage.has(STORAGE_KEY), false, "请求消费后应从本地交接存储中清除");

storage.set(STORAGE_KEY, { mode: "create", goalId: "goal-1", date: "2026-02-31" });
assert.equal(consumeTodayActionEditor(), null, "无效日历日期不应降级为错误的新增请求");
assert.equal(storage.has(STORAGE_KEY), false, "无效请求也必须在消费时清除");
assert.throws(
  () => queueTodayActionEditor({ mode: "create", goalId: "goal-1", date: "2026-02-31" }),
  /行动编辑请求无效/,
  "排队时应拒绝不存在的业务日期",
);

openTodayActionEditor(coachRequest);
assert.equal(tabCalls.length, 1, "统一入口应只触发一次 Tab 切换");
assert.equal(tabCalls[0].url, "/pages/index/index", "统一入口应切换到今日 Tab");
assert.equal(JSON.stringify(consumeTodayActionEditor()), JSON.stringify(coachRequest), "切换 Tab 后今日页仍应收到一次有效请求");
assert.deepEqual(toastCalls, [], "有效请求不应产生错误提示");

console.log("today action editor navigation tests passed");
