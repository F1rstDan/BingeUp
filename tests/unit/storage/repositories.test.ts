import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, readStorageMeta, STORES } from '@/storage/database';
import { CardRepository } from '@/storage/repositories/card-repository';
import { ReviewLogRepository } from '@/storage/repositories/review-log-repository';
import type { CardRecord, ReviewLogRecord } from '@/types';

const TEST_DB = 'test-bingeup-repos';

async function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

function makeCard(overrides: Partial<CardRecord> = {}): CardRecord {
  return {
    id: 'card-1',
    wordId: 'w-abandon',
    deckId: 'deck-daily',
    stage: 'short-term',
    origin: 'accepted-new',
    createdAt: 1_000_000,
    updatedAt: 1_000_000,
    ...overrides,
  };
}

function makeLog(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    id: 'log-1',
    cardId: 'card-1',
    wordId: 'w-abandon',
    questionType: 'en-to-zh',
    selectedAnswer: '利益；好处',
    correctAnswer: '放弃；遗弃',
    isCorrect: false,
    responseTimeMs: 3200,
    reviewedAt: 1_000_000,
    stageAtSubmission: 'short-term',
    source: 'natural',
    rating: 'again',
    ...overrides,
  };
}

async function deleteCardRaw(db: IDBDatabase, id: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORES.cards, 'readwrite');
    tx.objectStore(STORES.cards).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

describe('CardRepository — 学习卡持久化（Issue #5 验收标准 3）', () => {
  afterEach(async () => {
    await deleteDatabase(TEST_DB);
  });

  it('save 写入后 getById 可读', async () => {
    const db = await openDatabase(TEST_DB);
    const repo = new CardRepository(db);
    const card = makeCard();
    await repo.save(card);

    const read = await repo.getById('card-1');
    expect(read).toEqual(card);
    db.close();
  });

  it('getByWordId 通过索引查找学习卡', async () => {
    const db = await openDatabase(TEST_DB);
    const repo = new CardRepository(db);
    await repo.save(makeCard({ id: 'card-a', wordId: 'w-abandon' }));
    await repo.save(makeCard({ id: 'card-b', wordId: 'w-benefit' }));

    const found = await repo.getByWordId('w-abandon');
    expect(found).toBeDefined();
    expect(found!.id).toBe('card-a');
    db.close();
  });

  it('getByWordId 不存在时返回 undefined', async () => {
    const db = await openDatabase(TEST_DB);
    const repo = new CardRepository(db);
    const found = await repo.getByWordId('nonexistent');
    expect(found).toBeUndefined();
    db.close();
  });

  it('save 覆盖同 id 记录（更新学习卡）', async () => {
    const db = await openDatabase(TEST_DB);
    const repo = new CardRepository(db);
    await repo.save(makeCard({ stage: 'short-term' }));
    await repo.save(makeCard({ stage: 'long-term', updatedAt: 2_000_000 }));

    const read = await repo.getById('card-1');
    expect(read!.stage).toBe('long-term');
    expect(read!.updatedAt).toBe(2_000_000);
    db.close();
  });

  it('刷新或重启浏览器后学习卡仍可读取（新实例模拟重启）', async () => {
    const db1 = await openDatabase(TEST_DB);
    const repo1 = new CardRepository(db1);
    await repo1.save(makeCard({ id: 'card-persist', wordId: 'w-persist' }));
    db1.close();

    // 模拟浏览器重启：丢弃旧实例，用新实例重新打开数据库
    const db2 = await openDatabase(TEST_DB);
    const repo2 = new CardRepository(db2);
    const restored = await repo2.getById('card-persist');
    expect(restored).toBeDefined();
    expect(restored!.wordId).toBe('w-persist');
    db2.close();
  });

  it('getAll 返回所有学习卡', async () => {
    const db = await openDatabase(TEST_DB);
    const repo = new CardRepository(db);
    await repo.save(makeCard({ id: 'c1', wordId: 'w1' }));
    await repo.save(makeCard({ id: 'c2', wordId: 'w2' }));
    await repo.save(makeCard({ id: 'c3', wordId: 'w3' }));

    const all = await repo.getAll();
    expect(all).toHaveLength(3);
    db.close();
  });
});

