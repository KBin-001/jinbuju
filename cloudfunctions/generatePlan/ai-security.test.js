const assert = require("assert");
const test = require("node:test");

const { assertAiOutputSafe, resolveCloudEnv } = require("./ai");

test("AI output is checked with the caller openid and fails closed", async () => {
  let payload;
  await assertAiOutputSafe("安全建议", {
    context: { OPENID: "openid_ai" },
    securityApi: {
      msgSecCheck: async (value) => {
        payload = value;
        return { result: { suggest: "pass" } };
      },
    },
  });
  assert.strictEqual(payload.openid, "openid_ai");
  assert.strictEqual(payload.content, "安全建议");
  assert.strictEqual(payload.scene, 4);

  await assert.rejects(
    assertAiOutputSafe("风险内容", {
      context: { OPENID: "openid_ai" },
      securityApi: { msgSecCheck: async () => ({ result: { suggest: "review" } }) },
    }),
    (error) => error.code === "CONTENT_SECURITY_REJECTED",
  );
  await assert.rejects(
    assertAiOutputSafe("无身份", { context: {} }),
    (error) => error.code === "UNAUTHORIZED",
  );
});

test("AI CloudBase initialization requires an injected runtime environment", () => {
  assert.strictEqual(resolveCloudEnv({ CLOUDBASE_ENV: "prod-env" }), "prod-env");
  assert.strictEqual(resolveCloudEnv({ TCB_ENV: "test-env" }), "test-env");
  assert.throws(() => resolveCloudEnv({}), (error) => error.code === "CLOUDBASE_ENV_NOT_CONFIGURED");
});
