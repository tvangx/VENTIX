/** @type {import('jest').Config} */
module.exports = {
  ...require("./jest.config"),
  roots: ["<rootDir>/test/integration"],
  testMatch: ["**/*.int-spec.ts"],
  testTimeout: 180000,
};
