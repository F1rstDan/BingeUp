import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, idbGetAll, idbPut, STORES } from '@/storage/database';
import { MIGRATIONS } from '@/storage/migrations';
import { LocalSettingsStore } from '@/storage/local-settings';
import { DEFAULT_SETTINGS } from '@/settings/defaults';
import { getBuiltInDeck, getBuiltInWord } from '@/dictionary/built-in/decks';
import { StatsService } from '@/stats/stats-service';
import {
  clearAllLocalData,
  clearLearningProgress,
  exportLocalData,
  importLocalData,
  type ExportPayload,
} from '@/storage/data-transfer';
import type { CardRecord, ReviewLogRecord, SessionLogRecord } from '@/types';

const TEST_DB = 'test-issue-18-data-lifecycle';
const CARD: CardRecord = {
  id: 'card-1',
  wordId: 'w-abandon',
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
  correctAnswer: '放弃',
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

function installRuntimeStorageMock() {
  const values: Record<string, unknown> = {};
  let failNextWrite = false;
  const chromeStub = {
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

  beforeEach(async () => {
    runtime = installRuntimeStorageMock();
    db = await openDatabase(TEST_DB, MIGRATIONS);
    store = new LocalSettingsStore(db);
  });
  afterEach(async () => {
    db.close();
    await deleteDatabase();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  async function populatedBackup(): Promise<ExportPayload> {
    await store.setAppSettings({ ...DEFAULT_SETTINGS, dailyNewWordLimit: 8 });
    await store.disableSite('youtube.com');
    await store.markOnboardingCompleted();
    await Promise.all([
      idbPut(db, STORES.cards, CARD),
      idbPut(db, STORES.reviewLogs, LOG),
      idbPut(db, STORES.sessionLogs, SESSION),
    ]);
    return exportLocalData(store);
  }

  it('首次公开 v1 备份包含全部权威源数据，不包含临时运行状态或内置学习内容', async () => {
    await store.setCooldown({ nextAllowedAt: 9_999, consecutiveSkipCount: 2 });
    await idbPut(db, STORES.words, getBuiltInWord('w-abandon'));
    await idbPut(db, STORES.decks, getBuiltInDeck('deck-daily-high-frequency'));
    const payload = await populatedBackup();

    expect(payload.version).toBe(1);
    expect(payload.authoritativeState).toMatchObject({
      appSettings: { dailyNewWordLimit: 8 },
      onboardingCompleted: true,
      sites: { 'youtube.com': { enabled: false } },
    });
    expect(payload.data).toMatchObject({
      cards: [CARD],
      reviewLogs: [LOG],
      sessionLogs: [SESSION],
      words: [],
      decks: [],
    });
    expect(JSON.stringify(payload)).not.toContain('nextAllowedAt');
    expect(payload.data.words).toEqual([]);
    expect(payload.data.decks).toEqual([]);
  });

  it('导入拒绝以自定义内容覆盖内置单词或词库 id', async () => {
    const payload = await populatedBackup();
    payload.data.words.push(getBuiltInWord('w-abandon')!);
    payload.data.decks.push(getBuiltInDeck('deck-daily-high-frequency')!);
    const result = await importLocalData(store, payload);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('与内置单词 id 冲突'),
        expect.stringContaining('与内置词库 id 冲突'),
      ]),
    );
  });

  it('不支持开发期版本并给出可理解错误', async () => {
    const result = await importLocalData(store, { version: 2 });
    expect(result).toEqual({
      ok: false,
      errors: ['不支持的备份版本：2（当前支持版本：1）'],
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
    const [cards, logs, sessions] = await Promise.all([
      idbGetAll<CardRecord>(db, STORES.cards),
      idbGetAll<ReviewLogRecord>(db, STORES.reviewLogs),
      idbGetAll<SessionLogRecord>(db, STORES.sessionLogs),
    ]);
    const stats = new StatsService({ clock: { now: () => 2_000 } }).computeStats(
      cards,
      logs,
      sessions,
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
    expect(getBuiltInDeck(DEFAULT_SETTINGS.selectedDeckId)).not.toBeNull();
  });
});
