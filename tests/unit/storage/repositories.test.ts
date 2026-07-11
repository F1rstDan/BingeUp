import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, STORES } from '@/storage/database';
import { MIGRATIONS } from '@/storage/migrations';
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
    ...overrides,
  };
}

describe('CardRepository — 学习卡持久化（Issue #5 验收标准 3）', () => {
  afterEach(async () => {
    await deleteDatabase(TEST_DB);
  });

  it('save 写入后 getById 可读', async () => {
    const db = await openDatabase(TEST_DB, MIGRATIONS);
    const repo = new CardRepository(db);
    const card = makeCard();
    await repo.save(card);

    const read = await repo.getById('card-1');
    expect(read).toEqual(card);
    db.close();
  });

  it('getByWordId 通过索引查找学习卡', async () => {
    const db = await openDatabase(TEST_DB, MIGRATIONS);
    const repo = new CardRepository(db);
    await repo.save(makeCard({ id: 'card-a', wordId: 'w-abandon' }));
    await repo.save(makeCard({ id: 'card-b', wordId: 'w-benefit' }));

    const found = await repo.getByWordId('w-abandon');
    expect(found).toBeDefined();
    expect(found!.id).toBe('card-a');
    db.close();
  });

  it('getByWordId 不存在时返回 undefined', async () => {
    const db = await openDatabase(TEST_DB, MIGRATIONS);
    const repo = new CardRepository(db);
    const found = await repo.getByWordId('nonexistent');
    expect(found).toBeUndefined();
    db.close();
  });

  it('save 覆盖同 id 记录（更新学习卡）', async () => {
    const db = await openDatabase(TEST_DB, MIGRATIONS);
    const repo = new CardRepository(db);
    await repo.save(makeCard({ stage: 'short-term' }));
    await repo.save(makeCard({ stage: 'long-term', updatedAt: 2_000_000 }));

    const read = await repo.getById('card-1');
    expect(read!.stage).toBe('long-term');
    expect(read!.updatedAt).toBe(2_000_000);
    db.close();
  });

  it('刷新或重启浏览器后学习卡仍可读取（新实例模拟重启）', async () => {
    const db1 = await openDatabase(TEST_DB, MIGRATIONS);
    const repo1 = new CardRepository(db1);
    await repo1.save(makeCard({ id: 'card-persist', wordId: 'w-persist' }));
    db1.close();

    // 模拟浏览器重启：丢弃旧实例，用新实例重新打开数据库
    const db2 = await openDatabase(TEST_DB, MIGRATIONS);
    const repo2 = new CardRepository(db2);
    const restored = await repo2.getById('card-persist');
    expect(restored).toBeDefined();
    expect(restored!.wordId).toBe('w-persist');
    db2.close();
  });

  it('getAll 返回所有学习卡', async () => {
    const db = await openDatabase(TEST_DB, MIGRATIONS);
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
    const db = await openDatabase(TEST_DB, MIGRATIONS);
    const repo = new ReviewLogRepository(db);
    const log = makeLog();
    await repo.save(log);

    const read = await repo.getById('log-1');
    expect(read).toEqual(log);
    db.close();
  });

  it('getByCardId 通过索引查找该学习卡的所有复习日志', async () => {
    const db = await openDatabase(TEST_DB, MIGRATIONS);
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
    const db1 = await openDatabase(TEST_DB, MIGRATIONS);
    const repo1 = new ReviewLogRepository(db1);
    await repo1.save(makeLog({ id: 'log-persist', cardId: 'card-persist' }));
    db1.close();

    // 模拟浏览器重启
    const db2 = await openDatabase(TEST_DB, MIGRATIONS);
    const repo2 = new ReviewLogRepository(db2);
    const restored = await repo2.getByCardId('card-persist');
    expect(restored).toHaveLength(1);
    expect(restored[0]!.id).toBe('log-persist');
    db2.close();
  });

  it('getAll 返回所有复习日志', async () => {
    const db = await openDatabase(TEST_DB, MIGRATIONS);
    const repo = new ReviewLogRepository(db);
    await repo.save(makeLog({ id: 'l1', cardId: 'c1' }));
    await repo.save(makeLog({ id: 'l2', cardId: 'c2' }));

    const all = await repo.getAll();
    expect(all).toHaveLength(2);
    db.close();
  });
});

describe('STORES — 仓库与迁移一致性', () => {
  it('迁移创建的仓库名称与 STORES 常量一致', async () => {
    const db = await openDatabase(TEST_DB, MIGRATIONS);
    expect(db.objectStoreNames.contains(STORES.cards)).toBe(true);
    expect(db.objectStoreNames.contains(STORES.reviewLogs)).toBe(true);
    expect(db.objectStoreNames.contains(STORES.words)).toBe(true);
    expect(db.objectStoreNames.contains(STORES.decks)).toBe(true);
    db.close();
  });
});