describe('ReviewLogRepository — 复习日志持久化（Issue #5 验收标准 3）', () => {
  afterEach(async () => {
    await deleteDatabase(TEST_DB);
  });

  it('save 写入后可按 id 读取', async () => {
    const db = await openDatabase(TEST_DB);
    const repo = new ReviewLogRepository(db);
    const log = makeLog();
    await repo.save(log);

    const read = await repo.getById('log-1');
    expect(read).toEqual(log);
    db.close();
  });

  it('getByCardId 通过索引查找该学习卡的所有复习日志', async () => {
    const db = await openDatabase(TEST_DB);
    const repo = new ReviewLogRepository(db);
    await repo.save(makeLog({ id: 'log-1', cardId: 'card-1' }));
    await repo.save(makeLog({ id: 'log-2', cardId: 'card-1', reviewedAt: 2_000_000 }));
    await repo.save(makeLog({ id: 'log-3', cardId: 'card-2' }));

    const logs = await repo.getByCardId('card-1');
    expect(logs).toHaveLength(2);
    expect(logs.every((l) => l.cardId === 'card-1')).toBe(true);
    db.close();
  });

  it('刷新或重启浏览器后复习日志仍可读取（新实例模拟重启）', async () => {
    const db1 = await openDatabase(TEST_DB);
    const repo1 = new ReviewLogRepository(db1);
    await repo1.save(makeLog({ id: 'log-persist', cardId: 'card-persist' }));
    db1.close();

    // 模拟浏览器重启
    const db2 = await openDatabase(TEST_DB);
    const repo2 = new ReviewLogRepository(db2);
    const restored = await repo2.getByCardId('card-persist');
    expect(restored).toHaveLength(1);
    expect(restored[0]!.id).toBe('log-persist');
    db2.close();
  });

  it('getAll 返回所有复习日志', async () => {
    const db = await openDatabase(TEST_DB);
    const repo = new ReviewLogRepository(db);
    await repo.save(makeLog({ id: 'l1', cardId: 'c1' }));
    await repo.save(makeLog({ id: 'l2', cardId: 'c2' }));

    const all = await repo.getAll();
    expect(all).toHaveLength(2);
    db.close();
  });
});

describe('STORES — 仓库定义', () => {
  it('初始化的仓库名称与 STORES 常量一致', async () => {
    const db = await openDatabase(TEST_DB);
    expect(db.objectStoreNames.contains(STORES.cards)).toBe(true);
    expect(db.objectStoreNames.contains(STORES.reviewLogs)).toBe(true);
    expect(db.objectStoreNames.contains(STORES.words)).toBe(true);
    expect(db.objectStoreNames.contains(STORES.decks)).toBe(true);
    expect(db.objectStoreNames.contains(STORES.behaviorEvents)).toBe(true);
    db.close();
  });
});

// ─── Issue #19：持久化层唯一约束与原子提交 ───────────────────────

