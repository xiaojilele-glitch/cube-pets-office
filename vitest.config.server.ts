import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  test: {
    environment: "node",
    include: [
      "server/tests/**/*.test.ts",
      "shared/**/*.test.ts",
      "client/src/lib/replay/__tests__/**/*.test.ts",
      "client/src/runtime/demo-data/__tests__/**/*.test.ts",
    ],
  },
});
