const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = JSON.parse(read("miniprogram/app.json"));
const registeredPages = [
  ...app.pages,
  ...(app.subpackages || []).flatMap((pkg) => (pkg.pages || []).map((page) => `${pkg.root}/${page}`)),
];

assert(registeredPages.includes("pages/growth-records/index"), "成长记录子页面必须注册到 app.json");
for (const extension of ["ts", "wxml", "wxss", "json"]) {
  assert(fs.existsSync(path.join(root, `miniprogram/pages/growth-records/index.${extension}`)), `成长记录页缺少 index.${extension}`);
}

const source = read("miniprogram/pages/growth-records/index.ts");
const template = read("miniprogram/pages/growth-records/index.wxml");
const styles = read("miniprogram/pages/growth-records/index.wxss");
const config = JSON.parse(read("miniprogram/pages/growth-records/index.json"));
const profile = read("miniprogram/pages/profile/index.ts");
const progress = read("miniprogram/pages/plan/index.ts");

assert.match(source, /store\.tasks \|\| \[\]/, "成长记录必须以 tasks 作为唯一行动事实源");
assert.doesNotMatch(source, /goal\.actions \|\| \[\]/, "不得重复拼接归档快照 actions");
assert.match(source, /task\.activityDate \|\| task\.currentDate/, "成长记录必须优先使用真实行动日期");
assert.match(source, /statusBeforeReschedule === "partially_completed"/, "部分完成后顺延的真实投入必须保留");
assert.match(source, /hiddenGoalIds/);
assert.match(source, /Boolean\(goal\.deletedAt\).*goal\.restoredAt/);
assert.match(source, /!goal\?\.active \|\| rescheduled/, "归档与顺延历史记录必须只读");
assert.match(source, /updateActionRecord/);
assert.match(source, /deleteTask/);
assert.match(source, /PAGE_SIZE = 20/);
assert.match(source, /manual:sync/);
assert.match(source, /syncManualData\(\)/, "下拉刷新必须同步真实成长数据");
assert.match(source, /monthDayLabel:\s*formatMonthDay\(record\.date\)/, "成长时间轴必须显示真实月日");
assert.match(source, /weekdayLabel:\s*formatWeekday\(record\.date\)/, "成长时间轴必须显示真实星期");

