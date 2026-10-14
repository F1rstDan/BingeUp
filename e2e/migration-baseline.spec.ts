import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { pageUrl, test } from './fixtures';
import {
  installOverlayTiming,
  markOverlayTimingSend,
  readOverlayTiming,
  waitForOverlayCard,
} from './overlay-timing';

/**
 * M0 旧界面截图基线采集（工单 #37）——证据采集工具，不是质量门禁。
 *
 * 默认跳过；显式采集（会覆盖 docs/assets/migration-baseline/ 下同名截图）：
 *
 *   PowerShell:  $env:CAPTURE_BASELINE='1'; npx playwright test e2e/migration-baseline.spec.ts
 *
 * Popup / Onboarding / Options / Stats 为扩展独立页面；遮罩与启用提示使用 page.route
 * 兑现的合成 Bilibili 页面（不访问真实站点）驱动真实内容脚本，并记录遮罩进入延迟。
 * 真实站点上的遮罩、启用提示与站点适配行为仍以人工验收矩阵为准。
 */
const captureEnabled = process.env.CAPTURE_BASELINE === '1';

test.skip(!captureEnabled, '基线采集默认跳过：设置 CAPTURE_BASELINE=1 运行，见文件头注释');

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(projectRoot, 'docs', 'assets', 'migration-baseline');
const resultPath = resolve(projectRoot, '.output', 'migration-baseline-capture.json');

const SYNTHETIC_URL = 'https://www.bilibili.com/video/BV1M0BASELINE';
const SYNTHETIC_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>M0 基线合成页 — 非真实站点</title>
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
    <div class="fixture-note">M0 基线合成页（非真实站点）：仅用于在无站点环境下驱动 BingeUp 内容脚本。</div>
  </body>
