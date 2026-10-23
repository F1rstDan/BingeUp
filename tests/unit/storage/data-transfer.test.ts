import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, idbGetAll, idbPut, STORES } from '@/storage/database';
import { MIGRATIONS } from '@/storage/migrations';
import { LocalSettingsStore } from '@/storage/local-settings';
import { DEFAULT_SETTINGS } from '@/settings/defaults';
import { BuiltInWordBank } from '@/dictionary/built-in-word-bank';
import { StatsService } from '@/stats/stats-service';
import {
  clearAllLocalData,
  clearLearningProgress,
  exportLocalData,
  importLocalData,
  type ExportPayload,
} from '@/storage/data-transfer';
import type {
  BehaviorEventRecord,
  CardRecord,
  DeckRecord,
  ReviewLogRecord,
  SessionLogRecord,
  WordRecord,
} from '@/types';

const DICTIONARY_WORDS_JSON = readFileSync('public/dictionaries/words.json', 'utf8');
const DICTIONARY_DECKS_JSON = readFileSync('public/dictionaries/decks.json', 'utf8');

const TEST_DB = 'test-issue-18-data-lifecycle';
const CARD: CardRecord = {
  id: 'card-1',
  wordId: 'w-high',
  deckId: 'deck-daily-high-frequency',
  stage: 'short-term',
  createdAt: 1_000,
  updatedAt: 1_000,
  nextReviewAt: 2_000,
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
};
const SESSION: SessionLogRecord = {
  id: 'session-1',
  startedAt: 1_000,
  endedAt: 1_600,
  mode: 'single',
  outcome: 'submitted',
  questionsAnswered: 1,
};
const BEHAVIOR_EVENT: BehaviorEventRecord = {
  id: 'event-1',
  kind: 'site-enabled',
  occurredAt: 900,
  hostname: 'youtube.com',
  enabled: false,
};

function installRuntimeStorageMock() {
  const values: Record<string, unknown> = {};
  let failNextWrite = false;
  const chromeStub = {
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: values[key] })),
        set: vi.fn(async (entries: Record<string, unknown>) => {
          if (failNextWrite) {
            failNextWrite = false;
            throw new Error('模拟临时状态写入失败');
          }
          Object.assign(values, entries);
        }),
      },
    },
  };
  (globalThis as unknown as { chrome: typeof chromeStub }).chrome = chromeStub;
  return {
    values,
    failOnce: () => {
      failNextWrite = true;
    },
  };
}

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(TEST_DB);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
  });
}

