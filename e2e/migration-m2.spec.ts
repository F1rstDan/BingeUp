import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, pageUrl, test } from './fixtures';

/**
 * M2 Popup 完整迁移采集（工单 #39）——证据采集工具，不是质量门禁。
 *
 * 默认跳过；显式采集（会覆盖 docs/assets/migration-m2/ 下同名截图）：
 *
 *   PowerShell:  $env:CAPTURE_M2='1'; npx playwright test e2e/migration-m2.spec.ts
 *
 * Popup 直接打开时没有 activeTab 上下文；为采集各状态，脚本仅在采集页内替换
 * chrome.tabs.query / chrome.permissions.contains，站点数据仍来自真实后台，
 * 判定逻辑与消息链路保持不变。200% 缩放用 CDP 设备指标模拟：
 * CSS 视口 320px、deviceScaleFactor 2（物理 640px），与浏览器按缩放重新布局等效。
 */
const captureEnabled = process.env.CAPTURE_M2 === '1';

test.skip(!captureEnabled, 'M2 采集默认跳过：设置 CAPTURE_M2=1 运行，见文件头注释');

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(projectRoot, 'docs', 'assets', 'migration-m2');
const resultPath = resolve(projectRoot, '.output', 'migration-m2-capture.json');

interface CaptureRecord {
  name: string;
  status: 'captured' | 'failed';
  file?: string;
  detail?: string;
}

const records: CaptureRecord[] = [];

interface PopupStubOptions {
  /** 伪造的当前标签页 URL；不传则保持真实（无 tabs 权限时为 undefined）。 */
  tabUrl?: string;
  /** 伪造的 https 主机权限判定；不传则使用真实 chrome.permissions.contains。 */
  httpsPermission?: boolean;
}

/** 在页面脚本运行前替换部分 chrome API（仅限本文件采集用）。 */
async function installPopupStub(page: Page, options: PopupStubOptions): Promise<void> {
  await page.addInitScript((input: PopupStubOptions) => {
    const patch = (target: object, key: string, value: unknown) => {
      try {
        (target as Record<string, unknown>)[key] = value;
      } catch {
        try {
          Object.defineProperty(target, key, { value, configurable: true, writable: true });
        } catch {
          // 替换失败时保持真实 API 行为，采集记录会反映实际状态。
        }
      }
    };
    const api = chrome as unknown as { tabs: object; permissions: object };
    if (input.tabUrl !== undefined) {
      patch(api.tabs, 'query', async () => [{ id: 1, url: input.tabUrl, active: true }]);
    }
    if (input.httpsPermission !== undefined) {
      patch(api.permissions, 'contains', async () => input.httpsPermission);
    }
  }, options);
}

interface PageWatch {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  fontResponses: string[];
}

function watchPage(page: Page): PageWatch {
  const watch: PageWatch = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    fontResponses: [],
  };
  page.on('console', (message) => {
    if (message.type() === 'error') watch.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => watch.pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    watch.failedRequests.push(
      `${request.resourceType()} ${request.url()} :: ${request.failure()?.errorText ?? ''}`,
    );
  });
  page.on('response', (response) => {
    if (response.request().resourceType() === 'font' && response.ok()) {
      watch.fontResponses.push(response.url());
    }
  });
  return watch;
}

async function readOverflow(page: Page): Promise<{ scrollWidth: number; clientWidth: number }> {
  return page.evaluate(() => {
    const root = document.documentElement;
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
  });
}

async function readFontState(
  page: Page,
): Promise<{ loadedFamilies: string[]; notoReady: boolean; nunitoReady: boolean }> {
  return page.evaluate(async () => {
    await document.fonts.ready;
    const loadedFamilies = [...document.fonts]
      .filter((font) => font.status === 'loaded')
      .map((font) => font.family);
    return {
      loadedFamilies: [...new Set(loadedFamilies)],
      notoReady: document.fonts.check('14px "Noto Sans SC"'),
      nunitoReady: document.fonts.check('14px Nunito'),
    };
  });
}

/** 准备真实后台状态：完成引导并按需启用/停用 bilibili 与全局暂停。 */
async function seedBackground(
  control: Page,
  extensionId: string,
  options: { bilibiliEnabled: boolean; pauseTenMinutes?: boolean },
): Promise<void> {
  await control.goto(pageUrl(extensionId, 'options.html'));
  await control.evaluate(async (input) => {
    await chrome.runtime.sendMessage({
      type: 'ONBOARDING_COMPLETE',
      hostnames: ['bilibili.com', 'youtube.com'],
      deckId: 'deck-cet4',
      selfRatedLevel: 'intermediate',
    });
    await chrome.runtime.sendMessage({
      type: input.bilibiliEnabled ? 'SITE_ENABLE' : 'SITE_DISABLE',
      hostname: 'bilibili.com',
    });
    if (input.pauseTenMinutes) {
      await chrome.runtime.sendMessage({ type: 'PAUSE_TEN_MINUTES' });
    }
  }, options);
}

async function capture(
  page: Page,
  name: string,
  file: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  await page.screenshot({ path: resolve(outDir, file), fullPage: true });
  records.push({
    name,
    status: 'captured',
    file,
    detail: detail === undefined ? undefined : JSON.stringify(detail),
  });
}

