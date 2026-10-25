import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, pageUrl, test } from './fixtures';
import { OVERLAY_VIEWPORT_FALLBACK_MAX_HEIGHT } from '../src/ui/overlay/layout';

/**
 * M5 视频遮罩全量迁移 e2e（工单 #44）——真实 Chromium + 真实 MV3 产物。
 *
 * 用 page.route 兑现的合成 Bilibili 页面驱动真实内容脚本，学习遮罩可以自然触发，
 * 也可以经扩展内部消息 START_CONTINUOUS_LEARNING 打开（回退路径）。断言：
 * - 宿主机契约：fixed 宿主 display:block 且铺满播放器矩形；
 * - ShadowRoot 内的原版计算样式：Card 羊皮纸底 / 20px 圆角 / 500 字重、Button 50px
 *   胶囊与 0.25s cubic-bezier(0.4, 0, 0.2, 1) 动效、遮罩底层为原版 mask 令牌、
 *   :root 令牌映射为 :host；
 * - 字体（Nunito / Noto Sans SC）从 chrome-extension:// 本地加载并进入 loaded；
 * - 宿主页无 style/节点/滚动副作用，无 CSP 报错；
 * - 16:9、9:16 与标准窗下卡片保持在播放器矩形内；较矮视频回退到视口居中；
 * - 卡片不显示滚动条，内容未溢出时滚轮可继续滚动宿主页；
 * - Escape 退出后遮罩清理干净。真实站点（B 站/YouTube）的 CSP、全屏与真实媒体
 *   恢复由 docs/beta-acceptance-matrix.md 中的人工验收覆盖。
 *
 * 截图证据为可选采集（默认只跑断言，不落盘）：
 *
 *   PowerShell:  $env:CAPTURE_M5='1'; npx playwright test e2e/overlay-island-migration.spec.ts
 *
 * 采集会覆盖 docs/assets/migration-m5/ 下同名 PNG，并把状态写入
 * .output/migration-m5-capture.json。
 */

const captureEnabled = process.env.CAPTURE_M5 === '1';
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(projectRoot, 'docs', 'assets', 'migration-m5');
const resultPath = resolve(projectRoot, '.output', 'migration-m5-capture.json');
const layoutCaptureEnabled = process.env.CAPTURE_LAYOUT === '1';
const layoutOutDir = resolve(projectRoot, '.output', 'layout-evidence');

const SYNTHETIC_URL = 'https://www.bilibili.com/video/BV1M5OVERLAY';

interface SyntheticPageOptions {
  playerWidth: number;
  playerHeight: number;
  pageHeight: number;
}

function syntheticHtml(options: SyntheticPageOptions): string {
  const style = [
    'body { margin: 0; background: #16181d; color: #8b93a1; font-family: system-ui, sans-serif; }',
    '#bilibili-player { width: ' + options.playerWidth + 'px; }',
    '.bpx-player-container { position: relative; width: ' +
      options.playerWidth +
      'px; height: ' +
      options.playerHeight +
      'px; background: #000; }',
    'video { display: block; width: 100%; height: 100%; background: #000; }',
    '.fixture-note { padding: 14px 18px; font-size: 14px; }',
    '.filler { height: ' + options.pageHeight + 'px; }',
  ].join('\n');
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '  <head>',
    '    <meta charset="utf-8" />',
    '    <title>M5 合成页 — 非真实站点</title>',
    '    <style>',
    style,
    '    </style>',
    '  </head>',
    '  <body>',
    '    <div id="bilibili-player">',
    '      <div class="bpx-player-container"><video controls></video></div>',
    '    </div>',
    '    <div class="fixture-note">M5 合成页（非真实站点）：仅用于驱动 BingeUp 内容脚本。</div>',
    '    <div class="filler"></div>',
    '  </body>',
    '</html>',
  ].join('\n');
}

async function fulfillSyntheticPage(page: Page, options: SyntheticPageOptions): Promise<void> {
  const html = syntheticHtml(options);
  await page.route('https://www.bilibili.com/**', async (route) => {
    if (route.request().resourceType() === 'document') {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
      return;
    }
    await route.fulfill({ status: 204, body: '' });
  });
}

async function findSyntheticTabId(extensionPage: Page): Promise<number | null> {
  return extensionPage.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const matched = tabs.find((tab) => tab.url?.includes('bilibili.com'));
    return matched?.id ?? null;
  });
}

interface SendResult {
  ok?: boolean;
  reason?: string;
  error?: string;
}

