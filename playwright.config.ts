import { defineConfig } from '@playwright/test';

/**
 * Playwright E2E 配置（Issue #27）。
 *
 * 仅本地/手动运行（`npm run test:e2e`），不进入默认 CI 门禁：扩展 E2E 依赖已构建的
 * MV3 产物且在 CI 中偏不稳定。运行前需先 `npm run build` 生成 .output/chrome-mv3。
 */
export default defineConfig({
  testDir: './e2e',
  // 扩展通过单一 persistent context 加载，测试间共享同一浏览器，串行更稳定。
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 30_000,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
