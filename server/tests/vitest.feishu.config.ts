import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "server/tests/feishu-bridge.test.ts",
      "server/tests/feishu-routes.test.ts",
    ],
  },
});
