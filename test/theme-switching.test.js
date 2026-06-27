// 主题切换测试
// 验证今日页使用暖白轻盈皮肤，同时保留进度页既有主题结构。

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL  ${name}: ${error.message}`);
  }
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function expectIncludes(haystack, needle, message) {
  if (!haystack.includes(needle)) {
    throw new Error(`${message} (missing: ${needle})`);
  }
}

function expectNotIncludes(haystack, needle, message) {
  if (haystack.includes(needle)) {
    throw new Error(`${message} (unexpected: ${needle})`);
  }
}

// ===========================================================
// 1. 默认主题必须是墨绿成长
// ===========================================================
test("默认主题 = 墨绿成长（inkGreen）", () => {
  const theme = read("miniprogram/services/theme.ts");
  expectIncludes(theme, 'DEFAULT_THEME_ID: ThemeId = "inkGreen"', "默认主题不是 inkGreen");
  expectIncludes(theme, 'id: "inkGreen"', "墨绿成长主题未注册");
  expectIncludes(theme, '"墨绿成长"', "墨绿成长中文名缺失");
});

// ===========================================================
// 2. 今日页主题结构
// ===========================================================
test("今日页根节点声明 data-theme", () => {
  const wxml = read("miniprogram/pages/index/index.wxml");
  expectIncludes(wxml, 'class="page today-page"', "今日页根节点 class 缺失");
  expectIncludes(wxml, 'data-theme="{{appTheme}}"', "今日页根节点缺少 data-theme 绑定");
});

test("今日页使用暖白渐变背景且不再包含沉浸式深绿覆写", () => {
  const wxss = read("miniprogram/pages/index/index.wxss");
  const finalStyle = wxss.slice(wxss.lastIndexOf("V2 设计稿最终对齐：今日页"));
  expectIncludes(finalStyle, ".today-page[data-theme=\"inkGreen\"]", "今日页最终样式缺少 inkGreen 选择器");
  expectIncludes(finalStyle, "linear-gradient(180deg, #FCFCF8 0%, #F7F8F3 46%, #F5F7F2 100%)", "今日页暖白渐变缺失");
  expectNotIncludes(finalStyle, "墨绿成长 · 沉浸式深绿覆写", "今日页最终样式仍保留沉浸式深绿覆写章节");
  expectNotIncludes(finalStyle, "linear-gradient(180deg, #173F34 0%, #1D493C 58%, #15382F 100%)", "今日页最终样式仍使用深绿根背景");
});

test("今日页卡片、Hero、日期与鼓励卡使用克制浅色层级", () => {
  const wxss = read("miniprogram/pages/index/index.wxss");
  const tokens = [
    "rgba(255, 255, 252, 0.82)",
    "linear-gradient(140deg, #E4F0E6 0%, #EAF3EA 64%, #F7FAF5 100%)",
    "rgba(252, 252, 248, 0.96)",
    "#F4C95D",
    "#FFF1C7",
  ];
  tokens.forEach((t) => expectIncludes(wxss, t, `今日页缺少轻盈视觉标记：${t}`));
});

test("今日页文字和卡片阴影保持柔和层级", () => {
  const wxss = read("miniprogram/pages/index/index.wxss");
  const finalStyle = wxss.slice(wxss.lastIndexOf("V2 设计稿最终对齐：今日页"));
  expectIncludes(finalStyle, "color: #1F2D28", "今日页缺少深灰绿主文字");
  expectIncludes(finalStyle, "color: #71827A", "今日页缺少灰绿辅助文字");
  expectIncludes(finalStyle, "rgba(31, 45, 40, 0.055)", "今日数据卡缺少轻柔阴影");
  expectNotIncludes(finalStyle, "rgba(35, 81, 67, 0.94)", "今日页最终样式仍使用深绿统计卡");
});

test("今日页最终样式以 inkGreen 同等特异性覆盖所有可见模块", () => {
  const wxss = read("miniprogram/pages/index/index.wxss");
  const finalStyle = wxss.slice(wxss.lastIndexOf("V2 设计稿最终对齐：今日页"));
  const scopedSelectors = [
    '.today-page[data-theme="inkGreen"] .today-greeting {',
    '.today-page[data-theme="inkGreen"] .week-card {',
    '.today-page[data-theme="inkGreen"] .today-action-panel {',
    '.today-page[data-theme="inkGreen"] .action-empty-inline {',
    '.today-page[data-theme="inkGreen"] .today-task-row {',
    '.today-page[data-theme="inkGreen"] .today-data-title {',
    '.today-page[data-theme="inkGreen"] .daily-nudge-card {',
  ];
  scopedSelectors.forEach((selector) => {
    expectIncludes(finalStyle, selector, `今日页缺少高特异性最终规则：${selector}`);
  });
});

test("今日页最终尺寸按 375px 设计稿换算", () => {
  const wxss = read("miniprogram/pages/index/index.wxss");
  const finalStyle = wxss.slice(wxss.lastIndexOf("V2 设计稿最终对齐：今日页"));
  [
    "padding: 32rpx 32rpx",
    "font-size: 50rpx",
    "border-radius: 44rpx",
    "border-radius: 36rpx",
    "border-radius: 32rpx",
  ].forEach((token) => expectIncludes(finalStyle, token, `今日页缺少设计稿尺寸：${token}`));
});

// ===========================================================
// 3. 进度页主题结构
// ===========================================================
test("进度页根节点声明 data-theme", () => {
  const wxml = read("miniprogram/pages/plan/index.wxml");
  expectIncludes(wxml, 'class="page progress-page"', "进度页根节点 class 缺失");
  expectIncludes(wxml, 'data-theme="{{appTheme}}"', "进度页根节点缺少 data-theme 绑定");
});

test("进度页内容区使用轻盈暖白最终覆盖", () => {
  const wxss = read("miniprogram/pages/plan/index.wxss");
  const finalStyle = wxss.slice(wxss.lastIndexOf("V3 轻盈暖白最终覆盖"));
  const tokens = [
    "linear-gradient(180deg, #FCFCF8 0%, #F7F8F3 46%, #F5F7F2 100%)",
    ".progress-page[data-theme=\"inkGreen\"] .overview-card",
    ".progress-page[data-theme=\"inkGreen\"] .trend-card",
    ".progress-page[data-theme=\"inkGreen\"] .milestone-card",
    ".progress-page[data-theme=\"inkGreen\"] .record-card",
    ".progress-page[data-theme=\"inkGreen\"] .ai-coach-card--summary",
    ".progress-page[data-theme=\"inkGreen\"] .year-top-stats",
    ".progress-page[data-theme=\"inkGreen\"] .heatmap-cell.level-4",
    ".progress-page[data-theme=\"inkGreen\"] .highlight-icon-trophy",
    ".progress-page[data-theme=\"inkGreen\"] .goal-picker-panel",
    ".progress-page[data-theme=\"inkGreen\"] .goal-option-action",
  ];
  tokens.forEach((t) => expectIncludes(finalStyle, t, `进度页浅色最终样式缺少：${t}`));
  expectIncludes(finalStyle, "#1F2D28", "进度页缺少深灰绿主文字");
  expectIncludes(finalStyle, "#FFF1C7", "进度页缺少浅黄色点缀");
});

test("进度页顶部目标 Hero 不进入浅色最终覆盖", () => {
  const wxss = read("miniprogram/pages/plan/index.wxss");
  const finalStyle = wxss.slice(wxss.lastIndexOf("V3 轻盈暖白最终覆盖"));
  expectNotIncludes(finalStyle, '.progress-page[data-theme="inkGreen"] .goal-card {', "浅色覆盖不应重写顶部 Hero 容器");
  expectNotIncludes(finalStyle, '.progress-page[data-theme="inkGreen"] .goal-card-shade', "浅色覆盖不应重写顶部 Hero 遮罩");
  expectNotIncludes(finalStyle, '.progress-page[data-theme="inkGreen"] .goal-card-bg', "浅色覆盖不应重写顶部 Hero 图片");
});

test("进度页墨绿山水 Hero 图未被移除或替换", () => {
  const wxml = read("miniprogram/pages/plan/index.wxml");
  const asset = path.join(root, "miniprogram/images/progress-hero-v2.jpg");
  expectIncludes(wxml, "/images/progress-hero-v2.jpg", "进度页 Hero 资源引用被替换");
  assert(fs.existsSync(asset), "墨绿山水 Hero 图片资源缺失");
  const size = fs.statSync(asset).size;
  assert(size > 20_000, `墨绿山水 Hero 资源疑似无效: ${size} bytes`);
  assert(size < 200_000, `墨绿山水 Hero 资源过大: ${size} bytes`);
});

// ===========================================================
// 4. 主题变量层一致性（theme.wxss）
// ===========================================================
test("全局 inkGreen 主题色为深墨绿（与今日/进度页覆写匹配）", () => {
  const theme = read("miniprogram/styles/theme.wxss");
  expectIncludes(theme, "[data-theme=\"inkGreen\"]", "全局未注册 inkGreen 主题块");
  expectIncludes(theme, "--color-primary: #356859", "inkGreen 主色应为 #356859");
  expectIncludes(theme, "--color-primary-deep: #1F5B4A", "inkGreen 深色应为 #1F5B4A");
  expectIncludes(theme, "--color-text-main: #233B34", "inkGreen 主文字色应为 #233B34");
});

// ===========================================================
// 5. 四页浅色视觉一致性
// ===========================================================
test("小队页使用浅薄荷 Hero 与暖白内容卡", () => {
  const wxss = read("miniprogram/pages/team/index.wxss");
  const finalStyle = wxss.slice(wxss.lastIndexOf("V3 轻盈暖白最终覆盖"));
  [
    '.team-page[data-theme="inkGreen"] .team-status-card {',
    '.team-page[data-theme="inkGreen"] .team-dashboard-card,',
    '.team-page[data-theme="inkGreen"] .team-popup,',
    "linear-gradient(140deg, #E4F0E6 0%, #EAF3EA 66%, #F7FAF5 100%)",
  ].forEach((token) => expectIncludes(finalStyle, token, `小队页最终样式缺少：${token}`));
  expectNotIncludes(finalStyle, "linear-gradient(135deg, #1F5B4A 0%, #356859 62%, #4C806E 100%)", "小队 Hero 仍使用深绿背景");
});

test("我的页使用浅薄荷 Hero、暖白卡片与浅黄周总结", () => {
  const wxss = read("miniprogram/pages/profile/index.wxss");
  const finalStyle = wxss.slice(wxss.lastIndexOf("V3 轻盈暖白最终覆盖"));
  [
    '.profile-page[data-theme="inkGreen"] .hero-card {',
    '.profile-page[data-theme="inkGreen"] .section-card,',
    '.profile-page[data-theme="inkGreen"] .week-card {',
    '.profile-page[data-theme="inkGreen"] .profile-editor-panel,',
    "background: #FFF1C7",
  ].forEach((token) => expectIncludes(finalStyle, token, `我的页最终样式缺少：${token}`));
  expectNotIncludes(finalStyle, "linear-gradient(135deg, #1F5B4A 0%, #356859 62%, #4C806E 100%)", "个人 Hero 仍使用深绿背景");
});

test("四个主页面共享暖白、深灰绿、辅助灰绿、主绿和浅黄", () => {
  const pages = [
    ["今日", read("miniprogram/pages/index/index.wxss"), "V2 设计稿最终对齐：今日页"],
    ["进度", read("miniprogram/pages/plan/index.wxss"), "V3 轻盈暖白最终覆盖"],
    ["小队", read("miniprogram/pages/team/index.wxss"), "V3 轻盈暖白最终覆盖"],
    ["我的", read("miniprogram/pages/profile/index.wxss"), "V3 轻盈暖白最终覆盖"],
  ];
  pages.forEach(([name, source, marker]) => {
    const finalStyle = source.slice(source.lastIndexOf(marker));
    ["#F7F8F3", "#1F2D28", "#71827A", "#356859", "#FFF1C7"].forEach((token) => {
      expectIncludes(finalStyle, token, `${name}页缺少统一色彩 ${token}`);
    });
  });
});

test("今日页黄色仅作为日期与鼓励卡点缀", () => {
  const today = read("miniprogram/pages/index/index.wxss");
  const finalStyle = today.slice(today.lastIndexOf("V2 设计稿最终对齐：今日页"));
  expectIncludes(finalStyle, "background: #F4C95D", "选中日期缺少精致黄色点缀");
  expectIncludes(finalStyle, "background: #FFF1C7", "鼓励卡缺少浅黄色背景");
  expectNotIncludes(finalStyle, "background: linear-gradient(135deg, #F8D26A, #F3C85A)", "鼓励卡最终样式仍使用厚重黄色渐变");
});

console.log(`\n========== 主题切换测试：${passed} 通过 / ${failed} 失败 ==========`);
process.exit(failed === 0 ? 0 : 1);
