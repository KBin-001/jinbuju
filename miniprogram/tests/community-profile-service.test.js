const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  module._compile(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
  }).outputText, filename);
};

let resolver = async () => ({ fileList: [] });
let requestedFileLists = [];
global.wx = {
  cloud: {
    getTempFileURL(options) {
      requestedFileLists.push(options.fileList);
      return resolver(options);
    },
  },
};

const { resolveCommunityQrUrl } = require("../services/profile.ts");

(async () => {
  requestedFileLists = [];
  await assert.rejects(
    () => resolveCommunityQrUrl("https://example.com/qr.png"),
    (error) => error.code === "COMMUNITY_IMAGE_INVALID",
  );
  assert.deepEqual(requestedFileLists, []);

  resolver = async () => ({
    fileList: [{ status: 0, tempFileURL: "https://temp.example.com/community.png" }],
  });
  assert.equal(
    await resolveCommunityQrUrl("  cloud://env/community/current.png  "),
    "https://temp.example.com/community.png",
  );
  assert.deepEqual(requestedFileLists, [["cloud://env/community/current.png"]]);

  resolver = async () => ({ fileList: [{ status: -1, tempFileURL: "https://should-not-be-used" }] });
  await assert.rejects(
    () => resolveCommunityQrUrl("cloud://env/community/current.png"),
    (error) => error.code === "COMMUNITY_IMAGE_UNAVAILABLE",
  );

  resolver = async () => ({ fileList: [{ status: 0, tempFileURL: "" }] });
  await assert.rejects(
    () => resolveCommunityQrUrl("cloud://env/community/current.png"),
    (error) => error.code === "COMMUNITY_IMAGE_UNAVAILABLE",
  );

  resolver = async () => { throw new Error("network down"); };
  await assert.rejects(
    () => resolveCommunityQrUrl("cloud://env/community/current.png"),
    (error) => error.code === "COMMUNITY_IMAGE_UNAVAILABLE",
  );

  console.log("community profile service QR resolution tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
