const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("avatar upload validates locally, checks remotely, and cleans failed uploads", () => {
  const account = read("miniprogram/services/account.ts");
  assert.match(account, /2 \* 1024 \* 1024/);
  assert.match(account, /new Set\(\["jpg", "jpeg", "png"\]\)/);
  assert.match(account, /validateAvatarUpload/);
  assert.match(account, /deleteFile\(\{ fileList: \[fileId\] \}\)/);
});

test("AI input and output use content security checks", () => {
  const entry = read("cloudfunctions/generatePlan/index.js");
  const ai = read("cloudfunctions/generatePlan/ai.js");
  assert.match(entry, /assertEventContentSafe\(context\.OPENID, action, event \|\| \{\}\)/);
  assert.match(ai, /await assertAiOutputSafe\(result\.text\)/);
});

test("cloud environment IDs are not committed", () => {
  const clientCloud = read("miniprogram/config/cloud.ts");
  const ai = read("cloudfunctions/generatePlan/ai.js");
  assert.doesNotMatch(clientCloud + ai, /ai-d3g9qsay37da6a3cc/);
  assert.match(ai, /CLOUDBASE_ENV_NOT_CONFIGURED/);
});

test("privacy authorization is wired before sensitive actions", () => {
  const profile = read("miniprogram/pages/profile/index.wxml");
  const accountSecurity = read("miniprogram/pages/account-security/index.wxml");
  assert.match(profile, /authorizePlatformPrivacy/);
  assert.match(accountSecurity, /authorizePlatformPrivacy/);
});
