import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.KORA_E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // The screens share one seeded tenant, so parallel specs would fight over it.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { baseURL, trace: 'off', video: 'off', screenshot: 'off' },
  webServer: {
    command: `pnpm exec dotenv -e ../../.env -- next dev --webpack --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
    // Auth checks the origin, so the app has to agree with the port the tests use.
    env: { BETTER_AUTH_URL: baseURL, KORA_APP_URL: baseURL },
  },
});
