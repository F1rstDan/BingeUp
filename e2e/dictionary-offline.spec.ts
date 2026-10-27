import { test, expect, pageUrl } from './fixtures';
import type { Page } from '@playwright/test';

async function makeCardDue(page: Page, wordId: string): Promise<void> {
  await page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('bingeup');
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
    if (!card) throw new Error(`未找到学习卡：${id}`);
    card.nextReviewAt = Date.now() - 1;
    store.put(card);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, wordId);
}

/**
 * 新词库整包离线交付验收（Issue #64）。
 *
 * 断网加载真实构建产物中的 manifest、词条与题组，再走一次新词展示、接受、出题和提交，
 * 证明词库、固定题组与 FSRS 更新不依赖网络。
 */
test.describe('新词库整包离线', () => {
  test('缺少语境题的真实词条不会重复出题，太难可退回短期学习', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(pageUrl(extensionId, 'popup.html'));
    await page.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'LEARNING_ACCEPT_NEW_WORD', wordId: 'w-abandon' }),
    );

    let reviewLogId = '';
    for (const expectedType of ['en-to-zh', 'zh-to-en']) {
      await makeCardDue(page, 'w-abandon');
      const item = await page.evaluate(() =>
        chrome.runtime.sendMessage({ type: 'LEARNING_GET_NEXT' }),
      );
      expect(item.kind).toBe('question');
      expect(item.question.type).toBe(expectedType);
      const result = await page.evaluate(
        (question) =>
          chrome.runtime.sendMessage({
            type: 'LEARNING_SUBMIT_ANSWER',
            submission: {
              question,
              selectedIndex: question.correctIndex,
              responseTimeMs: 1500,
              source: 'manual',
            },
          }),
        item.question,
      );
      reviewLogId = result.reviewLogId;
    }

    const afterAnswer = await page.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'EXPORT_DATA' }),
    );
    const completed = afterAnswer.data.cards.find(
      (card: { wordId: string }) => card.wordId === 'w-abandon',
    );
    expect(completed.stage).toBe('long-term');
    expect(completed.schedulerState.scheduledDays).toBe(3);

    await page.evaluate(
      (id) =>
        chrome.runtime.sendMessage({
          type: 'LEARNING_CORRECT_RATING',
          reviewLogId: id,
          correction: 'too-hard',
        }),
      reviewLogId,
    );
    const afterCorrection = await page.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'EXPORT_DATA' }),
    );
    const corrected = afterCorrection.data.cards.find(
      (card: { wordId: string }) => card.wordId === 'w-abandon',
    );
    expect(corrected).toMatchObject({ stage: 'short-term', shortTermStep: 0 });
    expect(corrected.schedulerState).toBeUndefined();
    await page.close();
  });

  test('增补题组可在真实扩展中依次出现拼写和语境题', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(pageUrl(extensionId, 'popup.html'));
    await page.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'LEARNING_ACCEPT_NEW_WORD', wordId: 'w-find' }),
    );

    for (const expectedType of ['en-to-zh', 'zh-to-en']) {
      await makeCardDue(page, 'w-find');
      const item = await page.evaluate(() =>
        chrome.runtime.sendMessage({ type: 'LEARNING_GET_NEXT' }),
      );
      expect(item.question.type).toBe(expectedType);
      await page.evaluate(
        (question) =>
          chrome.runtime.sendMessage({
            type: 'LEARNING_SUBMIT_ANSWER',
            submission: {
              question,
              selectedIndex: question.correctIndex,
              responseTimeMs: 3000,
              source: 'manual',
            },
          }),
        item.question,
      );
    }

    await makeCardDue(page, 'w-find');
    const spelling = await page.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'LEARNING_GET_NEXT', options: { allowSpelling: true } }),
    );
    expect(spelling.kind).toBe('spelling-question');
    expect(spelling.question.correctAnswer).toBe('find');
    const spellingResult = await page.evaluate(
      (question) =>
        chrome.runtime.sendMessage({
          type: 'LEARNING_SUBMIT_SPELLING',
          submission: {
            question,
            spelledAnswer: question.correctAnswer,
            responseTimeMs: 3000,
            source: 'continuous',
          },
        }),
      spelling.question,
    );
    await page.evaluate(
      (reviewLogId) =>
        chrome.runtime.sendMessage({
          type: 'LEARNING_CORRECT_RATING',
          reviewLogId,
          correction: 'too-easy',
        }),
      spellingResult.reviewLogId,
    );

    const contextQuestion = await page.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'LEARNING_GET_NEXT', options: { allowSpelling: true } }),
    );
    expect(contextQuestion.kind).toBe('question');
    expect(contextQuestion.question.type).toBe('context-choice');
    expect(contextQuestion.question.options[contextQuestion.question.correctIndex]).toBe('find');
    await page.evaluate(
      (question) =>
        chrome.runtime.sendMessage({
          type: 'LEARNING_SUBMIT_ANSWER',
          submission: {
            question,
            selectedIndex: question.correctIndex,
            responseTimeMs: 3000,
            source: 'continuous',
          },
        }),
      contextQuestion.question,
    );
    const backup = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'EXPORT_DATA' }));
    const card = backup.data.cards.find((item: { wordId: string }) => item.wordId === 'w-find');
    expect(card.stage).toBe('long-term');
    await page.close();
  });

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
        dictionaryVersion: manifest.dictionaryVersion,
        effectiveWords: manifest.counts.effectiveWords,
        words: words.length,
        questions: questions.length,
      };
    });
    expect(delivered).toMatchObject({
      schemaVersion: 1,
      dictionaryVersion: '1',
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
    const databaseVersion = await page.evaluate(async (id) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('bingeup');
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
      return db.version;
    }, wordId);
    expect(databaseVersion).toBe(1);
    const next = await page.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'LEARNING_GET_NEXT' }),
    );
    expect(next.kind).toBe('question');

    const result = await page.evaluate(
      (question) =>
        chrome.runtime.sendMessage({
          type: 'LEARNING_SUBMIT_ANSWER',
          submission: { question, selectedIndex: 0, responseTimeMs: 1200, source: 'manual' },
        }),
      next.question,
    );
    expect(result.reviewLogId).toBeTruthy();
    expect(result.nextReviewAt).toBeGreaterThan(Date.now());

    const backup = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'EXPORT_DATA' }));
    expect(backup.version).toBe(1);
    expect(backup.data.reviewLogs[0]).toMatchObject({
      stageAtSubmission: 'short-term',
      source: 'manual',
    });
    const restored = await page.evaluate(
      (payload) => chrome.runtime.sendMessage({ type: 'IMPORT_DATA', payload }),
      backup,
    );
    expect(restored).toMatchObject({ ok: true, errors: [] });
    expect(errors).toEqual([]);

    await context.setOffline(false);
    await page.close();
  });
});
