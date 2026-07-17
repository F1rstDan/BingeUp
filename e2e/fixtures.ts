import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 加载真实 MV3 扩展的 Playwright fixture（Issue #27）。
 *
 * 通过 launchPersistentContext + --load-extension 加载已构建的 chrome-mv3 产物，
 * 从 service worker URL 解析扩展 ID，并提供打开扩展内部页面（popup/options/stats）的辅助。
 */

const currentDir = dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = resolve(currentDir, '../.output/chrome-mv3');

interface ExtensionFixtures {
  context: BrowserContext;
  extensionId: string;
  serviceWorker: Worker;
}

export const test = base.extend<ExtensionFixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    if (!existsSync(resolve(EXTENSION_PATH, 'manifest.json'))) {
      throw new Error(
        `未找到扩展构建产物：${EXTENSION_PATH}。请先运行 \`npm run build\` 生成 .output/chrome-mv3。`,
      );
    }
    const context = await chromium.launchPersistentContext('', {
      // `channel: 'chromium'` 使用支持扩展的新版 headless 构建（Chrome for Testing）；
      // 旧版 headless 不加载扩展，service worker 不会注册。如需可视化调试可加 headless: false。
      channel: 'chromium',
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
    await use(context);
    await context.close();
  },

  serviceWorker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) {
      worker = await context.waitForEvent('serviceworker');
    }
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    // service worker URL 形如 chrome-extension://<id>/background.js
    const extensionId = new URL(serviceWorker.url()).host;
    await use(extensionId);
  },
});

export const expect = test.expect;

/** 扩展内部页面 URL，如 popupUrl(id, 'options.html')。 */
export function pageUrl(extensionId: string, htmlFile: string): string {
  return `chrome-extension://${extensionId}/${htmlFile}`;
}
