import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuiltInWordBank } from '@/dictionary/built-in-word-bank';
import { DEFAULT_SETTINGS } from '@/settings/defaults';
import {
  clearAllLocalData,
  clearLearningProgress,
  exportLocalData,
  importLocalData,
  type ExportPayload,
} from '@/storage/data-transfer';
import { STORES, idbGetAll, idbPut, openDatabase, readStorageMeta } from '@/storage/database';
import { LocalSettingsStore } from '@/storage/local-settings';
import type {
  BehaviorEventRecord,
  CardRecord,
  DeckRecord,
  ReviewLogRecord,
  SessionLogRecord,
  WordRecord,
} from '@/types';

const TEST_DB = 'test-data-transfer';

function word(id: string, wordText: string, frequencyRank: number): WordRecord {
  return {
    id,
    word: wordText,
    lemma: wordText,
    partOfSpeech: ['n.'],
    coreMeaningZh: [wordText],
    difficulty: 2,
    frequencyRank,
    source: 'test',
    license: 'test',
  };
}

const BUILT_IN_WORDS = [
  word('w-high', 'high', 1),
  word('w-help', 'help', 2),
  word('w-three', 'three', 3),
  word('w-cet4-only', 'cet4', 4),
  word('w-cet6-only', 'cet6', 5),
  word('w-reservoir', 'reservoir', 6),
];

function deck(id: string, wordIds: string[]): DeckRecord {
  return { id, name: id, source: 'test', license: 'test', wordIds };
}

const BUILT_IN_DECKS = [
  deck('deck-daily-high-frequency', ['w-high', 'w-help', 'w-three']),
  deck('deck-cet4', ['w-cet4-only', 'w-reservoir']),
  deck('deck-cet6', ['w-cet6-only', 'w-reservoir']),
];

const CARD: CardRecord = {
  id: 'card-1',
  wordId: 'w-high',
  deckId: 'deck-daily-high-frequency',
  stage: 'short-term',
  origin: 'accepted-new',
  createdAt: 1_000,
  updatedAt: 1_000,
  nextReviewAt: 2_000,
  shortTermStep: 1,
};

const LOG: ReviewLogRecord = {
  id: 'log-1',
  cardId: CARD.id,
  wordId: CARD.wordId,
  questionType: 'en-to-zh',
  selectedAnswer: '错',
  correctAnswer: '高的',
  isCorrect: false,
  responseTimeMs: 300,
  reviewedAt: 1_500,
  stageAtSubmission: 'short-term',
  source: 'natural',
  rating: 'again',
};

const SESSION: SessionLogRecord = {
  id: 'session-1',
  startedAt: 1_000,
  endedAt: 1_600,
  mode: 'single',
  outcome: 'submitted',
  questionsAnswered: 1,
  source: 'natural',
  continuousQuestionsAnswered: 0,
};

const EVENT: BehaviorEventRecord = {
  id: 'event-1',
  kind: 'site-enabled',
  occurredAt: 900,
  hostname: 'youtube.com',
  enabled: false,
};

function payload(overrides: Partial<ExportPayload['data']> = {}): ExportPayload {
  return {
    version: 1,
    exportedAt: 2_000,
    authoritativeState: {
      appSettings: { ...DEFAULT_SETTINGS },
      sites: {},
      onboardingCompleted: true,
    },
    data: {
      cards: [{ ...CARD }],
      reviewLogs: [{ ...LOG }],
      sessionLogs: [{ ...SESSION }],
      behaviorEvents: [{ ...EVENT }],
      words: [],
      decks: [],
      ...overrides,
    },
  };
}

function installRuntimeStorageMock(): void {
  const values: Record<string, unknown> = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: values[key] })),
        set: vi.fn(async (entries: Record<string, unknown>) => Object.assign(values, entries)),
      },
    },
  });
}

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(TEST_DB);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

