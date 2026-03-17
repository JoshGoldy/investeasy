const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  timeout: 20_000,
  retries: 1,
  reporter: [['list'], ['json', { outputFile: '../results/e2e.json' }]],
  use: {
    baseURL: process.env.TEST_URL || 'http://127.0.0.1:8787',
    headless: true,
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
          ],
        },
      },
    },
  ],
  // No webServer block — started externally by run_tests.sh
});
