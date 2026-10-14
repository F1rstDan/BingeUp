import type { Page } from '@playwright/test';
import { expect, pageUrl, test } from './fixtures';

/**
 * M4 Shadow DOM 样式与字体 PoC（工单 #43）——真实 Chromium + 真实 MV3 产物。
 *
 * 用 page.route 兑现的合成 Bilibili 页面驱动真实内容脚本，通过临时的扩展内部消息
 * ISLAND_POC_PREVIEW / ISLAND_POC_CLOSE 打开实验预览宿主，断言：
 * 遮罩内原版 Button/Card 的计算样式、字体从扩展本地加载、宿主页无样式/节点泄漏、
 * 无 CSP 报错、宿主的 fixed/铺满矩形与播放器区域一致。
 *
 * 真实站点（B 站/YouTube）的 CSP 与页面规模差异不在本 spec 范围内，见证据文档。
 */

const SYNTHETIC_URL = 'https://www.bilibili.com/video/BV1M4POC';
const SYNTHETIC_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>M4 PoC 合成页 — 非真实站点</title>
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
    <div class="fixture-note">M4 PoC 合成页（非真实站点）：仅用于驱动 BingeUp 内容脚本。</div>
  </body>
</html>`;

async function fulfillSyntheticPage(page: Page): Promise<void> {
  await page.route('https://www.bilibili.com/**', async (route) => {
    if (route.request().resourceType() === 'document') {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: SYNTHETIC_HTML });
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

test.describe('M4 Shadow DOM PoC（合成 Bilibili 页面）', () => {
  test.describe.configure({ timeout: 120_000 });

  test('遮罩内原版 Button/Card 计算样式、字体本地加载、宿主页无泄漏与无 CSP 报错', async ({
    context,
    extensionId,
  }) => {
    // 预热：让后台先完成首次词库加载，避免内容脚本启动时序抖动。
    const control = await context.newPage();
    await control.goto(pageUrl(extensionId, 'options.html'));
    await control.evaluate(async () => {
      await chrome.runtime.sendMessage({ type: 'LEARNING_GET_NEXT' });
    });

    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });

    const consoleMessages: string[] = [];
    page.on('console', (message) => consoleMessages.push(message.text()));
    page.on('pageerror', (error) => consoleMessages.push('pageerror: ' + error.message));
    const fontResponses: { url: string; status: number }[] = [];
    page.on('response', (response) => {
      if (response.url().includes('.woff2')) {
        fontResponses.push({ url: response.url(), status: response.status() });
      }
    });

    await fulfillSyntheticPage(page);
    await page.goto(SYNTHETIC_URL, { waitUntil: 'load' });

    // 传入访客页面前后基线：宿主页 head/body 不应被塞入库样式或节点。
    const before = await page.evaluate(() => {
      const probeElement = document.querySelector('.fixture-note');
      const probeStyle = probeElement ? getComputedStyle(probeElement) : null;
      return {
        headStyleCount: document.head.querySelectorAll('style,link[rel="stylesheet"]').length,
        bodyChildCount: document.body.childElementCount,
        pageProbe: probeStyle
          ? {
              boxSizing: probeStyle.boxSizing,
              fontFamily: probeStyle.fontFamily,
              color: probeStyle.color,
              lineHeight: probeStyle.lineHeight,
            }
          : null,
        scrollHeight: document.documentElement.scrollHeight,
      };
    });

    const tabId = await findSyntheticTabId(control);
    expect(tabId).not.toBeNull();

    // 内容控制器同一时刻只允许一个遮罩交互：等自然触发的真实学习遮罩稳定（或手动触发
    // 连续学习）后再开实验预览，避免自然触发在断言中途顶掉预览宿主。
    const learningHost = page.locator('#bingeup-overlay-host');
    const naturalAppeared = await learningHost
      .waitFor({ state: 'attached', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!naturalAppeared) {
      await sendToContent(control, tabId!, { type: 'START_CONTINUOUS_LEARNING' });
      await expect(learningHost).toHaveCount(1, { timeout: 15_000 });
    }

    // 内容脚本启动后监听器才存在：轮询发送预览消息直到成功。
    await expect
      .poll(
        async () => {
          const result = await sendToContent(control, tabId!, { type: 'ISLAND_POC_PREVIEW' });
          return result.ok === true;
        },
        { timeout: 30_000, message: '内容脚本未响应 ISLAND_POC_PREVIEW' },
      )
      .toBe(true);

    const host = page.locator('#bingeup-island-preview-host');
    await expect(host).toHaveCount(1);
    // 预览与学习遮罩共用控制器槽位：预览打开后学习遮罩让位（PoC 语义，M5 移除）。
    await expect(page.locator('#bingeup-overlay-host')).toHaveCount(0);

    // 等字体就绪并读取真实计算样式（跨 Shadow Root 用页面内求值更精确）。
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const fonts = Array.from(document.fonts);
            return fonts.some((face) => face.family.includes('Nunito'));
          }),
        { timeout: 15_000, message: 'Nunito @font-face 未注册进文档 FontFaceSet' },
      )
      .toBe(true);

    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await expect
      .poll(() => fontResponses.length, { timeout: 15_000, message: '字体文件未发起加载请求' })
      .toBeGreaterThan(0);

    const after = await page.evaluate(() => {
      const hostElement = document.getElementById('bingeup-island-preview-host');
      const shadow = hostElement?.shadowRoot ?? null;
      const primaryButton = shadow?.querySelector('button');
      const smallButton = shadow?.querySelectorAll('button')[1] ?? null;
      const card = shadow?.querySelector('[class*="animal-card"]');
      const hostRect = hostElement?.getBoundingClientRect();
      const playerRect = document.querySelector('.bpx-player-container')?.getBoundingClientRect();
      const style = (element: Element | null | undefined) =>
        element ? getComputedStyle(element) : null;
      const summary = (computed: CSSStyleDeclaration | null) =>
        computed
          ? {
              borderRadius: computed.borderRadius,
              backgroundColor: computed.backgroundColor,
              color: computed.color,
              boxShadow: computed.boxShadow,
              fontFamily: computed.fontFamily,
              fontWeight: computed.fontWeight,
              height: computed.height,
              fontSize: computed.fontSize,
            }
          : null;
      return {
        primaryButton: summary(style(primaryButton)),
        smallButton: summary(style(smallButton)),
        card: summary(style(card)),
        cardText: card?.textContent ?? null,
        hostStyle: hostElement
          ? { display: hostElement.style.display, boxSizing: hostElement.style.boxSizing }
          : null,
        hostRect: hostRect
          ? { left: hostRect.left, top: hostRect.top, width: hostRect.width, height: hostRect.height }
          : null,
        playerRect: playerRect
          ? { left: playerRect.left, top: playerRect.top, width: playerRect.width, height: playerRect.height }
          : null,
        pageProbe: (() => {
          const probeElement = document.querySelector('.fixture-note');
          const probeStyle = probeElement ? getComputedStyle(probeElement) : null;
          return probeStyle
            ? {
                boxSizing: probeStyle.boxSizing,
                fontFamily: probeStyle.fontFamily,
                color: probeStyle.color,
                lineHeight: probeStyle.lineHeight,
              }
            : null;
        })(),
        scrollHeight: document.documentElement.scrollHeight,
        headStyleCount: document.head.querySelectorAll('style,link[rel="stylesheet"]').length,
        bodyChildCount: document.body.childElementCount,
        lightDomAnimalNodes: document.querySelectorAll('[class^="animal-"]').length,
        fontFaces: Array.from(document.fonts).map((face) => ({
          family: face.family,
          status: face.status,
        })),
      };
    });

    // 1) 原版 Button/Card 的真实计算样式。
    expect(after.primaryButton).not.toBeNull();
    expect(after.primaryButton?.borderRadius).toBe('50px');
    expect(after.primaryButton?.backgroundColor).toBe('rgb(248, 248, 240)');
    expect(after.primaryButton?.color).toBe('rgb(121, 79, 39)');
    expect(after.primaryButton?.boxShadow).toContain('rgb(189, 174, 160)');
    expect(after.primaryButton?.boxShadow).toContain('5px');
    expect(after.primaryButton?.fontFamily).toContain('Nunito');
    expect(after.primaryButton?.fontFamily).toContain('Noto Sans SC');

    // 小按钮高度走 --animal-height-sm 令牌，证明 :root → :host 令牌映射生效。
    expect(after.smallButton?.height).toBe('32px');
    expect(after.smallButton?.fontSize).toBe('12px');

    expect(after.card?.backgroundColor).toBe('rgb(247, 243, 223)');
    expect(after.card?.borderRadius).toBe('20px');
    expect(after.card?.fontWeight).toBe('500');
    expect(after.cardText).toContain('Animal Island Shadow PoC');

    // 2) 字体从扩展本地加载：chrome-extension:// 且无 CSP 报错。
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
    // FontFace API 注册的族名会保留原始引号（如 "Noto Sans SC"），用包含匹配；
    // 中文子集字体在文字首次渲染后才触发加载，用轮询等待进入 loaded。
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

    const cspErrors = consoleMessages.filter(
      (message) => /Content Security Policy/i.test(message) || /Refused to load/i.test(message),
    );
    expect(cspErrors).toEqual([]);
    const pageErrors = consoleMessages.filter((message) => message.startsWith('pageerror:'));
    expect(pageErrors).toEqual([]);

    // 3) 宿主契约：fixed 宿主 display:block 且铺满播放器矩形。
    expect(after.hostStyle).toEqual({ display: 'block', boxSizing: 'border-box' });
    expect(after.hostRect).not.toBeNull();
    expect(after.playerRect).not.toBeNull();
    expect(after.hostRect?.width).toBeCloseTo(after.playerRect!.width, 0);
    expect(after.hostRect?.height).toBeCloseTo(after.playerRect!.height, 0);
    expect(after.hostRect?.left).toBeCloseTo(after.playerRect!.left, 0);

    // 4) 宿主页无样式/节点/滚动副作用：库 reset 未影响页面元素的盒模型与字体。
    expect(after.headStyleCount).toBe(before.headStyleCount);
    expect(after.bodyChildCount).toBe(before.bodyChildCount);
    expect(after.lightDomAnimalNodes).toBe(0);
    expect(after.pageProbe).toEqual(before.pageProbe);
    expect(after.scrollHeight).toBe(before.scrollHeight);

    // 5) 重复打开不重复注入；关闭后清理干净。
    const reopen = await sendToContent(control, tabId!, { type: 'ISLAND_POC_PREVIEW' });
    expect(reopen.ok).toBe(true);
    await expect(host).toHaveCount(1);

    const closed = await sendToContent(control, tabId!, { type: 'ISLAND_POC_CLOSE' });
    expect(closed.ok).toBe(true);
    await expect(host).toHaveCount(0);
    const afterClose = await page.evaluate(() => ({
      host: document.getElementById('bingeup-island-preview-host'),
      rootChildCount: document.documentElement.childElementCount,
    }));
    expect(afterClose.host).toBeNull();

    await control.close();
  });
});