describe('本地用户数据备份', () => {
  let db: IDBDatabase;
  let store: LocalSettingsStore;

  beforeEach(async () => {
    installRuntimeStorageMock();
    vi.spyOn(BuiltInWordBank.prototype, 'listWords').mockResolvedValue(BUILT_IN_WORDS);
    vi.spyOn(BuiltInWordBank.prototype, 'getDeck').mockImplementation(
      async (deckId) => BUILT_IN_DECKS.find((candidate) => candidate.id === deckId) ?? null,
    );
    db = await openDatabase(TEST_DB);
    store = new LocalSettingsStore(db);
  });

  afterEach(async () => {
    db.close();
    await deleteDatabase();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function seedCurrentData(): Promise<void> {
    await store.setAppSettings({ ...DEFAULT_SETTINGS, dailyNewWordLimit: 8 });
    await store.markOnboardingCompleted();
    await Promise.all([
      idbPut(db, STORES.cards, CARD),
      idbPut(db, STORES.reviewLogs, LOG),
      idbPut(db, STORES.sessionLogs, SESSION),
      idbPut(db, STORES.behaviorEvents, EVENT),
    ]);
  }

  it('导出设置与全部用户数据，并保留 words/decks 原记录', async () => {
    const customWord = word('user-word', 'custom', 10);
    const customDeck = {
      ...deck('user-deck', [customWord.id]),
      source: 'user',
      license: 'user',
    };
    await seedCurrentData();
    await idbPut(db, STORES.words, BUILT_IN_WORDS[0]!);
    await idbPut(db, STORES.words, customWord);
    await idbPut(db, STORES.decks, BUILT_IN_DECKS[0]!);
    await idbPut(db, STORES.decks, customDeck);

    const exported = await exportLocalData(store);

    expect(exported).toMatchObject({
      version: 1,
      authoritativeState: { onboardingCompleted: true },
      data: {
        cards: [CARD],
        reviewLogs: [LOG],
        sessionLogs: [SESSION],
        behaviorEvents: [EVENT],
      },
    });
    expect(exported.data.words).toHaveLength(2);
    expect(exported.data.words).toEqual(expect.arrayContaining([BUILT_IN_WORDS[0], customWord]));
    expect(exported.data.decks).toHaveLength(2);
    expect(exported.data.decks).toEqual(expect.arrayContaining([BUILT_IN_DECKS[0], customDeck]));
    expect(Object.keys(exported).sort()).toEqual([
      'authoritativeState',
      'data',
      'exportedAt',
      'version',
    ]);
    expect(JSON.stringify(exported)).not.toContain('storageMeta');
  });

  it('拒绝无效格式且不修改现有数据', async () => {
    await seedCurrentData();
    const result = await importLocalData(store, { ...payload(), version: 99 });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('备份格式无效');
    expect(await idbGetAll(db, STORES.cards)).toEqual([CARD]);
  });

  it('拒绝未知字段和缺失的学习卡来源', async () => {
    const withUnknownFields = {
      ...payload(),
      unexpected: true,
    };
    expect((await importLocalData(store, withUnknownFields)).errors).toContain('备份包含未知字段');

    const missingOrigin = payload();
    delete (missingOrigin.data.cards[0] as Partial<CardRecord>).origin;
    expect((await importLocalData(store, missingOrigin)).errors).toContain(
      'data.cards[0] 结构非法',
    );
  });

  it('拒绝 authoritativeState 中的 id，且不覆盖当前设置', async () => {
    await seedCurrentData();
    const incoming = payload();
    (incoming.authoritativeState as unknown as Record<string, unknown>).id = 'forged';

    const result = await importLocalData(store, incoming);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('authoritativeState 包含未知字段');
    expect(await store.getAppSettings()).toMatchObject({ dailyNewWordLimit: 8 });
    expect(await idbGetAll(db, STORES.cards)).toEqual([CARD]);
  });

  it('拒绝学习卡引用不存在的词', async () => {
    const invalid = { ...CARD, wordId: 'missing-word' };
    const result = await importLocalData(store, payload({ cards: [invalid], reviewLogs: [] }));
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('data.cards[0] 引用不存在的单词：missing-word');
  });

  it('拒绝缺少判定事实的答题日志，且保留已有数据', async () => {
    await seedCurrentData();
    const incompleteLog: Partial<ReviewLogRecord> = { ...LOG };
    delete incompleteLog.stageAtSubmission;
    delete incompleteLog.source;
    delete incompleteLog.rating;

    const incoming = { ...payload(), data: { ...payload().data, reviewLogs: [incompleteLog] } };
    expect((await importLocalData(store, incoming)).errors).toContain(
      'data.reviewLogs[0] 结构非法',
    );
    expect(await idbGetAll(db, STORES.reviewLogs)).toEqual([LOG]);
  });

  it('原子替换全部用户数据并重置临时状态', async () => {
    await seedCurrentData();
    await store.setCooldown({ nextAllowedAt: 9_999, consecutiveSkipCount: 2 });
    await idbPut(db, STORES.cards, { ...CARD, id: 'obsolete', wordId: 'w-help' });
    const incoming = payload({ cards: [{ ...CARD, id: 'restored' }] });
    incoming.data.reviewLogs = [];
    const beforeImport = await readStorageMeta(db);

    expect(await importLocalData(store, incoming)).toEqual({
      ok: true,
      errors: [],
      warnings: [],
    });
    expect(await idbGetAll(db, STORES.cards)).toEqual([{ ...CARD, id: 'restored' }]);
    expect(await store.getCooldown()).toEqual({ nextAllowedAt: 0, consecutiveSkipCount: 0 });
    const afterImport = await readStorageMeta(db);
    expect(afterImport.generation).not.toBe(beforeImport.generation);
    expect(afterImport.revision).toBe(beforeImport.revision + 1);
    expect(afterImport.pendingBackup).toBe(true);
    expect(afterImport.committedAt).toBeGreaterThanOrEqual(beforeImport.committedAt);
  });

  it('事务中途失败时保留全部原数据', async () => {
    await seedCurrentData();
    const beforeImport = await readStorageMeta(db);
    const originalPut = IDBObjectStore.prototype.put;
    let putCount = 0;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args
    ) {
      putCount += 1;
      if (putCount === 2) throw new Error('模拟写入失败');
      return originalPut.apply(this, args);
    });

    const result = await importLocalData(store, payload({ cards: [], reviewLogs: [] }));
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('原有权威数据未改变');
    expect(await idbGetAll(db, STORES.cards)).toEqual([CARD]);
    expect(await idbGetAll(db, STORES.reviewLogs)).toEqual([LOG]);
    expect(await readStorageMeta(db)).toEqual(beforeImport);
  });

  it('词库读取失败时拒绝导入并保持原数据', async () => {
    await seedCurrentData();
    vi.mocked(BuiltInWordBank.prototype.listWords).mockRejectedValueOnce(new Error('模拟词库失败'));
    const result = await importLocalData(store, payload({ cards: [], reviewLogs: [] }));
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('词库加载失败');
    expect(await idbGetAll(db, STORES.cards)).toEqual([CARD]);
  });

  it('自定义单词和词库保留且引用严格校验', async () => {
    const customWord = word('user-word', 'custom', 10);
    const customDeck = { ...deck('user-deck', [customWord.id]), source: 'user', license: 'user' };
    const customCard = {
      ...CARD,
      id: 'card-custom',
      wordId: customWord.id,
      deckId: customDeck.id,
    };
    const incoming = payload({
      cards: [customCard],
      reviewLogs: [{ ...LOG, cardId: customCard.id, wordId: customCard.wordId }],
      words: [customWord],
      decks: [customDeck],
    });
    expect((await importLocalData(store, incoming)).ok).toBe(true);
    expect(await idbGetAll(db, STORES.words)).toEqual([customWord]);
    expect(await idbGetAll(db, STORES.decks)).toEqual([customDeck]);

    incoming.data.decks[0]!.wordIds = ['w-three'];
    const invalid = await importLocalData(store, incoming);
    expect(invalid.errors).toContain('data.cards[0] 的单词不属于引用的词库');
  });

  it('清除学习进度保留设置；清除全部数据回到默认状态', async () => {
    await seedCurrentData();
    const beforeClearProgress = await readStorageMeta(db);
    await clearLearningProgress(db);
    expect(await idbGetAll(db, STORES.cards)).toEqual([]);
    expect(await idbGetAll(db, STORES.reviewLogs)).toEqual([]);
    expect(await idbGetAll(db, STORES.sessionLogs)).toEqual([]);
    expect(await idbGetAll(db, STORES.behaviorEvents)).toEqual([]);
    expect(await store.getAppSettings()).toMatchObject({ dailyNewWordLimit: 8 });

    const afterClearProgress = await readStorageMeta(db);
    expect(afterClearProgress.generation).not.toBe(beforeClearProgress.generation);
    expect(afterClearProgress.revision).toBe(beforeClearProgress.revision + 1);
    expect(afterClearProgress.pendingBackup).toBe(true);

    expect(await clearAllLocalData(store)).toEqual({ ok: true, errors: [], warnings: [] });
    expect(await store.getAppSettings()).toEqual(DEFAULT_SETTINGS);
    expect(await idbGetAll(db, STORES.cards)).toEqual([]);
    const afterClearAll = await readStorageMeta(db);
    expect(afterClearAll.generation).not.toBe(afterClearProgress.generation);
    expect(afterClearAll.revision).toBe(afterClearProgress.revision + 1);
    expect(afterClearAll.pendingBackup).toBe(true);
  });
});
