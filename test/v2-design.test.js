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

function assertBalancedWxml(file) {
  const source = read(file);
  ["view", "block", "text", "button", "scroll-view", "canvas"].forEach((tag) => {
    const opens = (source.match(new RegExp(`<${tag}(?:\\s|>)`, "g")) || []).length;
    const selfClosing = (source.match(new RegExp(`<${tag}(?=\\s|>)[^>]*\\/>`, "g")) || []).length;
    const closes = (source.match(new RegExp(`</${tag}>`, "g")) || []).length;
    assert(opens - selfClosing === closes, `${file} 的 ${tag} 标签不平衡`);
  });
}

test("默认主题和全局可见颜色均为墨绿色", () => {
  const theme = read("miniprogram/services/theme.ts");
  const app = JSON.parse(read("miniprogram/app.json"));
  assert(theme.includes('DEFAULT_THEME_ID: ThemeId = "inkGreen"'), "默认主题不是 inkGreen");
  assert(theme.includes('THEME_STORAGE_KEY = "APP_THEME_V2"'), "旧主题缓存不会迁移到 V2 默认值");
  assert(app.window.backgroundColor === "#F5F7F2", "窗口背景色不匹配");
  assert(app.tabBar.selectedColor === "#356859", "TabBar 选中色不匹配");
});

test("今日页包含 V2 周历、类别图标、进度环与鼓励卡细节", () => {
  const wxml = read("miniprogram/pages/index/index.wxml");
  const wxss = read("miniprogram/pages/index/index.wxss");
  const finalStyle = wxss.slice(wxss.lastIndexOf("V2 设计稿最终对齐：今日页"));
  ["展开", "task-type-icon", "task-tail-check", "daily-nudge-star", "conic-gradient(#356859"].forEach((token) => {
    assert(wxml.includes(token), `今日页缺少 ${token}`);
  });
  assert(wxss.lastIndexOf("V2 设计稿最终对齐：今日页") > wxss.lastIndexOf("墨绿主题：当前页面真实使用"), "V2 覆写顺序错误");
  ["#F7F8F3", "#F4C95D", "#FFF1C7", "V2 设计稿级联锁定"].forEach((token) => {
    assert(finalStyle.includes(token), `今日页最终样式缺少视觉标记 ${token}`);
  });
  assert(!finalStyle.includes("墨绿成长 · 沉浸式深绿覆写"), "今日页最终样式仍存在沉浸式深绿覆写");
  assertBalancedWxml("miniprogram/pages/index/index.wxml");
});

test("进度页包含山景 Hero、三列总览、双指标图例和独立教练卡", () => {
  const wxml = read("miniprogram/pages/plan/index.wxml");
  const wxss = read("miniprogram/pages/plan/index.wxss");
  const finalStyle = wxss.slice(wxss.lastIndexOf("V3 轻盈暖白最终覆盖"));
  ["累计投入", "投入分钟", "完成项数", "ai-coach-hint", "ai-coach-card--summary"].forEach((token) => {
    assert(wxml.includes(token) || read("miniprogram/pages/plan/index.ts").includes(token), `进度页缺少 ${token}`);
  });
  assert(wxml.includes('<image class="goal-card-bg" src="/images/progress-hero-v2.jpg" mode="aspectFill" />'), "未通过 image 图层接入 V2 Hero 资源");
  ["#F7F8F3", "#1F2D28", "#71827A", "#356859", "#FFF1C7"].forEach((token) => {
    assert(finalStyle.includes(token), `进度页最终样式缺少统一色彩 ${token}`);
  });
  assert(!finalStyle.includes('.progress-page[data-theme="inkGreen"] .goal-card {'), "进度页最终浅色覆盖不应修改 Hero 背景");
  assertBalancedWxml("miniprogram/pages/plan/index.wxml");
});

test("进度 Hero 资源适合小程序包体", () => {
  const asset = path.join(root, "miniprogram/images/progress-hero-v2.jpg");
  const size = fs.statSync(asset).size;
  assert(size > 20_000, "Hero 资源疑似无效");
  assert(size < 200_000, `Hero 资源过大: ${size} bytes`);
});

console.log(`\n========== V2 设计校验：${passed} 通过 / ${failed} 失败 ==========`);
process.exit(failed === 0 ? 0 : 1);
