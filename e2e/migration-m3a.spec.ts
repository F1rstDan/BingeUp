import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, pageUrl, test } from './fixtures';

/**
 * M3a 安装引导迁移采集（工单 #40）——证据采集工具，不是质量门禁。
 *
 * 默认跳过；显式采集（会覆盖 docs/assets/migration-m3a/ 下同名截图）：
 *
 *   PowerShell:  $env:CAPTURE_M3A='1'; npx playwright test e2e/migration-m3a.spec.ts
 *
 * 采集直接加载真实 MV3 产物：字体、控制台、横向溢出与键盘焦点均来自真实构建页面；
 * 键盘用例通过真实 Tab / 方向键操作原版 Radio 组，并记录焦点轮廓的实际计算样式。
 */
const captureEnabled = process.env.CAPTURE_M3A === '1';

test.skip(!captureEnabled, 'M3a 采集默认跳过：设置 CAPTURE_M3A=1 运行，见文件头注释');

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(projectRoot, 'docs', 'assets', 'migration-m3a');
const resultPath = resolve(projectRoot, '.output', 'migration-m3a-capture.json');

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

interface ActiveElementState {
  tag: string;
  type: string | null;
  text: string;
  checked: boolean | null;
  outlineStyle: string;
  outlineWidth: string;
  outlineColor: string;
}

/** 读取当前焦点元素及其焦点轮廓计算样式（用于“键盘焦点可见”证据）。 */
async function readActiveElement(page: Page): Promise<ActiveElementState> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (el === null) {
      return {
        tag: '',
        type: null,
        text: '',
        checked: null,
        outlineStyle: 'none',
        outlineWidth: '0px',
        outlineColor: '',
      };
    }
    const style = getComputedStyle(el);
    const input = el as HTMLInputElement;
    return {
      tag: el.tagName,
      type: input.type ?? null,
      text: (el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 40),
      checked: typeof input.checked === 'boolean' ? input.checked : null,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
    };
  });
}

async function capture(page: Page, name: string, file: string, detail?: unknown): Promise<void> {
  await page.screenshot({ path: resolve(outDir, file), fullPage: true });
  records.push({
    name,
    status: 'captured',
    file,
    detail: detail === undefined ? undefined : JSON.stringify(detail),
  });
}

/** 导航到扩展内部页；首启竞态下偶发导航中断（ERR_ABORTED）时重试一次。 */
async function gotoExtensionPage(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  } catch {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  }
}

/**
 * 首启预热：扩展在安装后由后台自动打开引导页（onInstalled），直接导航可能与其抢占。
 * 先访问设置页吸收安装回调，再开始各用例的采集导航。
 */
async function warmUpExtension(context: BrowserContext, extensionId: string): Promise<void> {
  const warmup = await context.newPage();
  await gotoExtensionPage(warmup, pageUrl(extensionId, 'options.html'));
  await warmup.close();
}

