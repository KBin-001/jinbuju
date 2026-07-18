const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const flags = read("miniprogram/config/features.ts");
const profilePage = read("miniprogram/pages/profile/index.ts");
const profileView = read("miniprogram/pages/profile/index.wxml");
const accountPage = read("miniprogram/pages/account-security/index.ts");
const accountView = read("miniprogram/pages/account-security/index.wxml");
const privacyPage = read("miniprogram/pages/privacy-center/index.ts");
const privacyView = read("miniprogram/pages/privacy-center/index.wxml");

assert(flags.includes("ENABLE_PHONE_BINDING: false"), "手机号入口开关必须默认关闭");
assert(profilePage.includes("phoneBindingEnabled: FEATURE_FLAGS.ENABLE_PHONE_BINDING"), "我的页必须读取统一手机号开关");
assert(profileView.includes('wx:if="{{phoneBindingEnabled}}" class="manage-value'), "我的页不得在开关关闭时展示手机号绑定状态");
assert(!profileView.includes("手机号、数据与注销"), "我的页账号入口文案不应再提及手机号");
assert(accountView.includes('wx:if="{{phoneBindingEnabled}}" class="card phone-card"'), "账号与安全页必须受开关保护");
assert(accountPage.includes("FEATURE_FLAGS.ENABLE_PHONE_BINDING ? await getConsentStatus() : null"), "入口关闭时不应读取手机号处理同意状态");
assert(accountPage.includes("if (!FEATURE_FLAGS.ENABLE_PHONE_BINDING || this.data.operating) return;"), "手机号绑定操作必须在逻辑层受开关保护");
assert(privacyView.includes('wx:if="{{phoneBindingEnabled}}" class="rights-row" bindtap="openAccountSecurity"'), "隐私中心手机号入口必须受开关保护");
assert(privacyPage.includes("if (!FEATURE_FLAGS.ENABLE_PHONE_BINDING || this.data.saving) return;"), "隐私中心撤回手机号同意必须受开关保护");

console.log("手机号绑定前端入口开关检查通过");
