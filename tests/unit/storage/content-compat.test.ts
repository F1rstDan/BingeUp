import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, idbGetAll, idbPut, STORES } from '@/storage/database';
import { MIGRATIONS } from '@/storage/migrations';
import {
  CONTENT_COMPAT_ID,
  acceptanceEvents,
  buildCompatibilityPlan,
  getContentCompatibility,
  prepareContentCompatibility,
} from '@/storage/content-compat';
import type { CardRecord, LegacyRegistry, ReviewLogRecord, SchedulerState } from '@/types';

const DB_NAME = 'test-content-compat';
const SCHEDULER: SchedulerState = {
  stability: 3,
  difficulty: 5,
  reps: 4,
  lapses: 1,
  state: 2,
  scheduledDays: 5,
  learningSteps: 0,
};

function entry(
  legacyId: string,
  disposition: 'keep' | 'merge' | 'deactivate',
  canonicalId: string,
  decks: Array<{ deckId: string; difficulty: number }>,
) {
  return {
    legacyId,
    disposition,
    canonicalId,
    canonicalWord: canonicalId.replace('w-', ''),
    reason: 'test',
    evidence: ['test'],
    seedEntryHash: 'a'.repeat(64),
    original: { word: legacyId.replace('w-', ''), difficulty: 2, frequencyRank: 1, decks },
  };
}

const REGISTRY: LegacyRegistry = {
  schemaVersion: 1,
  registryVersion: 'legacy-registry-1',
  registryHash: 'b'.repeat(64),
  datasetId: 'test',
  seedHash: 'c'.repeat(64),
  source: {
    name: 'ECDICT',
    repository: 'test',
    commit: 'test',
    license: 'MIT',
    capturedAt: '2026-10-23',
    note: 'test',
  },
  review: { reviewedAt: '2026-10-23', method: 'test', evidenceSources: [] },
  entries: [
    entry('w-reservior', 'merge', 'w-reservoir', [{ deckId: 'deck-cet4', difficulty: 2 }]),
    entry('w-reservoir', 'keep', 'w-reservoir', [{ deckId: 'deck-cet6', difficulty: 3 }]),
    entry('w-normal', 'keep', 'w-normal', [{ deckId: 'deck-cet4', difficulty: 1 }]),
    entry('w-old', 'deactivate', 'w-old', [{ deckId: 'deck-cet6', difficulty: 4 }]),
  ],
};

const CARDS: CardRecord[] = [
  {
    id: 'card-a',
    wordId: 'w-reservior',
    deckId: 'deck-cet4',
    stage: 'short-term',
    origin: 'accepted-new',
    createdAt: 100,
    updatedAt: 300,
    nextReviewAt: 500,
  },
  {
    id: 'card-b',
    wordId: 'w-reservoir',
    deckId: 'deck-cet6',
    stage: 'long-term',
    origin: 'self-reported',
    createdAt: 200,
    updatedAt: 400,
    nextReviewAt: 300,
    schedulerState: SCHEDULER,
  },
  {
    id: 'card-old',
    wordId: 'w-old',
    deckId: 'deck-cet6',
    stage: 'long-term',
    createdAt: 50,
    updatedAt: 60,
    nextReviewAt: 70,
  },
];

const LOGS: ReviewLogRecord[] = [
  {
    id: 'log-a',
    cardId: 'card-a',
    wordId: 'w-reservior',
    questionType: 'en-to-zh',
    selectedAnswer: 'a',
    correctAnswer: 'b',
    isCorrect: false,
    responseTimeMs: 100,
    reviewedAt: 120,
    stageAtSubmission: 'short-term',
  },
  {
    id: 'log-b',
    cardId: 'card-b',
    wordId: 'w-reservoir',
    questionType: 'zh-to-en',
    selectedAnswer: 'c',
    correctAnswer: 'd',
    isCorrect: true,
    responseTimeMs: 100,
    reviewedAt: 130,
    stageAtSubmission: 'long-term',
  },
];

