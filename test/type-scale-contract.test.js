const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const theme = read("miniprogram/styles/theme.wxss");
const appStyles = read("miniprogram/app.wxss");
const tabBarStyles = read("miniprogram/custom-tab-bar/index.wxss");
const progressPageStyles = read("miniprogram/pages/plan/index.wxss");
const coachStyles = read("miniprogram/components/coach-insight/index.wxss");
const trendStyles = read("miniprogram/components/action-trend-chart/index.wxss");
const metricsStyles = read("miniprogram/components/progress-metrics/index.wxss");
const goalStyles = read("miniprogram/components/goal-overview/index.wxss");
const todayStyles = read("miniprogram/pages/index/index.wxss");
const actionSessionStyles = read("miniprogram/pages/action-session/index.wxss");
const actionRecordEditorStyles = read("miniprogram/components/action-record-editor/index.wxss");
const completedRecordEditorStyles = read("miniprogram/components/completed-record-editor/index.wxss");
const teamStyles = read("miniprogram/pages/team/index.wxss");
const teamMembersStyles = read("miniprogram/pages/team-members/index.wxss");
const teamInviteStyles = read("miniprogram/pages/team-invite/index.wxss");
const teamActivityStyles = read("miniprogram/pages/team-activity/index.wxss");
const profileStyles = read("miniprogram/pages/profile/index.wxss");
const achievementsStyles = read("miniprogram/pages/achievements/index.wxss");
const accountStyles = read("miniprogram/pages/account-security/index.wxss");
const dataManagementStyles = read("miniprogram/pages/data-management/index.wxss");
const dataSyncStyles = read("miniprogram/pages/data-sync/index.wxss");
const privacyCenterStyles = read("miniprogram/pages/privacy-center/index.wxss");
const legalPrivacyStyles = read("miniprogram/pages/legal/privacy/index.wxss");
const legalSharedStyles = read("miniprogram/styles/legal.wxss");
const aiCoachStyles = read("miniprogram/pages/ai-coach/index.wxss");
const welcomeStyles = read("miniprogram/pages/welcome/index.wxss");
const goalDetailStyles = read("miniprogram/pages/goal-detail/index.wxss");
const historyStyles = read("miniprogram/pages/history/index.wxss");
const shareCardStyles = read("miniprogram/pages/share-card/index.wxss");
const planPreviewStyles = read("miniprogram/pages/plan-preview/index.wxss");
const coachChatStyles = read("miniprogram/components/coach-chat/index.wxss");

const tokenValues = {
  "--font-page-title": "40rpx",
  "--font-section-title": "34rpx",
  "--font-card-title": "28rpx",
  "--font-body-strong": "25rpx",
  "--font-body": "22rpx",
  "--font-caption": "20rpx",
  "--font-meta": "18rpx",
  "--font-tag": "16rpx",
  "--font-data": "44rpx",
};

for (const [token, value] of Object.entries(tokenValues)) {
  assert.match(theme, new RegExp(`${token}:\\s*${value}`), `${token} 应定义为 ${value}`);
}

const lineHeightTokens = [
  "--line-height-page-title",
  "--line-height-section-title",
  "--line-height-card-title",
  "--line-height-body-strong",
  "--line-height-body",
  "--line-height-caption",
  "--line-height-meta",
  "--line-height-tag",
  "--line-height-data",
  "--line-height-brand-display",
];

for (const token of lineHeightTokens) {
  assert.match(theme, new RegExp(`${token}:\\s*[^;]+;`), `${token} 必须有行高约定`);
}

for (const token of [
  "--font-brand-display",
  "--font-data-hero",
  "--font-timer",
  "--font-timer-compact",
  "--font-timer-editor",
  "--font-timer-editor-compact",
  "--font-calendar",
  "--font-icon-display",
  "--font-longform",
  "--font-page-title-compact",
  "--font-section-title-compact",
  "--font-card-title-compact",
  "--font-body-compact",
  "--font-caption-compact",
  "--font-meta-compact",
  "--font-tag-compact",
  "--font-data-compact",
]) {
  assert.match(theme, new RegExp(`${token}:\\s*[^;]+;`), `${token} 必须作为受控例外或小屏令牌存在`);
}

