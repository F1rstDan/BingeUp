import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, idbGetAll, STORES, DATABASE_NAME } from '@/storage/database';
import type { ExtensionMessage } from '@/messaging/messages';
import type { CardRecord, LearningItem, ReviewLogRecord, SubmissionResult } from '@/types';
import { dictionaryFetch } from '../../helpers/dictionary-fetch';

vi.mock('@/sites/custom-content-script', () => ({
  syncCustomContentScripts: vi.fn().mockResolvedValue(undefined),
  registerCustomContentScript: vi.fn().mockResolvedValue(undefined),
  unregisterCustomContentScript: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/dev-tools/background-handler', () => ({
  isDevExtensionMessage: () => false,
  handleDevExtensionMessage: vi.fn(),
}));

type MessageListener = (
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
  respond: (response: unknown) => void,
) => boolean;

describe('background 入口 — 共享持久化上下文', () => {
  let listener: MessageListener;
  let now: number;

  const send = <T = unknown>(message: ExtensionMessage): Promise<T> =>
    new Promise((resolve) => {
      expect(listener(message, {}, (response) => resolve(response as T))).toBe(true);
    });

  beforeEach(async () => {
    now = Date.UTC(2026, 9, 22, 12);
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const values: Record<string, unknown> = {};
    vi.stubGlobal('defineBackground', (initialize: () => void) => initialize);
    vi.stubGlobal('chrome', {
      runtime: {
        getURL: (path: string) => `chrome-extension://test/${path}`,
        onMessage: {
          addListener: (handler: MessageListener) => {
            listener = handler;
          },
        },
        onInstalled: { addListener: vi.fn() },
      },
      storage: {
        local: {
          get: async (key: string) => structuredClone({ [key]: values[key] }),
          set: async (entries: Record<string, unknown>) => {
            Object.assign(values, structuredClone(entries));
          },
        },
      },
    });
    vi.stubGlobal('fetch', vi.fn(dictionaryFetch));
    const background = await import('@/entrypoints/background');
    (background.default as unknown as () => void)();
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DATABASE_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('并发消息只建立一份网站基线', async () => {
    await Promise.all(Array.from({ length: 10 }, () => send({ type: 'COOLDOWN_GET_STATUS' })));
    const db = await openDatabase(DATABASE_NAME);
    try {
      const events = await idbGetAll(db, STORES.behaviorEvents);
      expect(events).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  it('不同消息共享冷却写入锁，不丢失连续跳过计数', async () => {
    await send({ type: 'COOLDOWN_GET_STATUS' });

    await Promise.all([
      send({ type: 'COOLDOWN_SKIP_QUESTION' }),
      send({ type: 'COOLDOWN_SKIP_QUESTION' }),
    ]);

    expect(await send({ type: 'COOLDOWN_GET_STATUS' })).toMatchObject({
      consecutiveSkipCount: 2,
    });
  });

  it('同一题的并发提交只写一条日志并推进一次学习状态', async () => {
    await send({ type: 'LEARNING_ACCEPT_NEW_WORD', wordId: 'w-abandon' });
    now += 10 * 60_000;
    const item = await send<LearningItem>({ type: 'LEARNING_GET_NEXT' });
    if (item.kind !== 'question') throw new Error('应先生成短期学习题');
    const message: ExtensionMessage = {
      type: 'LEARNING_SUBMIT_ANSWER',
      submission: {
        question: item.question,
        selectedIndex: item.question.correctIndex,
        responseTimeMs: 3_000,
        source: 'natural',
      },
    };

    const [first, second] = await Promise.all([
      send<SubmissionResult>(message),
      send<SubmissionResult>(message),
    ]);

    expect(second.reviewLogId).toBe(first.reviewLogId);
    // 第一条完成后才到达的重复消息也必须命中同一个幂等结果。
    const duplicate = await send<SubmissionResult>(message);
    expect(duplicate.reviewLogId).toBe(first.reviewLogId);
    const db = await openDatabase(DATABASE_NAME);
    try {
      expect(await idbGetAll<ReviewLogRecord>(db, STORES.reviewLogs)).toHaveLength(1);
      expect(await idbGetAll<CardRecord>(db, STORES.cards)).toMatchObject([
        { stage: 'short-term', shortTermStep: 1 },
      ]);
    } finally {
      db.close();
    }
  });

  it('明确重建后，下一条学习消息使用新数据库', async () => {
    await send({ type: 'LEARNING_ACCEPT_NEW_WORD', wordId: 'w-abandon' });

    expect(await send({ type: 'REBUILD_DATABASE' })).toMatchObject({ ok: true });
    await send({ type: 'LEARNING_SELF_REPORT_KNOWN', wordId: 'w-ability' });

    const db = await openDatabase(DATABASE_NAME);
    try {
      const cards = await idbGetAll<CardRecord>(db, STORES.cards);
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({ wordId: 'w-ability', stage: 'self-reported-known' });
    } finally {
      db.close();
    }
  });
});