test.describe('M3a 安装引导迁移采集', () => {
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
    console.log(`[M3a] 采集结果写入 ${resultPath}`);
    console.log(JSON.stringify(records, null, 2));
  });

  test('首屏：字体、控制台与 760/560/360 宽度', async ({ context, extensionId }) => {
    await warmUpExtension(context, extensionId);
    const page = await context.newPage();
    const watch = watchPage(page);
    await page.setViewportSize({ width: 760, height: 1200 });
    await gotoExtensionPage(page, pageUrl(extensionId, 'onboarding.html'));
    await page.getByRole('heading', { name: /欢迎使用/ }).waitFor();
    await page.getByRole('region', { name: '学习设置' }).waitFor();
    await page.getByRole('region', { name: '默认支持网站' }).waitFor();

    const fonts = await readFontState(page);
    expect(fonts.nunitoReady).toBe(true);
    expect(fonts.notoReady).toBe(true);
    expect(fonts.loadedFamilies.length).toBeGreaterThan(0);
    expect(watch.fontResponses.length).toBeGreaterThan(0);
    // 字体必须来自扩展本地资源，不能出现远程字体。
    expect(watch.fontResponses.every((url) => url.startsWith('chrome-extension://'))).toBe(true);

    const widthChecks: Record<string, unknown>[] = [];
    for (const width of [760, 560, 360] as const) {
      await page.setViewportSize({ width, height: 1200 });
      const overflow = await readOverflow(page);
      widthChecks.push({ width, ...overflow });
      expect(overflow.scrollWidth, `width=${width}`).toBeLessThanOrEqual(overflow.clientWidth);
      await capture(page, `select-${width}`, `onboarding-select-${width}.png`, overflow);
    }

    // 200% 缩放等效：CDP 设备指标（CSS 视口 360、deviceScaleFactor 2 → 物理 720）。
    const session = await context.newCDPSession(page);
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: 360,
      height: 1200,
      deviceScaleFactor: 2,
      mobile: false,
    });
    const zoomOverflow = await readOverflow(page);
    expect(zoomOverflow.scrollWidth).toBeLessThanOrEqual(zoomOverflow.clientWidth);
    await capture(page, 'select-zoom-200', 'onboarding-select-zoom200.png', zoomOverflow);

    records.push({
      name: 'select-runtime',
      status: 'captured',
      detail: JSON.stringify({
        fonts,
        widthChecks: widthChecks.map((item) => JSON.stringify(item)),
        zoomOverflow,
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

  test('键盘操作与焦点可见', async ({ context, extensionId }) => {
    await warmUpExtension(context, extensionId);
    const page = await context.newPage();
    await page.setViewportSize({ width: 760, height: 1200 });
    await gotoExtensionPage(page, pageUrl(extensionId, 'onboarding.html'));
    await page.getByRole('heading', { name: /欢迎使用/ }).waitFor();

    // 首个 Tab 应落在当前选中的水平单选上（原版 Radio 的 roving tabindex）。
    await page.keyboard.press('Tab');
    const first = await readActiveElement(page);
    expect(first.type).toBe('radio');
    expect(first.checked).toBe(true);
    expect(first.outlineStyle).not.toBe('none');
    expect(first.outlineWidth).not.toBe('0px');
    await capture(page, 'focus-level-radio', 'onboarding-focus-level-radio.png', first);

    // 方向键移动选择并保持焦点（原版 Radio 键盘语义）。
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('radio', { name: /进阶/ })).toBeChecked();
    await expect(page.getByRole('radio', { name: /进阶/ })).toBeFocused();
    const moved = await readActiveElement(page);
    expect(moved.outlineStyle).not.toBe('none');

    // 继续 Tab 到主按钮，确认按钮焦点轮廓可见。
    let reachedPrimary = false;
    for (let i = 0; i < 8 && !reachedPrimary; i++) {
      await page.keyboard.press('Tab');
      const active = await readActiveElement(page);
      reachedPrimary = active.tag === 'BUTTON' && active.text.includes('完成引导');
    }
    expect(reachedPrimary).toBe(true);
    // 原版按钮带 transition: all，等待过渡结束后读取稳定的焦点轮廓。
    await page.waitForTimeout(450);
    const focusedButton = await readActiveElement(page);
    expect(focusedButton.outlineStyle).not.toBe('none');
    expect(focusedButton.outlineWidth).not.toBe('0px');
    await capture(
      page,
      'focus-primary-button',
      'onboarding-focus-primary-button.png',
      focusedButton,
    );

    records.push({
      name: 'keyboard',
      status: 'captured',
      detail: JSON.stringify({ first, moved, focusedButton }),
    });
    await page.close();
  });

  test('完成状态', async ({ context, extensionId }) => {
    await warmUpExtension(context, extensionId);
    const page = await context.newPage();
    const watch = watchPage(page);
    await page.setViewportSize({ width: 760, height: 1200 });
    await gotoExtensionPage(page, pageUrl(extensionId, 'onboarding.html'));
    await page.getByRole('heading', { name: /欢迎使用/ }).waitFor();
    await page.getByRole('button', { name: '完成引导' }).click();
    await page.getByRole('heading', { name: '引导完成' }).waitFor();
    await page.getByText('已启用所选网站').waitFor();
    await capture(page, 'done-760', 'onboarding-done-760.png', {
      detail: '默认选择（两站启用、一般、日常高频）提交后的完成页',
    });
    expect(watch.pageErrors).toEqual([]);
    expect(watch.consoleErrors).toEqual([]);
    await page.close();
  });
});