async function sendToContent(
  extensionPage: Page,
  tabId: number,
  message: Record<string, unknown>,
): Promise<SendResult> {
  return extensionPage.evaluate(
    async (args) => {
      try {
        const response = await chrome.tabs.sendMessage(args.tabId, args.message);
        return (response ?? {}) as SendResult;
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    },
    { tabId, message },
  );
}

/** 预热：让后台先完成首次词库加载，避免内容脚本启动时序抖动。 */
async function warmUp(control: Page, extensionId: string): Promise<void> {
  await control.goto(pageUrl(extensionId, 'options.html'));
  await control.evaluate(async () => {
    await chrome.runtime.sendMessage({ type: 'LEARNING_GET_NEXT' });
  });
}

async function cardVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const card = document
      .getElementById('bingeup-overlay-host')
      ?.shadowRoot?.querySelector('.bingeup-card');
    if (!card) return false;
    const rect = card.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

/** 等自然触发；未触发时用 START_CONTINUOUS_LEARNING 手动打开学习遮罩。 */
async function ensureOverlay(
  page: Page,
  control: Page,
  tabId: number,
): Promise<'natural' | 'manual'> {
  const host = page.locator('#bingeup-overlay-host');
  const natural = await host
    .waitFor({ state: 'attached', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (natural) {
    await expect
      .poll(() => cardVisible(page), { timeout: 15_000, message: '遮罩卡片未渲染' })
      .toBe(true);
    return 'natural';
  }
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
  await expect.poll(() => cardVisible(page), { timeout: 15_000 }).toBe(true);
  return 'manual';
}

interface RectSnapshot {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

interface ShadowState {
  hasHost: boolean;
  hostInline: { display: string; boxSizing: string } | null;
  hostRect: RectSnapshot | null;
  hostTokenPrimary: string | null;
  overlay: {
    position: string;
    display: string;
    backgroundColor: string;
    backdropFilter: string;
  } | null;
  card: {
    className: string;
    backgroundColor: string;
    borderRadius: string;
    fontWeight: string;
    fontFamily: string;
    backdropFilter: string;
    overflowY: string;
    rect: RectSnapshot;
    scrollWidth: number;
    clientWidth: number;
    scrollHeight: number;
    clientHeight: number;
    scrollTop: number;
  } | null;
  button: {
    borderRadius: string;
    fontFamily: string;
    transitionDuration: string;
    transitionTimingFunction: string;
  } | null;
  styleFlags: { hostTokens: boolean; noRoot: boolean; extensionFont: boolean };
  stateFlags: { hasOptions: boolean; hasInput: boolean; hasPreviousFeedback: boolean };
  dialogLabel: string | null;
  lightDomAnimalNodes: number;
  headStyleCount: number;
  bodyChildCount: number;
  pageScrollY: number;
  pageProbe: { boxSizing: string; fontFamily: string; color: string; lineHeight: string } | null;
  docScrollHeight: number;
}

async function readShadowState(page: Page): Promise<ShadowState> {
  return page.evaluate(() => {
    const host = document.getElementById('bingeup-overlay-host');
    const shadow = host?.shadowRoot ?? null;
    const overlay = shadow?.querySelector('.bingeup-overlay') ?? null;
    const card = shadow?.querySelector('.bingeup-card') ?? null;
    // 网页朗读也是原版 Button；视觉断言仍应落在底部主操作按钮上。
    const button =
      shadow?.querySelector('.bingeup-actions button[class*="animal-btn"]') ??
      shadow?.querySelector('button[class*="animal-btn"]') ??
      null;
    const styleText = shadow?.querySelector('style')?.textContent ?? '';
    const styleOf = (element: Element | null) => (element ? getComputedStyle(element) : null);
    const rectOf = (element: Element | null) => {
      const rect = element?.getBoundingClientRect();
      if (!rect) return null;
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom,
      };
    };
    const cardStyle = styleOf(card);
    const buttonStyle = styleOf(button);
    const overlayStyle = styleOf(overlay);
    const probeElement = document.querySelector('.fixture-note');
    const probeStyle = probeElement ? getComputedStyle(probeElement) : null;
    return {
      hasHost: host !== null,
      hostInline: host ? { display: host.style.display, boxSizing: host.style.boxSizing } : null,
      hostRect: rectOf(host),
      hostTokenPrimary: host
        ? getComputedStyle(host).getPropertyValue('--animal-primary-color').trim()
        : null,
      overlay:
        overlay && overlayStyle
          ? {
              position: overlayStyle.position,
              display: overlayStyle.display,
              backgroundColor: overlayStyle.backgroundColor,
              backdropFilter: overlayStyle.backdropFilter,
            }
          : null,
      card:
        card && cardStyle
          ? {
              className: String(card.className),
              backgroundColor: cardStyle.backgroundColor,
              borderRadius: cardStyle.borderRadius,
              fontWeight: cardStyle.fontWeight,
              fontFamily: cardStyle.fontFamily,
              backdropFilter: cardStyle.backdropFilter,
              overflowY: cardStyle.overflowY,
              rect: rectOf(card) as RectSnapshot,
              scrollWidth: card.scrollWidth,
              clientWidth: card.clientWidth,
              scrollHeight: card.scrollHeight,
              clientHeight: card.clientHeight,
              scrollTop: card.scrollTop,
            }
          : null,
      button:
        button && buttonStyle
          ? {
              borderRadius: buttonStyle.borderRadius,
              fontFamily: buttonStyle.fontFamily,
              transitionDuration: buttonStyle.transitionDuration,
              transitionTimingFunction: buttonStyle.transitionTimingFunction,
            }
          : null,
      styleFlags: {
        hostTokens: styleText.includes(':host{--animal-primary-color'),
        noRoot: !styleText.includes(':root{'),
        extensionFont: styleText.includes('chrome-extension://'),
      },
      stateFlags: {
        hasOptions: Boolean(shadow?.querySelector('button.bingeup-option')),
        hasInput: Boolean(shadow?.querySelector('input')),
        hasPreviousFeedback: Boolean(shadow?.querySelector('.bingeup-previous-feedback')),
      },
      dialogLabel: shadow?.querySelector('[role="dialog"]')?.getAttribute('aria-label') ?? null,
      lightDomAnimalNodes: document.querySelectorAll('[class^="animal-"]').length,
      headStyleCount: document.head.querySelectorAll('style,link[rel="stylesheet"]').length,
      bodyChildCount: document.body.childElementCount,
      pageScrollY: window.scrollY,
      pageProbe: probeStyle
        ? {
            boxSizing: probeStyle.boxSizing,
            fontFamily: probeStyle.fontFamily,
            color: probeStyle.color,
            lineHeight: probeStyle.lineHeight,
          }
        : null,
      docScrollHeight: document.documentElement.scrollHeight,
    };
  }) as Promise<ShadowState>;
}

async function playerRect(page: Page): Promise<RectSnapshot | null> {
  return page.evaluate(() => {
    const element = document.querySelector('.bpx-player-container');
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      right: rect.right,
      bottom: rect.bottom,
    };
  });
}

interface CaptureRecord {
  name: string;
  status: 'captured' | 'skipped';
  file?: string;
  detail?: string;
}

const records: CaptureRecord[] = [];

/** 遮罩当前状态的可读标识（用于采集去重）。 */
function stateMarker(state: ShadowState): string {
  return [
    state.stateFlags.hasOptions ? 'question' : state.stateFlags.hasInput ? 'spelling' : 'new-word',
    state.stateFlags.hasPreviousFeedback ? 'feedback' : '',
  ]
    .filter(Boolean)
    .join('+');
}

async function captureViewport(
  page: Page,
  name: string,
  file: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  if (!captureEnabled) {
    records.push({ name, status: 'skipped', detail: 'CAPTURE_M5 未设置' });
    return;
  }
  await page.screenshot({ path: resolve(outDir, file) });
  records.push({
    name,
    status: 'captured',
    file,
    detail: detail === undefined ? undefined : JSON.stringify(detail),
  });
}

interface LayoutExampleState {
  label: string | null;
  role: string | null;
  tabIndex: string | null;
  nestedButtons: number;
  iconColor: string;
  iconFill: string;
  iconStroke: string;
}

interface LayoutFeedbackState {
  closeText: string | null;
  closeVisible: boolean;
  closeHit: boolean;
  detailsButton: boolean;
  phonetic: string;
  wordSpeechLabel: string | null;
  wordSpeechBorderWidth: string;
  wordSpeechBorderStyle: string;
  example: LayoutExampleState | null;
  secondary: string;
  text: string;
}

interface LayoutState {
  kind: 'new-word' | 'question' | 'spelling' | null;
  example: LayoutExampleState | null;
  optionKeys: string[];
  feedback: LayoutFeedbackState | null;
}

async function inspectLayout(page: Page): Promise<LayoutState> {
  return (await page.evaluate(() => {
    const overlayShadow = document.getElementById('bingeup-overlay-host')?.shadowRoot ?? null;
    const feedbackShadow =
      document.getElementById('bingeup-learning-feedback-notice')?.shadowRoot ?? null;
    const overlay = overlayShadow?.querySelector('.bingeup-overlay') ?? null;
    const kind = !overlay
      ? null
      : overlay.querySelector('button.bingeup-option')
        ? 'question'
        : overlay.querySelector('input')
          ? 'spelling'
          : overlay.querySelector('.bingeup-new-word')
            ? 'new-word'
            : null;
    const exampleState = (scope: ParentNode | null): LayoutExampleState | null => {
      const action = scope?.querySelector<HTMLElement>('.bingeup-example-action') ?? null;
      if (!action) return null;
      const icon = action.querySelector<SVGElement>('.bingeup-example-speaker') ?? null;
      const path = icon?.querySelector('path') ?? null;
      return {
        label: action.getAttribute('aria-label'),
        role: action.getAttribute('role'),
        tabIndex: action.getAttribute('tabindex'),
        nestedButtons: action.querySelectorAll('button').length,
        iconColor: icon ? getComputedStyle(icon).color : '',
        iconFill: path ? getComputedStyle(path).fill : '',
        iconStroke: path ? getComputedStyle(path).stroke : '',
      };
    };
    const feedback = feedbackShadow?.querySelector<HTMLElement>('.bingeup-learning-feedback');
    const close =
      feedback?.querySelector<HTMLButtonElement>('button.bingeup-learning-feedback__close') ?? null;
    const closeRect = close?.getBoundingClientRect();
    const closeHit =
      closeRect && feedbackShadow
        ? Boolean(
            (() => {
              const hit = feedbackShadow.elementFromPoint(
                closeRect.left + closeRect.width / 2,
                closeRect.top + closeRect.height / 2,
              );
              return hit === close || close?.contains(hit);
            })(),
          )
        : false;
    const wordSpeech = feedback?.querySelector<HTMLButtonElement>(
      'button[aria-label="朗读单词"], button[aria-label="停止朗读单词"]',
    );
    const wordSpeechTag = feedback?.querySelector<HTMLElement>('.bingeup-pronunciation-tag');
    const wordSpeechStyle = wordSpeechTag ? getComputedStyle(wordSpeechTag) : null;
    return {
      kind,
      example: exampleState(overlayShadow),
      optionKeys: overlay
        ? [...overlay.querySelectorAll('.bingeup-option-key')].map(
            (element) => element.textContent?.trim() ?? '',
          )
        : [],
      feedback: feedback
        ? {
            closeText: close?.getAttribute('aria-label') ?? null,
            closeVisible: close ? close.getBoundingClientRect().width > 0 : false,
            closeHit,
            detailsButton: Boolean(
              [...feedback.querySelectorAll('button')].find((button) =>
                /详情/.test(button.textContent ?? ''),
              ),
            ),
            phonetic:
              feedback.querySelector('.bingeup-new-word-phonetic')?.textContent?.trim() ?? '',
            wordSpeechLabel: wordSpeech?.getAttribute('aria-label') ?? null,
            wordSpeechBorderWidth: wordSpeechStyle?.borderTopWidth ?? '',
            wordSpeechBorderStyle: wordSpeechStyle?.borderTopStyle ?? '',
            example: exampleState(feedback),
            secondary:
              feedback
                .querySelector('.bingeup-secondary')
                ?.textContent?.replace(/\s+/g, ' ')
                .trim() ?? '',
            text: (feedback.textContent ?? '').replace(/\s+/g, ' ').trim(),
          }
        : null,
    } as LayoutState;
  })) as LayoutState;
}

async function clickOverlayButton(page: Page, labels: string[]): Promise<string | null> {
  return page.evaluate((wanted) => {
    const shadow = document.getElementById('bingeup-overlay-host')?.shadowRoot;
    if (!shadow) return null;
    const buttons = [...shadow.querySelectorAll<HTMLButtonElement>('button')].filter(
      (button) => !button.disabled,
    );
    for (const label of wanted) {
      const button = buttons.find((candidate) =>
        (candidate.textContent ?? '').replace(/\s+/g, '').includes(label.replace(/\s+/g, '')),
      );
      if (button) {
        button.click();
        return label;
      }
    }
    return null;
  }, labels);
}

/**
 * 采集用：把遮罩推进到下一状态（选择题先选第一项、拼写题先输入一个字符，
 * 再点击"提交并继续/学到了，继续"）。返回实际点击的按钮文案。
 */
async function advanceOverlayState(page: Page): Promise<string | null> {
  const hasInput = await page.evaluate(() => {
    const input = document
      .getElementById('bingeup-overlay-host')
      ?.shadowRoot?.querySelector('input');
    if (!input || input.disabled) return false;
    input.focus();
    return true;
  });
  if (hasInput) {
    await page.keyboard.type('x');
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => {
    const option = document
      .getElementById('bingeup-overlay-host')
      ?.shadowRoot?.querySelector('button.bingeup-option') as HTMLButtonElement | null;
    if (option && !option.disabled) option.click();
  });
  await page.waitForTimeout(120);
  return page.evaluate(() => {
    const shadow = document.getElementById('bingeup-overlay-host')?.shadowRoot;
    if (!shadow) return null;
    const buttons = Array.from(shadow.querySelectorAll('button'));
    const clickEnabled = (label: string) => {
      const button = buttons.find(
        (candidate) => !candidate.disabled && (candidate.textContent ?? '').includes(label),
      );
      if (!button) return false;
      button.click();
      return true;
    };
    if (clickEnabled('提交并继续')) return '提交并继续';
    if (clickEnabled('学到了，继续')) return '学到了，继续';
    return null;
  });
}

/**
 * 采集用：在连续学习模式中循环前进，尽力覆盖不同遮罩状态（新词/选择题/拼写题/
 * 含上一题反馈的连续帧）。只在 CAPTURE_M5=1 时调用；单题新词没有"继续"动作时
 * 用 Escape 关闭后重新以手动连续学习打开。
 */
async function captureStateLoop(
  page: Page,
  control: Page,
  tabId: number,
  prefix: string,
  initiallySeen: Set<string>,
): Promise<void> {
  const seen = initiallySeen;
  const host = page.locator('#bingeup-overlay-host');
  for (let round = 0; round < 8 && seen.size < 3; round += 1) {
    if ((await host.count()) === 0) {
      const result = await sendToContent(control, tabId, { type: 'START_CONTINUOUS_LEARNING' });
      if (result.ok !== true) {
        records.push({
          name: prefix + '-loop',
          status: 'skipped',
          detail: '无法重新打开遮罩，停止状态采集',
        });
        return;
      }
      try {
        await expect(host).toHaveCount(1, { timeout: 15_000 });
        await expect.poll(() => cardVisible(page), { timeout: 15_000 }).toBe(true);
      } catch {
        records.push({ name: prefix + '-loop', status: 'skipped', detail: '遮罩重开超时' });
        return;
      }
    }
    const snapshot = await page.evaluate(() => {
      const shadow = document.getElementById('bingeup-overlay-host')?.shadowRoot;
      if (!shadow) return null;
      const card = shadow.querySelector('.bingeup-card');
      return {
        hasOptions: Boolean(shadow.querySelector('button.bingeup-option')),
        hasInput: Boolean(shadow.querySelector('input')),
        hasPreviousFeedback: Boolean(shadow.querySelector('.bingeup-previous-feedback')),
        cardText: (card?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
      };
    });
    if (snapshot === null) return;
    const stateName = [
      snapshot.hasOptions ? 'question' : snapshot.hasInput ? 'spelling' : 'new-word',
      snapshot.hasPreviousFeedback ? 'feedback' : '',
    ]
      .filter(Boolean)
      .join('+');
    // 同一状态的重复帧只在首次出现时采集。
    if (!seen.has(stateName)) {
      seen.add(stateName);
      await captureViewport(page, prefix + '-' + stateName, prefix + '-' + stateName + '.png', {
        cardText: snapshot.cardText,
      });
    }
    const advanced = await advanceOverlayState(page);
    if (advanced === null) {
      // 单题新词没有"继续"动作：关闭后重新以手动连续学习打开。
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      if ((await host.count()) === 0) continue;
      return;
    }
    records.push({
      name: prefix + '-advance',
      status: 'captured',
      detail: JSON.stringify({ advanced, from: stateName }),
    });
    await page.waitForTimeout(400);
  }
}

test.describe('M5 视频遮罩原版视觉（合成 Bilibili 页面）', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeAll(() => {
    if (captureEnabled) mkdirSync(outDir, { recursive: true });
  });

  test.afterAll(() => {
    if (!captureEnabled) return;
    writeFileSync(
      resultPath,
      JSON.stringify({ capturedAt: new Date().toISOString(), records }, null, 2) + '\n',
    );
    console.log('[M5] 采集结果写入 ' + resultPath);
    console.log(JSON.stringify(records, null, 2));
  });

  test('16:9：原版计算样式、字体本地加载、宿主页无泄漏', async ({ context, extensionId }) => {
    const control = await context.newPage();
    await warmUp(control, extensionId);

    const page = await context.newPage();
    await page.setViewportSize({ width: 1400, height: 900 });
    const consoleMessages: string[] = [];
    page.on('console', (message) => consoleMessages.push(message.text()));
    page.on('pageerror', (error) => consoleMessages.push('pageerror: ' + error.message));
    const fontResponses: { url: string; status: number }[] = [];
    page.on('response', (response) => {
      if (response.url().includes('.woff2')) {
        fontResponses.push({ url: response.url(), status: response.status() });
      }
    });

    await fulfillSyntheticPage(page, { playerWidth: 1280, playerHeight: 720, pageHeight: 1800 });
    await page.goto(SYNTHETIC_URL, { waitUntil: 'load' });
    const before = await readShadowState(page);

    const tabId = await findSyntheticTabId(control);
    expect(tabId).not.toBeNull();
    const mode = await ensureOverlay(page, control, tabId!);

    const after = await readShadowState(page);

    // 1) 宿主机契约：fixed 宿主 display:block、box-sizing 与播放器矩形一致。
    expect(after.hasHost).toBe(true);
    expect(after.hostInline).toEqual({ display: 'block', boxSizing: 'border-box' });
    const player = await playerRect(page);
    expect(player).not.toBeNull();
    expect(after.hostRect!.width).toBeCloseTo(player!.width, 0);
    expect(after.hostRect!.height).toBeCloseTo(player!.height, 0);
    expect(after.hostRect!.left).toBeCloseTo(player!.left, 0);
    expect(after.hostRect!.top).toBeCloseTo(player!.top, 0);

    // 2) ShadowRoot 内原版样式：:host 令牌映射、无 :root、字体 URL 为扩展本地路径。
    expect(after.styleFlags).toEqual({ hostTokens: true, noRoot: true, extensionFont: true });
    expect(after.hostTokenPrimary).toBe('#19c8b9');

    // 3) 遮罩底层使用原版 mask 令牌；无旧玻璃风格。
    expect(after.overlay).not.toBeNull();
    expect(after.overlay!.position).toBe('absolute');
    expect(after.overlay!.display).toBe('grid');
    expect(after.overlay!.backgroundColor).toBe('rgba(0, 0, 0, 0.35)');
    expect(after.overlay!.backdropFilter).toBe('none');

    // 4) 卡片是库 Card（羊皮纸底、20px 圆角、500 字重）；按钮是库 Button（50px 胶囊、
    //    --animal-motion-duration-base 动效），证明令牌映射生效。
    expect(after.card).not.toBeNull();
    expect(after.card!.className).toContain('animal-card');
    expect(after.card!.backgroundColor).toBe('rgb(247, 243, 223)');
    expect(after.card!.borderRadius).toBe('20px');
    expect(after.card!.fontWeight).toBe('500');
    expect(after.card!.fontFamily).toContain('Nunito');
    expect(after.card!.fontFamily).toContain('Noto Sans SC');
    expect(after.card!.backdropFilter).toBe('none');
    expect(after.card!.overflowY).toBe('auto');
    expect(after.button).not.toBeNull();
    expect(after.button!.borderRadius).toBe('50px');
    expect(after.button!.fontFamily).toContain('Nunito');
    expect(after.button!.transitionDuration).toBe('0.25s');
    expect(after.button!.transitionTimingFunction).toBe('cubic-bezier(0.4, 0, 0.2, 1)');

    // 5) 字体从扩展本地加载并进入 loaded。
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const loaded = Array.from(document.fonts)
              .filter((face) => face.status === 'loaded')
              .map((face) => face.family);
            return {
              nunito: loaded.some((family) => family.includes('Nunito')),
              noto: loaded.some((family) => family.includes('Noto Sans SC')),
            };
          }),
        { timeout: 15_000, message: '字体未进入 loaded 状态' },
      )
      .toEqual({ nunito: true, noto: true });
    await expect
      .poll(() => fontResponses.length, { timeout: 15_000, message: '字体文件未发起加载请求' })
      .toBeGreaterThan(0);
    const extensionFonts = fontResponses.filter((response) =>
      response.url.startsWith('chrome-extension://'),
    );
    expect(extensionFonts.length).toBeGreaterThan(0);
    expect(extensionFonts.every((response) => response.status === 200)).toBe(true);
    expect(
      fontResponses.every(
        (response) =>
          response.url.startsWith('chrome-extension://') || response.url.startsWith('data:'),
      ),
    ).toBe(true);

    // 6) 宿主页无样式/节点/滚动副作用。
    expect(before.headStyleCount).toBe(after.headStyleCount);
    expect(before.bodyChildCount).toBe(after.bodyChildCount);
    expect(after.lightDomAnimalNodes).toBe(0);
    expect(after.pageProbe).toEqual(before.pageProbe);
    expect(after.docScrollHeight).toBe(before.docScrollHeight);

    // 7) 无 CSP 报错与页面异常。
    const cspErrors = consoleMessages.filter(
      (message) => /Content Security Policy/i.test(message) || /Refused to load/i.test(message),
    );
    expect(cspErrors).toEqual([]);
    expect(consoleMessages.filter((message) => message.startsWith('pageerror:'))).toEqual([]);

    // 截图证据（可选）：初始状态 + 尽力采集选择题/拼写题/连续反馈状态。
    await captureViewport(page, 'overlay-16x9', 'overlay-16x9.png', {
      mode,
      dialogLabel: after.dialogLabel,
    });
    if (captureEnabled) {
      await captureStateLoop(page, control, tabId!, 'overlay-16x9', new Set([stateMarker(after)]));
    }

    // 8) Escape 退出：遮罩清理，宿主页恢复原状。
    await page.keyboard.press('Escape');
    await expect(page.locator('#bingeup-overlay-host')).toHaveCount(0, { timeout: 10_000 });
    expect(await page.evaluate(() => document.getElementById('bingeup-overlay-host'))).toBeNull();

    await control.close();
    await page.close();
  });

  test('9:16：竖屏播放器内卡片完整可见且不产生内部溢出', async ({ context, extensionId }) => {
    const control = await context.newPage();
    await warmUp(control, extensionId);

    const page = await context.newPage();
    await page.setViewportSize({ width: 700, height: 1000 });
    await fulfillSyntheticPage(page, { playerWidth: 405, playerHeight: 720, pageHeight: 1200 });
    await page.goto(SYNTHETIC_URL, { waitUntil: 'load' });

    const tabId = await findSyntheticTabId(control);
    expect(tabId).not.toBeNull();
    await ensureOverlay(page, control, tabId!);

    const state = await readShadowState(page);
    const player = await playerRect(page);
    expect(state.card).not.toBeNull();
    expect(player).not.toBeNull();
    // 卡片完整落在播放器矩形内（可见、不裁切）。
    expect(state.card!.rect.left).toBeGreaterThanOrEqual(player!.left - 2);
    expect(state.card!.rect.right).toBeLessThanOrEqual(player!.right + 2);
    expect(state.card!.rect.top).toBeGreaterThanOrEqual(player!.top - 2);
    expect(state.card!.rect.bottom).toBeLessThanOrEqual(player!.bottom + 2);
    // 卡片保留溢出兜底，但正常竖屏内容应完整装入。
    expect(state.card!.overflowY).toBe('auto');
    expect(state.card!.scrollHeight).toBeLessThanOrEqual(state.card!.clientHeight + 1);

    await captureViewport(page, 'overlay-9x16', 'overlay-9x16.png', {
      dialogLabel: state.dialogLabel,
      cardHeight: Math.round(state.card!.rect.height),
      playerHeight: Math.round(player!.height),
    });

    await page.keyboard.press('Escape');
    await expect(page.locator('#bingeup-overlay-host')).toHaveCount(0, { timeout: 10_000 });
    await control.close();
    await page.close();
  });

  test('标准窗：临界高度保持标准样式，滚轮可继续滚动页面', async ({ context, extensionId }) => {
    const control = await context.newPage();
    await warmUp(control, extensionId);

    const page = await context.newPage();
    await page.setViewportSize({ width: 900, height: 700 });
    // 临界值本身仍使用视频区域遮罩和唯一一套标准卡片样式。
    await fulfillSyntheticPage(page, {
      playerWidth: 720,
      playerHeight: OVERLAY_VIEWPORT_FALLBACK_MAX_HEIGHT,
      pageHeight: 2400,
    });
    await page.goto(SYNTHETIC_URL, { waitUntil: 'load' });

    const tabId = await findSyntheticTabId(control);
    expect(tabId).not.toBeNull();
    const host = page.locator('#bingeup-overlay-host');
    await ensureOverlay(page, control, tabId!);

    const state = await readShadowState(page);
    const player = await playerRect(page);
    expect(state.card).not.toBeNull();
    expect(player).not.toBeNull();
    expect(state.card!.rect.left).toBeGreaterThanOrEqual(player!.left - 2);
    expect(state.card!.rect.right).toBeLessThanOrEqual(player!.right + 2);
    expect(state.card!.rect.top).toBeGreaterThanOrEqual(player!.top - 2);
    expect(state.card!.rect.bottom).toBeLessThanOrEqual(player!.bottom + 2);
    expect(state.card!.scrollWidth).toBeLessThanOrEqual(state.card!.clientWidth + 1);
    expect(
      await page.evaluate(() => {
        const card = document
          .getElementById('bingeup-overlay-host')
          ?.shadowRoot?.querySelector('.bingeup-card');
        return card ? getComputedStyle(card).padding : null;
      }),
    ).toBe('16px 24px');
    // 标准布局应完整容纳内容，不出现可见或隐藏的纵向滚动条。
    expect(state.card!.scrollHeight).toBeLessThanOrEqual(state.card!.clientHeight + 1);
    expect(
      await page.evaluate(() => {
        const card = document
          .getElementById('bingeup-overlay-host')
          ?.shadowRoot?.querySelector('.bingeup-card');
        return card ? getComputedStyle(card).scrollbarWidth : null;
      }),
    ).toBe('none');

    await captureViewport(page, 'overlay-short', 'overlay-short.png', {
      dialogLabel: state.dialogLabel,
      clientHeight: state.card!.clientHeight,
    });

    // 卡片没有可滚动内容时，滚轮不能被遮罩拦截，宿主页应继续滚动。
    const centerX = state.card!.rect.left + state.card!.rect.width / 2;
    const centerY = state.card!.rect.top + state.card!.rect.height / 2;
    await page.mouse.move(centerX, centerY);
    await page.mouse.wheel(0, 400);
    await expect
      .poll(() => page.evaluate(() => window.scrollY), { timeout: 5_000 })
      .toBeGreaterThan(0);

    await page.keyboard.press('Escape');
    await expect(host).toHaveCount(0, { timeout: 10_000 });

    await control.close();
    await page.close();
  });

  test('极矮窗：卡片回退到视口居中，不被 200px 播放器裁切', async ({ context, extensionId }) => {
    const control = await context.newPage();
    await warmUp(control, extensionId);

    const page = await context.newPage();
    await page.setViewportSize({ width: 900, height: 700 });
    await fulfillSyntheticPage(page, { playerWidth: 320, playerHeight: 200, pageHeight: 2400 });
    await page.goto(SYNTHETIC_URL, { waitUntil: 'load' });

    const tabId = await findSyntheticTabId(control);
    expect(tabId).not.toBeNull();
    await ensureOverlay(page, control, tabId!);

    const state = await readShadowState(page);
    expect(state.hostRect).not.toBeNull();
    expect(state.hostRect!.left).toBe(0);
    expect(state.hostRect!.top).toBe(0);
    expect(state.hostRect!.width).toBe(900);
    expect(state.hostRect!.height).toBe(700);
    expect(state.card).not.toBeNull();
    expect(state.card!.rect.left).toBeGreaterThanOrEqual(0);
    expect(state.card!.rect.top).toBeGreaterThanOrEqual(0);
    expect(state.card!.rect.right).toBeLessThanOrEqual(900);
    expect(state.card!.rect.bottom).toBeLessThanOrEqual(700);
    expect(state.card!.scrollHeight).toBeLessThanOrEqual(state.card!.clientHeight + 1);

    await page.keyboard.press('Escape');
    await expect(page.locator('#bingeup-overlay-host')).toHaveCount(0, { timeout: 10_000 });
    await control.close();
    await page.close();
  });

  test('UI 修正：例句整块单色朗读、反馈常显详情、选项 1-4', async ({ context, extensionId }) => {
    const control = await context.newPage();
    await warmUp(control, extensionId);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await fulfillSyntheticPage(page, { playerWidth: 960, playerHeight: 720, pageHeight: 1400 });
    await page.goto(SYNTHETIC_URL, { waitUntil: 'load' });
    if (layoutCaptureEnabled) mkdirSync(layoutOutDir, { recursive: true });

    const tabId = await findSyntheticTabId(control);
    expect(tabId).not.toBeNull();
    await ensureOverlay(page, control, tabId!);

    let sawNewWord = false;
    let sawQuestion = false;
    let sawFeedback = false;
    let capturedNewWord = false;
    let capturedFeedback = false;

    for (let round = 0; round < 16 && !(sawNewWord && sawQuestion && sawFeedback); round += 1) {
      if ((await page.locator('#bingeup-overlay-host').count()) === 0) {
        const reopened = await sendToContent(control, tabId!, {
          type: 'START_CONTINUOUS_LEARNING',
        });
        if (reopened.ok !== true) break;
        await expect(page.locator('#bingeup-overlay-host')).toHaveCount(1, { timeout: 15_000 });
        await expect.poll(() => cardVisible(page), { timeout: 15_000 }).toBe(true);
      }

      const state = await inspectLayout(page);
      if (state.kind === 'new-word') {
        sawNewWord = true;
        expect(state.example).not.toBeNull();
        expect(state.example!.role).toBe('button');
        expect(state.example!.tabIndex).toBe('0');
        expect(state.example!.nestedButtons).toBe(0);
        expect(state.example!.iconFill).toBe(state.example!.iconColor);
        expect(state.example!.iconStroke).toBe(state.example!.iconColor);

        if (layoutCaptureEnabled && !capturedNewWord) {
          capturedNewWord = true;
          const clip = await page.evaluate(() => {
            const panel = document
              .getElementById('bingeup-overlay-host')
              ?.shadowRoot?.querySelector('.bingeup-example-panel');
            const rect = panel?.getBoundingClientRect();
            return rect
              ? {
                  x: Math.max(0, rect.left),
                  y: Math.max(0, rect.top),
                  width: Math.min(rect.width, window.innerWidth),
                  height: Math.min(rect.height, window.innerHeight),
                }
              : null;
          });
          await page.screenshot({ path: resolve(layoutOutDir, 'new-word-card.png') });
          if (clip && clip.width > 0 && clip.height > 0) {
            await page.screenshot({ path: resolve(layoutOutDir, 'new-word-example.png'), clip });
          }
        }

        if (
          !(await clickOverlayButton(page, ['学到了，继续', '学到了', '我认识，换一个', '跳过']))
        ) {
          break;
        }
        await page.waitForTimeout(350);
        continue;
      }

      if (state.kind === 'question') {
        sawQuestion = true;
        expect(state.optionKeys).toEqual(['1', '2', '3', '4']);
        await page.evaluate(() => {
          const option = document
            .getElementById('bingeup-overlay-host')
            ?.shadowRoot?.querySelector<HTMLButtonElement>('button.bingeup-option');
          option?.click();
        });
        await page.waitForTimeout(100);
      } else if (state.kind === 'spelling') {
        await page.locator('#bingeup-overlay-host').locator('input').fill('x');
        await page.waitForTimeout(100);
      } else {
        await page.waitForTimeout(250);
        continue;
      }

      if (!(await clickOverlayButton(page, ['提交并继续']))) break;
      await expect
        .poll(async () => (await inspectLayout(page)).feedback !== null, { timeout: 10_000 })
        .toBe(true);
      const feedback = (await inspectLayout(page)).feedback!;
      sawFeedback = true;
      expect(feedback.closeText).toBe('关闭');
      expect(feedback.closeVisible).toBe(true);
      expect(feedback.closeHit).toBe(true);
      expect(feedback.detailsButton).toBe(false);
      expect(feedback.phonetic).toMatch(/\//);
      expect(feedback.wordSpeechLabel).toMatch(/朗读单词/);
      expect(feedback.wordSpeechBorderStyle).not.toBe('dashed');
      expect(Number.parseFloat(feedback.wordSpeechBorderWidth)).toBe(0);
      expect(feedback.example).toBeNull();

      const feedbackRect = await page.evaluate(() => {
        const element = document
          .getElementById('bingeup-learning-feedback-notice')
          ?.shadowRoot?.querySelector('.bingeup-learning-feedback');
        const rect = element?.getBoundingClientRect();
        return rect
          ? {
              x: Math.max(0, rect.left),
              y: Math.max(0, rect.top),
              width: Math.min(rect.width, window.innerWidth),
              height: Math.min(rect.height, window.innerHeight),
            }
          : null;
      });
      if (feedbackRect) {
        await page.mouse.move(feedbackRect.x + feedbackRect.width / 2, feedbackRect.y + 16);
      }
      if (layoutCaptureEnabled && !capturedFeedback && feedbackRect) {
        capturedFeedback = true;
        await page.screenshot({ path: resolve(layoutOutDir, 'feedback-with-overlay.png') });
        if (feedbackRect.width > 0 && feedbackRect.height > 0) {
          await page.screenshot({
            path: resolve(layoutOutDir, 'feedback-notice.png'),
            clip: feedbackRect,
          });
        }
      }

      await page.evaluate(() => {
        const shadow = document.getElementById('bingeup-learning-feedback-notice')?.shadowRoot;
        const close = shadow?.querySelector<HTMLButtonElement>(
          'button.bingeup-learning-feedback__close',
        );
        close?.click();
      });
      await expect
        .poll(async () => (await inspectLayout(page)).feedback === null, { timeout: 5_000 })
        .toBe(true);
      await page.waitForTimeout(250);
    }

    expect(sawNewWord).toBe(true);
    expect(sawQuestion).toBe(true);
    expect(sawFeedback).toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.locator('#bingeup-overlay-host')).toHaveCount(0, { timeout: 10_000 });
    await control.close();
    await page.close();
  });

  test('真实浏览器本地朗读进入 speaking 状态', async ({ context, extensionId }) => {
    test.skip(process.env.E2E_SPEECH !== '1', '真实语音只在带系统语音的浏览器中运行');
    const control = await context.newPage();
    await warmUp(control, extensionId);
    const settings = await control.evaluate(
      async () =>
        (await chrome.runtime.sendMessage({ type: 'GET_APP_SETTINGS' })) as Record<string, unknown>,
    );
    await control.evaluate(async (current) => {
      await chrome.runtime.sendMessage({
        type: 'SET_APP_SETTINGS',
        settings: {
          ...current,
          speechVoiceName: 'Microsoft David - English (United States)',
        },
      });
    }, settings);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await fulfillSyntheticPage(page, { playerWidth: 960, playerHeight: 540, pageHeight: 1400 });
    await page.goto(SYNTHETIC_URL, { waitUntil: 'load' });

    const tabId = await findSyntheticTabId(control);
    expect(tabId).not.toBeNull();
    await ensureOverlay(page, control, tabId!);
    await expect(page.locator('.bingeup-new-word')).toBeVisible();
    await expect
      .poll(
        () => page.locator('.bingeup-pronunciation-wrap').getAttribute('data-preferred-voice'),
        { timeout: 5_000, message: '朗读音色设置未进入内容脚本' },
      )
      .toContain('David');

    const voices = await page.evaluate(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return window.speechSynthesis
        .getVoices()
        .filter((voice) => voice.localService && /^en/i.test(voice.lang))
        .map((voice) => ({ name: voice.name, lang: voice.lang }));
    });
    expect(voices.length).toBeGreaterThan(0);

    await page.locator('button[aria-label="朗读单词"]').click();
    await expect
      .poll(() => page.locator('.bingeup-pronunciation-wrap').getAttribute('data-voice-name'), {
        timeout: 3_000,
        message: '朗读没有使用设置页选择的 David',
      })
      .toContain('David');
    const started = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const timer = window.setInterval(() => {
            if (window.speechSynthesis.speaking) {
              window.clearInterval(timer);
              resolve(true);
            }
          }, 50);
          window.setTimeout(() => {
            window.clearInterval(timer);
            resolve(false);
          }, 3_000);
        }),
    );
    expect(started).toBe(true);

    await page.keyboard.press('Escape');
    await control.close();
    await page.close();
  });
});
