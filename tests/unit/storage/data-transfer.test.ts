import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, idbPut, idbGetAll, STORES, type Migration } from '@/storage/database';
import { MIGRATIONS } from '@/storage/migrations';
import { LocalSettingsStore } from '@/storage/local-settings';
import {
  exportLocalData,
  importLocalData,
  clearLearningProgress,
  clearAllLocalData,
  type ExportPayload,
} from '@/storage/data-transfer';
import type { CardRecord, ReviewLogRecord, SessionLogRecord } from '@/types';

const TEST_DB = 'test-bingeup-data-transfer';

async function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

function installChromeStorageMock() {
  const store: Record<string, unknown> = {};
  const chromeStub = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: store[key] })),
        set: vi.fn(async (entries: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(entries)) {
            store[k] = v;
          }
        }),
        remove: vi.fn(async (key: string) => {
          delete store[key];
        }),
      },
    },
  };
  (globalThis as unknown as { chrome: typeof chromeStub }).chrome = chromeStub;
  return chromeStub;
}

const CARD: CardRecord = {
  id: 'card-1',
  wordId: 'w-abandon',
  deckId: 'deck-daily-high-frequency',
  stage: 'short-term',
  createdAt: 1_000_000,
  updatedAt: 1_000_000,
  nextReviewAt: 1_600_000,
};

const LOG: ReviewLogRecord = {
  id: 'log-1',
  cardId: 'card-1',
  wordId: 'w-abandon',
  questionType: 'en-to-zh',
  selectedAnswer: '建造',
  correctAnswer: '放弃；遗弃',
  isCorrect: false,
  responseTimeMs: 3_000,
  reviewedAt: 1_200_000,
};

const SESSION: SessionLogRecord = {
  id: 'session-1',
  startedAt: 1_000_000,
  endedAt: 1_300_000,
  mode: 'continuous',
  outcome: 'submitted',
  questionsAnswered: 2,
};

