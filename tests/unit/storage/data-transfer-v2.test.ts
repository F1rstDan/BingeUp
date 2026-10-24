import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, idbGetAll, STORES } from '@/storage/database';
import { MIGRATIONS } from '@/storage/migrations';
import { LocalSettingsStore } from '@/storage/local-settings';
import { DEFAULT_SETTINGS } from '@/settings/defaults';
import {
  clearLearningProgress,
  exportLocalData,
  importLocalData,
  type ExportPayloadV1,
  type ExportPayloadV2,
} from '@/storage/data-transfer';
import { getContentCompatibility } from '@/storage/content-compat';
import { buildV2PackageTexts, packageFetchMock } from '../../helpers/content-v2-package';
import type { CardRecord, ReviewLogRecord, WordRecord } from '@/types';

const DB_NAME = 'test-data-transfer-v2';

function installChrome(): void {
  const values: Record<string, unknown> = {};
  vi.stubGlobal('chrome', {
    runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: values[key] })),
        set: vi.fn(async (entries: Record<string, unknown>) => Object.assign(values, entries)),
      },
    },
  });
}

function v1Payload(cards: CardRecord[], logs: ReviewLogRecord[]): ExportPayloadV1 {
  return {
    version: 1,
    exportedAt: 1_000,
    authoritativeState: {
      appSettings: { ...DEFAULT_SETTINGS, selectedDeckId: 'deck-cet4' },
      sites: {},
      onboardingCompleted: true,
    },
    data: {
      cards,
      reviewLogs: logs,
      sessionLogs: [],
      behaviorEvents: [],
      words: [],
      decks: [],
    },
  };
}

const CARD_A: CardRecord = {
  id: 'card-a',
  wordId: 'w-reservior',
  deckId: 'deck-cet4',
  stage: 'short-term',
  origin: 'accepted-new',
  createdAt: 100,
  updatedAt: 100,
  nextReviewAt: 200,
};
const CARD_B: CardRecord = {
  id: 'card-b',
  wordId: 'w-reservoir',
  deckId: 'deck-cet6',
  stage: 'long-term',
  origin: 'self-reported',
  createdAt: 90,
  updatedAt: 300,
  nextReviewAt: 400,
  schedulerState: {
    stability: 1,
    difficulty: 5,
    reps: 2,
    lapses: 0,
    state: 2,
    scheduledDays: 1,
    learningSteps: 0,
  },
};
const LOG_A: ReviewLogRecord = {
  id: 'log-a',
  cardId: 'card-a',
  wordId: 'w-reservior',
  questionType: 'en-to-zh',
  selectedAnswer: 'a',
  correctAnswer: 'b',
  isCorrect: true,
  responseTimeMs: 100,
  reviewedAt: 150,
};