describe('CardRepository — 唯一索引与原子提交（Issue #19 AC1/AC3）', () => {
  afterEach(async () => {
    await deleteDatabase(TEST_DB);
  });

  it('AC1：唯一索引拒绝同 wordId 不同 id 的重复学习卡', async () => {
    const db = await openDatabase(TEST_DB);
    const repo = new CardRepository(db);
    await repo.save(makeCard({ id: 'card-a', wordId: 'w-dup' }));

    // 同 wordId 不同 id：唯一索引拒绝
    await expect(repo.save(makeCard({ id: 'card-b', wordId: 'w-dup' }))).rejects.toThrow(
      /已有学习卡|ConstraintError/i,
    );

    // 同 id 覆盖仍允许（更新现有学习卡）
    await repo.save(makeCard({ id: 'card-a', wordId: 'w-dup', stage: 'long-term' }));
    const all = await repo.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.stage).toBe('long-term');
    db.close();
  });

  it('AC3：saveCardAndLog 在单一事务内原子写入学习卡与复习日志', async () => {
    const db = await openDatabase(TEST_DB);
    const cardRepo = new CardRepository(db);
    const logRepo = new ReviewLogRepository(db);
    const card = makeCard({ id: 'card-1', wordId: 'w-1' });
    const log = makeLog({ id: 'log-1', cardId: 'card-1', wordId: 'w-1' });

    await cardRepo.save(card);
    await cardRepo.saveCardAndLog(card, log);

    // 两边同时持久化
    await expect(cardRepo.getById('card-1')).resolves.toBeDefined();
    await expect(logRepo.getById('log-1')).resolves.toBeDefined();
    db.close();
  });

  it.each([
    ['wordId', { wordId: 'w-replaced' }],
    ['deckId', { deckId: 'deck-replaced' }],
  ])('saveCardAndLog 发现 %s 身份变化时回滚且不推进 revision', async (_field, change) => {
    const db = await openDatabase(TEST_DB);
    const cardRepo = new CardRepository(db);
    const logRepo = new ReviewLogRepository(db);
    const current = makeCard({ id: 'card-update', wordId: 'w-update' });
    const stale = { ...current, ...change };
    const log = makeLog({
      id: `log-${_field}`,
      cardId: stale.id,
      wordId: stale.wordId,
    });
    await cardRepo.save(current);
    const before = await readStorageMeta(db);

    await expect(cardRepo.saveCardAndLog(stale, log)).rejects.toMatchObject({
      code: 'CARD_IDENTITY_CONFLICT',
      reason: 'changed',
    });

    await expect(cardRepo.getById(current.id)).resolves.toEqual(current);
    await expect(logRepo.getAll()).resolves.toEqual([]);
    expect(await readStorageMeta(db)).toEqual(before);
    db.close();
  });

  it('AC3：saveCardAndLog 更新不存在的学习卡时整体回滚', async () => {
    const db = await openDatabase(TEST_DB);
    const cardRepo = new CardRepository(db);
    const logRepo = new ReviewLogRepository(db);
    await cardRepo.save(makeCard({ id: 'card-existing', wordId: 'w-existing' }));

    const conflictCard = makeCard({ id: 'card-conflict', wordId: 'w-existing' });
    const conflictLog = makeLog({
      id: 'log-conflict',
      cardId: 'card-conflict',
      wordId: 'w-existing',
    });
    await expect(cardRepo.saveCardAndLog(conflictCard, conflictLog)).rejects.toMatchObject({
      code: 'CARD_IDENTITY_CONFLICT',
      reason: 'missing',
    });

    // 冲突卡未写入
    await expect(cardRepo.getById('card-conflict')).resolves.toBeUndefined();
    // 冲突日志也未写入（事务回滚：学习卡与复习日志要么同时成功要么都不发生）
    await expect(logRepo.getById('log-conflict')).resolves.toBeUndefined();
    // 原有卡仍在
    await expect(cardRepo.getById('card-existing')).resolves.toBeDefined();
    db.close();
  });

  it('AC3：saveCardAndLog 事务回滚不残留部分写入到复习日志', async () => {
    const db = await openDatabase(TEST_DB);
    const cardRepo = new CardRepository(db);
    const logRepo = new ReviewLogRepository(db);

    await cardRepo.save(makeCard({ id: 'c0', wordId: 'w-0' }));
    await expect(
      cardRepo.saveCardAndLog(
        makeCard({ id: 'c1', wordId: 'w-0' }),
        makeLog({ id: 'l1', cardId: 'c1', wordId: 'w-0' }),
      ),
    ).rejects.toThrow();

    // 复习日志仓库应为空（事务整体回滚）
    const allLogs = await logRepo.getAll();
    expect(allLogs).toHaveLength(0);
    db.close();
  });
});