describe('内容兼容转换 — Issue #58', () => {
  let db: IDBDatabase;

  beforeEach(async () => {
    db = await openDatabase(DB_NAME, MIGRATIONS);
    for (const card of CARDS) await idbPut(db, STORES.cards, card);
    for (const log of LOGS) await idbPut(db, STORES.reviewLogs, log);
  });

  afterEach(async () => {
    db.close();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
    vi.restoreAllMocks();
  });

  it('按确定性规则合卡、重绑日志并保留历史依据', async () => {
    const record = await prepareContentCompatibility(db, REGISTRY, 'content-v2', 9_000);
    const cards = await idbGetAll<CardRecord>(db, STORES.cards);
    const logs = await idbGetAll<ReviewLogRecord>(db, STORES.reviewLogs);
    const merged = cards.find((card) => card.id === 'card-a')!;

    expect(cards).toHaveLength(2);
    expect(merged).toMatchObject({
      wordId: 'w-reservoir',
      deckId: 'deck-cet4',
      createdAt: 100,
      updatedAt: 400,
      stage: 'long-term',
      origin: 'accepted-new',
      nextReviewAt: 300,
      schedulerState: SCHEDULER,
      lastWrongAt: 120,
    });
    expect(cards.find((card) => card.id === 'card-b')).toBeUndefined();
    expect(cards.find((card) => card.id === 'card-old')?.disabled).toBe(true);
    expect(logs.map((log) => [log.id, log.cardId, log.wordId])).toEqual([
      ['log-a', 'card-a', 'w-reservoir'],
      ['log-b', 'card-a', 'w-reservoir'],
    ]);
    expect(record.originals).toHaveLength(3);
    expect(record.merges).toEqual([
      {
        fromCardId: 'card-b',
        toCardId: 'card-a',
        fromWordId: 'w-reservoir',
        toWordId: 'w-reservoir',
      },
    ]);
    expect(acceptanceEvents(cards, record)).toEqual(
      expect.arrayContaining([
        { cardId: 'card-a', createdAt: 100 },
        { cardId: 'card-old', createdAt: 50 },
      ]),
    );
  });

  it('重复启动幂等，不重复改写或更新完成时间', async () => {
    const first = await prepareContentCompatibility(db, REGISTRY, 'content-v2', 9_000);
    const second = await prepareContentCompatibility(db, REGISTRY, 'content-v2', 10_000);
    expect(second).toEqual(first);
    expect(await idbGetAll<CardRecord>(db, STORES.cards)).toHaveLength(2);
    expect(await idbGetAll<ReviewLogRecord>(db, STORES.reviewLogs)).toHaveLength(2);
  });

  it('转换请求中途失败时全部回滚', async () => {
    const originalPut = IDBObjectStore.prototype.put;
    let count = 0;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args
    ) {
      count += 1;
      if (count === 3) throw new Error('模拟写入失败');
      return originalPut.apply(this, args);
    });

    await expect(prepareContentCompatibility(db, REGISTRY, 'content-v2', 9_000)).rejects.toThrow();
    vi.restoreAllMocks();
    expect(await idbGetAll<CardRecord>(db, STORES.cards)).toEqual(CARDS);
    expect(await idbGetAll<ReviewLogRecord>(db, STORES.reviewLogs)).toEqual(LOGS);
    expect(await getContentCompatibility(db)).toBeNull();
  });

  it('纯计算结果不写入数据库，且保留最早到期时间', () => {
    const plan = buildCompatibilityPlan({
      cards: CARDS,
      logs: LOGS,
      registry: REGISTRY,
      contentVersion: 'content-v2',
      now: 9_000,
    });
    expect(plan.record.id).toBe(CONTENT_COMPAT_ID);
    expect(plan.cards.find((card) => card.id === 'card-a')?.nextReviewAt).toBe(300);
    expect(plan.cards.find((card) => card.id === 'card-a')?.lastWrongAt).toBe(120);
  });
});
