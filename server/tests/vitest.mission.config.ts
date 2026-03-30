import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'server/tests/mission-store.test.ts',
      'server/tests/mission-routes.test.ts',
      'server/tests/mission-storage.test.ts',
      'server/tests/mission-orchestrator.test.ts',
    ],
  },
});