for (const copy of ["成长总览", "完成行动", "投入分钟", "行动天数", "连续天数", "全部目标", "全部记录", "部分完成", "历史目标"]) {
  assert(`${source}\n${template}`.includes(copy), `成长记录页面缺少“${copy}”`);
}
assert.match(template, /record\.reflection/, "成长过程应展示用户记录的真实感受");
assert.match(template, /hero-orbit-v1\.jpg/, "成长总览应使用正式年轮山水资源");
assert.doesNotMatch(template, /date-ring-v1\.png/, "日期节点已改为纯文字，不得继续显示装饰圆环");
assert.match(template, /timeline-thread-v1\.png/, "日期节点应使用独立墨线资源连接");
assert.match(template, /class="record-groups">\s*<image class="timeline-thread"[\s\S]*?<view wx:for="\{\{groups\}\}"/, "时间轴必须使用一根贯穿全部日期组的连续墨线");
assert.doesNotMatch(template, /class="date-rail">\s*<image class="timeline-thread"/, "不得在每个日期组内重复绘制时间轴造成波形接缝");
assert.match(template, /class="page-hero-art"[^>]*mode="widthFix"/, "年轮背景必须保持原始宽高比，不能被 aspectFill 裁切");
assert.match(template, /today-action-seal-v1\.png/, "成长记录标题应保留现代东方红色印记");
for (const [asset, maxBytes] of [["hero-orbit-v1.jpg", 100 * 1024], ["timeline-thread-v1.png", 25 * 1024]]) {
  const assetPath = path.join(root, "miniprogram/assets/growth-records", asset);
  assert(fs.existsSync(assetPath), `成长记录正式资源缺失：${asset}`);
  assert(fs.statSync(assetPath).size <= maxBytes, `成长记录资源体积过大：${asset}`);
}
assert.match(template, /item\.monthDayLabel/);
assert.match(template, /item\.weekdayLabel/);
assert.match(template, /class="date-label"/, "日期应使用无圆环的双行文字标签");
assert.match(template, /today-action-brush-green-v1\.png/, "完成记录应使用克制的墨绿笔触标记");
assert.match(template, /today-action-brush-gold-v1\.png/, "非完成记录应保留金色语义笔触");
assert.doesNotMatch(template, /check-circle/, "任务记录不得继续显示完成勾选图标");
assert.doesNotMatch(template, /hero-mountain|hero-veil|summary-grid|record-card|date-mark/, "1:1 宣纸版式不得保留旧卡片化结构");
assert.match(template, /class="growth-records-hero"/, "成长总览必须使用页面专属类名，避免继承全局 growth-hero 卡片样式");
assert.doesNotMatch(template, /class="growth-hero"/, "成长总览不得继承全局浅绿卡片、圆角与装饰圆");
assert.match(styles, /\.growth-records-hero\s*\{[^}]*border-bottom:/, "成长总览与目标范围应以细分隔线衔接");
assert.doesNotMatch(styles, /\.growth-records-hero\s*\{[^}]*border-radius:/, "成长总览不得继续使用圆角卡片");
assert.doesNotMatch(styles, /\.filter-section\s*\{[^}]*border-radius:/, "目标范围不得继续使用圆角卡片");
assert.match(styles, /\.page-hero-art\s*\{[^}]*width:\s*1120rpx;[^}]*height:\s*auto;[^}]*top:\s*50rpx;[^}]*left:\s*-200rpx;/s, "完整年轮与山水背景应延伸进入目标范围顶部");
assert.match(styles, /\.record-groups\s*\{[^}]*padding:\s*20rpx 42rpx 30rpx 14rpx;/s, "时间轴应贴近参考稿左侧位置");
assert.match(styles, /\.date-label\s*\{[^}]*min-height:\s*76rpx;[^}]*padding-left:\s*34rpx;/s, "日期文字应沿时间轴保持克制的编辑式层级");
assert.match(styles, /\.growth-records-hero\s*\{[^}]*height:\s*365rpx;/s, "目标范围应继续上移并紧接年轮背景，避免空白页面段");
assert.match(styles, /\.hero-copy\s*\{[^}]*top:\s*36rpx;/s, "成长总览应上移到导航下方的有效视觉区域");
assert.match(styles, /\.filter-section\s*\{[^}]*background:\s*transparent;/s, "目标范围不得用独立底色截断年轮山水背景");
assert.match(styles, /\.timeline-thread\s*\{[^}]*height:\s*calc\(100% - 58rpx\);[^}]*top:\s*62rpx;[^}]*left:\s*8rpx;/s, "时间轴墨线应位于纯文字日期左侧并连续贯穿记录");
assert.match(styles, /\.record-brush\s*\{[^}]*width:\s*9rpx;[^}]*height:\s*46rpx;/s, "任务记录应使用细笔触替代完成勾选图标");
assert.match(source, /openRecord[\s\S]*record\.readOnly[\s\S]*recordEditorVisible/, "时间轴改版后仍须保留只读复盘与记录编辑链路");
assert.match(template, /status === 'loading'/);
assert.match(template, /status === 'error'/);
assert.match(template, /groups\.length === 0/);
assert.equal(config.usingComponents["action-record-editor"], "/components/action-record-editor/index");
assert.match(profile, /pages\/growth-records\/index\?from=profile/);
assert.match(progress, /pages\/growth-records\/index\?from=progress&goalId=/);

console.log("成长记录独立子页面、跨目标口径与导航契约检查通过");
