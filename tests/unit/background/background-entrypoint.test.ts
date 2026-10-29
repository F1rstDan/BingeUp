import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, idbDelete, idbGetAll, STORES, DATABASE_NAME } from '@/storage/database';
import type { ExtensionMessage, ResultWithBackupWarning } from '@/messaging/messages';
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
import { DEFAULT_SETTINGS } from '@/settings/defaults';
import {
  RECOVERY_PENDING_OPERATION_KEY,
  clearStorageIsolation,
  saveRecoverySnapshot,
} from '@/storage/recovery-snapshot';
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
  let failSnapshotWrites: boolean;
  let failNextSetFor: string | null;

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

  function snapshotGeneration(): string {
    return (values['bingeup:recovery-snapshot'] as { generation: string }).generation;
  }

  function expectSnapshotWithoutWord(wordId: string): void {
    expect(JSON.stringify(values['bingeup:recovery-snapshot'])).not.toContain(wordId);
  }

  beforeEach(async () => {
    now = Date.UTC(2026, 9, 22, 12);
    failSnapshotWrites = false;
    failNextSetFor = null;
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
            if (failNextSetFor !== null && failNextSetFor in entries) {
              failNextSetFor = null;
              throw new Error('模拟跨存储标记写入失败');
            }
            if (failSnapshotWrites && 'bingeup:recovery-snapshot' in entries) {
              throw new Error('模拟配额不足');
            }
            Object.assign(values, structuredClone(entries));
          },
        },
      },
    });
    await clearStorageIsolation();
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

  it('答题已保存但备份失败时返回原 result 与 backupWarning', async () => {
    await send({ type: 'LEARNING_ACCEPT_NEW_WORD', wordId: 'w-abandon' });
    now += 10 * 60_000;
    const item = await send<LearningItem>({ type: 'LEARNING_GET_NEXT' });
    if (item.kind !== 'question') throw new Error('应先生成短期学习题');
    failSnapshotWrites = true;

    const response = await send<ResultWithBackupWarning<SubmissionResult>>({
      type: 'LEARNING_SUBMIT_ANSWER',
      submission: {
        question: item.question,
        selectedIndex: item.question.correctIndex,
        responseTimeMs: 3_000,
        source: 'natural',
      },
    });

    expect(response).toMatchObject({
      __bingeupEnvelope: 'result-with-backup-warning',
      result: { reviewLogId: expect.any(String), isCorrect: true },
      backupWarning: { message: expect.stringContaining('自动备份未完成') },
    });
    const db = await openDatabase(DATABASE_NAME);
    try {
      expect(await idbGetAll<ReviewLogRecord>(db, STORES.reviewLogs)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('void 创建卡备份失败使用 null 原 result，专用重试不重放创建卡', async () => {
    failSnapshotWrites = true;
    const response = await send<ResultWithBackupWarning<null>>({
      type: 'LEARNING_SELF_REPORT_KNOWN',
      wordId: 'w-ability',
    });
    expect(response).toMatchObject({
      __bingeupEnvelope: 'result-with-backup-warning',
      result: null,
      backupWarning: { message: expect.stringContaining('自动备份未完成') },
    });

    await expect(send({ type: 'RETRY_RECOVERY_SNAPSHOT' })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('自动备份仍未完成'),
    });
    failSnapshotWrites = false;
    await expect(send({ type: 'RETRY_RECOVERY_SNAPSHOT' })).resolves.toEqual({ ok: true });
    const db = await openDatabase(DATABASE_NAME);
    try {
      expect(await idbGetAll<CardRecord>(db, STORES.cards)).toHaveLength(1);
      expect(await idbGetAll<ReviewLogRecord>(db, STORES.reviewLogs)).toHaveLength(0);
    } finally {
      db.close();
    }
    expect(values['bingeup:recovery-snapshot']).toMatchObject({
      payload: { data: { cards: [{ wordId: 'w-ability' }] } },
    });
  });

  it('导入与清除的 warnings 保持结构化，不被 envelope 替换', async () => {
    await send({ type: 'LEARNING_ACCEPT_NEW_WORD', wordId: 'w-abandon' });
    const backup = await send<ExportPayload>({ type: 'EXPORT_DATA' });
    failSnapshotWrites = true;

    const imported = await send<{ ok: boolean; warnings: string[]; __bingeupEnvelope?: string }>({
      type: 'IMPORT_DATA',
      payload: backup,
    });
    expect(imported.ok).toBe(true);
    expect(imported.__bingeupEnvelope).toBeUndefined();
    expect(imported.warnings).toContain('导入已成功，但自动存档更新失败；存档仍保持隔离。');

    await expect(send({ type: 'RETRY_RECOVERY_SNAPSHOT' })).resolves.toMatchObject({
      ok: false,
    });
    expect((await send<StorageHealth>({ type: 'GET_STORAGE_HEALTH' })).status).toBe('isolated');
    expect(values[RECOVERY_PENDING_OPERATION_KEY]).toMatchObject({ operation: 'import' });

    failSnapshotWrites = false;
    await expect(send({ type: 'RETRY_RECOVERY_SNAPSHOT' })).resolves.toEqual({ ok: true });
    expect(values[RECOVERY_PENDING_OPERATION_KEY]).toBeNull();
    failSnapshotWrites = true;
    const cleared = await send<{ ok: boolean; warnings: string[]; __bingeupEnvelope?: string }>({
      type: 'CLEAR_ALL_DATA',
    });
    expect(cleared.ok).toBe(true);
    expect(cleared.__bingeupEnvelope).toBeUndefined();
    expect(cleared.warnings).toContain('自动存档清理失败；下次启动可能恢复旧数据。');
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
    const blockedWrites: ExtensionMessage[] = [
      { type: 'SITE_DISABLE', hostname: 'youtube.com' },
      { type: 'SET_APP_SETTINGS', settings: DEFAULT_SETTINGS },
      { type: 'PAUSE_TEN_MINUTES' },
      {
        type: 'ONBOARDING_COMPLETE',
        hostnames: ['bilibili.com'],
        deckId: 'deck-daily-high-frequency',
        selfRatedLevel: 'intermediate',
      },
    ];
    for (const blockedWrite of blockedWrites) {
      const response = await send<{ __bingeupErrorCode?: string }>(blockedWrite);
      expect(response.__bingeupErrorCode).toBe('STORAGE_ISOLATED');
    }
    const db = await openDatabase(DATABASE_NAME);
    try {
      expect((await new LocalSettingsStore(db).getSite('youtube.com')).enabled).toBe(true);
    } finally {
      db.close();
    }
    await expect(send({ type: 'GET_APP_SETTINGS' })).resolves.toBeDefined();
    await expect(send({ type: 'LIST_SITES' })).resolves.toEqual({ sites: [] });
    await expect(send({ type: 'COOLDOWN_GET_STATUS' })).resolves.toBeDefined();
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
    const previousGeneration = snapshotGeneration();

    const result = await send({ type: 'IMPORT_DATA', payload: oneCardBackup });

    expect(result).toMatchObject({ ok: true });
    expect(await send<StorageHealth>({ type: 'GET_STORAGE_HEALTH' })).toMatchObject({
      status: 'healthy',
      currentCounts: { cards: 1 },
    });
    expect(snapshotGeneration()).not.toBe(previousGeneration);
    expect(values['bingeup:recovery-snapshot']).toMatchObject({ tombstone: null });
    expect(values[RECOVERY_PENDING_OPERATION_KEY]).toBeNull();
    const next = await send<{ __bingeupErrorCode?: string }>({ type: 'LEARNING_GET_NEXT' });
    expect(next.__bingeupErrorCode).toBeUndefined();
  });

  it('明确清除学习进度后解除隔离，并允许继续学习', async () => {
    await send({ type: 'LEARNING_SELF_REPORT_KNOWN', wordId: 'w-ability' });
    await deleteCardByWordId('w-ability');
    await saveSnapshotAndExpectIsolation();
    const previousGeneration = snapshotGeneration();

    await send({ type: 'CLEAR_LEARNING_PROGRESS' });

    expect((await send<StorageHealth>({ type: 'GET_STORAGE_HEALTH' })).status).toBe('healthy');
    expect(snapshotGeneration()).not.toBe(previousGeneration);
    expect(values['bingeup:recovery-snapshot']).toMatchObject({
      tombstone: { kind: 'clear-learning-progress' },
      previous: null,
    });
    expect(values[RECOVERY_PENDING_OPERATION_KEY]).toBeNull();
    expectSnapshotWithoutWord('w-ability');
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
    const previousGeneration = snapshotGeneration();

    expect(await send({ type: 'CLEAR_ALL_DATA' })).toMatchObject({ ok: true });

    expect((await send<StorageHealth>({ type: 'GET_STORAGE_HEALTH' })).status).toBe('healthy');
    expect(snapshotGeneration()).not.toBe(previousGeneration);
    expect(values['bingeup:recovery-snapshot']).toMatchObject({
      tombstone: { kind: 'clear-all' },
      previous: null,
    });
    expect(values[RECOVERY_PENDING_OPERATION_KEY]).toBeNull();
    expectSnapshotWithoutWord('w-abandon');
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
    const previousGeneration = snapshotGeneration();

    expect(await send({ type: 'REBUILD_DATABASE' })).toMatchObject({ ok: true });

    expect((await send<StorageHealth>({ type: 'GET_STORAGE_HEALTH' })).status).toBe('healthy');
    expect(snapshotGeneration()).not.toBe(previousGeneration);
    expect(values['bingeup:recovery-snapshot']).toMatchObject({
      tombstone: { kind: 'rebuild' },
      previous: null,
    });
    expect(values[RECOVERY_PENDING_OPERATION_KEY]).toBeNull();
    expectSnapshotWithoutWord('w-abandon');
    const accepted = await send<{ __bingeupErrorCode?: string } | undefined>({
      type: 'LEARNING_SELF_REPORT_KNOWN',
      wordId: 'w-ability',
    });
    expect(accepted?.__bingeupErrorCode).toBeUndefined();
  });

  it('pending 标记写入失败时不执行破坏性操作', async () => {
    await send({ type: 'LEARNING_ACCEPT_NEW_WORD', wordId: 'w-abandon' });
    failNextSetFor = RECOVERY_PENDING_OPERATION_KEY;

    const blocked = await send<{ __bingeupErrorCode?: string }>({ type: 'CLEAR_ALL_DATA' });

    expect(blocked.__bingeupErrorCode).toBe('STORAGE_PENDING_WRITE_FAILED');
    const db = await openDatabase(DATABASE_NAME);
    try {
      expect(await idbGetAll<CardRecord>(db, STORES.cards)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('并发破坏性操作只有取得 pending 的一份执行', async () => {
    const originalSet = chrome.storage.local.set;
    let releaseSnapshot!: () => void;
    let markSnapshotStarted!: () => void;
    let holdingSnapshot = false;
    const snapshotGate = new Promise<void>((resolve) => {
      releaseSnapshot = resolve;
    });
    const snapshotStarted = new Promise<void>((resolve) => {
      markSnapshotStarted = resolve;
    });
    vi.spyOn(chrome.storage.local, 'set').mockImplementation(async (entries) => {
      if (!holdingSnapshot && 'bingeup:recovery-snapshot' in entries) {
        holdingSnapshot = true;
        markSnapshotStarted();
        await snapshotGate;
      }
      await originalSet(entries);
    });

    const clearing = send<{ ok: boolean }>({ type: 'CLEAR_ALL_DATA' });
    await snapshotStarted;
    const blocked = await send<{ __bingeupErrorCode?: string }>({
      type: 'CLEAR_LEARNING_PROGRESS',
    });

    expect(blocked.__bingeupErrorCode).toBe('STORAGE_OPERATION_IN_PROGRESS');
    releaseSnapshot();
    await expect(clearing).resolves.toMatchObject({ ok: true });
    expect(values[RECOVERY_PENDING_OPERATION_KEY]).toBeNull();
  });
});
