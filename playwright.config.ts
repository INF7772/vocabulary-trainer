import { defineConfig, devices } from '@playwright/test';

const quietTestEnvironment: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[0] !== 'FORCE_COLOR' && entry[1] !== undefined,
    ),
  ),
  NODE_NO_WARNINGS: '1',
  NO_COLOR: '1',
};

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    serviceWorkers: 'allow',
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : undefined,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command:
      'npm run build -- --logLevel error && npm run preview -- --host 127.0.0.1 --port 4173 --logLevel error',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    env: quietTestEnvironment,
  },
});