describe('data-transfer — Issue #10 AC4 导出/导入/清除', () => {
  let db: IDBDatabase;
  let store: LocalSettingsStore;

  beforeEach(async () => {
    installChromeStorageMock();
    db = await openDatabase(TEST_DB, MIGRATIONS);
    store = new LocalSettingsStore();
  });

  afterEach(async () => {
    db.close();
    await deleteDatabase(TEST_DB);
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it('导出包含设置、站点、冷却与 IDB 全部记录（可恢复）', async () => {
    await store.setAppSettings({
      ...(
        await import('@/settings/defaults')
      ).DEFAULT_SETTINGS,
      dailyNewWordLimit: 8,
    });
    await store.enableSite('bilibili.com');
    await store.setCooldown({ nextAllowedAt: 9_999, consecutiveSkipCount: 1 });
    await idbPut(db, STORES.cards, CARD);
    await idbPut(db, STORES.reviewLogs, LOG);
    await idbPut(db, STORES.sessionLogs, SESSION);

    const payload = await exportLocalData(store, db);

    expect(payload.version).toBe(2);
    expect(payload.settings.appSettings.dailyNewWordLimit).toBe(8);
    expect(payload.settings.sites['bilibili.com']!.enabled).toBe(true);
    expect(payload.settings.cooldown.nextAllowedAt).toBe(9_999);
    expect(payload.data.cards).toHaveLength(1);
    expect(payload.data.cards[0]!.id).toBe('card-1');
    expect(payload.data.reviewLogs).toHaveLength(1);
    expect(payload.data.sessionLogs).toEqual([SESSION]);
    expect(payload.data.words).toBeDefined();
    expect(payload.data.decks).toBeDefined();
  });

  it('旧版合法备份通过明确迁移路径导入，缺少的学习会话按空数组迁移', async () => {
    const current = await exportLocalData(store, db);
    const legacy = {
      ...current,
      version: 1,
      data: {
        cards: current.data.cards,
        reviewLogs: current.data.reviewLogs,
        words: current.data.words,
        decks: current.data.decks,
      },
    };

    const result = await importLocalData(store, db, legacy);

    expect(result).toEqual({ ok: true, errors: [] });
    expect(await idbGetAll(db, STORES.sessionLogs)).toEqual([]);
  });

  it('不支持的备份版本返回可理解错误', async () => {
    const result = await importLocalData(store, db, { version: 99 });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('不支持的备份版本：99（支持版本：1、2）');
  });

  it.each([
    ['学习卡', 'cards', { ...CARD, stage: 'unknown' }],
    ['复习日志', 'reviewLogs', { ...LOG, responseTimeMs: -1 }],
    ['学习会话', 'sessionLogs', { ...SESSION, endedAt: 999_999 }],
    ['单词', 'words', { id: 'bad-word' }],
    ['词库', 'decks', { id: 'bad-deck', wordIds: 'bad' }],
  ])('导入逐条拒绝无效%s实体', async (_label, collection, invalidEntity) => {
    const payload = await exportLocalData(store, db);
    (payload.data[collection as keyof typeof payload.data] as unknown[]).push(invalidEntity);

    const result = await importLocalData(store, db, payload);

    expect(result.ok).toBe(false);
    expect(result.errors.join('；')).toContain(`data.${collection}[0]`);
  });

  it('导入拒绝损坏的学习卡、复习日志和词库引用', async () => {
    const payload = await exportLocalData(store, db);
    payload.data.cards.push({ ...CARD, wordId: 'missing-word' });
    payload.data.reviewLogs.push({ ...LOG, cardId: 'missing-card' });

    const result = await importLocalData(store, db, payload);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('引用不存在的单词'),
      expect.stringContaining('引用不存在的学习卡'),
    ]));
  });

  it('提交中设置写入失败后原有设置与数据库内容保持不变', async () => {
    await store.enableSite('bilibili.com');
    await idbPut(db, STORES.cards, CARD);
    const payload = await exportLocalData(store, db);
    payload.settings.sites = {};
    payload.data.cards = [];
    vi.spyOn(store, 'write').mockRejectedValueOnce(new Error('模拟设置写入失败'));

    const result = await importLocalData(store, db, payload);

    expect(result.ok).toBe(false);
    expect((await store.listSites()).map((entry) => entry.hostname)).toContain('bilibili.com');
    expect(await idbGetAll<CardRecord>(db, STORES.cards)).toEqual([CARD]);
  });

  it('数据库事务启动失败时回滚已写入的设置并保留原数据库内容', async () => {
    await store.enableSite('bilibili.com');
    await idbPut(db, STORES.cards, CARD);
    const payload = await exportLocalData(store, db);
    payload.settings.sites = {};
    payload.data.cards = [];
    const transaction = db.transaction.bind(db);
    vi.spyOn(db, 'transaction').mockImplementationOnce(() => {
      throw new Error('模拟事务失败');
    });

    const result = await importLocalData(store, db, payload);

    vi.mocked(db.transaction).mockImplementation(transaction);
    expect(result.ok).toBe(false);
    expect((await store.listSites()).map((entry) => entry.hostname)).toContain('bilibili.com');
    expect(await idbGetAll<CardRecord>(db, STORES.cards)).toEqual([CARD]);
  });

  it('导入先校验再写入：合法 payload 写入后可恢复全部数据', async () => {
    // 准备一份合法 payload。
    const sourceStore = new LocalSettingsStore();
    await sourceStore.enableSite('youtube.com');
    await idbPut(db, STORES.cards, CARD);
    await idbPut(db, STORES.reviewLogs, LOG);
    await idbPut(db, STORES.sessionLogs, SESSION);
    const payload = await exportLocalData(sourceStore, db);

    // 清空目标环境，再导入。
    await clearAllLocalData(store, db);
    const result = await importLocalData(store, db, payload);

    expect(result.ok).toBe(true);
    const sites = await store.listSites();
    expect(sites.find((s) => s.hostname === 'youtube.com')?.settings.enabled).toBe(true);
    const cards = await idbGetAll<CardRecord>(db, STORES.cards);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.id).toBe('card-1');
  });

  it('导入非法 payload（结构错误）拒绝写入并返回错误', async () => {
    const bad = { version: 999, settings: {}, data: {} } as unknown as ExportPayload;
    const result = await importLocalData(store, db, bad);

    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    // 目标环境未被污染。
    const cards = await idbGetAll<CardRecord>(db, STORES.cards);
    expect(cards).toHaveLength(0);
  });

  it('导入缺字段的 payload 被拒绝（校验先于写入）', async () => {
    const payload: ExportPayload = {
      version: 1,
      settings: { cooldown: { nextAllowedAt: 0, consecutiveSkipCount: 0 }, sites: {} },
      data: { cards: [CARD], reviewLogs: [], words: [], decks: [] },
      // 缺少 appSettings / globalPausedUntil / onboardingCompleted 等字段
    } as unknown as ExportPayload;
    const result = await importLocalData(store, db, payload);
    expect(result.ok).toBe(false);
  });

  it('clearLearningProgress 只清除 cards 与 reviewLogs，保留设置与词库', async () => {
    await idbPut(db, STORES.cards, CARD);
    await idbPut(db, STORES.reviewLogs, LOG);
    await store.enableSite('bilibili.com');

    await clearLearningProgress(db);

    expect(await idbGetAll<CardRecord>(db, STORES.cards)).toHaveLength(0);
    expect(await idbGetAll<ReviewLogRecord>(db, STORES.reviewLogs)).toHaveLength(0);
    expect(await idbGetAll<SessionLogRecord>(db, STORES.sessionLogs)).toHaveLength(0);
    const sites = await store.listSites();
    expect(sites.find((s) => s.hostname === 'bilibili.com')).toBeDefined();
  });

  it('clearAllLocalData 清除 IDB 全部仓库与 chrome.storage 状态', async () => {
    await idbPut(db, STORES.cards, CARD);
    await idbPut(db, STORES.reviewLogs, LOG);
    await store.enableSite('bilibili.com');
    await store.markOnboardingCompleted();

    await clearAllLocalData(store, db);

    expect(await idbGetAll<CardRecord>(db, STORES.cards)).toHaveLength(0);
    expect(await idbGetAll<ReviewLogRecord>(db, STORES.reviewLogs)).toHaveLength(0);
    await expect(store.isOnboardingCompleted()).resolves.toBe(false);
    await expect(store.listSites()).resolves.toHaveLength(0);
  });
});
