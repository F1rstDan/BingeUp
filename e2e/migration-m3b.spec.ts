import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, pageUrl, test } from './fixtures';

/**
 * M3b 设置页原版迁移采集（工单 #41）——证据采集工具，不是质量门禁。
 *
 * 默认跳过；显式采集（会覆盖 docs/assets/migration-m3b/ 下同名截图）：
 *
 *   PowerShell:  $env:CAPTURE_M3B='1'; npx playwright test e2e/migration-m3b.spec.ts
 *
 * 采集运行时记录（.output/migration-m3b-capture.json）：字体就绪与本地 woff2 响应、
 * 320/360/420 窄宽度与 200% 缩放（CSS 视口 640px 直接设定，避免与 Playwright
 * 视口模拟混用）的横向溢出检查、原版 Select 下拉面板在窄视口内的可见性、原版 Modal
 * 的滚动锁定与焦点行为、控制台/页面错误与失败请求。
 */
const captureEnabled = process.env.CAPTURE_M3B === '1';

test.skip(!captureEnabled, 'M3b 采集默认跳过：设置 CAPTURE_M3B=1 运行，见文件头注释');

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(projectRoot, 'docs', 'assets', 'migration-m3b');
const resultPath = resolve(projectRoot, '.output', 'migration-m3b-capture.json');

interface CaptureRecord {
  name: string;
  status: 'captured' | 'failed';
  file?: string;
  detail?: string;
}

const records: CaptureRecord[] = [];

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

/** 准备真实后台状态：完成引导、启用 bilibili，并按需写入自定义站点 example.com。 */
async function seedBackground(
  control: Page,
  extensionId: string,
  options: { customSite?: boolean } = {},
): Promise<void> {
  await control.goto(pageUrl(extensionId, 'options.html'));
  await control.evaluate(async (input) => {
    await chrome.runtime.sendMessage({
      type: 'ONBOARDING_COMPLETE',
      hostnames: ['bilibili.com', 'youtube.com'],
      deckId: 'deck-cet4',
      selfRatedLevel: 'intermediate',
    });
    await chrome.runtime.sendMessage({ type: 'SITE_ENABLE', hostname: 'bilibili.com' });
    if (input.customSite) {
      await chrome.runtime.sendMessage({ type: 'ADD_CUSTOM_SITE', hostname: 'example.com' });
    }
  }, options);
}

async function capture(
  page: Page,
  name: string,
  file: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  // 等待库组件的入场动效（tabpanel 淡入 0.25s、Modal 缩放 0.3s、下拉淡入 0.2s）结束。
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(outDir, file), fullPage: true });
  records.push({
    name,
    status: 'captured',
    file,
    detail: detail === undefined ? undefined : JSON.stringify(detail),
  });
}