</html>`;

interface CaptureRecord {
  name: string;
  status: 'captured' | 'failed';
  file?: string;
  detail?: string;
}

const records: CaptureRecord[] = [];

/** 用合成页面响应替换 bilibili.com 请求；主文档返回 fixture HTML。 */
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

/** 在扩展页面上下文里找到合成站点标签页的 tabId。 */
async function findSyntheticTabId(extensionPage: Page): Promise<number | null> {
  return extensionPage.evaluate(async () => {
    const allowed = await chrome.tabs.query({ url: '*://*.bilibili.com/*' });
    const tabs = allowed.length > 0 ? allowed : await chrome.tabs.query({});
    const matched = tabs.find((tab) => tab.url?.includes('bilibili.com'));
    return matched?.id ?? null;
  });
}

test.describe('M0 旧界面基线采集', () => {
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
    console.log(`[M0] 基线采集结果写入 ${resultPath}`);
    console.log(JSON.stringify(records, null, 2));
  });

  test('扩展独立页面截图：Popup / Onboarding / Options / Stats', async ({
    context,
    extensionId,
  }) => {
    const captures = [
      { name: 'popup', file: 'popup.png', html: 'popup.html', width: 400, height: 200 },
      {
        name: 'onboarding',
        file: 'onboarding.png',
        html: 'onboarding.html',
        width: 760,
        height: 1200,
      },
      { name: 'options', file: 'options.png', html: 'options.html', width: 1120, height: 1000 },
      { name: 'stats', file: 'stats.png', html: 'stats.html', width: 1120, height: 1000 },
    ] as const;

    for (const capture of captures) {
      const page = await context.newPage();
      await page.setViewportSize({ width: capture.width, height: capture.height });
      await page.goto(pageUrl(extensionId, capture.html));

      if (capture.name === 'popup') {
        await page.getByRole('button', { name: '设置' }).waitFor();
      } else if (capture.name === 'onboarding') {
        await page.getByRole('heading', { name: /欢迎使用/ }).waitFor();
      } else if (capture.name === 'options') {
        await page.getByRole('heading', { name: '刷刷升级 — 设置' }).waitFor();
      } else {
        await page.getByRole('heading', { name: '学习统计' }).waitFor();
      }

      // 等字体就绪再截图，避免基线里的中文落到系统回退字体。
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await page.waitForTimeout(250);
      await page.screenshot({ path: resolve(outDir, capture.file), fullPage: true });
      records.push({ name: capture.name, status: 'captured', file: capture.file });
      await page.close();
    }
  });

  test('遮罩（合成 Bilibili 页面）：截图与进入延迟', async ({ context, extensionId }) => {
    // 预热：让后台先完成首次词库加载（首次初始化可能数十秒），避免混入进入延迟。
    const control = await context.newPage();
    await control.goto(pageUrl(extensionId, 'options.html'));
    const warmup = await control.evaluate(async () => {
      const item = (await chrome.runtime.sendMessage({ type: 'LEARNING_GET_NEXT' })) as {
        kind?: string;
      } | null;
      return item?.kind ?? null;
    });

    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    const overlayLogs: string[] = [];
    page.on('console', (message) => {
      if (message.text().includes('[BingeUp]')) overlayLogs.push(message.text());
    });
    page.on('pageerror', (error) => overlayLogs.push(`pageerror: ${error.message}`));
    await installOverlayTiming(page);

    await fulfillSyntheticPage(page);
    await page.goto(SYNTHETIC_URL, { waitUntil: 'load' });

    const waitForOverlay = (timeout: number) => waitForOverlayCard(page, timeout);

    let mode: 'natural' | 'manual' | 'late' | 'none' = 'none';
    let sendResult: unknown = null;

    if (await waitForOverlay(15_000)) {
      // 视频身份变化后的自然触发（首次触发无需等待冷却）。
      mode = 'natural';
    } else {
      const tabId = await findSyntheticTabId(control);
      if (tabId !== null) {
        await markOverlayTimingSend(page);
        sendResult = await control.evaluate(async (id) => {
          try {
            const response = await chrome.tabs.sendMessage(id, {
              type: 'START_CONTINUOUS_LEARNING',
            });
            return { ok: true, response };
          } catch (error) {
            return { ok: false, error: String(error) };
          }
        }, tabId);
        if (await waitForOverlay(15_000)) {
          const sentOk =
            typeof sendResult === 'object' &&
            sendResult !== null &&
            (sendResult as { ok?: boolean }).ok === true;
          mode = sentOk ? 'manual' : 'late';
        }
      } else {
        sendResult = { ok: false, error: '未找到合成站点标签页' };
      }
    }

    const timing = await readOverlayTiming(page);
    const naturalMs =
      timing?.overlayAt != null && (timing.tSend === null || timing.overlayAt < timing.tSend)
        ? Math.round(timing.overlayAt - timing.docStart)
        : null;
    const manualMs =
      timing?.overlayAt != null && timing.tSend !== null && timing.overlayAt >= timing.tSend
        ? Math.round(timing.overlayAt - timing.tSend)
        : null;
    const bootMs =
      timing?.hostAt != null && timing.hostAt >= timing.docStart
        ? Math.round(timing.hostAt - timing.docStart)
        : null;
    const renderMs =
      timing?.overlayAt != null && timing.hostAt != null
        ? Math.round(timing.overlayAt - timing.hostAt)
        : null;

    if (mode !== 'none') {
      await page.waitForTimeout(300);
      await page.screenshot({ path: resolve(outDir, 'overlay-synthetic.png') });
    }

    records.push({
      name: 'overlay',
      status: mode === 'none' ? 'failed' : 'captured',
      file: mode === 'none' ? undefined : 'overlay-synthetic.png',
      detail: JSON.stringify({
        mode,
        naturalMs,
        manualMs,
        bootMs,
        renderMs,
        warmup,
        sendResult,
        logs: overlayLogs.slice(-8),
      }),
    });
    console.log(
      '[M0] 遮罩进入延迟:',
      JSON.stringify({ mode, naturalMs, manualMs, bootMs, renderMs, warmup }),
    );
    await control.close();
  });

  test('启用提示（合成 Bilibili 页面）截图', async ({ context, extensionId }) => {
    const control = await context.newPage();
    await control.goto(pageUrl(extensionId, 'options.html'));
    const prep = await control.evaluate(async () => {
      await chrome.runtime.sendMessage({
        type: 'ONBOARDING_COMPLETE',
        hostnames: ['bilibili.com', 'youtube.com'],
        deckId: 'deck-cet4',
        selfRatedLevel: 'intermediate',
      });
      const site = await chrome.runtime.sendMessage({
        type: 'SITE_DISABLE',
        hostname: 'bilibili.com',
      });
      const popup = (await chrome.runtime.sendMessage({
        type: 'GET_POPUP_DATA',
        hostname: 'bilibili.com',
      })) as { onboardingCompleted?: boolean } | null;
      return { site, onboardingCompleted: popup?.onboardingCompleted ?? null };
    });
    await control.close();

    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await fulfillSyntheticPage(page);
    await page.goto(SYNTHETIC_URL);
    await page.locator('#bingeup-enable-prompt-host .bingeup-enable-prompt-card').waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(outDir, 'enable-prompt-synthetic.png') });
    records.push({
      name: 'enable-prompt',
      status: 'captured',
      file: 'enable-prompt-synthetic.png',
      detail: JSON.stringify(prep),
    });
  });
});
