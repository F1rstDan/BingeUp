import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, pageUrl, test } from './fixtures';

/**
 * 工单外修正截图采集（2026-10-14：CI 与三处 UI 调整）——证据采集工具，不是质量门禁。
 *
 * 默认跳过；显式采集（写入 docs/assets/migration-ui-fixes/，会覆盖同名 PNG）：
 *
 *   PowerShell:  $env:CAPTURE_FIXES='1'; npx playwright test e2e/migration-ui-fixes.spec.ts
 *
 * 依赖真实构建产物 .output/chrome-mv3（采集前先 npm run build）。覆盖三项修复：
 * - 设置页数字输入框聚焦态：黄色焦点环跟随 50px 胶囊圆角（原方角黄框已修复）；
 * - primary 按钮薄荷品牌强调（设置页保存/添加/导出、遮罩提交/继续、启用提示启用），
 *   并对照 danger（红色，含 Modal 确认按钮）与 default 按钮不受影响；
 * - 运行记录写入 .output/migration-ui-fixes-capture.json。
 */
const captureEnabled = process.env.CAPTURE_FIXES === '1';

test.skip(!captureEnabled, 'UI 修正采集默认跳过：设置 CAPTURE_FIXES=1 运行，见文件头注释');

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(projectRoot, 'docs', 'assets', 'migration-ui-fixes');
const resultPath = resolve(projectRoot, '.output', 'migration-ui-fixes-capture.json');

interface CaptureRecord {
  name: string;
  status: 'captured' | 'skipped';
  file?: string;
  detail?: string;
}

const records: CaptureRecord[] = [];

async function capture(
  page: Page,
  name: string,
  file: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: resolve(outDir, file) });
  records.push({
    name,
    status: 'captured',
    file,
    detail: detail === undefined ? undefined : JSON.stringify(detail),
  });
}

/** 围绕指定矩形留出边距的局部截图（用于聚焦态等小范围证据）。 */
async function captureClip(
  page: Page,
  name: string,
  file: string,
  clip: { x: number; y: number; width: number; height: number },
  detail?: Record<string, unknown>,
): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: resolve(outDir, file), clip });
  records.push({
    name,
    status: 'captured',
    file,
    detail: detail === undefined ? undefined : JSON.stringify(detail),
  });
}

test.describe('UI 修正采集', () => {
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
    console.log(`[UI 修正] 采集结果写入 ${resultPath}`);
    console.log(JSON.stringify(records, null, 2));
  });

  test('设置页数字输入框聚焦：黄色焦点环为 50px 胶囊圆角', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(pageUrl(extensionId, 'options.html'));

    const input = page.getByRole('spinbutton', { name: '每日新词上限' });
    await input.scrollIntoViewIfNeeded();
    await input.focus();
    // 胶囊外壳带 transition:all .25s：等焦点环颜色过渡结束再读取/截图。
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const wrapper = document
              .querySelector('input[aria-label="每日新词上限"]')
              ?.closest('[class^="animal-wrapper"]');
            return wrapper === null ? null : getComputedStyle(wrapper).outlineColor;
          }),
        { timeout: 5_000, message: '焦点环颜色未稳定到令牌值' },
      )
      .toBe('rgb(245, 195, 28)');

    const details = await page.evaluate(() => {
      const inputEl = document.querySelector('input[aria-label="每日新词上限"]');
      const wrapper = inputEl?.closest('[class^="animal-wrapper"]') ?? null;
      const inputStyle = inputEl ? getComputedStyle(inputEl) : null;
      const wrapperStyle = wrapper ? getComputedStyle(wrapper) : null;
      const rect = wrapper?.getBoundingClientRect() ?? null;
      return {
        focusedIsInnerInput: document.activeElement === inputEl,
        inputClassName: inputEl ? String(inputEl.className) : null,
        wrapperClassName: wrapper ? String(wrapper.className) : null,
        // 修复前：全局 input:focus-visible 把内层 input 画成方角黄框。
        inputOutlineStyle: inputStyle?.outlineStyle ?? null,
        // 修复后：焦点环画在胶囊外壳上，跟随 50px 圆角。
        wrapperOutlineStyle: wrapperStyle?.outlineStyle ?? null,
        wrapperOutlineWidth: wrapperStyle?.outlineWidth ?? null,
        wrapperOutlineColor: wrapperStyle?.outlineColor ?? null,
        wrapperOutlineOffset: wrapperStyle?.outlineOffset ?? null,
        wrapperBorderRadius: wrapperStyle?.borderRadius ?? null,
        wrapperRect:
          rect === null ? null : { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    });

    expect(details.focusedIsInnerInput).toBe(true);
    // 库 Input 内层 input：outline:none 生效，不再出现方角黄框。
    expect(details.inputClassName).toContain('animal-input');
    expect(details.inputOutlineStyle).toBe('none');
    // 胶囊外壳（animal-wrapper-*）接管焦点环，颜色/宽度/偏移与原版焦点一致。
    expect(details.wrapperClassName).toContain('animal-wrapper');
    expect(details.wrapperOutlineStyle).toBe('solid');
    expect(details.wrapperOutlineWidth).toBe('2px');
    expect(details.wrapperOutlineColor).toBe('rgb(245, 195, 28)');
    expect(details.wrapperOutlineOffset).toBe('2px');
    expect(details.wrapperBorderRadius).toBe('50px');
    expect(details.wrapperRect).not.toBeNull();

    const rect = details.wrapperRect!;
    await captureClip(
      page,
      'options-input-focus',
      'options-input-focus.png',
      { x: rect.x - 16, y: rect.y - 16, width: rect.width + 32, height: rect.height + 32 },
      details,
    );
    await capture(page, 'options-input-focus-full', 'options-input-focus-full.png', details);
    await page.close();
  });
});
