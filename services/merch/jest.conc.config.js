/** @type {import('jest').Config} */
module.exports = {
  ...require("./jest.config"),
  roots: ["<rootDir>/test/concurrency"],
  testMatch: ["**/*.conc-spec.ts"],
  testTimeout: 120000,
};
