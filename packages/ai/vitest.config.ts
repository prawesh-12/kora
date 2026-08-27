import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['../../vitest.setup.ts'], include: ['test/**/*.test.ts'], fileParallelism: false, testTimeout: 60_000 },
});
