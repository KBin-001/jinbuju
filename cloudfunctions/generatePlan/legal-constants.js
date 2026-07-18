const POLICY_VERSIONS = Object.freeze({
  privacy: "privacy-2.0.0",
  terms: "terms-2.0.0",
  phone_binding: "phone-1.0-rc.1",
});

const POLICY_TYPES = Object.keys(POLICY_VERSIONS);

module.exports = { POLICY_TYPES, POLICY_VERSIONS };
