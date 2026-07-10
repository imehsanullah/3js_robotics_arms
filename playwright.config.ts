import { defineConfig, devices } from 'playwright/test';

const basePath = process.env.PLAYWRIGHT_BASE_PATH ?? '/';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: `http://127.0.0.1:5173${basePath}`,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'npm run dev -- --port 5173',
    url: `http://127.0.0.1:5173${basePath}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