assert.match(appStyles, /page\s*\{[^}]*font-size:\s*var\(--font-body\)/s, "全局页面字号必须使用正文令牌");
assert.match(
  appStyles,
  /\.tab-header__title\s*\{[^}]*font-size:\s*var\(--font-page-title\)[^}]*line-height:\s*var\(--line-height-page-title\)/s,
  "全局标题必须使用页面标题字号与行高令牌",
);
assert.match(
  tabBarStyles,
  /\.custom-tab-label\s*\{[^}]*font-size:\s*var\(--font-tag\)[^}]*line-height:\s*var\(--line-height-tag\)/s,
  "自定义 TabBar 标签必须使用标签令牌",
);

assert.match(
  progressPageStyles,
  /\.section-title\s*\{[^}]*font-size:\s*var\(--font-section-title\)[^}]*line-height:\s*var\(--line-height-section-title\)/s,
  "进度页分区标题必须使用分区标题令牌",
);
assert.match(
  coachStyles,
  /\.coach-conclusion\s*\{[^}]*font-size:\s*var\(--font-card-title\)[^}]*line-height:\s*var\(--line-height-card-title\)/s,
  "教练结论必须收敛到卡片标题层级",
);
assert.match(
  coachStyles,
  /\.coach-advice\s*\{[^}]*font-size:\s*var\(--font-body-strong\)[^}]*line-height:\s*var\(--line-height-body-strong\)/s,
  "下一步建议必须使用强调正文层级",
);
assert.doesNotMatch(coachStyles, /font-size:\s*31rpx/, "进度页不得恢复已确认偏大的 31rpx 教练字号");
assert.match(trendStyles, /\.trend-title\s*\{[^}]*font-size:\s*var\(--font-section-title\)/s);
assert.match(metricsStyles, /\.metric-number\s*\{[^}]*font-size:\s*var\(--font-data\)/s);
assert.match(goalStyles, /\.goal-overview__title\s*\{[^}]*font-size:\s*var\(--font-brand-display\)/s);
assert.match(todayStyles, /\.today-greeting\s*\{[\s\S]*?font-size:\s*var\(--font-section-title\)/s);
assert.match(todayStyles, /\.today-subtitle\s*\{[\s\S]*?font-size:\s*var\(--font-caption\)/s);
assert.match(todayStyles, /\.task-title\s*\{[\s\S]*?font-size:\s*var\(--font-card-title\)/s);
assert.match(todayStyles, /\.task-duration\s*\{[\s\S]*?font-size:\s*var\(--font-meta\)/s);
assert.match(todayStyles, /\.completion-title\s*\{[\s\S]*?font-size:\s*var\(--font-card-title\)/s);
assert.match(todayStyles, /\.task-action-sheet__title\s*\{[\s\S]*?font-size:\s*var\(--font-page-title\)/s);
assert.match(actionSessionStyles, /\.timer-value\s*\{[\s\S]*?font-size:\s*var\(--font-timer\)/s);
assert.match(actionSessionStyles, /\.task-title\s*\{[\s\S]*?font-size:\s*var\(--font-brand-display\)/s);
assert.match(actionRecordEditorStyles, /\.record-title\s*\{[\s\S]*?font-size:\s*var\(--font-card-title\)/s);
assert.match(completedRecordEditorStyles, /\.completed-editor__title\s*\{[\s\S]*?font-size:\s*var\(--font-card-title\)/s);
assert.match(teamStyles, /\.team-journey-content\s+\.hero-title\s*\{[\s\S]*?font-size:\s*var\(--font-page-title\)/s);
assert.match(teamStyles, /\.team-journey-content\s+\.hero-subtitle\s*\{[\s\S]*?font-size:\s*var\(--font-caption\)/s);
assert.match(teamStyles, /\.companion-name\s*\{[\s\S]*?font-size:\s*var\(--font-card-title\)/s);
assert.match(teamStyles, /\.companion-action\s*\{[\s\S]*?font-size:\s*var\(--font-body\)/s);
assert.match(teamStyles, /\.companion-status\s*\{[\s\S]*?font-size:\s*var\(--font-tag\)/s);
assert.match(teamStyles, /\.activity-time\s*\{[\s\S]*?font-size:\s*var\(--font-meta\)/s);
assert.match(teamStyles, /\.popup-title\s*\{[\s\S]*?font-size:\s*var\(--font-card-title\)/s);
assert.match(teamMembersStyles, /\.member-name\s*\{[\s\S]*?font-size:\s*var\(--font-card-title\)/s);
assert.match(teamMembersStyles, /\.member-action\s*\{[\s\S]*?font-size:\s*var\(--font-body\)/s);
assert.match(teamInviteStyles, /\.invite-title\s*\{[\s\S]*?font-size:\s*var\(--font-page-title\)/s);
assert.match(teamInviteStyles, /\.room-card__code\s*\{[\s\S]*?font-size:\s*var\(--font-data\)/s);
assert.match(teamActivityStyles, /\.activity-action\s*\{[\s\S]*?font-size:\s*var\(--font-body\)/s);
assert.match(teamActivityStyles, /\.activity-time\s*\{[\s\S]*?font-size:\s*var\(--font-meta\)/s);
assert.match(profileStyles, /\.profile-user-name\s*\{[\s\S]*?font-size:\s*var\(--font-card-title\)/s);
assert.match(profileStyles, /\.section-title\s*\{[\s\S]*?font-size:\s*var\(--font-section-title\)/s);
assert.match(profileStyles, /\.goal-title\s*\{[\s\S]*?font-size:\s*var\(--font-card-title\)/s);
assert.match(profileStyles, /\.profile-helper\s*\{[\s\S]*?font-size:\s*var\(--font-caption\)/s);
assert.match(achievementsStyles, /\.achievement-detail-title\s*\{[\s\S]*?font-size:\s*var\(--font-card-title\)/s);
assert.match(achievementsStyles, /\.achievement-detail-description\s*\{[\s\S]*?font-size:\s*var\(--font-caption\)/s);
assert.match(accountStyles, /\.account-hero__title\s*\{[\s\S]*?font-size:\s*var\(--font-page-title\)/s);
assert.match(dataManagementStyles, /\.page-title\s*\{[\s\S]*?font-size:\s*var\(--font-page-title\)/s);
assert.match(dataSyncStyles, /\.overview-item\s+text\s*\{[\s\S]*?font-size:\s*var\(--font-data\)/s);
assert.match(privacyCenterStyles, /\.privacy-hero__title\s*\{[\s\S]*?font-size:\s*var\(--font-page-title\)/s);
assert.match(`${legalPrivacyStyles}\n${legalSharedStyles}`, /var\(--font-longform\)|var\(--font-body\)/s);
assert.match(aiCoachStyles, /\.hero-title\s*\{[\s\S]*?font-size:\s*var\(--font-card-title\)/s);
assert.match(aiCoachStyles, /\.metric-value\s*\{[\s\S]*?font-size:\s*var\(--font-data\)/s);
assert.match(welcomeStyles, /\.hero-title\s*\{[\s\S]*?font-size:\s*var\(--font-page-title\)/s);
assert.match(goalDetailStyles, /\.hero-title\s*\{[\s\S]*?font-size:\s*var\(--font-page-title\)/s);
assert.match(goalDetailStyles, /\.record-title\s*\{[\s\S]*?font-size:\s*var\(--font-card-title\)/s);
assert.match(historyStyles, /\.hero-title\s*\{[\s\S]*?font-size:\s*var\(--font-section-title\)/s);
assert.match(shareCardStyles, /\.state-title\s*\{[\s\S]*?font-size:\s*var\(--font-card-title\)/s);
assert.match(planPreviewStyles, /\.plan-summary\s*\{[\s\S]*?font-size:\s*var\(--font-card-title\)/s);
assert.match(coachChatStyles, /\.message-text|\.chat-message|\.coach-chat/);

const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const entryPath = path.join(directory, entry.name);
  if (entry.isDirectory()) {
    if (entry.name === "node_modules" || entry.name === "miniprogram_npm") return [];
    return walk(entryPath);
  }
  return entry.name.endsWith(".wxss") ? [entryPath] : [];
});

for (const file of walk(path.join(root, "miniprogram"))) {
  if (file.endsWith(path.join("styles", "theme.wxss"))) continue;
  const source = fs.readFileSync(file, "utf8");
  const markerIndex = Math.max(
    source.lastIndexOf("/* Semantic type roles"),
    source.lastIndexOf("/* Semantic type scale"),
  );
  const rawDeclaration = /font-size\s*:\s*\d+rpx/;
  if (rawDeclaration.test(source) && markerIndex < 0) {
    throw new Error(`${path.relative(root, file)} 含裸字号但没有语义字号契约标记`);
  }
  if (markerIndex >= 0 && rawDeclaration.test(source.slice(markerIndex))) {
    throw new Error(`${path.relative(root, file)} 的末端语义覆盖仍含裸字号`);
  }
}

console.log("type scale progress contract tests passed");
