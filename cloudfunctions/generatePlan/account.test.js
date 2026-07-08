const assert = require("assert");
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
    async set({ data }) { records.set(key(collection, id), { ...data }); },
    async update({ data }) {
      const current = records.get(key(collection, id));
      if (!current) throw new Error("not found");
      records.set(key(collection, id), { ...current, ...data });
    },
    async remove() { records.delete(key(collection, id)); },
  };
}

function collectionApi(name) {
  return {
    doc(id) { return docApi(name, id); },
    where(filter) {
      return {
        async remove() {
          for (const [recordKey, value] of records.entries()) {
            if (recordKey.startsWith(`${name}:`) && Object.keys(filter).every((field) => value[field] === filter[field])) records.delete(recordKey);
          }
        },
      };
    },
  };
}

const db = {
  command: {},
  collection: collectionApi,
  serverDate: () => "SERVER_DATE",
  runTransaction: (callback) => callback({ collection: collectionApi }),
};

let phone = "13800138000";
const cloudMock = {
  database: () => db,
  openapi: { phonenumber: { getPhoneNumber: async () => ({ phoneInfo: { purePhoneNumber: phone } }) } },
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "wx-server-sdk") return cloudMock;
  return originalLoad.call(this, request, parent, isMain);
};

const account = require("./account");

(async () => {
  const first = await account.bootstrapAccount("openid-a");
  const second = await account.bootstrapAccount("openid-a");
  assert.equal(first.account.userId, second.account.userId);
  assert.equal(JSON.stringify(first).includes("openid-a"), false);

  const bound = await account.bindPhone("openid-a", { code: "phone-code-a" });
  assert.equal(bound.phoneMasked, "138****8000");

  await account.bootstrapAccount("openid-b");
  await assert.rejects(
    account.bindPhone("openid-b", { code: "phone-code-b" }),
    (error) => error.code === "PHONE_ALREADY_BOUND",
  );

  phone = "13900139000";
  const replaced = await account.bindPhone("openid-a", { code: "phone-code-c" });
  assert.equal(replaced.phoneMasked, "139****9000");
  console.log("account identity tests passed");
})().finally(() => { Module._load = originalLoad; });
