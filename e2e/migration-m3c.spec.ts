import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, pageUrl, test } from './fixtures';

/**
 * M3c 学习统计页迁移采集（工单 #42）——证据采集工具，不是质量门禁。
 *
 * 默认跳过；显式采集（会覆盖 docs/assets/migration-m3c/ 下同名截图）：
 *
 *   PowerShell:  $env:CAPTURE_M3C='1'; npx playwright test e2e/migration-m3c.spec.ts
 *
 * 空状态使用全新 profile（只有统计页自身创建的空数据库）；非空状态先经真实消息
 * 链路完成引导并启用 bilibili，再向 IndexedDB 写入复习日志、学习卡、会话日志与
 * 行为事件（仅采集用；统计页的读取与聚合链路保持不变）。
 */
const captureEnabled = process.env.CAPTURE_M3C === '1';

test.skip(!captureEnabled, 'M3c 采集默认跳过：设置 CAPTURE_M3C=1 运行，见文件头注释');

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(projectRoot, 'docs', 'assets', 'migration-m3c');
const resultPath = resolve(projectRoot, '.output', 'migration-m3c-capture.json');

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

async function readOverflow(page: Page): Promise<{ scrollWidth: number; clientWidth: number }> {
  return page.evaluate(() => {
    const root = document.documentElement;
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
  });
}

