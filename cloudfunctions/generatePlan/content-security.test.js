const assert = require("assert");
const test = require("node:test");

const {
  assertSafeAvatar,
  assertSafeText,
  chunkTexts,
  collectContentText,
} = require("./content-security");

test("collectContentText only collects user-authored fields", () => {
  const event = {
    action: "syncManualData",
    requestId: "request_123",
    store: {
      goals: [{ id: "goal_1", title: "通过四级", description: "每天复习" }],
      answers: [{ questionId: "q1", value: "希望提升听力" }],
    },
  };
  assert.deepStrictEqual(collectContentText(event), ["通过四级", "每天复习", "希望提升听力"]);
});

test("chunkTexts preserves long text within the API limit", () => {
  const input = ["甲".repeat(1500), "乙".repeat(1500)];
  const chunks = chunkTexts(input, 2000);
  assert.strictEqual(chunks.length, 2);
  assert.ok(chunks.every((item) => item.length <= 2000));
  assert.strictEqual(chunks.join("").replace("\n", ""), input.join(""));
});

test("assertSafeText accepts pass and rejects review", async () => {
  const calls = [];
  await assertSafeText("openid", ["安全内容"], 4, {
    msgSecCheck: async (payload) => {
      calls.push(payload);
      return { result: { suggest: "pass" } };
    },
  });
  assert.strictEqual(calls[0].version, 2);
  assert.strictEqual(calls[0].openid, "openid");

  await assert.rejects(
    assertSafeText("openid", ["待复核内容"], 4, {
      msgSecCheck: async () => ({ result: { suggest: "review" } }),
    }),
    (error) => error.code === "CONTENT_SECURITY_REJECTED",
  );
});

test("assertSafeText fails closed when the API is unavailable", async () => {
  await assert.rejects(
    assertSafeText("openid", ["内容"], 4, {
      msgSecCheck: async () => { throw Object.assign(new Error("network"), { errCode: -1 }); },
    }),
    (error) => error.code === "CONTENT_SECURITY_UNAVAILABLE",
  );
});

test("assertSafeAvatar sends Buffer media and rejects risky images", async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  let media;
  await assertSafeAvatar("openid", "cloud://env/user-avatars/u/avatar.jpg", {
    expectedPath: "user-avatars/u/",
    downloadFile: async () => ({ fileContent: jpeg }),
    securityApi: {
      imgSecCheck: async (payload) => {
        media = payload.media;
        return { errCode: 0 };
      },
    },
  });
  assert.strictEqual(media.contentType, "image/jpeg");
  assert.ok(Buffer.isBuffer(media.value));

  await assert.rejects(
    assertSafeAvatar("openid", "cloud://env/user-avatars/u/avatar.png", {
      downloadFile: async () => ({ fileContent: png }),
      securityApi: {
        imgSecCheck: async () => { throw Object.assign(new Error("risky"), { errCode: 87014 }); },
      },
    }),
    (error) => error.code === "CONTENT_SECURITY_REJECTED",
  );

  const oversizedJpeg = Buffer.alloc(2 * 1024 * 1024 + 1);
  oversizedJpeg.set([0xff, 0xd8, 0xff]);
  await assert.rejects(
    assertSafeAvatar("openid", "cloud://env/user-avatars/u/large.jpg", {
      expectedPath: "user-avatars/u/",
      downloadFile: async () => ({ fileContent: oversizedJpeg }),
      securityApi: { imgSecCheck: async () => ({ errCode: 0 }) },
    }),
    (error) => error.code === "CONTENT_SECURITY_REJECTED" && /2MB/.test(error.message),
  );

  await assert.rejects(
    assertSafeAvatar("openid", "cloud://env/user-avatars/u/avatar.webp", {
      expectedPath: "user-avatars/u/",
      downloadFile: async () => ({ fileContent: Buffer.from("RIFF0000WEBP") }),
      securityApi: { imgSecCheck: async () => ({ errCode: 0 }) },
    }),
    (error) => error.code === "CONTENT_SECURITY_REJECTED",
  );

  await assert.rejects(
    assertSafeAvatar("openid", "cloud://env/user-avatars/other/avatar.jpg", {
      expectedPath: "user-avatars/u/",
      downloadFile: async () => ({ fileContent: jpeg }),
      securityApi: { imgSecCheck: async () => ({ errCode: 0 }) },
    }),
    (error) => error.code === "CONTENT_SECURITY_REJECTED",
  );

  await assert.rejects(
    assertSafeAvatar("openid", "cloud://env/other/user-avatars/u/avatar.jpg", {
      expectedPath: "user-avatars/u/",
      downloadFile: async () => ({ fileContent: jpeg }),
      securityApi: { imgSecCheck: async () => ({ errCode: 0 }) },
    }),
    (error) => error.code === "CONTENT_SECURITY_REJECTED",
  );

  await assert.rejects(
    assertSafeAvatar("openid", "https://example.com/avatar.jpg", {
      expectedPath: "user-avatars/u/",
    }),
    (error) => error.code === "CONTENT_SECURITY_REJECTED",
  );

  await assert.rejects(
    assertSafeAvatar("openid", "cloud://env/user-avatars/u/spoofed.jpg", {
      expectedPath: "user-avatars/u/",
      downloadFile: async () => ({ fileContent: png }),
      securityApi: { imgSecCheck: async () => ({ errCode: 0 }) },
    }),
    (error) => error.code === "CONTENT_SECURITY_REJECTED",
  );
});
