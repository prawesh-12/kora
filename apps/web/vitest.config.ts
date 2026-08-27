import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Only for the component modules a test imports directly, such as the trace
  // verdict rule. Without it Vite hands JSX to the plain TS parser.
  plugins: [react()],
  test: {
    setupFiles: ['../../vitest.setup.ts'],
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
});
