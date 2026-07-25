const assert = require("assert");
const test = require("node:test");

const {
  assertEventContentSafe,
  assertSafeAvatar,
  assertSafeText,
  chunkTexts,
  collectContentText,
  isTransientError,
} = require("./content-security");

function captureConsole() {
  const calls = { warn: [], error: [] };
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = (...args) => calls.warn.push(args);
  console.error = (...args) => calls.error.push(args);
  return {
    calls,
    restore() {
      console.warn = originalWarn;
      console.error = originalError;
    },
  };
}

function withEnv(key, value, fn) {
  return async () => {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    try {
      await fn();
    } finally {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  };
}

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
  const calls = [];
  await assert.rejects(
    assertSafeText("openid", ["内容"], 4, {
      msgSecCheck: async () => { calls.push(1); throw Object.assign(new Error("network"), { errCode: -1 }); },
    }, { retryBaseDelayMs: 0 }),
    (error) => error.code === "CONTENT_SECURITY_UNAVAILABLE",
  );
  // Default maxRetries is 2: 1 initial attempt + 2 retries = 3 total calls.
  assert.strictEqual(calls.length, 3);
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

test("isTransientError distinguishes retryable from non-retryable errors", () => {
  // Content risk rejections (87014/87015) must not retry.
  assert.strictEqual(isTransientError({ errCode: 87014 }), false);
  assert.strictEqual(isTransientError({ errCode: 87015 }), false);
  assert.strictEqual(isTransientError({ errcode: 87014 }), false);

  // Generic network error (-1) is transient and worth retrying.
  assert.strictEqual(isTransientError({ errCode: -1 }), true);
  assert.strictEqual(isTransientError(Object.assign(new Error("network"), { errCode: -1 })), true);

  // Client errors (4xxxx: params, permissions, quota) are not transient.
  assert.strictEqual(isTransientError({ errCode: 40001 }), false);
  assert.strictEqual(isTransientError({ errCode: 45009 }), false);

  // Server errors (5xxxx) are transient and worth retrying.
  assert.strictEqual(isTransientError({ errCode: 50001 }), true);
  assert.strictEqual(isTransientError({ errCode: 50050 }), true);

  // TypeError (e.g. securityApi undefined) is not transient.
  assert.strictEqual(isTransientError(new TypeError("cannot read property")), false);

  // Missing or null error and unknown codes are conservatively non-retryable.
  assert.strictEqual(isTransientError(null), false);
  assert.strictEqual(isTransientError(undefined), false);
  assert.strictEqual(isTransientError({ errMsg: "something went wrong" }), false);
  assert.strictEqual(isTransientError(new Error("unknown")), false);
});

test("assertSafeText accepts an options argument without changing default behavior", async () => {
  // Without options the behavior stays single-call and fail-closed.
  const calls = [];
  await assertSafeText("openid", ["安全内容"], 4, {
    msgSecCheck: async (payload) => {
      calls.push(payload);
      return { result: { suggest: "pass" } };
    },
  });
  assert.strictEqual(calls.length, 1);

  // Passing options with defaults must not change behavior either.
  const secondCalls = [];
  await assertSafeText("openid", ["安全内容"], 4, {
    msgSecCheck: async (payload) => {
      secondCalls.push(payload);
      return { result: { suggest: "pass" } };
    },
  }, { degradeOnUnavailable: false, maxRetries: 2, retryBaseDelayMs: 500 });
  assert.strictEqual(secondCalls.length, 1);

  // Default options still fail closed on transient errors (with retries).
  await assert.rejects(
    assertSafeText("openid", ["内容"], 4, {
      msgSecCheck: async () => { throw Object.assign(new Error("network"), { errCode: -1 }); },
    }, { degradeOnUnavailable: false, retryBaseDelayMs: 0 }),
    (error) => error.code === "CONTENT_SECURITY_UNAVAILABLE",
  );
});

test("assertSafeText retries transient errors and succeeds on a later attempt", async () => {
  const calls = [];
  await assertSafeText("openid", ["安全内容"], 4, {
    msgSecCheck: async () => {
      calls.push(1);
      if (calls.length === 1) {
        throw Object.assign(new Error("network"), { errCode: -1 });
      }
      return { result: { suggest: "pass" } };
    },
  }, { retryBaseDelayMs: 0 });
  assert.strictEqual(calls.length, 2);
});

test("assertSafeText fails closed after exhausting all retries on transient errors", async () => {
  const calls = [];
  await assert.rejects(
    assertSafeText("openid", ["内容"], 4, {
      msgSecCheck: async () => {
        calls.push(1);
        throw Object.assign(new Error("server error"), { errCode: 50001 });
      },
    }, { retryBaseDelayMs: 0 }),
    (error) => error.code === "CONTENT_SECURITY_UNAVAILABLE",
  );
  // Default maxRetries is 2: 1 initial + 2 retries = 3 total calls.
  assert.strictEqual(calls.length, 3);
});

test("assertSafeText does not retry content risk rejections (87014)", async () => {
  const calls = [];
  await assert.rejects(
    assertSafeText("openid", ["风险内容"], 4, {
      msgSecCheck: async () => {
        calls.push(1);
        throw Object.assign(new Error("risky"), { errCode: 87014 });
      },
    }, { retryBaseDelayMs: 0 }),
    (error) => error.code === "CONTENT_SECURITY_REJECTED",
  );
  assert.strictEqual(calls.length, 1);
});

test("assertSafeText does not retry TypeError", async () => {
  const calls = [];
  await assert.rejects(
    assertSafeText("openid", ["内容"], 4, {
      msgSecCheck: async () => {
        calls.push(1);
        throw new TypeError("cannot read property of undefined");
      },
    }, { retryBaseDelayMs: 0 }),
    (error) => error.code === "CONTENT_SECURITY_UNAVAILABLE",
  );
  assert.strictEqual(calls.length, 1);
});

test("assertSafeText logs retry warnings and final error on exhaustion", async () => {
  const consoleCapture = captureConsole();
  try {
    await assert.rejects(
      assertSafeText("openid_test", ["内容"], 4, {
        msgSecCheck: async () => {
          throw Object.assign(new Error("network"), { errCode: -1 });
        },
      }, { retryBaseDelayMs: 0 }),
      (error) => error.code === "CONTENT_SECURITY_UNAVAILABLE",
    );
    // Two retry warnings (retry 1 and retry 2).
    assert.strictEqual(consoleCapture.calls.warn.length, 2);
    assert.strictEqual(consoleCapture.calls.warn[0][1].retry, 1);
    assert.strictEqual(consoleCapture.calls.warn[1][1].retry, 2);
    assert.strictEqual(consoleCapture.calls.warn[0][1].openid, "openid_t");
    assert.strictEqual(consoleCapture.calls.warn[0][1].scene, 4);
    assert.strictEqual(consoleCapture.calls.warn[0][1].errCode, -1);
    // One final error log with underlying cause.
    assert.strictEqual(consoleCapture.calls.error.length, 1);
    const errorPayload = consoleCapture.calls.error[0][1];
    assert.strictEqual(errorPayload.cause.errCode, -1);
    assert.ok(String(errorPayload.cause.errMsg).includes("network"));
    assert.strictEqual(errorPayload.cause.errorType, "Error");
  } finally {
    consoleCapture.restore();
  }
});

test("assertSafeText does not log error for non-retried failures", async () => {
  const consoleCapture = captureConsole();
  try {
    // TypeError is non-transient: no retry, no warn log.
    // An error log is expected for diagnosis of the underlying cause.
    await assert.rejects(
      assertSafeText("openid", ["内容"], 4, {
        msgSecCheck: async () => { throw new TypeError("boom"); },
      }, { retryBaseDelayMs: 0 }),
      (error) => error.code === "CONTENT_SECURITY_UNAVAILABLE",
    );
    assert.strictEqual(consoleCapture.calls.warn.length, 0);
    assert.strictEqual(consoleCapture.calls.error.length, 1);
    const errorLog = consoleCapture.calls.error[0][1];
    assert.strictEqual(errorLog.cause.errorType, "TypeError");
  } finally {
    consoleCapture.restore();
  }
});

test("assertSafeText respects CONTENT_SECURITY_MAX_RETRIES env var", withEnv("CONTENT_SECURITY_MAX_RETRIES", "1", async () => {
  const calls = [];
  await assert.rejects(
    assertSafeText("openid", ["内容"], 4, {
      msgSecCheck: async () => {
        calls.push(1);
        throw Object.assign(new Error("network"), { errCode: -1 });
      },
    }, { retryBaseDelayMs: 0 }),
    (error) => error.code === "CONTENT_SECURITY_UNAVAILABLE",
  );
  // maxRetries=1 from env: 1 initial + 1 retry = 2 total.
  assert.strictEqual(calls.length, 2);
}));

test("assertSafeText respects CONTENT_SECURITY_RETRY_BASE_DELAY_MS env var", withEnv("CONTENT_SECURITY_RETRY_BASE_DELAY_MS", "0", async () => {
  const calls = [];
  const start = Date.now();
  await assert.rejects(
    assertSafeText("openid", ["内容"], 4, {
      msgSecCheck: async () => {
        calls.push(1);
        throw Object.assign(new Error("network"), { errCode: -1 });
      },
    }),
    (error) => error.code === "CONTENT_SECURITY_UNAVAILABLE",
  );
  // Default maxRetries=2: 3 total calls.
  assert.strictEqual(calls.length, 3);
  // Env var set delay to 0, so total elapsed should be well under 500ms.
  assert.ok(Date.now() - start < 500, "retry delay should be near zero from env var");
}));

test("explicit options.maxRetries takes precedence over env var", withEnv("CONTENT_SECURITY_MAX_RETRIES", "5", async () => {
  const calls = [];
  await assert.rejects(
    assertSafeText("openid", ["内容"], 4, {
      msgSecCheck: async () => {
        calls.push(1);
        throw Object.assign(new Error("network"), { errCode: -1 });
      },
    }, { maxRetries: 1, retryBaseDelayMs: 0 }),
    (error) => error.code === "CONTENT_SECURITY_UNAVAILABLE",
  );
  // options.maxRetries=1 overrides env var 5: 1 initial + 1 retry = 2 total.
  assert.strictEqual(calls.length, 2);
}));

test("assertSafeText degrades (fail-open) when all retries fail and degradeOnUnavailable is true", async () => {
  const calls = [];
  const consoleCapture = captureConsole();
  try {
    // Should NOT throw — degradation means the check passes.
    await assertSafeText("openid_test", ["内容"], 4, {
      msgSecCheck: async () => {
        calls.push(1);
        throw Object.assign(new Error("network"), { errCode: -1 });
      },
    }, { degradeOnUnavailable: true, retryBaseDelayMs: 0 });
    // All 3 attempts made (1 initial + 2 retries).
    assert.strictEqual(calls.length, 3);
    // Audit warn log recorded.
    assert.strictEqual(consoleCapture.calls.warn.length, 3);
    const degradeLog = consoleCapture.calls.warn[2][1];
    assert.strictEqual(degradeLog.openid, "openid_t");
    assert.strictEqual(degradeLog.scene, 4);
    assert.strictEqual(degradeLog.errCode, -1);
    assert.ok(typeof degradeLog.contentLength === "number");
    // No error log (we degraded, not failed).
    assert.strictEqual(consoleCapture.calls.error.length, 0);
  } finally {
    consoleCapture.restore();
  }
});

test("assertSafeText does NOT degrade on explicit content rejection even with degradeOnUnavailable true", async () => {
  const calls = [];
  await assert.rejects(
    assertSafeText("openid", ["风险内容"], 4, {
      msgSecCheck: async () => {
        calls.push(1);
        return { result: { suggest: "review" } };
      },
    }, { degradeOnUnavailable: true, retryBaseDelayMs: 0 }),
    (error) => error.code === "CONTENT_SECURITY_REJECTED",
  );
  // No retry for response-level rejection (not a thrown error).
  assert.strictEqual(calls.length, 1);
});

test("assertSafeText does NOT degrade on 87014 even with degradeOnUnavailable true", async () => {
  const calls = [];
  await assert.rejects(
    assertSafeText("openid", ["风险内容"], 4, {
      msgSecCheck: async () => {
        calls.push(1);
        throw Object.assign(new Error("risky"), { errCode: 87014 });
      },
    }, { degradeOnUnavailable: true, retryBaseDelayMs: 0 }),
    (error) => error.code === "CONTENT_SECURITY_REJECTED",
  );
  assert.strictEqual(calls.length, 1);
});

test("assertSafeText still fails closed on transient errors when degradeOnUnavailable is false", async () => {
  const calls = [];
  await assert.rejects(
    assertSafeText("openid", ["内容"], 4, {
      msgSecCheck: async () => {
        calls.push(1);
        throw Object.assign(new Error("network"), { errCode: -1 });
      },
    }, { degradeOnUnavailable: false, retryBaseDelayMs: 0 }),
    (error) => error.code === "CONTENT_SECURITY_UNAVAILABLE",
  );
  assert.strictEqual(calls.length, 3);
});

test("assertEventContentSafe degrades for askProgressCoach on transient failure", async () => {
  // askProgressCoach: degradation enabled — should not throw on transient failure.
  const coachCalls = [];
  const coachApi = {
    msgSecCheck: async () => {
      coachCalls.push(1);
      throw Object.assign(new Error("network"), { errCode: -1 });
    },
  };
  const event = { question: "今天怎么安排？" };
  await assertEventContentSafe("openid_test", "askProgressCoach", event, coachApi, { retryBaseDelayMs: 0 });
  // All 3 attempts made (1 initial + 2 retries).
  assert.strictEqual(coachCalls.length, 3);
});

test("assertEventContentSafe keeps fail-closed for non-coach actions", async () => {
  // createManualTask: should remain fail-closed (no degradation).
  const calls = [];
  const api = {
    msgSecCheck: async () => {
      calls.push(1);
      throw Object.assign(new Error("network"), { errCode: -1 });
    },
  };
  const event = { title: "任务内容" };
  await assert.rejects(
    assertEventContentSafe("openid", "createManualTask", event, api, { retryBaseDelayMs: 0 }),
    (error) => error.code === "CONTENT_SECURITY_UNAVAILABLE",
  );
  assert.strictEqual(calls.length, 3);
});

test("assertEventContentSafe still rejects risky content for askProgressCoach", async () => {
  // Even with degradation, explicit content rejection must still throw.
  const calls = [];
  const api = {
    msgSecCheck: async () => {
      calls.push(1);
      throw Object.assign(new Error("risky"), { errCode: 87014 });
    },
  };
  const event = { question: "风险内容" };
  await assert.rejects(
    assertEventContentSafe("openid", "askProgressCoach", event, api, { retryBaseDelayMs: 0 }),
    (error) => error.code === "CONTENT_SECURITY_REJECTED",
  );
  assert.strictEqual(calls.length, 1);
});

test("syncManualData does not trigger content security check", async () => {
  // Regression: syncManualData is a sync operation, not content creation.
  // Content is checked at creation time via createManualTask, submitCheckin, etc.
  // Running msgSecCheck on the entire data store during sync was blocking AI
  // coach对话 when msgSecCheck was unavailable.
  let checkCalled = false;
  const api = {
    msgSecCheck: async () => {
      checkCalled = true;
      return { result: { suggest: "pass" } };
    },
  };
  const event = {
    action: "syncManualData",
    store: {
      version: 1,
      goals: [{ id: "goal_1", title: "通过英语四级", description: "每天复习" }],
      tasks: [{ id: "task_1", goalId: "goal_1", title: "背单词" }],
    },
  };
  await assertEventContentSafe("openid", "syncManualData", event, api);
  assert.strictEqual(checkCalled, false, "syncManualData should not call msgSecCheck");
});

test("assertSafeText degrades on non-transient error when degradeOnUnavailable is true", async () => {
  // Regression: non-transient errors (TypeError, unknown error format) must
  // also respect degradeOnUnavailable. Previously only transient errors
  // (after retry exhaustion) checked the flag.
  const api = {
    msgSecCheck: async () => {
      throw new Error("some unexpected error without errCode");
    },
  };
  // Should degrade (fail-open), not throw
  await assertSafeText("openid_test", ["测试内容"], 4, api, {
    degradeOnUnavailable: true,
    retryBaseDelayMs: 0,
  });
});

test("assertSafeText still fails-closed on non-transient error when degradeOnUnavailable is false", async () => {
  const api = {
    msgSecCheck: async () => {
      throw new Error("some unexpected error without errCode");
    },
  };
  await assert.rejects(
    assertSafeText("openid_test", ["测试内容"], 4, api, {
      degradeOnUnavailable: false,
      retryBaseDelayMs: 0,
    }),
    (error) => error.code === "CONTENT_SECURITY_UNAVAILABLE",
  );
});
