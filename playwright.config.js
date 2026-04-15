// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  use: {
    navigationTimeout: 15000,
    actionTimeout: 10000,
    // Map unavailable external domains to 127.0.0.2 (loopback) so requests fail
    // fast instead of hanging on DNS timeouts during tests.
    launchOptions: {
      args: [
        '--host-resolver-rules=MAP fonts.googleapis.com 127.0.0.2, MAP fonts.gstatic.com 127.0.0.2',
      ],
    },
  },
  webServer: {
    command: 'py -m http.server 8787 --bind 127.0.0.1',
    url: 'http://127.0.0.1:8787',
    reuseExistingServer: true,
    timeout: 10000,
  },
});
