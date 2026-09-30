// Playwright 测试配置：自动启动只读模式的本地服务（测试不会改动仓库中的数据文件），只用 Chromium 运行 tests/ 下的用例。
const { defineConfig, devices } = require('@playwright/test');

// 与 npm start 的默认端口（4173）不同，且从不复用已运行的服务，避免测试连到可写服务器改动真实数据
const PORT = Number(process.env.TEST_PORT) || 4183;

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
    command: `node server.js --readonly --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
