import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, idbPut, idbGet, idbGetAll, idbCount, STORES, type Migration } from '@/storage/database';

const TEST_DB = 'test-bingeup-db';

const V1_MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: '初始结构',
    run: (db) => {
      db.createObjectStore(STORES.cards, { keyPath: 'id' });
      db.createObjectStore(STORES.reviewLogs, { keyPath: 'id' });
    },
  },
];

const FAILING_V2: Migration[] = [
  ...V1_MIGRATIONS,
  {
    version: 2,
    description: '故意失败的迁移',
    run: () => {
      throw new Error('迁移执行失败：模拟错误');
    },
  },
];

const V2_WITH_NEW_STORE: Migration[] = [
  ...V1_MIGRATIONS,
  {
    version: 2,
    description: '新增 words 仓库',
    run: (db) => {
      db.createObjectStore(STORES.words, { keyPath: 'id' });
    },
  },
];

async function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

describe('openDatabase — 全新数据库', () => {
  afterEach(async () => {
    await deleteDatabase(TEST_DB);
  });

  it('打开后包含迁移创建的所有对象仓库', async () => {
    const db = await openDatabase(TEST_DB, V1_MIGRATIONS);

    expect(db.objectStoreNames.contains(STORES.cards)).toBe(true);
    expect(db.objectStoreNames.contains(STORES.reviewLogs)).toBe(true);
    db.close();
  });

  it('数据库版本号等于迁移数组的最后一项版本', async () => {
    const db = await openDatabase(TEST_DB, V1_MIGRATIONS);
    expect(db.version).toBe(1);
    db.close();
  });
});

describe('openDatabase — 版本迁移可执行（Issue #5 验收标准 4）', () => {
  afterEach(async () => {
    await deleteDatabase(TEST_DB);
  });

  it('从 v1 迁移到 v2 后新增的对象仓库存在', async () => {
    const db1 = await openDatabase(TEST_DB, V1_MIGRATIONS);
    db1.close();

    const db2 = await openDatabase(TEST_DB, V2_WITH_NEW_STORE);
    expect(db2.version).toBe(2);
    expect(db2.objectStoreNames.contains(STORES.words)).toBe(true);
    expect(db2.objectStoreNames.contains(STORES.cards)).toBe(true);
    db2.close();
  });

  it('已有数据在升级到新版本后仍然可读', async () => {
    const db1 = await openDatabase(TEST_DB, V1_MIGRATIONS);
    await idbPut(db1, STORES.cards, { id: 'card-1', wordId: 'w-1', stage: 'short-term' });
    db1.close();

    const db2 = await openDatabase(TEST_DB, V2_WITH_NEW_STORE);
    const card = await idbGet<{ id: string; wordId: string }>(db2, STORES.cards, 'card-1');
    expect(card).toBeDefined();
    expect(card!.wordId).toBe('w-1');
    db2.close();
  });

  it('旧页面的连接响应版本变化并自动释放，不会永久阻塞升级', async () => {
    const oldPageDb = await openDatabase(TEST_DB, V1_MIGRATIONS);

    const upgradedDb = await openDatabase(TEST_DB, V2_WITH_NEW_STORE);

    expect(upgradedDb.version).toBe(2);
    expect(() => oldPageDb.transaction(STORES.cards)).toThrow();
    upgradedDb.close();
  });
});

describe('openDatabase — 迁移失败不会静默清空数据（Issue #5 验收标准 4）', () => {
  afterEach(async () => {
    await deleteDatabase(TEST_DB);
  });

  it('迁移失败时抛出错误，不静默吞没', async () => {
    const db1 = await openDatabase(TEST_DB, V1_MIGRATIONS);
    await idbPut(db1, STORES.cards, { id: 'card-1', wordId: 'w-1' });
    db1.close();

    await expect(openDatabase(TEST_DB, FAILING_V2)).rejects.toThrow();
  });

  it('迁移失败后既有学习数据仍然可读', async () => {
    const db1 = await openDatabase(TEST_DB, V1_MIGRATIONS);
    await idbPut(db1, STORES.cards, { id: 'card-1', wordId: 'w-1', stage: 'short-term' });
    await idbPut(db1, STORES.reviewLogs, { id: 'log-1', cardId: 'card-1', isCorrect: true });
    db1.close();

    try {
      await openDatabase(TEST_DB, FAILING_V2);
    } catch {
      // 预期失败
    }

    // 重新以 v1 打开，验证数据仍在
    const db2 = await openDatabase(TEST_DB, V1_MIGRATIONS);
    const card = await idbGet<{ id: string; wordId: string }>(db2, STORES.cards, 'card-1');
    const log = await idbGet<{ id: string; cardId: string }>(db2, STORES.reviewLogs, 'log-1');
    expect(card).toBeDefined();
    expect(card!.wordId).toBe('w-1');
    expect(log).toBeDefined();
    expect(log!.cardId).toBe('card-1');
    db2.close();
  });

  it('迁移失败后数据库版本不变', async () => {
    const db1 = await openDatabase(TEST_DB, V1_MIGRATIONS);
    db1.close();

    try {
      await openDatabase(TEST_DB, FAILING_V2);
    } catch {
      // 预期失败
    }

    const db2 = await openDatabase(TEST_DB, V1_MIGRATIONS);
    expect(db2.version).toBe(1);
    db2.close();
  });
});

describe('IDB 辅助函数', () => {
  afterEach(async () => {
    await deleteDatabase(TEST_DB);
  });

  it('idbPut 写入后 idbGet 可读', async () => {
    const db = await openDatabase(TEST_DB, V1_MIGRATIONS);
    await idbPut(db, STORES.cards, { id: 'card-x', wordId: 'w-x' });
    const record = await idbGet<{ id: string; wordId: string }>(db, STORES.cards, 'card-x');
    expect(record).toEqual({ id: 'card-x', wordId: 'w-x' });
    db.close();
  });

  it('idbGetAll 返回仓库内所有记录', async () => {
    const db = await openDatabase(TEST_DB, V1_MIGRATIONS);
    await idbPut(db, STORES.cards, { id: 'c1' });
    await idbPut(db, STORES.cards, { id: 'c2' });
    await idbPut(db, STORES.cards, { id: 'c3' });
    const all = await idbGetAll<{ id: string }>(db, STORES.cards);
    expect(all).toHaveLength(3);
    db.close();
  });

  it('idbCount 返回仓库内记录数', async () => {
    const db = await openDatabase(TEST_DB, V1_MIGRATIONS);
    await idbPut(db, STORES.cards, { id: 'c1' });
    await idbPut(db, STORES.cards, { id: 'c2' });
    const count = await idbCount(db, STORES.cards);
    expect(count).toBe(2);
    db.close();
  });

  it('idbGet 不存在的 key 返回 undefined', async () => {
    const db = await openDatabase(TEST_DB, V1_MIGRATIONS);
    const record = await idbGet(db, STORES.cards, 'nonexistent');
    expect(record).toBeUndefined();
    db.close();
  });
});
