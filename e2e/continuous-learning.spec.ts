import type { Page } from '@playwright/test';
import { expect, pageUrl, test } from './fixtures';

const SYNTHETIC_URL = 'https://www.bilibili.com/video/BV1CONTINUOUS';
const SYNTHETIC_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>连续学习回归测试 — 非真实站点</title>
    <style>
      body { margin: 0; background: #16181d; }
      #bilibili-player { width: 800px; }
      .bpx-player-container { position: relative; width: 800px; height: 480px; background: #000; }
      video { display: block; width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <div id="bilibili-player">
      <div class="bpx-player-container"><video controls muted playsinline></video></div>
    </div>
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

async function sendToContent(
  control: Page,
  tabId: number,
  message: Record<string, unknown>,
): Promise<{ ok?: boolean; error?: string }> {
  return control.evaluate(
    async (input) => {
      try {
        const response = await chrome.tabs.sendMessage(input.tabId, input.message);
        return (response ?? {}) as { ok?: boolean; error?: string };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    },
    { tabId, message },
  );
}

async function currentCard(page: Page): Promise<{ text: string; kind: 'new-word' | 'question' }> {
  return page.evaluate(() => {
    const shadow = document.getElementById('bingeup-overlay-host')?.shadowRoot;
    if (!shadow) throw new Error('学习题卡未显示');
    const prompt = shadow.querySelector('.bingeup-prompt')?.textContent?.trim() ?? '';
    const kind = shadow.querySelector('.bingeup-options') ? 'question' : 'new-word';
    return { text: prompt, kind } as const;
  });
}

async function clickOverlayButton(page: Page, label: string): Promise<void> {
  const clicked = await page.evaluate((wanted) => {
    const shadow = document.getElementById('bingeup-overlay-host')?.shadowRoot;
    if (!shadow) return false;
    const normalize = (text: string | null): string => (text ?? '').replace(/\s+/g, '');
    const button = [...shadow.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => !candidate.disabled && normalize(candidate.textContent).includes(wanted),
    );
    if (!button) return false;
    button.click();
    return true;
  }, label);
  expect(clicked).toBe(true);
}

async function selectFirstOption(page: Page): Promise<void> {
  const selected = await page.evaluate(() => {
    const option = document
      .getElementById('bingeup-overlay-host')
      ?.shadowRoot?.querySelector<HTMLButtonElement>('button.bingeup-option');
    if (!option) return false;
    option.click();
    return true;
  });
  expect(selected).toBe(true);
}

async function waitForCardKind(page: Page, kind: 'new-word' | 'question') {
  await expect.poll(async () => (await currentCard(page)).kind).toBe(kind);
}

test.describe('连续学习新词后答题', () => {
  test('首次出现选择题时提交并继续，仍可练习本轮展示过的新词', async ({ context, extensionId }) => {
    const control = await context.newPage();
    await control.goto(pageUrl(extensionId, 'options.html'));
    await control.evaluate(async () => {
      await chrome.runtime.sendMessage({
        type: 'ONBOARDING_COMPLETE',
        hostnames: ['bilibili.com'],
        deckId: 'deck-cet4',
        selfRatedLevel: 'intermediate',
      });
      await chrome.runtime.sendMessage({
        type: 'SITE_MARK_FIRST_QUESTION_HANDLED',
        hostname: 'bilibili.com',
      });
      const settings = await chrome.runtime.sendMessage({ type: 'GET_APP_SETTINGS' });
      await chrome.runtime.sendMessage({
        type: 'SET_APP_SETTINGS',
        settings: { ...settings, dailyNewWordLimit: 2 },
      });
      await chrome.runtime.sendMessage({ type: 'COOLDOWN_SKIP_QUESTION' });
      await chrome.runtime.sendMessage({
        type: 'LEARNING_ACCEPT_NEW_WORD',
        wordId: 'w-abandon',
      });
    });

    // 更早接受、尚未到期的短期学习词：它不是今天的新词，也不占用今日额度。
    await control.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('bingeup');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const tx = db.transaction('cards', 'readwrite');
      const store = tx.objectStore('cards');
      const cards = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result as Array<Record<string, unknown>>);
        request.onerror = () => reject(request.error);
      });
      const card = cards.find((candidate) => candidate.wordId === 'w-abandon');
      if (!card) throw new Error('未找到 w-abandon 学习卡');
      const yesterday = Date.now() - 24 * 60 * 60 * 1000;
      store.put({
        ...card,
        createdAt: yesterday,
        updatedAt: yesterday,
        nextReviewAt: Date.now() + 8 * 60 * 1000,
        shortTermStep: 0,
      });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });

    const page = await context.newPage();
    await page.setViewportSize({ width: 1100, height: 800 });
    await fulfillSyntheticPage(page);
    await page.goto(SYNTHETIC_URL, { waitUntil: 'load' });
    const tabId = await control.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((tab) => tab.url?.includes('bilibili.com'))?.id ?? null;
    });
    expect(tabId).not.toBeNull();

    await expect
      .poll(
        async () =>
          (await sendToContent(control, tabId!, { type: 'START_CONTINUOUS_LEARNING' })).ok === true,
        { timeout: 30_000, message: '内容脚本未启动连续学习' },
      )
      .toBe(true);

    const shownWords: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      await waitForCardKind(page, 'new-word');
      shownWords.push((await currentCard(page)).text);
      await clickOverlayButton(page, '学到了，继续');
    }

    await waitForCardKind(page, 'question');
    expect((await currentCard(page)).text).toBe('abandon');
    await selectFirstOption(page);
    await clickOverlayButton(page, '提交并继续');

    await waitForCardKind(page, 'question');
    expect((await currentCard(page)).text).toBe(shownWords[0]);
    await expect(page.locator('#bingeup-learning-feedback-notice')).toHaveCount(0);

    await selectFirstOption(page);
    await clickOverlayButton(page, '提交并继续');
    await waitForCardKind(page, 'question');
    expect((await currentCard(page)).text).toBe(shownWords[1]);
    await expect(page.locator('#bingeup-learning-feedback-notice')).toHaveCount(0);

    await page.close();
    await control.close();
  });
});