describe('CardRepository — 答题提交幂等', () => {
  afterEach(async () => {
    await deleteDatabase(TEST_DB);
  });

  it('同一日志 id 只提交一次，并返回原日志与当前学习卡', async () => {
    const db = await openDatabase(TEST_DB);
    const cardRepo = new CardRepository(db);
    const logRepo = new ReviewLogRepository(db);
    const card = makeCard({ id: 'card-idempotent', wordId: 'w-idempotent', shortTermStep: 0 });
    const log = makeLog({
      id: 'question:stable-question',
      cardId: card.id,
      wordId: card.wordId,
    });

    await cardRepo.save(card);
    const first = await cardRepo.saveSubmission(card, log);
    expect(first).toMatchObject({ inserted: true, card, log });

    const proposedProgressedCard = makeCard({
      ...card,
      stage: 'long-term',
      shortTermStep: 1,
      updatedAt: 2_000_000,
    });
    const retriedLog = makeLog({
      ...log,
      selectedAnswer: '重试时改变的答案',
      reviewedAt: 2_000_000,
    });
    const duplicate = await cardRepo.saveSubmission(proposedProgressedCard, retriedLog);

    expect(duplicate).toMatchObject({ inserted: false, card, log });
    await expect(cardRepo.getById(card.id)).resolves.toEqual(card);
    await expect(logRepo.getAll()).resolves.toEqual([log]);
    db.close();
  });

  it('并发提交同一日志 id 时，仅一个事务写入并推进学习卡', async () => {
    const db = await openDatabase(TEST_DB);
    const cardRepo = new CardRepository(db);
    const card = makeCard({ id: 'card-race', wordId: 'w-race' });
    const firstLog = makeLog({ id: 'question:race', cardId: card.id, wordId: card.wordId });
    const secondLog = makeLog({
      id: firstLog.id,
      cardId: card.id,
      wordId: card.wordId,
      selectedAnswer: '另一个答案',
    });

    await cardRepo.save(card);
    const results = await Promise.all([
      cardRepo.saveSubmission(card, firstLog),
      cardRepo.saveSubmission({ ...card, updatedAt: 2_000_000 }, secondLog),
    ]);

    expect(results.filter((result) => result.inserted)).toHaveLength(1);
    expect(results.filter((result) => !result.inserted)).toHaveLength(1);
    await expect(new ReviewLogRepository(db).getAll()).resolves.toHaveLength(1);
    db.close();
  });

  it.each([
    ['cardId', { cardId: 'card-other' }],
    ['wordId', { wordId: 'w-other' }],
    ['questionType', { questionType: 'zh-to-en' as const }],
  ])('已存在日志的 %s 不一致时拒绝覆盖', async (_field, mismatch) => {
    const db = await openDatabase(TEST_DB);
    const cardRepo = new CardRepository(db);
    const logRepo = new ReviewLogRepository(db);
    const card = makeCard({ id: 'card-conflict', wordId: 'w-conflict' });
    const original = makeLog({ id: 'question:conflict', cardId: card.id, wordId: card.wordId });
    await cardRepo.save(card);
    await cardRepo.saveSubmission(card, original);

    await expect(cardRepo.saveSubmission(card, { ...original, ...mismatch })).rejects.toThrow(
      /不一致|冲突/,
    );

    await expect(logRepo.getById(original.id)).resolves.toEqual(original);
    await expect(cardRepo.getById(card.id)).resolves.toEqual(card);
    db.close();
  });

  it('答题最终写事务发现卡已删除时拒绝复活且不推进 revision', async () => {
    const db = await openDatabase(TEST_DB);
    const cardRepo = new CardRepository(db);
    const logRepo = new ReviewLogRepository(db);
    const card = makeCard({ id: 'card-cleared', wordId: 'w-cleared' });
    const log = makeLog({
      id: 'question:cleared',
      cardId: card.id,
      wordId: card.wordId,
    });
    await cardRepo.save(card);
    const before = await readStorageMeta(db);
    await deleteCardRaw(db, card.id);

    await expect(cardRepo.saveSubmission(card, log)).rejects.toMatchObject({
      code: 'CARD_IDENTITY_CONFLICT',
      reason: 'missing',
    });

    await expect(cardRepo.getById(card.id)).resolves.toBeUndefined();
    await expect(logRepo.getAll()).resolves.toEqual([]);
    expect(await readStorageMeta(db)).toEqual(before);
    db.close();
  });

  it.each([
    ['wordId', { wordId: 'w-replaced' }],
    ['deckId', { deckId: 'deck-replaced' }],
  ])('答题最终写事务发现 %s 变化时拒绝覆盖且不推进 revision', async (_field, change) => {
    const db = await openDatabase(TEST_DB);
    const cardRepo = new CardRepository(db);
    const logRepo = new ReviewLogRepository(db);
    const current = makeCard({ id: 'card-identity', wordId: 'w-identity' });
    const stale = { ...current, ...change };
    const log = makeLog({
      id: `question:${_field}`,
      cardId: stale.id,
      wordId: stale.wordId,
    });
    await cardRepo.save(current);
    const before = await readStorageMeta(db);

    await expect(cardRepo.saveSubmission(stale, log)).rejects.toMatchObject({
      code: 'CARD_IDENTITY_CONFLICT',
      reason: 'changed',
    });

    await expect(cardRepo.getById(current.id)).resolves.toEqual(current);
    await expect(logRepo.getAll()).resolves.toEqual([]);
    expect(await readStorageMeta(db)).toEqual(before);
    db.close();
  });
});

