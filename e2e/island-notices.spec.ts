import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, pageUrl, test } from './fixtures';

/**
 * M6a 附属提示迁移（工单 #45）——真实 Chromium + 真实 MV3 产物。
 *
 * 用 page.route 兑现的合成 Bilibili 页面驱动真实内容脚本，验证：
 * - 启用提示：原版 Card/Button 计算样式、ShadowRoot 隔离、启用/暂不/已启用刷新提示交互；
 * - 播放恢复提示：真实「视频未能自动继续」流程下呈现原版提示、指针不拦截播放器、
 *   6 秒自动消失、宿主页无样式/节点泄漏。
 *
 * 截图（证据）默认不写；显式采集：
 *
 *   PowerShell:  $env:CAPTURE_M6A='1'; npx playwright test e2e/island-notices.spec.ts
 *
 * 真实站点（B 站/YouTube）的 CSP 与页面规模差异不在本 spec 范围内，见证据文档。
 */

const captureEnabled = process.env.CAPTURE_M6A === '1';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(projectRoot, 'docs', 'assets', 'migration-m6a');
const resultPath = resolve(projectRoot, '.output', 'migration-m6a-capture.json');

const SYNTHETIC_URL = 'https://www.bilibili.com/video/BV1M6ANOTICE';
const SYNTHETIC_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>M6a 合成页 — 非真实站点</title>
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
      <div class="bpx-player-container"><video muted playsinline></video></div>
    </div>
    <div class="fixture-note">M6a 合成页（非真实站点）：仅用于驱动 BingeUp 内容脚本。</div>
    <script>
      // 用 canvas 捕获流制造一个真实播放中的 muted 视频（无远程资源），
      // 供「视频未能自动继续」恢复失败流程使用。
      (async () => {
        const video = document.querySelector('video');
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 180;
        const ctx = canvas.getContext('2d');
        const paint = () => {
          ctx.fillStyle = '#12233d';
          ctx.fillRect(0, 0, 320, 180);
          ctx.fillStyle = '#19c8b9';
          ctx.fillRect((performance.now() / 12) % 320, 0, 40, 180);
          requestAnimationFrame(paint);
        };
        paint();
        try {
          video.srcObject = canvas.captureStream(30);
          await video.play();
          window.__m6aVideoPlaying = !video.paused;
        } catch (error) {
          window.__m6aVideoError = String(error);
        }
      })();
    </script>
  </body>
