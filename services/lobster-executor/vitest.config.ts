import { defineConfig } from "vitest/config";

export default defineConfig({
  root: ".",
  test: {
    environment: "node",
    include: ["services/lobster-executor/src/**/*.test.ts"],
  },
});