async function capture(
  page: Page,
  name: string,
  file: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  // 等字体就绪再截图，避免中文落到系统回退字体。
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  // 预热一帧：headless 下没有帧时 CSS 过渡会停在起始值（如 Tab 高亮滞后），
  // 先强制渲染一帧让过渡开始计时，等待过渡结束后再截正式图。
  await page.screenshot({ clip: { x: 0, y: 0, width: 8, height: 8 } });
  await page.waitForTimeout(350);
  await page.screenshot({ path: resolve(outDir, file), fullPage: true });
  records.push({
    name,
    status: 'captured',
    file,
    detail: detail === undefined ? undefined : JSON.stringify(detail),
  });
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 非空状态数据：相对采集时刻构造，保证"今日/昨日/近 7 日/上周"都有样本。 */
function buildSeedPayload(): Record<string, unknown[]> {
  const now = Date.now();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();
  const at = (daysAgo: number, hours: number) => todayStartMs - daysAgo * MS_PER_DAY + hours * 3600_000;
  const todayAt = Math.max(todayStartMs, now - 60_000);

  const card = (
    id: string,
    wordId: string,
    stage: string,
    createdAt: number,
    nextReviewAt?: number,
  ) => ({
    id,
    wordId,
    deckId: 'deck-cet4',
    stage,
    origin: 'accepted-new',
    createdAt,
    updatedAt: now,
    ...(nextReviewAt === undefined ? {} : { nextReviewAt }),
  });

  const cards = [
    // 短期学习 7 张（其中 4 张到期）
    card('card-w1', 'w1', 'short-term', at(1, 9), now - 3600_000),
    card('card-w2', 'w2', 'short-term', at(2, 9), now - 7200_000),
    card('card-w3', 'w3', 'short-term', at(3, 9), now - 10_800_000),
    card('card-w4', 'w4', 'short-term', at(4, 9), now - 14_400_000),
    card('card-w5', 'w5', 'short-term', at(5, 9), now + 1 * MS_PER_DAY),
    card('card-w6', 'w6', 'short-term', at(6, 9), now + 2 * MS_PER_DAY),
    card('card-w13', 'w13', 'short-term', todayStartMs + 1000),
    // 长期复习 4 张（其中 2 张到期）
    card('card-w7', 'w7', 'long-term', at(20, 9), now - 2 * 3600_000),
    card('card-w8', 'w8', 'long-term', at(22, 9), now - 3 * 3600_000),
    card('card-w9', 'w9', 'long-term', at(25, 9), now + 3 * MS_PER_DAY),
    card('card-w10', 'w10', 'long-term', at(30, 9), now + 5 * MS_PER_DAY),
    // 自报已知 2 张
    card('card-w11', 'w11', 'self-reported-known', at(3, 9)),
    card('card-w12', 'w12', 'self-reported-known', at(4, 9)),
  ];

  const log = (
    id: string,
    wordId: string,
    reviewedAt: number,
    isCorrect: boolean,
    source: string,
    stageAtSubmission: string,
  ) => ({
    id,
    cardId: `card-${wordId}`,
    wordId,
    questionType: 'en-to-zh',
    selectedAnswer: '放弃',
    correctAnswer: '放弃',
    isCorrect,
    responseTimeMs: 2400,
    reviewedAt,
    source,
    stageAtSubmission,
  });

  const reviewLogs = [
    // 今日 6 条：5 自然 / 5 正确；长期 3 条 2 正确
    log('log-1', 'w1', todayAt, true, 'natural', 'short-term'),
    log('log-2', 'w2', todayAt, true, 'natural', 'short-term'),
    log('log-3', 'w7', todayAt, false, 'natural', 'long-term'),
    log('log-4', 'w3', todayAt, true, 'natural', 'short-term'),
    log('log-5', 'w8', todayAt, true, 'manual', 'long-term'),
    log('log-6', 'w4', todayAt, true, 'natural', 'long-term'),
    // 昨日 3 条
    log('log-7', 'w1', at(1, 12), true, 'natural', 'short-term'),
    log('log-8', 'w2', at(1, 12), false, 'manual', 'short-term'),
    log('log-9', 'w7', at(1, 13), true, 'natural', 'long-term'),
    // 3 天前 2 条
    log('log-10', 'w3', at(3, 12), true, 'natural', 'short-term'),
    log('log-11', 'w8', at(3, 12), true, 'natural', 'long-term'),
    // 上周 4 条（长期 2 对 2 错）
    log('log-12', 'w7', at(8, 12), true, 'natural', 'long-term'),
    log('log-13', 'w7', at(8, 12), false, 'natural', 'long-term'),
    log('log-14', 'w8', at(8, 13), true, 'natural', 'long-term'),
    log('log-15', 'w8', at(8, 13), false, 'natural', 'long-term'),
  ];

  const session = (
    id: string,
    startedAt: number,
    overrides: Record<string, unknown>,
  ) => ({
    id,
    startedAt,
    endedAt: startedAt + 5000,
    mode: 'single',
    outcome: 'submitted',
    questionsAnswered: 1,
    ...overrides,
  });

  const sessionLogs = [
    session('session-1', todayAt, { source: 'natural', initialOutcome: 'submitted' }),
    session('session-2', todayAt, {
      mode: 'continuous',
      outcome: 'exit',
      questionsAnswered: 3,
      continuousQuestionsAnswered: 3,
    }),
    session('session-3', at(1, 13), { outcome: 'skipped', source: 'natural', initialOutcome: 'skipped' }),
    session('session-4', at(3, 12), { source: 'natural', initialOutcome: 'submitted' }),
  ];

  const behaviorEvents = [
    {
      id: 'event-site-1',
      kind: 'site-enabled',
      occurredAt: now - 5 * MS_PER_DAY,
      hostname: 'bilibili.com',
      enabled: true,
    },
    {
      id: 'event-pause-1',
      kind: 'global-pause',
      occurredAt: at(1, 10),
      action: 'started',
      pausedUntil: at(1, 10) + 10 * 60_000,
    },
  ];

  return { cards, reviewLogs, sessionLogs, behaviorEvents };
}

/** 在扩展页面上下文里直接写入源数据（仅采集用）。 */
async function seedRecords(control: Page, payload: Record<string, unknown[]>): Promise<void> {
  await control.evaluate(async (data) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const request = indexedDB.open('bingeup-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stores = ['cards', 'reviewLogs', 'sessionLogs', 'behaviorEvents'] as const;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(stores as unknown as string[], 'readwrite');
      for (const store of stores) {
        const objectStore = tx.objectStore(store);
        objectStore.clear();
        for (const record of data[store] ?? []) objectStore.put(record);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, payload);
}

test.describe('M3c 学习统计页迁移采集', () => {
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
    console.log(`[M3c] 采集结果写入 ${resultPath}`);
    console.log(JSON.stringify(records, null, 2));
  });

  test('空状态：今日与趋势标签', async ({ context, extensionId }) => {
    const page = await context.newPage();
    const watch = watchPage(page);
    await page.setViewportSize({ width: 1120, height: 1000 });
    await page.goto(pageUrl(extensionId, 'stats.html'));

    await page.getByRole('tablist', { name: '统计分区' }).waitFor();
    await page
      .getByRole('region', { name: '当前学习卡状态' })
      .getByText('还没有学习卡')
      .waitFor();
    const fonts = await readFontState(page);
    expect(fonts.nunitoReady).toBe(true);
    expect(fonts.notoReady).toBe(true);
    expect(watch.fontResponses.every((url) => url.startsWith('chrome-extension://'))).toBe(true);

    const overflowToday = await readOverflow(page);
    expect(overflowToday.scrollWidth).toBeLessThanOrEqual(overflowToday.clientWidth);
    await capture(page, 'empty-today', 'stats-empty-today.png', { fonts, overflowToday });

    // 窄宽度 + 键盘焦点：480px 无横向溢出；Tab 落在激活标签上并显示原版黄色焦点环。
    await page.setViewportSize({ width: 480, height: 900 });
    const overflowNarrow = await readOverflow(page);
    expect(overflowNarrow.scrollWidth).toBeLessThanOrEqual(overflowNarrow.clientWidth);
    await page.keyboard.press('Tab');
    const focusedTab = await page.evaluate(() => document.activeElement?.textContent ?? null);
    await capture(page, 'empty-today-narrow-focus', 'stats-empty-today-narrow.png', {
      overflowNarrow,
      focusedTab,
    });
    await page.setViewportSize({ width: 1120, height: 1000 });

    await page.getByRole('tab', { name: '趋势' }).click();
    await page.getByRole('region', { name: '近 7 日趋势' }).waitFor();
    await capture(page, 'empty-trend', 'stats-empty-trend.png', {
      todayRow: await page
        .getByRole('region', { name: '近 7 日趋势' })
        .getByText(/自然 0 · 跳过 — · 暂停 0 · 连续 0\/0 · 长期 0\/—/)
        .first()
        .textContent(),
    });

    records.push({
      name: 'empty-runtime',
      status: 'captured',
      detail: JSON.stringify({
        fonts,
        consoleErrors: watch.consoleErrors,
        pageErrors: watch.pageErrors,
        failedRequests: watch.failedRequests,
        fontResponseCount: watch.fontResponses.length,
      }),
    });
    expect(watch.pageErrors).toEqual([]);
    expect(watch.consoleErrors).toEqual([]);
    await page.close();
  });

  test('非空状态：今日、趋势与网站标签', async ({ context, extensionId }) => {
    const control = await context.newPage();
    await control.goto(pageUrl(extensionId, 'options.html'));
    await control.evaluate(async () => {
      await chrome.runtime.sendMessage({
        type: 'ONBOARDING_COMPLETE',
        hostnames: ['bilibili.com', 'youtube.com'],
        deckId: 'deck-cet4',
        selfRatedLevel: 'intermediate',
      });
      await chrome.runtime.sendMessage({ type: 'SITE_ENABLE', hostname: 'bilibili.com' });
      await chrome.runtime.sendMessage({ type: 'SITE_DISABLE', hostname: 'youtube.com' });
    });
    await seedRecords(control, buildSeedPayload());
    await control.close();

    const page = await context.newPage();
    const watch = watchPage(page);
    await page.setViewportSize({ width: 1120, height: 1000 });
    await page.goto(pageUrl(extensionId, 'stats.html'));
    await page.getByRole('tablist', { name: '统计分区' }).waitFor();

    const overview = page.getByRole('region', { name: '概览' });
    await overview.getByText('今日自然完成题目').waitFor();
    await expect(overview.getByText('5')).toBeVisible();
    await expect(
      page.getByRole('region', { name: '今日学习' }).getByText('67%'),
    ).toBeVisible();
    const stageTags = page.getByRole('region', { name: '当前学习卡状态' });
    await expect(stageTags.getByText('短期学习')).toBeVisible();
    await expect(stageTags.getByRole('progressbar')).toHaveCount(3);

    const overflowToday = await readOverflow(page);
    expect(overflowToday.scrollWidth).toBeLessThanOrEqual(overflowToday.clientWidth);
    await capture(page, 'seeded-today', 'stats-seeded-today.png', {
      overview: '今日自然完成题目 5 · 今日复习词数 6 · 当前待复习词数 6',
      overflowToday,
    });

    await page.getByRole('tab', { name: '趋势' }).click();
    await page.getByRole('region', { name: '近 7 日趋势' }).waitFor();
    const weekComparisonText = (
      await page.getByRole('region', { name: '周对比' }).innerText()
    ).replace(/\s+/g, ' ');
    await capture(page, 'seeded-trend', 'stats-seeded-trend.png', {
      weekComparison: weekComparisonText,
    });

    await page.getByRole('tab', { name: '网站' }).click();
    const sites = page.getByRole('region', { name: '默认支持网站' });
    await sites.waitFor();
    await expect(sites.getByText('已启用')).toHaveCount(1);
    await expect(sites.getByText(/连续启用 5 天/)).toBeVisible();
    await expect(sites.getByText('已关闭')).toHaveCount(1);
    await expect(sites.getByText(/连续启用 0 天/)).toBeVisible();
    await capture(page, 'seeded-sites', 'stats-seeded-sites.png', {
      bilibili: '已启用 · 连续启用 5 天',
      youtube: '已关闭 · 连续启用 0 天',
    });

    records.push({
      name: 'seeded-runtime',
      status: 'captured',
      detail: JSON.stringify({
        consoleErrors: watch.consoleErrors,
        pageErrors: watch.pageErrors,
        failedRequests: watch.failedRequests,
      }),
    });
    expect(watch.pageErrors).toEqual([]);
    expect(watch.consoleErrors).toEqual([]);
    await page.close();
  });
});