</html>`;

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
  if (!captureEnabled) {
    records.push({
      name,
      status: 'skipped',
      file,
      detail: detail ? JSON.stringify(detail) : undefined,
    });
    return;
  }
  mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: resolve(outDir, file), fullPage: false });
  records.push({
    name,
    status: 'captured',
    file,
    detail: detail ? JSON.stringify(detail) : undefined,
  });
}

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

function watchPage(page: Page): { consoleMessages: string[]; fontResponses: string[] } {
  const consoleMessages: string[] = [];
  const fontResponses: string[] = [];
  page.on('console', (message) => consoleMessages.push(message.text()));
  page.on('pageerror', (error) => consoleMessages.push('pageerror: ' + error.message));
  page.on('response', (response) => {
    if (response.url().includes('.woff2')) fontResponses.push(response.url());
  });
  return { consoleMessages, fontResponses };
}

test.describe('M6a 附属提示（合成 Bilibili 页面）', () => {
  test.describe.configure({ timeout: 120_000 });

  test.afterAll(() => {
    if (!captureEnabled) return;
    writeFileSync(
      resultPath,
      `${JSON.stringify({ capturedAt: new Date().toISOString(), records }, null, 2)}\n`,
    );
    console.log(`[M6a] 采集结果写入 ${resultPath}`);
  });

  test('启用提示：原版外观、Shadow 隔离与启用/刷新交互', async ({ context, extensionId }) => {
    const control = await context.newPage();
    await seedBackground(control, extensionId, { bilibiliEnabled: false });
    await control.close();

    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    const watch = watchPage(page);
    await fulfillSyntheticPage(page);
    await page.goto(SYNTHETIC_URL, { waitUntil: 'load' });

    const host = page.locator('#bingeup-enable-prompt-host');
    await expect(host).toHaveCount(1, { timeout: 30_000 });
    await expect(page.getByRole('button', { name: '启用' })).toBeVisible();
    await expect(page.getByRole('button', { name: '暂不' })).toBeVisible();

    // 字体就绪后再读取样式与截图。
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            [...document.fonts].some(
              (face) => face.family.includes('Nunito') && face.status === 'loaded',
            ),
          ),
        { timeout: 15_000, message: 'Nunito 字体未进入 loaded' },
      )
      .toBe(true);
    expect(watch.fontResponses.length).toBeGreaterThan(0);
    expect(watch.fontResponses.every((url) => url.startsWith('chrome-extension://'))).toBe(true);

    const details = await page.evaluate(() => {
      const hostElement = document.getElementById('bingeup-enable-prompt-host');
      const shadow = hostElement?.shadowRoot ?? null;
      const buttons = [...(shadow?.querySelectorAll('button') ?? [])];
      const primary = buttons.find((button) => button.textContent?.includes('启用')) ?? null;
      const secondary = buttons.find((button) => button.textContent?.includes('暂不')) ?? null;
      const card = shadow?.querySelector('[class*="animal-card"]') ?? null;
      const summary = (element: Element | null) => {
        if (element === null) return null;
        const computed = getComputedStyle(element);
        return {
          borderRadius: computed.borderRadius,
          backgroundColor: computed.backgroundColor,
          color: computed.color,
          boxShadow: computed.boxShadow,
          fontFamily: computed.fontFamily,
        };
      };
      return {
        hostInline: hostElement
          ? {
              position: hostElement.style.position,
              top: hostElement.style.top,
              right: hostElement.style.right,
              zIndex: hostElement.style.zIndex,
            }
          : null,
        hostText: hostElement?.textContent ?? null,
        primary: summary(primary),
        secondary: summary(secondary),
        card: summary(card),
        shadowText: shadow?.textContent ?? null,
        shadowStyle: shadow?.querySelector('style')?.textContent ?? null,
        lightAnimalNodes: document.querySelectorAll('[class^="animal-"]').length,
        headStyleCount: document.head.querySelectorAll('style,link[rel="stylesheet"]').length,
        bodyChildCount: document.body.childElementCount,
      };
    });

    // 原版 Button/Card 计算样式（与 M4 遮罩内实测一致的库外观）。
    expect(details.primary?.borderRadius).toBe('50px');
    expect(details.primary?.backgroundColor).toBe('rgb(248, 248, 240)');
    expect(details.primary?.color).toBe('rgb(121, 79, 39)');
    expect(details.primary?.boxShadow).toContain('rgb(189, 174, 160)');
    expect(details.primary?.fontFamily).toContain('Nunito');
    expect(details.primary?.fontFamily).toContain('Noto Sans SC');
    expect(details.secondary?.borderRadius).toBe('50px');
    expect(details.card?.backgroundColor).toBe('rgb(247, 243, 223)');
    expect(details.card?.borderRadius).toBe('20px');

    // Shadow 隔离：宿主 light DOM 无内容、宿主页无库节点/新增样式。
    expect(details.hostText).toBe('');
    expect(details.lightAnimalNodes).toBe(0);
    expect(details.headStyleCount).toBe(1);
    // 合成页 body 自身三个子元素（播放器、说明、内联脚本）；内容脚本不新增 body 节点。
    expect(details.bodyChildCount).toBe(3);
    expect(details.shadowStyle).toContain(':host{--animal-primary-color');
    expect(details.shadowStyle).not.toContain(':root{');
    expect(details.hostInline).toEqual({
      position: 'fixed',
      top: '16px',
      right: '16px',
      zIndex: '2147483647',
    });

    await capture(page, 'enable-prompt', 'enable-prompt.png', {
      primary: details.primary,
      card: details.card,
    });

    // 启用：成功后显示「请刷新」提示，知道了移除横幅。
    await page.getByRole('button', { name: '启用' }).click();
    await expect(page.getByText('请刷新页面或新开标签页后开始学习。')).toBeVisible({
      timeout: 15_000,
    });
    await capture(page, 'enable-prompt-enabled', 'enable-prompt-enabled.png', {});
    await page.getByRole('button', { name: '知道了' }).click();
    await expect(host).toHaveCount(0);

    // 无 CSP 报错、无页面错误。
    expect(
      watch.consoleMessages.filter(
        (message) => /Content Security Policy/i.test(message) || /Refused to load/i.test(message),
      ),
    ).toEqual([]);
    expect(watch.consoleMessages.filter((message) => message.startsWith('pageerror:'))).toEqual([]);
    await page.close();
  });

  test('启用提示：暂不触发拒绝计数并移除横幅', async ({ context, extensionId }) => {
    const control = await context.newPage();
    await seedBackground(control, extensionId, { bilibiliEnabled: false });

    const page = await context.newPage();
    await fulfillSyntheticPage(page);
    await page.goto(SYNTHETIC_URL, { waitUntil: 'load' });

    await expect(page.locator('#bingeup-enable-prompt-host')).toHaveCount(1, { timeout: 30_000 });
    await page.getByRole('button', { name: '暂不' }).click();
    await expect(page.locator('#bingeup-enable-prompt-host')).toHaveCount(0);

    // 拒绝计数经真实后台持久化。
    const declineCount = await control.evaluate(async () => {
      const data = (await chrome.runtime.sendMessage({
        type: 'GET_POPUP_DATA',
        hostname: 'bilibili.com',
      })) as { site?: { promptDeclineCount?: number } } | null;
      return data?.site?.promptDeclineCount ?? null;
    });
    expect(declineCount).toBe(1);
    await control.close();
    await page.close();
  });

  test('播放恢复提示：真实恢复失败流程下呈现原版提示且不拦截播放器', async ({
    context,
    extensionId,
  }) => {
    const control = await context.newPage();
    await seedBackground(control, extensionId, { bilibiliEnabled: true });

    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    const watch = watchPage(page);
    await fulfillSyntheticPage(page);
    await page.goto(SYNTHETIC_URL, { waitUntil: 'load' });

    // 合成页视频必须曾经真实进入播放状态（自然触发会随即将它暂停），
    // 恢复流程才会拿到 wasPlaying=true 的快照并走 play() 失败分支。
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const state = window as unknown as {
              __m6aVideoPlaying?: boolean;
              __m6aVideoError?: string;
            };
            return {
              playing: state.__m6aVideoPlaying ?? null,
              error: state.__m6aVideoError ?? null,
            };
          }),
        { timeout: 15_000, message: '合成页视频未进入播放状态' },
      )
      .toEqual({ playing: true, error: null });

    // 等自然触发（冷却/首题就绪），必要时用连续学习手动触发。
    const overlay = page.locator('#bingeup-overlay-host');
    const naturalAppeared = await overlay
      .waitFor({ state: 'attached', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!naturalAppeared) {
      const tabId = await findSyntheticTabId(control);
      expect(tabId).not.toBeNull();
      await expect
        .poll(
          async () =>
            (await sendToContent(control, tabId!, { type: 'START_CONTINUOUS_LEARNING' })).ok ===
            true,
          { timeout: 30_000, message: '内容脚本未响应 START_CONTINUOUS_LEARNING' },
        )
        .toBe(true);
      await expect(overlay).toHaveCount(1, { timeout: 15_000 });
    }

    // 破坏视频源：把视频指向路由必然拒绝的媒体地址（非文档请求返回 204），
    // 交互结束后 restore 的 play() 将以 NotSupportedError 拒绝，触发真实恢复提示路径。
    await page.evaluate(() => {
      const video = document.querySelector('video');
      if (!video) throw new Error('合成页缺少视频元素');
      video.pause();
      video.srcObject = null;
      video.src = 'https://www.bilibili.com/__m6a_missing_media__.mp4';
      video.load();
    });

    // 走终态动作（跳过/结束/退出），触发遮罩关闭与播放恢复。
    await page
      .getByRole('button', { name: /跳过|结束|退出/ })
      .first()
      .click();

    const notice = page.locator('#bingeup-playback-recovery-notice');
    await expect(notice).toHaveCount(1, { timeout: 15_000 });

    const details = await page.evaluate(() => {
      const hostElement = document.getElementById('bingeup-playback-recovery-notice');
      const shadow = hostElement?.shadowRoot ?? null;
      const status = shadow?.querySelector('[role="status"]') ?? null;
      const computed = status ? getComputedStyle(status) : null;
      const rect = hostElement?.getBoundingClientRect() ?? null;
      const hit = rect
        ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        : null;
      return {
        text: status?.textContent ?? null,
        hostInline: hostElement
          ? {
              position: hostElement.style.position,
              right: hostElement.style.right,
              bottom: hostElement.style.bottom,
              pointerEvents: hostElement.style.pointerEvents,
            }
          : null,
        hostText: hostElement?.textContent ?? null,
        computed:
          computed === null
            ? null
            : {
                backgroundColor: computed.backgroundColor,
                color: computed.color,
                borderRadius: computed.borderTopLeftRadius,
                borderColor: computed.borderTopColor,
                fontFamily: computed.fontFamily,
              },
        shadowStyle: shadow?.querySelector('style')?.textContent ?? null,
        hitInsideHost: hostElement !== null && hit !== null ? hostElement.contains(hit) : null,
        hitTag: hit === null ? null : hit.nodeName,
        lightAnimalNodes: document.querySelectorAll('[class^="animal-"]').length,
        headStyleCount: document.head.querySelectorAll('style,link[rel="stylesheet"]').length,
        bodyChildCount: document.body.childElementCount,
      };
    });

    expect(details.text).toBe('视频未能自动继续，请手动播放');
    expect(details.hostText).toBe('');
    expect(details.hostInline).toEqual({
      position: 'fixed',
      right: '20px',
      bottom: '20px',
      pointerEvents: 'none',
    });
    expect(details.computed?.backgroundColor).toBe('rgb(248, 248, 240)');
    expect(details.computed?.color).toBe('rgb(121, 79, 39)');
    expect(details.computed?.borderRadius).toBe('18px');
    expect(details.computed?.borderColor).toBe('rgb(220, 216, 209)');
    expect(details.computed?.fontFamily).toContain('Nunito');

    // 不拦截播放器交互：指针穿透使命中测试落在页面元素上，而不是提示本身。
    expect(details.hitInsideHost).toBe(false);

    // Shadow 隔离：宿主页无库节点、无新增样式。
    expect(details.lightAnimalNodes).toBe(0);
    expect(details.headStyleCount).toBe(1);
    expect(details.bodyChildCount).toBe(3);
    expect(details.shadowStyle).toContain(':host{--animal-primary-color');
    expect(details.shadowStyle).not.toContain(':root{');

    await capture(page, 'playback-recovery-notice', 'playback-recovery-notice.png', {
      computed: details.computed,
      hitInsideHost: details.hitInsideHost,
      hitTag: details.hitTag,
    });

    // 6 秒自动消失。
    await expect(notice).toHaveCount(0, { timeout: 15_000 });

    expect(
      watch.consoleMessages.filter(
        (message) => /Content Security Policy/i.test(message) || /Refused to load/i.test(message),
      ),
    ).toEqual([]);
    expect(watch.consoleMessages.filter((message) => message.startsWith('pageerror:'))).toEqual([]);
    await control.close();
    await page.close();
  });
});