describe('本地用户数据生命周期 — Issue #18', () => {
  let db: IDBDatabase;
  let store: LocalSettingsStore;
  let runtime: ReturnType<typeof installRuntimeStorageMock>;
  let words: BuiltInWordBank;

  beforeEach(async () => {
    runtime = installRuntimeStorageMock();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/words.json')) return new Response(DICTIONARY_WORDS_JSON);
        if (url.endsWith('/decks.json')) return new Response(DICTIONARY_DECKS_JSON);
        throw new Error(`未预期的词库请求：${url}`);
      }),
    );
    words = new BuiltInWordBank();
    db = await openDatabase(TEST_DB, MIGRATIONS);
    store = new LocalSettingsStore(db);
  });
  afterEach(async () => {
    db.close();
    await deleteDatabase();
    delete (globalThis as { chrome?: unknown }).chrome;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function populatedBackup(): Promise<ExportPayload> {
    await store.setAppSettings({ ...DEFAULT_SETTINGS, dailyNewWordLimit: 8 });
    await store.disableSite('youtube.com');
    await store.markOnboardingCompleted();
    await Promise.all([
      idbPut(db, STORES.cards, CARD),
      idbPut(db, STORES.reviewLogs, LOG),
      idbPut(db, STORES.sessionLogs, SESSION),
      idbPut(db, STORES.behaviorEvents, BEHAVIOR_EVENT),
    ]);
    return exportLocalData(store);
  }

  it('首次公开 v1 备份包含全部权威源数据，不包含临时运行状态或内置学习内容', async () => {
    await store.setCooldown({ nextAllowedAt: 9_999, consecutiveSkipCount: 2 });
    for (const wordId of ['w-high', 'w-help', 'w-three']) {
      await idbPut(db, STORES.words, await words.getWord(wordId));
    }
    await idbPut(db, STORES.decks, await words.getDeck('deck-daily-high-frequency'));
    const payload = await populatedBackup();

    expect(payload.version).toBe(2);
    expect(payload.authoritativeState).toMatchObject({
      appSettings: { dailyNewWordLimit: 8 },
      onboardingCompleted: true,
      sites: { 'youtube.com': { enabled: false } },
    });
    expect(payload.data).toMatchObject({
      cards: [CARD],
      reviewLogs: [LOG],
      sessionLogs: [SESSION],
      behaviorEvents: [BEHAVIOR_EVENT],
      words: [],
      decks: [],
    });
    expect(JSON.stringify(payload)).not.toContain('nextAllowedAt');
    expect(payload.data.words).toEqual([]);
    expect(payload.data.decks).toEqual([]);
    expect((payload as import('@/storage/data-transfer').ExportPayloadV2).content.version).toBe(
      'legacy-v1',
    );
    expect((payload as import('@/storage/data-transfer').ExportPayloadV2).compatibility).toBeNull();
  });

  it('导入拒绝以自定义内容覆盖内置单词或词库 id', async () => {
    const payload = await populatedBackup();
    payload.data.words.push({
      ...(await words.getWord('w-high'))!,
      exampleSentence: 'The mountain is high.',
      exampleTranslation: '这座山很高。',
    });
    payload.data.decks.push((await words.getDeck('deck-daily-high-frequency'))!);
    const result = await importLocalData(store, payload);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('与内置单词 id 冲突'),
        expect.stringContaining('与内置词库 id 冲突'),
      ]),
    );
  });

  it('不支持未知版本并给出可理解错误', async () => {
    const result = await importLocalData(store, { version: 3 });
    expect(result).toEqual({
      ok: false,
      errors: ['不支持的备份版本：3（当前支持版本：1、2）'],
      warnings: [],
    });
  });

  it.each([
    [
      '站点可选字段',
      (payload: ExportPayload) => {
        payload.authoritativeState.sites['bad.test'] = {
          enabled: true,
          mode: 'basic-web',
          firstQuestionPending: true,
          pageLoadTrigger: 'yes' as never,
        };
      },
    ],
    [
      '学习卡可选字段',
      (payload: ExportPayload) => {
        payload.data.cards[0]!.schedulerState = { stability: -1 } as never;
      },
    ],
    [
      '复习日志可选字段',
      (payload: ExportPayload) => {
        payload.data.reviewLogs[0]!.rating = 'perfect' as never;
      },
    ],
    [
      '单词可选字段',
      (payload: ExportPayload) => {
        payload.data.words.push({
          id: 'custom',
          word: 'x',
          lemma: 'x',
          phonetic: 3 as never,
          partOfSpeech: ['n.'],
          coreMeaningZh: ['词'],
          exampleSentence: 'x',
          exampleTranslation: '词',
          difficulty: 1,
          frequencyRank: 1,
          source: 'user',
          license: 'user',
        });
      },
    ],
  ])('导入逐条拒绝无效%s且不修改现有数据', async (_name, corrupt) => {
    const payload = await populatedBackup();
    corrupt(payload);
    const result = await importLocalData(store, payload);
    expect(result.ok).toBe(false);
    expect(await idbGetAll<CardRecord>(db, STORES.cards)).toEqual([CARD]);
  });

  it('导入拒绝损坏的全部引用关系', async () => {
    const payload = await populatedBackup();
    payload.data.cards[0]!.wordId = 'missing-word';
    payload.data.reviewLogs[0]!.cardId = 'missing-card';
    const result = await importLocalData(store, payload);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('引用不存在的单词'),
        expect.stringContaining('引用不存在的学习卡'),
      ]),
    );
  });

  it.each(['学习卡词库', '词库成员', '当前词库'])('导入仍拒绝非法%s引用', async (kind) => {
    const payload = await populatedBackup();
    if (kind === '学习卡词库') payload.data.cards[0]!.deckId = 'missing-deck';
    if (kind === '词库成员') {
      const deck = (await words.getDeck(CARD.deckId))!;
      const outsideWord = (await words.listWords()).find(
        (word) => !deck.wordIds.includes(word.id),
      )!;
      payload.data.cards[0]!.wordId = outsideWord.id;
      payload.data.reviewLogs[0]!.wordId = outsideWord.id;
    }
    if (kind === '当前词库') {
      payload.authoritativeState.appSettings.selectedDeckId = 'missing-deck';
    }

    const result = await importLocalData(store, payload);

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain(kind === '词库成员' ? '不属于' : '不存在的词库');
    expect(await idbGetAll<CardRecord>(db, STORES.cards)).toEqual([CARD]);
  });

  it('实际词库的 high/help/three 和自报认识卡均能完整恢复', async () => {
    const payload = await populatedBackup();
    payload.data.cards = [
      CARD,
      { ...CARD, id: 'card-help', wordId: 'w-help' },
      { ...CARD, id: 'card-three', wordId: 'w-three' },
      {
        ...CARD,
        id: 'card-known',
        wordId: 'w-benefit',
        origin: 'self-reported',
        stage: 'self-reported-known',
        nextReviewAt: 86_401_000,
      },
    ];

    const result = await importLocalData(store, payload);

    expect(result).toEqual({ ok: true, errors: [], warnings: [] });
    expect(await idbGetAll<CardRecord>(db, STORES.cards)).toEqual(
      expect.arrayContaining(payload.data.cards),
    );
    expect(await idbGetAll<CardRecord>(db, STORES.cards)).toHaveLength(4);
    expect(await idbGetAll<ReviewLogRecord>(db, STORES.reviewLogs)).toEqual(
      payload.data.reviewLogs,
    );
  });

  it('导出仅过滤实际内置内容，自定义单词和词库仍能恢复', async () => {
    const customWord: WordRecord = {
      ...(await words.getWord('w-high'))!,
      id: 'user-word',
      exampleSentence: 'The mountain is high.',
      exampleTranslation: '这座山很高。',
      source: 'user',
    };
    const customDeck: DeckRecord = {
      id: 'user-deck',
      name: '用户词库',
      source: 'user',
      license: 'user',
      wordIds: [customWord.id],
    };
    await idbPut(db, STORES.words, await words.getWord('w-help'));
    await idbPut(db, STORES.words, customWord);
    await idbPut(db, STORES.decks, await words.getDeck('deck-cet4'));
    await idbPut(db, STORES.decks, customDeck);
    const payload = await populatedBackup();

    expect(payload.data.words).toEqual([customWord]);
    expect(payload.data.decks).toEqual([customDeck]);
    expect(await importLocalData(store, payload)).toEqual({ ok: true, errors: [], warnings: [] });
    expect(await idbGetAll<WordRecord>(db, STORES.words)).toEqual([customWord]);
    expect(await idbGetAll<DeckRecord>(db, STORES.decks)).toEqual([customDeck]);
  });

  it('词库加载失败时拒绝恢复并保留全部现有数据，随后可重试', async () => {
    const payload = await populatedBackup();
    const before = await exportLocalData(store);
    await store.setCooldown({ nextAllowedAt: 9_999, consecutiveSkipCount: 2 });
    payload.data.cards = [];
    payload.data.reviewLogs = [];
    payload.authoritativeState.appSettings.dailyNewWordLimit = 20;
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    let failing = true;
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (failing) throw new Error('模拟词库读取失败');
      return originalFetch(input);
    });

    const result = await importLocalData(store, payload);

    expect(result).toEqual({
      ok: false,
      errors: [expect.stringContaining('词库加载失败')],
      warnings: [],
    });
    failing = false;
    const after = await exportLocalData(store);
    expect(after.authoritativeState).toEqual(before.authoritativeState);
    expect(after.data).toEqual(before.data);
    expect(await store.getCooldown()).toEqual({ nextAllowedAt: 9_999, consecutiveSkipCount: 2 });
    expect(await importLocalData(store, payload)).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it('导出时词库 HTTP 加载失败会报错并保留现有数据', async () => {
    await populatedBackup();
    vi.mocked(fetch).mockImplementation(async () => new Response('', { status: 503 }));

    await expect(exportLocalData(store)).rejects.toThrow('词库资源加载失败');
    expect(await idbGetAll<CardRecord>(db, STORES.cards)).toEqual([CARD]);
  });

  it('恢复在一个事务中完整替换全部权威数据，并将临时状态归零', async () => {
    const payload = await populatedBackup();
    await store.setCooldown({ nextAllowedAt: 9_999, consecutiveSkipCount: 2 });
    await store.setAppSettings(DEFAULT_SETTINGS);
    await idbPut(db, STORES.cards, { ...CARD, id: 'obsolete-card', wordId: 'w-benefit' });

    const result = await importLocalData(store, payload);

    expect(result).toEqual({ ok: true, errors: [], warnings: [] });
    expect(await store.getAppSettings()).toMatchObject({ dailyNewWordLimit: 8 });
    expect(await idbGetAll<CardRecord>(db, STORES.cards)).toEqual([CARD]);
    expect(await store.getCooldown()).toEqual({ nextAllowedAt: 0, consecutiveSkipCount: 0 });
  });

  it('事务请求开始后失败会回滚全部权威数据', async () => {
    const payload = await populatedBackup();
    payload.authoritativeState.appSettings.dailyNewWordLimit = 20;
    payload.data.cards = [];
    const originalPut = IDBObjectStore.prototype.put;
    let putCount = 0;
    const putSpy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args
    ) {
      putCount += 1;
      if (putCount === 2) throw new Error('模拟事务中途请求失败');
      return originalPut.apply(this, args);
    });

    const result = await importLocalData(store, payload);
    putSpy.mockRestore();

    expect(result.ok).toBe(false);
    expect(await store.getAppSettings()).toMatchObject({ dailyNewWordLimit: 8 });
    expect(await idbGetAll<CardRecord>(db, STORES.cards)).toEqual([CARD]);
  });

  it('权威恢复成功但临时状态清零失败时返回真实的部分失败状态', async () => {
    const payload = await populatedBackup();
    payload.authoritativeState.appSettings.dailyNewWordLimit = 12;
    runtime.failOnce();

    const result = await importLocalData(store, payload);

    expect(result.ok).toBe(true);
    expect(result.warnings[0]).toContain('权威数据已成功更新');
    expect(await store.getAppSettings()).toMatchObject({ dailyNewWordLimit: 12 });
  });

  it('清除学习进度保留长期选择并使派生统计归零', async () => {
    await populatedBackup();
    await clearLearningProgress(db);
    const [cards, logs, sessions, events] = await Promise.all([
      idbGetAll<CardRecord>(db, STORES.cards),
      idbGetAll<ReviewLogRecord>(db, STORES.reviewLogs),
      idbGetAll<SessionLogRecord>(db, STORES.sessionLogs),
      idbGetAll<BehaviorEventRecord>(db, STORES.behaviorEvents),
    ]);
    const stats = new StatsService({ clock: { now: () => 2_000 } }).computeStats(
      cards,
      logs,
      sessions,
      events,
    );
    expect(stats.today).toMatchObject({
      completedQuestions: 0,
      correctAnswers: 0,
      skipped: 0,
      reviewedWords: 0,
      newWords: 0,
      continuousSessions: 0,
      continuousQuestions: 0,
    });
    expect(await store.getAppSettings()).toMatchObject({ dailyNewWordLimit: 8 });
    expect(events).toEqual([]);
    expect(await store.isOnboardingCompleted()).toBe(true);
  });

  it('清除全部数据回到刚安装状态并保留可重新生成的内置内容', async () => {
    await populatedBackup();
    const result = await clearAllLocalData(store);
    expect(result).toEqual({ ok: true, errors: [], warnings: [] });
    expect(await store.getAppSettings()).toEqual(DEFAULT_SETTINGS);
    expect(await store.isOnboardingCompleted()).toBe(false);
    expect(await store.listSites()).toEqual([]);
    expect(await idbGetAll(db, STORES.cards)).toEqual([]);
    expect(await words.getDeck(DEFAULT_SETTINGS.selectedDeckId)).not.toBeNull();
  });
});
