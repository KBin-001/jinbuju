const assert = require("node:assert/strict");
const Module = require("node:module");

let communityConfig = null;
let databaseError = null;
let requestedCollections = [];

const database = {
  collection(name) {
    requestedCollections.push(name);
    if (name !== "community_config") {
      throw new Error(`Unexpected personal data collection read: ${name}`);
    }
    const query = {
      where(value) {
        assert.deepEqual(value, { _id: "default" });
        return query;
      },
      limit(value) {
        assert.equal(value, 1);
        return query;
      },
      async get() {
        if (databaseError) throw databaseError;
        return { data: communityConfig ? [communityConfig] : [] };
      },
    };
    return query;
  },
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "wx-server-sdk") return { database: () => database };
  return originalLoad.call(this, request, parent, isMain);
};

const { getCommunityEntry } = require("./profile");
Module._load = originalLoad;

async function read(config) {
  communityConfig = config;
  databaseError = null;
  requestedCollections = [];
  const result = await getCommunityEntry("openid-must-not-be-used");
  assert.deepEqual(requestedCollections, ["community_config"]);
  return result;
}

(async () => {
  assert.equal((await read(null)).status, "preparing");
  assert.equal((await read({ _id: "default", status: "disabled" })).status, "preparing");
  assert.equal((await read({ _id: "default", status: "active", imageFileId: "" })).status, "preparing");
  assert.equal((await read({ _id: "default", status: "active", imageFileId: "https://example.com/qr.png" })).status, "preparing");

  const expired = await read({
    _id: "default",
    status: "active",
    imageFileId: "cloud://env/community/expired.png",
    expiresAt: "2020-01-01T00:00:00.000Z",
  });
  assert.equal(expired.status, "expired");
  assert.equal(expired.imageFileId, undefined);

  const ready = await read({
    _id: "default",
    status: "active",
    title: "一起成长",
    description: "长按识别",
    imageFileId: "  cloud://env/community/current.png  ",
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  assert.deepEqual(ready, {
    status: "ready",
    title: "一起成长",
    description: "长按识别",
    imageFileId: "cloud://env/community/current.png",
    expiresAt: "2099-01-01T00:00:00.000Z",
  });

  communityConfig = null;
  requestedCollections = [];
  databaseError = new Error("database unavailable");
  await assert.rejects(() => getCommunityEntry("openid"), (error) => error === databaseError);
  assert.deepEqual(requestedCollections, ["community_config"]);

  console.log("community entry cloud contract tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
