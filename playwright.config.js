// Playwright 测试配置：自动启动本地静态服务，只用 Chromium 运行 tests/ 下的用例。
const { defineConfig, devices } = require('@playwright/test');

const PORT = Number(process.env.PORT) || 4173;

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,      // CI 中禁止遗留 test.only
  retries: 0,                        // 不重试：失败即视为真实问题，不掩盖不稳定的测试
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `node tests/static-server.js ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