test.describe('M3b 设置页原版迁移采集', () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
  });

  test.afterAll(() => {
    if (!captureEnabled) return;
    writeFileSync(
      resultPath,
      `${JSON.stringify({ capturedAt: new Date().toISOString(), records }, null, 2)}\n`,
    );
    console.log(`[M3b] 采集结果写入 ${resultPath}`);
    console.log(JSON.stringify(records, null, 2));
  });

  test('学习设置：字体、控制台、窄宽度、下拉面板与 200% 缩放', async ({
    context,
    extensionId,
  }) => {
    const control = await context.newPage();
    await seedBackground(control, extensionId);
    await control.close();

    const page = await context.newPage();
    const watch = watchPage(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(pageUrl(extensionId, 'options.html'));
    await page.getByRole('tab', { name: '学习设置' }).waitFor();
    await page.getByRole('button', { name: '保存设置' }).waitFor();

    // 字体加载与 CSP：等待字体就绪，记录已加载家族与 woff2 资源。
    const fonts = await readFontState(page);
    expect(fonts.nunitoReady).toBe(true);
    expect(fonts.notoReady).toBe(true);
    expect(fonts.loadedFamilies.length).toBeGreaterThan(0);
    expect(watch.fontResponses.length).toBeGreaterThan(0);
    expect(watch.fontResponses.every((url) => url.startsWith('chrome-extension://'))).toBe(true);

    // 桌面全页截图
    const desktopOverflow = await readOverflow(page);
    expect(desktopOverflow.scrollWidth).toBeLessThanOrEqual(desktopOverflow.clientWidth);
    await capture(page, 'learning-1280', 'options-learning-1280.png', desktopOverflow);

    // 窄宽度 320 / 360 / 420：无横向溢出
    const widthChecks: Record<string, unknown>[] = [];
    for (const width of [320, 360, 420] as const) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await readOverflow(page);
      widthChecks.push({ width, ...overflow });
      expect(overflow.scrollWidth, `width=${width}`).toBeLessThanOrEqual(overflow.clientWidth);
      await capture(page, `learning-${width}`, `options-learning-${width}.png`, overflow);
    }

    // 窄视口打开原版 Select：下拉面板须完整落在视口内且不产生横向溢出
    await page.setViewportSize({ width: 320, height: 900 });
    const levelSelect = page.getByRole('combobox', { name: '学习水平' });
    await levelSelect.click();
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();
    const listboxBox = await listbox.boundingBox();
    expect(listboxBox).not.toBeNull();
    const openOverflow = await readOverflow(page);
    expect(openOverflow.scrollWidth).toBeLessThanOrEqual(openOverflow.clientWidth);
    expect(listboxBox!.x).toBeGreaterThanOrEqual(0);
    expect(listboxBox!.x + listboxBox!.width).toBeLessThanOrEqual(321);
    await capture(page, 'select-open-320', 'options-select-open-320.png', {
      ...openOverflow,
      listbox: { x: Math.round(listboxBox!.x), width: Math.round(listboxBox!.width) },
    });
    await page.keyboard.press('Escape');
    await expect(listbox).not.toBeVisible();

    // 200% 缩放等效：CSS 视口 640px（等价于 1280px 窗口 200% 缩放时的布局宽度）。
    // 不与 Playwright 视口模拟混用 CDP 设备指标，避免合成尺寸与布局不一致。
    await page.setViewportSize({ width: 640, height: 800 });
    const zoomOverflow = await readOverflow(page);
    expect(zoomOverflow.scrollWidth).toBeLessThanOrEqual(zoomOverflow.clientWidth);
    await capture(page, 'learning-zoom-200', 'options-learning-zoom200.png', zoomOverflow);

    records.push({
      name: 'learning-runtime',
      status: 'captured',
      detail: JSON.stringify({
        fonts,
        widthChecks,
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

  test('网站管理：站点列表、兼容模式与需要权限状态', async ({ context, extensionId }) => {
    const control = await context.newPage();
    await seedBackground(control, extensionId, { customSite: true });
    await control.close();

    const page = await context.newPage();
    const watch = watchPage(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(pageUrl(extensionId, 'options.html'));
    await page.getByRole('tab', { name: '网站管理' }).click();
    await page.getByText('bilibili.com').waitFor();
    await page.getByText('example.com').waitFor();
    await expect(page.getByText('需要权限')).toBeVisible();

    await capture(page, 'sites-1280', 'options-sites-1280.png', {
      statusText: 'bilibili.com 已启用/完整适配；example.com 需要权限',
    });
    expect(watch.pageErrors).toEqual([]);
    await page.close();
  });

  test('数据管理：原版 Modal 确认、滚动锁定与焦点行为', async ({ context, extensionId }) => {
    const page = await context.newPage();
    const watch = watchPage(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(pageUrl(extensionId, 'options.html'));
    await page.getByRole('tab', { name: '数据管理' }).click();
    await page.getByRole('button', { name: '清除学习进度' }).waitFor();

    await capture(page, 'data-1280', 'options-data-1280.png');

    await page.getByRole('button', { name: '清除学习进度' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: '取消' })).toBeFocused();
    const overflowWhileOpen = await page.evaluate(() => document.body.style.overflow);
    expect(overflowWhileOpen).toBe('hidden');
    await capture(page, 'modal-clear-1280', 'options-modal-clear-1280.png', {
      bodyOverflow: overflowWhileOpen,
    });

    await dialog.getByRole('button', { name: '取消' }).click();
    await expect(dialog).not.toBeVisible();
    const overflowAfterClose = await page.evaluate(() => document.body.style.overflow);
    expect(overflowAfterClose).toBe('');
    records.push({
      name: 'modal-runtime',
      status: 'captured',
      detail: JSON.stringify({
        overflowWhileOpen,
        overflowAfterClose,
        consoleErrors: watch.consoleErrors,
      }),
    });
    expect(watch.pageErrors).toEqual([]);
    await page.close();
  });
});