test.describe('M2 Popup 完整迁移采集', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
  });

  test.afterAll(() => {
    if (!captureEnabled) return;
    writeFileSync(
      resultPath,
      `${JSON.stringify({ capturedAt: new Date().toISOString(), records }, null, 2)}\n`,
    );
    console.log(`[M2] 采集结果写入 ${resultPath}`);
    console.log(JSON.stringify(records, null, 2));
  });

  test('可学习状态：字体、控制台、320–420px 与 200% 缩放', async ({ context, extensionId }) => {
    const control = await context.newPage();
    await seedBackground(control, extensionId, { bilibiliEnabled: true });
    await control.close();

    const page = await context.newPage();
    const watch = watchPage(page);
    await installPopupStub(page, {
      tabUrl: 'https://www.bilibili.com/video/BV1M2',
      httpsPermission: true,
    });
    await page.goto(pageUrl(extensionId, 'popup.html'));
    await page.getByRole('switch', { name: '关闭当前网站' }).waitFor();
    await page.getByText('可学习').waitFor();
    await page.getByText('今日学习').waitFor();

    // 字体加载与 CSP：等待字体就绪，记录已加载家族与 woff2 资源。
    const fonts = await readFontState(page);
    expect(fonts.nunitoReady).toBe(true);
    expect(fonts.notoReady).toBe(true);
    expect(fonts.loadedFamilies.length).toBeGreaterThan(0);
    expect(watch.fontResponses.length).toBeGreaterThan(0);
    // 字体必须来自扩展本地资源，不能出现远程字体。
    expect(watch.fontResponses.every((url) => url.startsWith('chrome-extension://'))).toBe(true);

    // 宽度 320 / 340 / 420：无横向溢出。
    const widths = [320, 340, 420] as const;
    const widthChecks: Record<string, unknown>[] = [];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 480 });
      const overflow = await readOverflow(page);
      widthChecks.push({ width, ...overflow });
      expect(overflow.scrollWidth, `width=${width}`).toBeLessThanOrEqual(overflow.clientWidth);
      await capture(page, `learnable-${width}`, `popup-learnable-${width}.png`, overflow);
    }

    // 200% 缩放：CDP 设备指标（CSS 视口 320、deviceScaleFactor 2 → 物理 640）。
    const session = await context.newCDPSession(page);
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: 320,
      height: 480,
      deviceScaleFactor: 2,
      mobile: false,
    });
    const zoomOverflow = await readOverflow(page);
    expect(zoomOverflow.scrollWidth).toBeLessThanOrEqual(zoomOverflow.clientWidth);
    await capture(page, 'learnable-zoom-200', 'popup-learnable-zoom200.png', zoomOverflow);

    records.push({
      name: 'learnable-runtime',
      status: 'captured',
      detail: JSON.stringify({
        fonts,
        widthChecks: widthChecks.map((item) => JSON.stringify(item)),
        consoleErrors: watch.consoleErrors,
        pageErrors: watch.pageErrors,
        failedRequests: watch.failedRequests,
        fontResponseCount: watch.fontResponses.length,
      }),
    });
    expect(watch.pageErrors).toEqual([]);
    expect(watch.consoleErrors).toEqual([]);
    expect(watch.failedRequests.filter((item) => item.includes('woff2'))).toEqual([]);
    await page.close();
  });

  test('暂停状态', async ({ context, extensionId }) => {
    const control = await context.newPage();
    await seedBackground(control, extensionId, { bilibiliEnabled: true, pauseTenMinutes: true });
    await control.close();

    const page = await context.newPage();
    await page.setViewportSize({ width: 340, height: 480 });
    await installPopupStub(page, {
      tabUrl: 'https://www.bilibili.com/video/BV1M2',
      httpsPermission: true,
    });
    await page.goto(pageUrl(extensionId, 'popup.html'));
    await page.getByRole('button', { name: /恢复 \d+:\d\d/ }).waitFor();
    await page.getByRole('switch', { name: '关闭当前网站' }).waitFor();
    await capture(page, 'paused', 'popup-paused-340.png', {
      statusText: '已暂停 · 完整适配',
    });
    await page.close();
  });

  test('权限不足状态', async ({ context, extensionId }) => {
    const control = await context.newPage();
    await seedBackground(control, extensionId, { bilibiliEnabled: true });
    await control.close();

    const page = await context.newPage();
    await page.setViewportSize({ width: 340, height: 360 });
    await installPopupStub(page, {
      tabUrl: 'https://www.bilibili.com/video/BV1M2',
      httpsPermission: false,
    });
    await page.goto(pageUrl(extensionId, 'popup.html'));
    await page.getByText('需权限').waitFor();
    await page.getByText(/缺少主机权限/).waitFor();
    await capture(page, 'needs-permission', 'popup-needs-permission-340.png');
    await page.close();
  });

  test('未加入网站（加入入口）状态', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 340, height: 400 });
    await installPopupStub(page, {
      tabUrl: 'https://example.com/article',
      httpsPermission: false,
    });
    await page.goto(pageUrl(extensionId, 'popup.html'));
    await page.getByRole('button', { name: '加入当前网站' }).waitFor();
    await capture(page, 'join-site', 'popup-join-site-340.png');
    await page.close();
  });

  test('无活动标签页降级与受保护页面状态', async ({ context, extensionId }) => {
    const degraded = await context.newPage();
    await degraded.setViewportSize({ width: 340, height: 260 });
    await degraded.goto(pageUrl(extensionId, 'popup.html'));
    await degraded.getByText('无法获取当前标签页').waitFor();
    await capture(degraded, 'degraded', 'popup-degraded-340.png');
    await degraded.close();

    const protectedPage = await context.newPage();
    await protectedPage.setViewportSize({ width: 340, height: 320 });
    await installPopupStub(protectedPage, { tabUrl: 'chrome://settings/' });
    await protectedPage.goto(pageUrl(extensionId, 'popup.html'));
    await protectedPage.getByText('当前页面不可用').waitFor();
    await capture(protectedPage, 'protected', 'popup-protected-340.png');
    await protectedPage.close();
  });
});
