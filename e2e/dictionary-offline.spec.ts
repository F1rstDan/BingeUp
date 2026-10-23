import { test, expect, pageUrl } from './fixtures';

/**
 * 新词库整包离线交付验收（Issue #64）。
 *
 * 断网加载真实构建产物中的 manifest、词条与题组，再走一次新词展示、接受、出题和提交，
 * 证明词库、固定题组与 FSRS 更新不依赖网络。
 */
test.describe('新词库整包离线', () => {
  test('断网加载 5,374 词并能出题和提交', async ({ context, extensionId }) => {
    await context.setOffline(true);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(pageUrl(extensionId, 'popup.html'));

    const delivered = await page.evaluate(async () => {
      const load = async (name: string) =>
        (await fetch(chrome.runtime.getURL(`dictionaries/${name}`))).json();
      const [manifest, words, questions] = await Promise.all([
        load('manifest.json'),
        load('words.json'),
        load('questions.json'),
      ]);
      return {
        schemaVersion: manifest.schemaVersion,
        effectiveWords: manifest.counts.effectiveWords,
        words: words.length,
        questions: questions.length,
      };
    });
    expect(delivered).toMatchObject({
      schemaVersion: 2,
      effectiveWords: 5374,
      words: 5374,
      questions: 5374,
    });

    const first = await page.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'LEARNING_GET_NEXT' }),
    );
    expect(first.kind).toBe('new-word-presentation');
    const wordId = first.presentation.word.id as string;

    await page.evaluate(
      (id) => chrome.runtime.sendMessage({ type: 'LEARNING_ACCEPT_NEW_WORD', wordId: id }),
      wordId,
    );
    // 新卡默认 10 分钟后复习；测试把该卡到期时间移到过去，继续验证真实出题与提交。
    await page.evaluate(async (id) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('bingeup-v1');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const tx = db.transaction('cards', 'readwrite');
      const store = tx.objectStore('cards');
      const cards = await new Promise<Array<{ wordId: string; nextReviewAt: number }>>(
        (resolve, reject) => {
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        },
      );
      const card = cards.find((item) => item.wordId === id);
      if (!card) throw new Error(`未找到已接受的新词卡：${id}`);
      card.nextReviewAt = Date.now() - 1;
      await new Promise<void>((resolve, reject) => {
        const request = store.put(card);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });
      db.close();
    }, wordId);
    const next = await page.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'LEARNING_GET_NEXT' }),
    );
    expect(next.kind).toBe('question');

    const result = await page.evaluate(
      (question) =>
        chrome.runtime.sendMessage({
          type: 'LEARNING_SUBMIT_ANSWER',
          submission: { question, selectedIndex: 0, responseTimeMs: 1200 },
        }),
      next.question,
    );
    expect(result.reviewLogId).toBeTruthy();
    expect(result.nextReviewAt).toBeGreaterThan(Date.now());
    expect(errors).toEqual([]);

    await context.setOffline(false);
    await page.close();
  });
});
