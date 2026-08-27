import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    env: {
      DATABASE_URL: 'postgresql://kora:kora@localhost:5432/kora',
      REDIS_URL: 'redis://localhost:6379',
      ACME_API_KEY: 'acme-dev-key',
      ACME_FAULT_RATE: '0',
    },
  },
});
