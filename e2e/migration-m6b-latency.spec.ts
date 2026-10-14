import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, pageUrl, test } from './fixtures';
import { installOverlayTiming, readOverlayTiming, waitForOverlayCard } from './overlay-timing';

/**
 * M6b 遮罩进入延迟复测（工单 #47）——复用 M0 采样方法（e2e/overlay-timing.ts），
 * 在最终构建上采集自然触发样本，供 docs/ui-migration-evidence.md 的 M6b 小节对比。
 *
 * 默认跳过；显式采集：
 *
 *   PowerShell:  $env:CAPTURE_M6B_LATENCY='1'; npx playwright test e2e/migration-m6b-latency.spec.ts
 *
 * 只统计自然触发（合成 Bilibili 页面 + 预热词库，与 M0 口径一致）；合成页为非真实
 * 站点，数值不代表真实 B 站 / YouTube 场景（见证据文档 M6b 未验证项汇总）。
 */
const captureEnabled = process.env.CAPTURE_M6B_LATENCY === '1';

test.skip(!captureEnabled, 'M6b 延迟复测默认跳过：设置 CAPTURE_M6B_LATENCY=1 运行，见文件头注释');

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const resultPath = resolve(projectRoot, '.output', 'migration-m6b-latency.json');

const SAMPLING_URL = 'https://www.bilibili.com/video/BV1M6BLATENCY';
const SYNTHETIC_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>M6b 延迟复测合成页 — 非真实站点</title>
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
    <div class="fixture-note">M6b 延迟复测合成页（非真实站点）：仅用于在无站点环境下驱动 BingeUp 内容脚本。</div>
  </body>
</html>`;

const TARGET_SAMPLES = 3;
const MAX_ATTEMPTS = 6;

interface LatencySample {
  index: number;
  bootMs: number;
  renderMs: number;
  totalMs: number;
}

test.describe('M6b 遮罩进入延迟复测', () => {
  test.describe.configure({ timeout: 180_000 });

  test('合成 Bilibili 页面：自然触发采样 3 次', async ({ context, extensionId }) => {
    // 预热：让后台先完成首次词库加载，避免混入进入延迟（与 M0 相同）。
    const control = await context.newPage();
    await control.goto(pageUrl(extensionId, 'options.html'));
    const warmup = await control.evaluate(async () => {
      const item = (await chrome.runtime.sendMessage({ type: 'LEARNING_GET_NEXT' })) as {
        kind?: string;
      } | null;
      return item?.kind ?? null;
    });

    const samples: LatencySample[] = [];
    const failures: string[] = [];
    for (let attempt = 0; attempt < MAX_ATTEMPTS && samples.length < TARGET_SAMPLES; attempt += 1) {
      const page = await context.newPage();
      await page.setViewportSize({ width: 1280, height: 800 });
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await installOverlayTiming(page);
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
      await page.goto(SAMPLING_URL, { waitUntil: 'load' });

      const visible = await waitForOverlayCard(page, 15_000);
      const timing = await readOverlayTiming(page);
      if (visible && timing !== null && timing.hostAt !== null && timing.overlayAt !== null) {
        samples.push({
          index: samples.length + 1,
          bootMs: Math.round(timing.hostAt - timing.docStart),
          renderMs: Math.round(timing.overlayAt - timing.hostAt),
          totalMs: Math.round(timing.overlayAt - timing.docStart),
        });
      } else {
        failures.push(
          '第 ' +
            String(attempt + 1) +
            ' 次尝试未在 15s 内自然触发：' +
            JSON.stringify({ timing, pageErrors }),
        );
      }
      await page.close();
    }

    mkdirSync(dirname(resultPath), { recursive: true });
    writeFileSync(
      resultPath,
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          warmup,
          samples,
          failures,
          note: '合成站点（非真实站点）；方法复用自 M0 基线（boot/render 定义见 e2e/overlay-timing.ts）',
        },
        null,
        2,
      ) + '\n',
    );
    console.log('[M6b] 遮罩进入延迟采样:', JSON.stringify({ warmup, samples, failures }));

    await control.close();
    expect(samples.length).toBeGreaterThanOrEqual(TARGET_SAMPLES);
  });
});