describe('备份 v1/v2 与身份转换 — Issue #59', () => {
  let db: IDBDatabase;
  let store: LocalSettingsStore;

  beforeEach(async () => {
    installChrome();
    const { texts } = await buildV2PackageTexts();
    vi.stubGlobal('fetch', vi.fn(packageFetchMock(texts)));
    db = await openDatabase(DB_NAME, MIGRATIONS);
    store = new LocalSettingsStore(db);
  });

  afterEach(async () => {
    db.close();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('合法 v1 引用在精确身份映射后合卡并保存兼容依据', async () => {
    const result = await importLocalData(store, v1Payload([CARD_A, CARD_B], [LOG_A]));
    expect(result).toEqual({ ok: true, errors: [], warnings: [] });
    const cards = await idbGetAll<CardRecord>(db, STORES.cards);
    const logs = await idbGetAll<ReviewLogRecord>(db, STORES.reviewLogs);
    const compatibility = await getContentCompatibility(db);

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      id: 'card-b',
      wordId: 'w-reservoir',
      deckId: 'deck-cet6',
      createdAt: 90,
      updatedAt: 300,
      stage: 'long-term',
      origin: 'self-reported',
    });
    expect(logs).toEqual([{ ...LOG_A, cardId: 'card-b', wordId: 'w-reservoir' }]);
    expect(compatibility?.merges).toHaveLength(1);
    expect(compatibility?.originals).toHaveLength(2);
  });

  it('v1 非法原成员关系先被拒绝，不借映射洗白', async () => {
    const invalid: CardRecord = { ...CARD_B, id: 'card-invalid', deckId: 'deck-cet4' };
    const result = await importLocalData(store, v1Payload([invalid], []));
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('不属于原词库')]),
    );
    expect(await idbGetAll<CardRecord>(db, STORES.cards)).toEqual([]);
  });

  it('自定义内容占用保留内置 ID 时拒绝导入', async () => {
    const payload = v1Payload([], []);
    payload.data.words.push({
      id: 'w-reservior',
      word: 'reservior',
      lemma: 'reservior',
      partOfSpeech: ['n.'],
      coreMeaningZh: ['测试'],
      exampleSentence: 'Test.',
      exampleTranslation: '测试。',
      difficulty: 1,
      frequencyRank: 1,
      source: 'user',
      license: 'user',
    } satisfies WordRecord);
    const result = await importLocalData(store, payload);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('与内置单词 id 冲突')]),
    );
  });

  it('v1 自定义词库的卡成员关系在规范化后校验', async () => {
    const payload = v1Payload(
      [
        {
          ...CARD_A,
          id: 'card-custom-deck',
          wordId: 'w-bench',
          deckId: 'user-deck',
        },
      ],
      [],
    );
    payload.data.decks.push({
      id: 'user-deck',
      name: '用户词库',
      source: 'user',
      license: 'user',
      wordIds: ['w-candle'],
    });
    const result = await importLocalData(store, payload);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('不属于引用的自定义词库')]),
    );
  });

  it('v2 往返保留兼容记录，重复导入不追加事实', async () => {
    await importLocalData(store, v1Payload([CARD_A, CARD_B], [LOG_A]));
    const exported = (await exportLocalData(store)) as ExportPayloadV2;
    expect(exported.version).toBe(2);
    expect(exported.compatibility?.merges).toHaveLength(1);

    const first = await importLocalData(store, exported);
    expect(first.ok).toBe(true);
    const cards = await idbGetAll<CardRecord>(db, STORES.cards);
    const logs = await idbGetAll<ReviewLogRecord>(db, STORES.reviewLogs);
    expect(cards).toHaveLength(1);
    expect(logs).toHaveLength(1);
    expect((await getContentCompatibility(db))?.merges).toHaveLength(1);

    expect((await importLocalData(store, exported)).ok).toBe(true);
    expect(await idbGetAll<CardRecord>(db, STORES.cards)).toHaveLength(1);
    expect(await idbGetAll<ReviewLogRecord>(db, STORES.reviewLogs)).toHaveLength(1);
  });

  it('清除学习进度同步删除兼容记录', async () => {
    await importLocalData(store, v1Payload([CARD_A, CARD_B], [LOG_A]));
    expect(await getContentCompatibility(db)).not.toBeNull();
    await clearLearningProgress(db);
    expect(await getContentCompatibility(db)).toBeNull();
    expect(await idbGetAll<CardRecord>(db, STORES.cards)).toEqual([]);
    expect(await idbGetAll<ReviewLogRecord>(db, STORES.reviewLogs)).toEqual([]);
  });

  it('未知兼容版本明确失败且保持当前数据', async () => {
    await importLocalData(store, v1Payload([CARD_A], [LOG_A]));
    const exported = (await exportLocalData(store)) as ExportPayloadV2;
    exported.compatibility = {
      ...exported.compatibility!,
      contentVersion: 'unknown-content-version',
    };
    const result = await importLocalData(store, exported);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('内容版本不一致')]),
    );
    expect(await idbGetAll<CardRecord>(db, STORES.cards)).toHaveLength(1);
  });

  it('内容版本与当前词库不一致时拒绝 v2', async () => {
    await importLocalData(store, v1Payload([CARD_A], [LOG_A]));
    const exported = (await exportLocalData(store)) as ExportPayloadV2;
    const broken = { ...exported, content: { ...exported.content, version: 'legacy-v1' } };
    const result = await importLocalData(store, broken);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('内容版本与当前词库不一致')]),
    );
    expect(await idbGetAll<CardRecord>(db, STORES.cards)).toHaveLength(1);
  });

  it('损坏的兼容记录返回错误列表而不是抛出异常', async () => {
    await importLocalData(store, v1Payload([CARD_A], [LOG_A]));
    const exported = (await exportLocalData(store)) as ExportPayloadV2;
    const broken = {
      ...exported,
      compatibility: {
        ...exported.compatibility!,
        deactivatedCardIds: undefined as never,
      },
    };
    const result = await importLocalData(store, broken);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('兼容记录结构非法')]),
    );
  });
});
