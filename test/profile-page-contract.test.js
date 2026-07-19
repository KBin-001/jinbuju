const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const wxml = read("miniprogram/pages/profile/index.wxml");
const page = read("miniprogram/pages/profile/index.ts");
const styles = read("miniprogram/pages/profile/index.wxss");
const growth = read("miniprogram/services/profileGrowth.ts");

assert(!wxml.includes("journey-card"), "我的页不应保留重复的账户概览卡");
assert(!wxml.includes("profile-statuses"), "头部不应堆叠同步或手机号 pill");
assert(!wxml.includes("profile-display-id") && !wxml.includes("{{displayId}}"), "我的页不应向用户展示内部账号标识");
assert(!wxml.includes("goal-progress") && !wxml.includes("progressPercent"), "当前目标卡不得展示进度条或完成率");
assert(wxml.includes("currentGoal.continuityText"), "当前目标卡应展示连续行动天数");
assert(wxml.includes("showSyncNotice") && wxml.includes("syncNoticeText"), "缓存或离线状态应有可见说明");
assert(wxml.includes("growth.completedActions") && wxml.includes("次行动 ·") && wxml.includes("连续 {{growth.currentStreakDays}} 天"), "成长记录应压缩为一行真实累计摘要");
assert(page.includes('wx.navigateTo({ url: "/pages/growth-records/index?from=profile" })'), "成长记录卡必须进入独立子页面，不能继续跳转进度 Tab");
const growthCardPosition = wxml.indexOf('class="paper-card growth-card"');
const communityCardPosition = wxml.indexOf('class="paper-card community-card"');
const manageCardPosition = wxml.indexOf('class="paper-card manage-card"');
assert(growthCardPosition >= 0 && communityCardPosition > growthCardPosition && manageCardPosition > communityCardPosition, "成长社区必须位于成长记录与管理设置之间");
assert(wxml.includes('bindtap="openGrowthCommunity"') && page.includes("openGrowthCommunity()"), "成长社区整卡必须始终具有真实点击事件");
assert(wxml.includes('name="usergroup-add"') && wxml.includes("进入社区"), "成长社区应使用正式线性图标和明确 CTA");
assert(wxml.includes("找到同频伙伴，一起持续行动") && wxml.includes("每日交流 · 每周复盘 · 目标互助"), "成长社区卡文案必须完整展示");
assert((wxml.match(/>内测</g) || []).length === 1, "成长社区只能展示一个内测标签");
assert(styles.includes(".community-card { height: 152rpx") && styles.includes("background: #EDF4EF"), "成长社区应保持 152rpx 浅玉绿卡片");
for (const state of ["loading", "preparing", "ready", "expired", "error"]) {
  assert(page.includes(`communitySheetStatus: \"${state}\"`) || wxml.includes(`communitySheetStatus === '${state}'`) || (state === "error" && wxml.includes("wx:else")), `社区半屏层缺少 ${state} 状态`);
}
assert(page.includes("getCommunityEntry") && page.includes("resolveCommunityQrUrl"), "社区入口必须读取真实配置并解析二维码 URL");
assert(page.includes('entry.status === "expired"') && page.includes('entry.status === "preparing"'), "社区状态必须遵循服务端 status 协议");
assert(page.includes("communityRequestActive") && page.includes("communityRequestSerial"), "社区入口必须防止重复请求和关闭后的过期回写");
assert(wxml.includes('show-menu-by-longpress="{{true}}"') && page.includes("wx.previewImage") && page.includes("showmenu: true"), "二维码必须支持长按与带菜单预览");
assert(page.includes("二维码预览失败，请稍后重试"), "二维码预览失败必须有明确反馈");
assert(wxml.includes('binderror="handleGrowthCommunityQrError"') && wxml.includes("不会读取群聊记录或通讯录") && wxml.includes("不会自动上传你的目标和行动记录"), "二维码失败状态和隐私边界说明必须可见");
assert(!wxml.includes("weekly-summary") && !wxml.includes("growth-grid"), "我的页不应重复进度页的周统计和三列累计卡");
assert(wxml.includes("profile-sync-line") && wxml.includes("{{syncTitle}}"), "身份区应显示真实云端同步状态");
assert(wxml.includes("云端数据与同步") && wxml.includes("账号与安全"), "账户能力应使用两个标准列表入口");

for (const key of ["goals", "history", "badges", "sync", "account", "privacy", "about"]) {
  assert(wxml.includes(`data-key="${key}"`), `管理列表缺少 ${key} 入口`);
  assert(page.includes(`key === "${key}"`), `${key} 入口缺少真实跳转事件`);
}

assert(wxml.includes('bindtap="openCustomerService"') && page.includes("openCustomerService()"), "我的页必须提供可打开客服承接层的入口");
assert(wxml.includes("/assets/customer-service-qr.jpg") && wxml.includes('show-menu-by-longpress="{{true}}"'), "客服二维码必须可见并支持长按识别");
assert(page.includes("wx.previewImage") && page.includes("previewCustomerServiceQr()"), "客服二维码必须支持点击放大预览");
assert(styles.includes(".manage-contact-row") && styles.includes(".customer-service-sheet-panel"), "客服入口与二维码承接层需要保持完整样式");

assert(page.includes("this.loadProfile();\n    bootstrapAccount()"), "页面应先展示本地记录，再刷新云端账号");
assert(page.includes('on("sync:state"') && page.includes('off("sync:state"'), "页面应订阅并清理同步状态监听");
assert(page.includes('sync.phase === "syncing"') && page.includes('sync.phase === "synced"'), "同步状态必须区分同步中与已同步");

assert(growth.includes("activityDate || task.currentDate"), "跨目标统计应优先使用真实行动日期");
assert(growth.includes('statusBeforeReschedule === "partially_completed"'), "部分完成后顺延的真实投入不得丢失");
assert(growth.includes("hiddenGoalIds") && growth.includes("!task.deletedAt"), "最近删除目标和已删除行动不得进入成长统计");
assert(growth.includes("new Set(progressed.map(actionDate))"), "连续行动应按跨目标唯一行动日计算");
assert(styles.includes("text-overflow: ellipsis") && styles.includes("@media (max-width: 350px)"), "长昵称和小屏幕需要明确适配");

console.log("我的页精简结构、离线状态与跨目标成长口径检查通过");