describe('权威仓库 — storageMeta revision', () => {
  afterEach(async () => {
    await deleteDatabase(TEST_DB);
  });

  it('每个实际写事务递增一次，重复提交不递增', async () => {
    const db = await openDatabase(TEST_DB);
    const cardRepo = new CardRepository(db);
    const logRepo = new ReviewLogRepository(db);
    const card = makeCard({ id: 'rev-card', wordId: 'w-rev' });
    const submissionCard = makeCard({ id: 'rev-submission', wordId: 'w-submission' });
    const submissionLog = makeLog({
      id: 'question:rev',
      cardId: submissionCard.id,
      wordId: submissionCard.wordId,
    });
    await cardRepo.save(card);
    await cardRepo.save(submissionCard);
    const initial = await readStorageMeta(db);

    await cardRepo.save(card);
    expect((await readStorageMeta(db)).revision).toBe(initial.revision + 1);

    const firstLog = makeLog({ id: 'rev-log-1', cardId: card.id, wordId: card.wordId });
    await cardRepo.saveCardAndLog(card, firstLog);
    expect((await readStorageMeta(db)).revision).toBe(initial.revision + 2);

    await logRepo.save(makeLog({ id: 'rev-log-2', cardId: card.id, wordId: card.wordId }));
    expect((await readStorageMeta(db)).revision).toBe(initial.revision + 3);

    await cardRepo.saveSubmission(submissionCard, submissionLog);
    const afterInsert = await readStorageMeta(db);
    expect(afterInsert.revision).toBe(initial.revision + 4);

    await cardRepo.saveSubmission(submissionCard, submissionLog);
    expect(await readStorageMeta(db)).toEqual(afterInsert);
    expect(afterInsert.generation).toBe(initial.generation);
    expect(afterInsert.pendingBackup).toBe(true);
    db.close();
  });

  it('写事务失败时 revision 回滚', async () => {
    const db = await openDatabase(TEST_DB);
    const cardRepo = new CardRepository(db);
    await cardRepo.save(makeCard({ id: 'existing', wordId: 'w-existing' }));
    const before = await readStorageMeta(db);

    await expect(
      cardRepo.saveCardAndLog(
        makeCard({ id: 'conflict', wordId: 'w-existing' }),
        makeLog({ id: 'conflict-log', cardId: 'conflict', wordId: 'w-existing' }),
      ),
    ).rejects.toThrow();

    expect(await readStorageMeta(db)).toEqual(before);
    db.close();
  });
});
