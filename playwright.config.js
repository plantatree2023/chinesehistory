// Playwright 测试配置：自动启动只读模式的本地服务（测试不会改动仓库中的数据文件），只用 Chromium 运行 tests/ 下的用例。
// 界面测试使用固定的测试数据 tests/data/cn_zh-test.json（服务器以 --test-data 提供），不受 data/ 中真实数据更新的影响。
const { defineConfig, devices } = require('@playwright/test');

// 与 npm start 的默认端口（4173）不同，且从不复用已运行的服务，避免测试连到可写服务器改动真实数据
const PORT = Number(process.env.TEST_PORT) || 4183;

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 8,                        // 同时运行的测试数固定为 8：再多会让单进程测试服务器和计时类测试不稳定
  forbidOnly: !!process.env.CI,      // CI 中禁止遗留 test.only
  retries: 2,                        // 失败后自动重跑最多 2 次（应对机器负载高时的偶发失败）；重跑才通过的会在报告中标为 flaky
  timeout: 90_000,
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
    command: `node server.js --readonly --test-data tests/data --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
