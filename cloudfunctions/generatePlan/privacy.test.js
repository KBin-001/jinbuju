const assert = require("node:assert/strict");
const Module = require("module");

const records = new Map();
const key = (collection, id) => `${collection}:${id}`;

function docApi(collection, id) {
  return {
    async get() {
      const data = records.get(key(collection, id));
      if (!data) throw new Error("not found");
      return { data: { ...data } };
    },
    async set({ data }) { records.set(key(collection, id), { _id: id, ...data }); },
    async update({ data }) {
      const current = records.get(key(collection, id));
      if (!current) throw new Error("not found");
      records.set(key(collection, id), { ...current, ...data });
    },
    async remove() { records.delete(key(collection, id)); },
  };
}

function queryApi(collection, filter) {
  return {
    limit() { return this; },
    async get() {
      return {
        data: [...records.entries()]
          .filter(([recordKey, value]) => recordKey.startsWith(`${collection}:`) && Object.keys(filter).every((field) => value[field] === filter[field]))
          .map(([, value]) => ({ ...value })),
      };
    },
  };
}

function collectionApi(name) {
  return {
    doc(id) { return docApi(name, id); },
    where(filter) { return queryApi(name, filter); },
  };
}

const db = {
  command: {},
  collection: collectionApi,
  serverDate: () => "SERVER_DATE",
  runTransaction: (callback) => callback({ collection: collectionApi }),
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "wx-server-sdk") return { database: () => db };
  return originalLoad.call(this, request, parent, isMain);
};

const privacy = require("./privacy");

(async () => {
  const initial = await privacy.getConsentStatus("privacy-openid");
  assert.equal(initial.consents.privacy.agreed, false);
  assert.equal(initial.consents.terms.agreed, false);

  const recorded = await privacy.recordConsent("privacy-openid", { types: ["privacy", "terms"], source: "welcome" });
  assert.equal(recorded.consents.privacy.agreed, true);
  assert.equal(recorded.consents.terms.agreed, true);

  await assert.rejects(
    privacy.recordConsent("privacy-openid", { types: ["unknown"] }),
    (error) => error.code === "CONSENT_INVALID",
  );

  const withdrawn = await privacy.withdrawConsent("privacy-openid", { type: "privacy" });
  assert.equal(withdrawn.consents.privacy.agreed, false);
  assert.equal(withdrawn.consents.privacy.withdrawnAt, "SERVER_DATE");
  console.log("privacy consent tests passed");
})().finally(() => { Module._load = originalLoad; });
