import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, idbDelete, idbGetAll, STORES, DATABASE_NAME } from '@/storage/database';
import type { ExtensionMessage } from '@/messaging/messages';
import type {
  CardRecord,
  LearningItem,
  ReviewLogRecord,
  StorageDiagnostics,
  StorageHealth,
  SubmissionResult,
} from '@/types';
import type { ExportPayload } from '@/storage/data-transfer';
import { LocalSettingsStore } from '@/storage/local-settings';
import { saveRecoverySnapshot } from '@/storage/recovery-snapshot';
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
  let values: Record<string, unknown>;

  const send = <T = unknown>(message: ExtensionMessage): Promise<T> =>
    new Promise((resolve) => {
      expect(listener(message, {}, (response) => resolve(response as T))).toBe(true);
    });

  async function deleteCardByWordId(wordId: string): Promise<void> {
    const db = await openDatabase(DATABASE_NAME);
    try {
      const cards = await idbGetAll<CardRecord>(db, STORES.cards);
      const card = cards.find((candidate) => candidate.wordId === wordId);
      if (!card) throw new Error(`找不到学习卡：${wordId}`);
      await idbDelete(db, STORES.cards, card.id);
    } finally {
      db.close();
    }
  }

  async function saveSnapshotAndExpectIsolation(): Promise<void> {
    const db = await openDatabase(DATABASE_NAME);
    try {
      expect(await saveRecoverySnapshot(new LocalSettingsStore(db))).toBe(false);
    } finally {
      db.close();
    }
  }

  beforeEach(async () => {
    now = Date.UTC(2026, 9, 22, 12);
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    values = {};
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
          get: async (keys: string | string[]) => {
            const list = Array.isArray(keys) ? keys : [keys];
            return structuredClone(Object.fromEntries(list.map((key) => [key, values[key]])));
          },
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

  it('学习数据写入后同步刷新自动恢复快照', async () => {
    await send({ type: 'LEARNING_ACCEPT_NEW_WORD', wordId: 'w-abandon' });

    const stored = await chrome.storage.local.get('bingeup:recovery-snapshot');
    const snapshot = stored['bingeup:recovery-snapshot'] as {
      payload: { data: { cards: { wordId: string }[] } };
    };
    expect(snapshot.payload.data.cards.some((card) => card.wordId === 'w-abandon')).toBe(true);
  });

  it('返回启动读取、当前计数和快照的诊断信息', async () => {
    await send({ type: 'LEARNING_ACCEPT_NEW_WORD', wordId: 'w-abandon' });

    const diagnostics = await send<StorageDiagnostics>({ type: 'GET_STORAGE_DIAGNOSTICS' });
    expect(diagnostics.startup?.readAt).toEqual(expect.any(Number));
    expect(diagnostics.current?.counts.cards).toBe(1);
    expect(diagnostics.snapshot.present).toBe(true);
    expect(diagnostics.snapshot.counts?.cards).toBe(1);
    expect(diagnostics.history.length).toBeGreaterThan(0);
  });

  it('通过独立消息返回存档健康状态', async () => {
    await send({ type: 'LEARNING_ACCEPT_NEW_WORD', wordId: 'w-abandon' });

    const health = await send<StorageHealth>({ type: 'GET_STORAGE_HEALTH' });

    expect(health).toMatchObject({ status: 'healthy', issues: [] });
    expect(health.currentCounts.cards).toBe(1);
  });

  it('自报认识会写入学习卡并记录最近自报单词', async () => {
    await send({ type: 'LEARNING_SELF_REPORT_KNOWN', wordId: 'w-ability' });

    const diagnostics = await send<StorageDiagnostics>({ type: 'GET_STORAGE_DIAGNOSTICS' });
    expect(diagnostics.current?.cardStages?.selfReported).toBe(1);
    expect(diagnostics.startup?.lastSelfReportWordId).toBe('w-ability');
    expect(diagnostics.startup?.lastSelfReportAt).toEqual(expect.any(Number));
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

  it('部分丢失时隔离并阻止学习，仍允许导出和诊断', async () => {
    await send({ type: 'LEARNING_ACCEPT_NEW_WORD', wordId: 'w-abandon' });
    await send({ type: 'LEARNING_ACCEPT_NEW_WORD', wordId: 'w-ability' });
    await deleteCardByWordId('w-abandon');
    await saveSnapshotAndExpectIsolation();

    const health = await send<StorageHealth>({ type: 'GET_STORAGE_HEALTH' });
    expect(health.status).toBe('isolated');
    const blocked = await send<{ __bingeupErrorCode?: string }>({ type: 'LEARNING_GET_NEXT' });
    expect(blocked.__bingeupErrorCode).toBe('STORAGE_ISOLATED');
    const exported = await send<ExportPayload>({ type: 'EXPORT_DATA' });
    expect(exported.data.cards).toHaveLength(1);
    expect(
      (await send<StorageDiagnostics>({ type: 'GET_STORAGE_DIAGNOSTICS' })).current?.counts,
    ).toMatchObject({ cards: 1 });
  });

  it('合法导入少于旧快照的卡后解除隔离，并允许继续学习', async () => {
    await send({ type: 'LEARNING_ACCEPT_NEW_WORD', wordId: 'w-abandon' });
    const oneCardBackup = await send<ExportPayload>({ type: 'EXPORT_DATA' });
    await send({ type: 'LEARNING_ACCEPT_NEW_WORD', wordId: 'w-ability' });
    await deleteCardByWordId('w-abandon');
    await saveSnapshotAndExpectIsolation();

    const result = await send({ type: 'IMPORT_DATA', payload: oneCardBackup });

    expect(result).toMatchObject({ ok: true });
    expect(await send<StorageHealth>({ type: 'GET_STORAGE_HEALTH' })).toMatchObject({
      status: 'healthy',
      currentCounts: { cards: 1 },
    });
    const next = await send<{ __bingeupErrorCode?: string }>({ type: 'LEARNING_GET_NEXT' });
    expect(next.__bingeupErrorCode).toBeUndefined();
  });

  it('明确清除学习进度后解除隔离，并允许继续学习', async () => {
    await send({ type: 'LEARNING_SELF_REPORT_KNOWN', wordId: 'w-ability' });
    await deleteCardByWordId('w-ability');
    await saveSnapshotAndExpectIsolation();

    await send({ type: 'CLEAR_LEARNING_PROGRESS' });

    expect((await send<StorageHealth>({ type: 'GET_STORAGE_HEALTH' })).status).toBe('healthy');
    const accepted = await send<{ __bingeupErrorCode?: string } | undefined>({
      type: 'LEARNING_ACCEPT_NEW_WORD',
      wordId: 'w-abandon',
    });
    expect(accepted?.__bingeupErrorCode).toBeUndefined();
  });

  it('明确清除全部数据后解除隔离，并允许继续学习', async () => {
    await send({ type: 'LEARNING_ACCEPT_NEW_WORD', wordId: 'w-abandon' });
    await deleteCardByWordId('w-abandon');
    await saveSnapshotAndExpectIsolation();

    expect(await send({ type: 'CLEAR_ALL_DATA' })).toMatchObject({ ok: true });

    expect((await send<StorageHealth>({ type: 'GET_STORAGE_HEALTH' })).status).toBe('healthy');
    const accepted = await send<{ __bingeupErrorCode?: string } | undefined>({
      type: 'LEARNING_SELF_REPORT_KNOWN',
      wordId: 'w-ability',
    });
    expect(accepted?.__bingeupErrorCode).toBeUndefined();
  });

  it('明确重建数据库后解除隔离，并允许继续学习', async () => {
    await send({ type: 'LEARNING_ACCEPT_NEW_WORD', wordId: 'w-abandon' });
    await deleteCardByWordId('w-abandon');
    await saveSnapshotAndExpectIsolation();

    expect(await send({ type: 'REBUILD_DATABASE' })).toMatchObject({ ok: true });

    expect((await send<StorageHealth>({ type: 'GET_STORAGE_HEALTH' })).status).toBe('healthy');
    const accepted = await send<{ __bingeupErrorCode?: string } | undefined>({
      type: 'LEARNING_SELF_REPORT_KNOWN',
      wordId: 'w-ability',
    });
    expect(accepted?.__bingeupErrorCode).toBeUndefined();
  });
});
