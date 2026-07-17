const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const template = read("miniprogram/pages/team/index.wxml");
const page = read("miniprogram/pages/team/index.ts");
const settingsStart = template.indexOf('<view wx:if="{{settingsVisible}}"');
const settingsEnd = template.indexOf('<view wx:if="{{memberDetailVisible}}"');
assert(settingsStart >= 0 && settingsEnd > settingsStart, "找不到小队设置弹层");
const settings = template.slice(settingsStart, settingsEnd);

assert.match(settings, /小队名称/);
assert.match(settings, /maxlength="20"/);
assert.match(settings, /保存设置/);
assert.match(settings, /小队宣传语/);
assert.match(settings, /成员管理/);
assert.match(settings, /匿名模式/);
assert.match(settings, /解散小队/);
assert.match(settings, /小队信息/);
assert.match(settings, /退出小队/);
for (const hiddenFeature of ["上传头像", "小队公告", "公开小队", "行动详情"]) {
  assert(!settings.includes(hiddenFeature), `简化设置不应包含：${hiddenFeature}`);
}

assert.match(page, /if \(!this\.data\.settingsCanEditTeam\) return;/,
  "普通成员必须在逻辑层被阻止修改名称");
assert.match(page, /name\.length < 2|trim\(\)\.length < 2/,
  "名称保存必须校验最少 2 个字符");
const saveStart = page.indexOf("async saveTeamSettings()");
const saveEnd = page.indexOf("confirmLeaveOrDissolve()", saveStart);
const saveHandler = page.slice(saveStart, saveEnd);
assert.match(saveHandler, /updateTeamSettings\s*\(\s*\{\s*name,\s*announcement:\s*slogan\s*\}/,
  "设置保存必须向云端提交名称与宣传语，而不是只做本地乐观展示");
for (const forbiddenKey of ["avatar", "visibility", "joinMode", "allowAnonymous", "actionDetailVisibility"]) {
  assert(!saveHandler.includes(`${forbiddenKey}:`), `设置保存不应提交 ${forbiddenKey}`);
}

console.log("小队设置名称校验、队长管理与成员只读信息契约测试通过");
