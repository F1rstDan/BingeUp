import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';
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
 * - primary 按钮薄荷品牌强调（设置页保存/导出、遮罩提交/继续、启用提示启用），
 *   并对照 danger（红色，含 Modal 确认按钮）与 default 按钮不受影响；
 * - 主标题飘带（设置 / 统计 / Popup 品牌区）与 320px 窄视口无横向溢出；
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

interface ButtonStyleSummary {
  text: string;
  className: string;
  backgroundColor: string;
  color: string;
  borderColor: string;
  boxShadow: string;
  borderRadius: string;
}

/** 读取按钮当前的计算样式（hover/active 由调用方先驱动鼠标再读取）。 */
async function readButtonStyle(locator: Locator): Promise<ButtonStyleSummary> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      text: (element.textContent ?? '').replace(/\s+/g, ' ').trim(),
      className: String(element.className),
      backgroundColor: style.backgroundColor,
      color: style.color,
      borderColor: style.borderColor,
      boxShadow: style.boxShadow,
      borderRadius: style.borderRadius,
    };
  });
}

/** 合成 Bilibili 页面（与 M5 同法：真实播放器容器 + 无源 video 元素）。 */
const SYNTHETIC_URL = 'https://www.bilibili.com/video/BV1UIFIXES';
const SYNTHETIC_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>UI 修正合成页 — 非真实站点</title>
    <style>
      body { margin: 0; background: #16181d; color: #8b93a1; font-family: system-ui, sans-serif; }
      #bilibili-player { width: 1280px; }
      .bpx-player-container { position: relative; width: 1280px; height: 720px; background: #000; }
      video { display: block; width: 100%; height: 100%; background: #000; }
      .fixture-note { padding: 14px 18px; font-size: 14px; }
    </style>
  </head>
  <body>
    <div id="bilibili-player">
      <div class="bpx-player-container"><video controls></video></div>
    </div>
    <div class="fixture-note">UI 修正合成页（非真实站点）：仅用于驱动 BingeUp 内容脚本。</div>
  </body>
</html>`;

async function fulfillSyntheticPage(page: Page): Promise<void> {
  await page.route('https://www.bilibili.com/**', async (route) => {
    if (route.request().resourceType() === 'document') {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: SYNTHETIC_HTML,
      });
      return;
    }
    await route.fulfill({ status: 204, body: '' });
  });
}

/** 预热后台词库并写入引导/站点状态。 */
async function seedBackground(
  control: Page,
  extensionId: string,
  options: { bilibiliEnabled: boolean },
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
    // 预热：首次词库加载可能较慢，避免内容脚本启动时序抖动。
    await chrome.runtime.sendMessage({ type: 'LEARNING_GET_NEXT' });
  }, options);
}

async function findSyntheticTabId(extensionPage: Page): Promise<number | null> {
  return extensionPage.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const matched = tabs.find((tab) => tab.url?.includes('bilibili.com'));
    return matched?.id ?? null;
  });
}

async function sendToContent(
  extensionPage: Page,
  tabId: number,
  message: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return extensionPage.evaluate(
    async (args) => {
      try {
        const response = await chrome.tabs.sendMessage(args.tabId, args.message);
        return (response ?? {}) as Record<string, unknown>;
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    },
    { tabId, message },
  );
}

/** 等自然触发；未触发时用 START_CONTINUOUS_LEARNING 手动打开学习遮罩。 */
async function ensureOverlay(
  page: Page,
  control: Page,
  tabId: number,
): Promise<'natural' | 'manual'> {
  const host = page.locator('#bingeup-overlay-host');
  // 自然触发若已打开遮罩，手动发送会得到 interaction-active，因此先等自然路径。
  const natural = await host
    .waitFor({ state: 'attached', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (natural) return 'natural';
  await expect
    .poll(
      async () => {
        if ((await host.count()) > 0) return true;
        const result = await sendToContent(control, tabId, {
          type: 'START_CONTINUOUS_LEARNING',
        });
        return result.ok === true;
      },
      { timeout: 30_000, message: '内容脚本未打开学习遮罩' },
    )
    .toBe(true);
  await expect(host).toHaveCount(1, { timeout: 15_000 });
  return 'manual';
}

/** 用 START_CONTINUOUS_LEARNING 打开连续学习遮罩（单题遮罩关闭后的重建路径）。 */
async function openContinuous(page: Page, control: Page, tabId: number): Promise<void> {
  const host = page.locator('#bingeup-overlay-host');
  await expect
    .poll(
      async () => {
        if ((await host.count()) > 0) return true;
        const result = await sendToContent(control, tabId, {
          type: 'START_CONTINUOUS_LEARNING',
        });
        return result.ok === true;
      },
      { timeout: 30_000, message: '内容脚本未打开连续学习遮罩' },
    )
    .toBe(true);
  await expect(host).toHaveCount(1, { timeout: 15_000 });
}

/** 采集用：把遮罩推进到选择题状态（“提交/继续”按钮在场），跨单题与连续两种模式。 */
async function advanceToQuestion(page: Page, control: Page, tabId: number): Promise<boolean> {
  let lastState: { hasOptions: boolean; hasInput: boolean } | null = null;
  for (let round = 0; round < 12; round += 1) {
    const state = await page.evaluate(() => {
      const shadow = document.getElementById('bingeup-overlay-host')?.shadowRoot;
      if (!shadow) return null;
      return {
        hasOptions: Boolean(shadow.querySelector('button.bingeup-option')),
        hasInput: Boolean(shadow.querySelector('input')),
      };
    });
    if (state === null) {
      // 单题模式的终态动作会关闭遮罩：改用连续学习重新打开后继续推进。
      await openContinuous(page, control, tabId);
      continue;
    }
    lastState = state;
    if (state.hasOptions) return true;
    if (state.hasInput) {
      // 拼写题：先输入一个字符，让“提交并继续”可用。
      await page.locator('#bingeup-overlay-host').locator('input').fill('x');
      await page.waitForTimeout(100);
    }
    const clicked = await page.evaluate(() => {
      const shadow = document.getElementById('bingeup-overlay-host')?.shadowRoot;
      if (!shadow) return false;
      const normalize = (text: string | null): string => (text ?? '').replace(/\s+/g, '');
      const buttons = [...shadow.querySelectorAll('button')].filter(
        (candidate) => !candidate.disabled,
      );
      const next =
        buttons.find((candidate) => normalize(candidate.textContent).startsWith('学到了，继续')) ??
        buttons.find((candidate) => normalize(candidate.textContent).startsWith('提交并继续')) ??
        buttons.find((candidate) => normalize(candidate.textContent).startsWith('继续')) ??
        buttons.find((candidate) => normalize(candidate.textContent).startsWith('学到了')) ??
        null;
      if (next === null) return false;
      (next as HTMLButtonElement).click();
      return true;
    });
    if (!clicked) return false;
    await page.waitForTimeout(400);
  }
  console.log(
    `[UI 修正] advanceToQuestion 未到达选择题状态，最后状态：${JSON.stringify(lastState)}`,
  );
  return false;
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
            const wrapper =
              document
                .querySelector('input[aria-label="每日新词上限"]')
                ?.closest('[class^="animal-wrapper"]') ?? null;
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

  test('设置页 primary 按钮薄荷强调；danger 与 default 不受影响', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(pageUrl(extensionId, 'options.html'));
    await page.getByRole('button', { name: '保存设置' }).waitFor();

    const saveButton = (): Locator => page.getByRole('button', { name: '保存设置' });

    // 默认态：薄荷底 + 白字 + 5px 堆叠阴影（库 danger primary 的结构，换主色令牌）。
    const save = await readButtonStyle(saveButton());
    expect(save.className).toContain('animal-btn-primary');
    expect(save.backgroundColor).toBe('rgb(25, 200, 185)');
    expect(save.color).toBe('rgb(255, 255, 255)');
    expect(save.borderColor).toBe('rgb(25, 200, 185)');
    expect(save.boxShadow).toContain('rgb(80, 185, 171)');
    expect(save.boxShadow).toContain('0px 5px');
    // default 按钮保持库的奶油底，不受品牌覆盖影响。
    const reset = await readButtonStyle(page.getByRole('button', { name: '恢复默认' }));
    expect(reset.backgroundColor).toBe('rgb(248, 248, 240)');

    await capture(page, 'options-primary', 'options-primary-buttons.png', { save, reset });

    // hover：更亮的薄荷 + 抬升到 6px。
    await saveButton().hover();
    await expect
      .poll(async () => (await readButtonStyle(saveButton())).backgroundColor, {
        timeout: 5_000,
        message: 'hover 背景未过渡到 primary-color-hover',
      })
      .toBe('rgb(61, 212, 198)');
    const hovered = await readButtonStyle(saveButton());
    expect(hovered.boxShadow).toContain('0px 6px');

    // active（按住）：主色 active + 压到 1px。
    await page.mouse.down();
    await expect
      .poll(async () => (await readButtonStyle(saveButton())).backgroundColor, {
        timeout: 5_000,
        message: 'active 背景未过渡到 primary-color-active',
      })
      .toBe('rgb(80, 185, 171)');
    const pressed = await readButtonStyle(saveButton());
    expect(pressed.boxShadow).toContain('0px 1px');
    await page.mouse.up();
    await page.mouse.move(4, 4);

    // 数据管理：danger（default 型红字）与 primary（导出）并存，互不影响。
    await page.getByRole('tab', { name: '数据管理' }).click();
    const clear = page.getByRole('button', { name: '清除学习进度' });
    await clear.waitFor();
    const clearStyle = await readButtonStyle(clear);
    expect(clearStyle.className).toContain('animal-btn-danger');
    expect(clearStyle.color).toBe('rgb(224, 90, 90)');
    expect(clearStyle.backgroundColor).toBe('rgb(248, 248, 240)');
    const exportStyle = await readButtonStyle(page.getByRole('button', { name: '导出数据' }));
    expect(exportStyle.backgroundColor).toBe('rgb(25, 200, 185)');

    await capture(page, 'options-danger', 'options-danger-buttons.png', {
      clear: clearStyle,
      exportPrimary: exportStyle,
    });

    // Modal 的 danger primary 确认按钮保持库的红色填充。
    await clear.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole('button', { name: '清除学习进度' });
    const confirmStyle = await readButtonStyle(confirm);
    expect(confirmStyle.backgroundColor).toBe('rgb(224, 90, 90)');
    expect(confirmStyle.color).toBe('rgb(255, 255, 255)');
    expect(confirmStyle.boxShadow).toContain('rgb(201, 68, 68)');
    // 等 Modal 入场动效（缩放 0.3s）结束再截图。
    await page.waitForTimeout(600);
    await capture(page, 'options-modal-danger', 'options-modal-danger.png', {
      confirm: confirmStyle,
    });
    await dialog.getByRole('button', { name: '取消' }).click();
    await expect(dialog).not.toBeVisible();

    await page.close();
  });

  test('遮罩（合成 B 站页）primary 按钮薄荷强调', async ({ context, extensionId }) => {
    const control = await context.newPage();
    await seedBackground(control, extensionId, { bilibiliEnabled: true });

    const page = await context.newPage();
    await page.setViewportSize({ width: 1400, height: 900 });
    await fulfillSyntheticPage(page);
    await page.goto(SYNTHETIC_URL, { waitUntil: 'load' });

    const tabId = await findSyntheticTabId(control);
    expect(tabId).not.toBeNull();
    const overlayMode = await ensureOverlay(page, control, tabId!);

    const host = page.locator('#bingeup-overlay-host');
    await expect(host).toHaveCount(1, { timeout: 15_000 });
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const card = document
              .getElementById('bingeup-overlay-host')
              ?.shadowRoot?.querySelector('.bingeup-card');
            return card !== null && card !== undefined && card.getBoundingClientRect().width > 0;
          }),
        { timeout: 15_000, message: '遮罩卡片未渲染' },
      )
      .toBe(true);

    // 推进到选择题状态：确保「提交/继续」按钮在场（新词与拼写状态先前进）。
    expect(await advanceToQuestion(page, control, tabId!)).toBe(true);
    // 选中第一个选项，让「提交并继续 / 提交」进入可用状态
    //（禁用主按钮保持库的奶油底，不属于品牌强调范围）。
    await page.evaluate(() => {
      const option = document
        .getElementById('bingeup-overlay-host')
        ?.shadowRoot?.querySelector('button.bingeup-option');
      (option as HTMLButtonElement | null)?.click();
    });
    await page.waitForTimeout(200);
    // 按钮带 transition:all .25s：等颜色过渡稳定后再读取/截图。
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const shadow = document.getElementById('bingeup-overlay-host')?.shadowRoot;
            if (!shadow) return false;
            const colors = [...shadow.querySelectorAll('button')]
              .filter((button) => String(button.className).includes('animal-btn-primary'))
              .map((button) => getComputedStyle(button).backgroundColor);
            return colors.length > 0 && colors.every((color) => color === 'rgb(25, 200, 185)');
          }),
        { timeout: 5_000, message: '主按钮颜色未稳定到薄荷主色' },
      )
      .toBe(true);

    const styles = await page.evaluate(() => {
      const shadow = document.getElementById('bingeup-overlay-host')?.shadowRoot ?? null;
      const read = (button: HTMLButtonElement) => {
        const style = getComputedStyle(button);
        return {
          text: (button.textContent ?? '').replace(/\s+/g, ' ').trim(),
          className: String(button.className),
          backgroundColor: style.backgroundColor,
          color: style.color,
          boxShadow: style.boxShadow,
        };
      };
      return [...(shadow?.querySelectorAll('button') ?? [])].map(read);
    });

    const primary = styles.filter((button) => button.className.includes('animal-btn-primary'));
    const defaults = styles.filter(
      (button) =>
        button.className.includes('animal-btn') && !button.className.includes('animal-btn-primary'),
    );
    expect(primary.length).toBeGreaterThan(0);
    for (const button of primary) {
      expect(button.backgroundColor, button.text).toBe('rgb(25, 200, 185)');
      expect(button.color, button.text).toBe('rgb(255, 255, 255)');
      expect(button.boxShadow, button.text).toContain('rgb(80, 185, 171)');
    }
    // 「跳过」等 default 按钮保持奶油底。
    expect(defaults.length).toBeGreaterThan(0);
    for (const button of defaults) {
      expect(button.backgroundColor, button.text).toBe('rgb(248, 248, 240)');
    }

    await capture(page, 'overlay-primary', 'overlay-primary-buttons.png', {
      mode: overlayMode,
      primary: primary.map((button) => button.text),
      defaults: defaults.map((button) => button.text),
    });

    await page.keyboard.press('Escape');
    await control.close();
    await page.close();
  });

  test('启用提示（合成 B 站页）启用按钮薄荷强调', async ({ context, extensionId }) => {
    const control = await context.newPage();
    await seedBackground(control, extensionId, { bilibiliEnabled: false });
    await control.close();

    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await fulfillSyntheticPage(page);
    await page.goto(SYNTHETIC_URL, { waitUntil: 'load' });
    await expect(page.locator('#bingeup-enable-prompt-host')).toHaveCount(1, { timeout: 30_000 });
    await page.getByRole('button', { name: '启用' }).waitFor();

    const enable = await readButtonStyle(page.getByRole('button', { name: '启用' }));
    const dismiss = await readButtonStyle(page.getByRole('button', { name: '暂不' }));
    expect(enable.backgroundColor).toBe('rgb(25, 200, 185)');
    expect(enable.color).toBe('rgb(255, 255, 255)');
    expect(enable.borderColor).toBe('rgb(25, 200, 185)');
    expect(enable.boxShadow).toContain('rgb(80, 185, 171)');
    // 「暂不」为库默认按钮，不受品牌强调影响。
    expect(dismiss.backgroundColor).toBe('rgb(248, 248, 240)');

    const rect = await page.locator('#bingeup-enable-prompt-host').boundingBox();
    expect(rect).not.toBeNull();
    const clip = {
      x: Math.max(0, rect!.x - 24),
      y: Math.max(0, rect!.y - 24),
      width: Math.min(1280, rect!.x + rect!.width + 24) - Math.max(0, rect!.x - 24),
      height: Math.min(800, rect!.y + rect!.height + 24) - Math.max(0, rect!.y - 24),
    };
    await captureClip(page, 'enable-prompt-primary', 'enable-prompt-primary.png', clip, {
      enable,
      dismiss,
    });

    await page.close();
  });

  test('Popup 文本按钮（设置）保持库 text 变体样式', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(pageUrl(extensionId, 'popup.html'));
    const settings = page.getByRole('button', { name: '设置' });
    await settings.waitFor();

    const style = await readButtonStyle(settings);
    expect(style.className).toContain('animal-btn-text');
    expect(style.className).not.toContain('animal-btn-primary');
    expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(style.boxShadow).toBe('none');

    await page.close();
  });

  test('主标题飘带（设置 / 统计 / Popup）：库 Title 与 320px 无溢出', async ({
    context,
    extensionId,
  }) => {
    interface TitleAreaInfo {
      hasRibbon: boolean;
      fontSize: string | null;
      text: string;
      rect: { x: number; y: number; width: number; height: number } | null;
    }
    async function readTitleArea(page: Page, selector: string): Promise<TitleAreaInfo> {
      return page.evaluate((sel) => {
        const root = document.querySelector(sel);
        const ribbon = root?.querySelector('[class^="animal-ribbon-"]') ?? null;
        const rect = ribbon?.getBoundingClientRect() ?? null;
        const style = ribbon ? getComputedStyle(ribbon) : null;
        return {
          hasRibbon: ribbon !== null,
          fontSize: style?.fontSize ?? null,
          text: (root?.textContent ?? '').replace(/\s+/g, ' ').trim(),
          rect:
            rect === null ? null : { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        };
      }, selector);
    }
    const clipAround = (
      rect: { x: number; y: number; width: number; height: number },
      viewport: { width: number; height: number },
    ) => ({
      x: Math.max(0, rect.x - 24),
      y: Math.max(0, rect.y - 24),
      width: Math.min(viewport.width, rect.x + rect.width + 24) - Math.max(0, rect.x - 24),
      height: Math.min(viewport.height, rect.y + rect.height + 24) - Math.max(0, rect.y - 24),
    });

    // 设置页：h1 包裹 Title size=large，桌面字号保持 28px。
    const options = await context.newPage();
    await options.setViewportSize({ width: 1280, height: 900 });
    await options.goto(pageUrl(extensionId, 'options.html'));
    await options.getByRole('heading', { level: 1, name: '刷刷升级 — 设置' }).waitFor();
    const optionsTitle = await readTitleArea(options, '.bingeup-title');
    expect(optionsTitle.hasRibbon).toBe(true);
    expect(optionsTitle.text).toBe('刷刷升级 — 设置');
    expect(optionsTitle.fontSize).toBe('28px');
    await captureClip(
      options,
      'title-options',
      'title-options.png',
      clipAround(optionsTitle.rect!, { width: 1280, height: 900 }),
      { text: optionsTitle.text, fontSize: optionsTitle.fontSize },
    );
    // 窄视口（320px）：飘带字号降为 24px，无横向溢出。
    await options.setViewportSize({ width: 320, height: 800 });
    await expect
      .poll(async () => (await readTitleArea(options, '.bingeup-title')).fontSize, {
        timeout: 3_000,
        message: '窄视口飘带字号未切换到 24px',
      })
      .toBe('24px');
    const optionsNarrow = await options.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(optionsNarrow.scrollWidth, 'options @320').toBeLessThanOrEqual(
      optionsNarrow.clientWidth,
    );
    const optionsNarrowTitle = await readTitleArea(options, '.bingeup-title');
    await captureClip(
      options,
      'title-options-320',
      'title-options-320.png',
      clipAround(optionsNarrowTitle.rect!, { width: 320, height: 800 }),
      { fontSize: optionsNarrowTitle.fontSize, ...optionsNarrow },
    );
    await options.close();

    // 统计页：h1 包裹 Title size=large。
    const stats = await context.newPage();
    await stats.setViewportSize({ width: 1280, height: 900 });
    await stats.goto(pageUrl(extensionId, 'stats.html'));
    await stats.getByRole('heading', { level: 1, name: '学习统计' }).waitFor();
    const statsTitle = await readTitleArea(stats, '.bingeup-stats h1');
    expect(statsTitle.hasRibbon).toBe(true);
    expect(statsTitle.text).toBe('学习统计');
    expect(statsTitle.fontSize).toBe('28px');
    await captureClip(
      stats,
      'title-stats',
      'title-stats.png',
      clipAround(statsTitle.rect!, { width: 1280, height: 900 }),
      { text: statsTitle.text, fontSize: statsTitle.fontSize },
    );
    await stats.close();

    // Popup 品牌区：Title size=small（14px 飘带），340 与 320 均无横向溢出。
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 340, height: 640 });
    await popup.goto(pageUrl(extensionId, 'popup.html'));
    await popup.locator('.bingeup-brand').waitFor();
    const brandTitle = await readTitleArea(popup, '.bingeup-brand');
    expect(brandTitle.hasRibbon).toBe(true);
    expect(brandTitle.text).toContain('刷刷升级');
    expect(brandTitle.fontSize).toBe('14px');
    await captureClip(
      popup,
      'title-popup-brand',
      'title-popup-brand.png',
      clipAround(brandTitle.rect!, { width: 340, height: 640 }),
      { text: brandTitle.text, fontSize: brandTitle.fontSize },
    );
    await popup.setViewportSize({ width: 320, height: 640 });
    await popup.waitForTimeout(200);
    const popupNarrow = await popup.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(popupNarrow.scrollWidth, 'popup @320').toBeLessThanOrEqual(popupNarrow.clientWidth);
    await popup.close();
  });
});
