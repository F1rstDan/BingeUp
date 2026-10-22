import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { idbPut, openDatabase, STORES } from '@/storage/database';
import { MIGRATIONS } from '@/storage/migrations';
import { CardRepository } from '@/storage/repositories/card-repository';
import { ReviewLogRepository } from '@/storage/repositories/review-log-repository';
import type { CardRecord, ReviewLogRecord, SchedulerState } from '@/types';

const TEST_DB = 'test-bingeup-v4-migration';
const V3_MIGRATIONS = MIGRATIONS.filter(({ version }) => version < 4);
const SCHEDULER_STATE: SchedulerState = {
  stability: 12,
  difficulty: 4,
  reps: 5,
  lapses: 1,
  state: 2,
  scheduledDays: 10,
  learningSteps: 0,
  lastReviewAt: 9_000,
};

function makeCard(overrides: Partial<CardRecord> = {}): CardRecord {
  return {
    id: 'card-first',
    wordId: 'w-help',
    deckId: 'deck-daily',
    stage: 'short-term',
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function makeLog(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    id: 'log-first',
    cardId: 'card-first',
    wordId: 'w-help',
    questionType: 'en-to-zh',
    selectedAnswer: '帮助',
    correctAnswer: '帮助',
    isCorrect: true,
    responseTimeMs: 2_000,
    reviewedAt: 9_000,
    ...overrides,
  };
}

describe('v4 迁移 — 同词学习关系与复习日志合并', () => {
  const connections: IDBDatabase[] = [];

  async function openTestDatabase(migrations = MIGRATIONS): Promise<IDBDatabase> {
    const db = await openDatabase(TEST_DB, migrations);
    connections.push(db);
    return db;
  }

  async function seedLegacyDatabase(
    cards: CardRecord[],
    logs: ReviewLogRecord[] = [],
    migrations = V3_MIGRATIONS,
  ): Promise<void> {
    const db = await openTestDatabase(migrations);
    for (const card of cards) await idbPut(db, STORES.cards, card);
    for (const log of logs) await idbPut(db, STORES.reviewLogs, log);
    db.close();
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const db of connections.splice(0)) db.close();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(TEST_DB);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('测试数据库仍有未关闭的连接'));
    });
  });

  it.each<CardRecord['stage']>(['self-reported-known', 'long-term'])(
    '保留最早关系与首次来源，并采用最新的 %s 进度',
    async (stage) => {
      const first = makeCard({
        id: 'z-first',
        origin: 'accepted-new',
        stage: 'long-term',
        schedulerState: { ...SCHEDULER_STATE, reps: 1 },
        lastWrongAt: 500,
        nextReviewAt: 2_000,
      });
      const latest = makeCard({
        id: 'a-latest',
        deckId: 'deck-other',
        origin: 'self-reported',
        stage,
        createdAt: 2_000,
        updatedAt: 9_000,
        nextReviewAt: 20_000,
        ...(stage === 'long-term' ? { schedulerState: SCHEDULER_STATE, lastWrongAt: 8_000 } : {}),
      });
      await seedLegacyDatabase([first, latest]);

      const db = await openTestDatabase();
      const cards = new CardRepository(db);
      expect(await cards.getAll()).toEqual([
        {
          ...latest,
          id: first.id,
          deckId: first.deckId,
          createdAt: first.createdAt,
          origin: first.origin,
        },
      ]);
      expect(await cards.getById(latest.id)).toBeUndefined();
      expect((await cards.getByWordId(first.wordId))?.id).toBe(first.id);
      expect(db.transaction(STORES.cards).objectStore(STORES.cards).index('byWordId').unique).toBe(
        true,
      );
      await expect(cards.save(makeCard({ id: 'another-duplicate' }))).rejects.toThrow(
        /已有学习卡|ConstraintError/i,
      );
    },
  );

  it('v1 直升时合并三张同词卡的多来源日志，保留其他单词及所有日志字段', async () => {
    const first = makeCard({ id: 'z-first', origin: 'self-reported' });
    const latest = makeCard({
      id: 'm-latest',
      createdAt: 2_000,
      updatedAt: 9_000,
      stage: 'long-term',
      schedulerState: SCHEDULER_STATE,
      nextReviewAt: 20_000,
    });
    const lastCreated = makeCard({ id: 'a-last', createdAt: 3_000, updatedAt: 5_000 });
    const other = makeCard({ id: 'other', wordId: 'w-three' });
    const logs = [
      makeLog({ id: 'l1', cardId: first.id, source: 'natural' }),
      makeLog({ id: 'l2', cardId: latest.id, source: 'manual' }),
      makeLog({
        id: 'l3',
        cardId: latest.id,
        source: 'continuous',
        questionType: 'spelling',
        stageAtSubmission: 'long-term',
        rating: 'easy',
        userCorrection: 'too-easy',
        previousSchedulerState: SCHEDULER_STATE,
      }),
      makeLog({ id: 'l4', cardId: lastCreated.id, source: 'natural' }),
      makeLog({ id: 'l5', cardId: other.id, wordId: other.wordId, source: 'manual' }),
    ];
    await seedLegacyDatabase(
      [first, latest, lastCreated, other],
      logs,
      MIGRATIONS.filter(({ version }) => version === 1),
    );

    const db = await openTestDatabase();
    const cards = new CardRepository(db);
    const reviews = new ReviewLogRepository(db);
    expect(await cards.getAll()).toHaveLength(2);
    expect(await reviews.getAll()).toStrictEqual(
      logs.map((log) => ({ ...log, cardId: log.wordId === first.wordId ? first.id : other.id })),
    );
    expect(await cards.getById(first.id)).toEqual({
      ...latest,
      id: first.id,
      deckId: first.deckId,
      createdAt: first.createdAt,
      origin: first.origin,
    });
    expect(await cards.getById(other.id)).toStrictEqual(other);
    expect(await reviews.getByCardId(first.id)).toHaveLength(4);
    expect(await reviews.getByCardId(latest.id)).toEqual([]);
    expect(await reviews.getByCardId(lastCreated.id)).toEqual([]);
  });

  it('v2 直升时最早卡也可提供最新进度，不补写缺省的首次来源', async () => {
    const first = makeCard({
      updatedAt: 9_000,
      stage: 'long-term',
      schedulerState: SCHEDULER_STATE,
      nextReviewAt: 20_000,
    });
    const duplicate = makeCard({
      id: 'card-duplicate',
      createdAt: 2_000,
      updatedAt: 3_000,
      origin: 'self-reported',
      stage: 'self-reported-known',
    });
    const logs = [makeLog(), makeLog({ id: 'log-other', cardId: duplicate.id })];
    await seedLegacyDatabase(
      [first, duplicate],
      logs,
      MIGRATIONS.filter(({ version }) => version <= 2),
    );

    const db = await openTestDatabase();
    expect(await new CardRepository(db).getAll()).toStrictEqual([first]);
    expect(await new ReviewLogRepository(db).getAll()).toStrictEqual(
      logs.map((log) => ({ ...log, cardId: first.id })),
    );
  });

  it.each([false, true])('无重复时保留原始记录（空库：%s）', async (empty) => {
    const cards = empty
      ? []
      : [makeCard(), makeCard({ id: 'card-other', wordId: 'w-three', origin: 'self-reported' })];
    const logs = empty ? [] : [makeLog()];
    await seedLegacyDatabase(cards, logs);

    const db = await openTestDatabase();
    expect(await new CardRepository(db).getAll()).toStrictEqual(cards);
    expect(await new ReviewLogRepository(db).getAll()).toStrictEqual(logs);
    expect(db.transaction(STORES.cards).objectStore(STORES.cards).index('byWordId').unique).toBe(
      true,
    );
  });

  it('日志重绑后升级中止时回滚卡片、日志和索引，保留旧数据库版本', async () => {
    const cards = [
      makeCard({ id: 'a-first' }),
      makeCard({ id: 'z-latest', createdAt: 2_000, updatedAt: 9_000, stage: 'long-term' }),
    ];
    const logs = cards.map((card, index) => makeLog({ id: `log-${index}`, cardId: card.id }));
    await seedLegacyDatabase(cards, logs);
    let logUpdated = false;
    const originalUpdate = IDBCursor.prototype.update;
    // 在日志实际写入后中止事务，验证卡、日志和唯一索引不会部分提交。
    vi.spyOn(IDBCursor.prototype, 'update').mockImplementation(function (
      this: IDBCursor,
      value: unknown,
    ) {
      const request = originalUpdate.call(this, value);
      const source = this.source;
      if (source instanceof IDBObjectStore && source.name === STORES.reviewLogs) {
        request.addEventListener('success', () => {
          logUpdated = true;
          source.transaction.abort();
        });
      }
      return request;
    });

    await expect(openTestDatabase()).rejects.toThrow();
    expect(logUpdated).toBe(true);

    const db = await openTestDatabase(V3_MIGRATIONS);
    expect(db.version).toBe(3);
    expect(await new CardRepository(db).getAll()).toStrictEqual(cards);
    expect(await new ReviewLogRepository(db).getAll()).toStrictEqual(logs);
    expect(db.transaction(STORES.cards).objectStore(STORES.cards).index('byWordId').unique).toBe(
      false,
    );
    expect(db.objectStoreNames.contains(STORES.behaviorEvents)).toBe(false);
  });

  it('已升级数据库重开时不重跑 v4 或推测恢复已丢失的卡片', async () => {
    const card = makeCard();
    const orphanLog = makeLog({ cardId: 'previously-discarded-card' });
    const current = await openTestDatabase();
    await idbPut(current, STORES.cards, card);
    await idbPut(current, STORES.reviewLogs, orphanLog);
    current.close();

    const reopened = await openTestDatabase();
    expect(await new CardRepository(reopened).getAll()).toStrictEqual([card]);
    expect(await new ReviewLogRepository(reopened).getAll()).toStrictEqual([orphanLog]);
  });
});
