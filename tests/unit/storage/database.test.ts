import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DATABASE_VERSION,
  STORES,
  idbGetAll,
  idbPut,
  openDatabase,
  rebuildDatabase,
} from '@/storage/database';
import type { CardRecord } from '@/types';

const TEST_DB = 'test-current-database';

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(TEST_DB);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

const CARD: CardRecord = {
  id: 'card-1',
  wordId: 'w-test',
  deckId: 'deck-cet4',
  stage: 'short-term',
  origin: 'accepted-new',
  createdAt: 1,
  updatedAt: 1,
};

describe('IndexedDB 结构', () => {
  afterEach(async () => {
    await deleteDatabase();
  });

  it('首次打开时创建版本 1、7 个仓库和索引', async () => {
    const db = await openDatabase(TEST_DB);
    expect(db.version).toBe(1);
    expect([...db.objectStoreNames].sort()).toEqual(Object.values(STORES).sort());

    const cards = db.transaction(STORES.cards).objectStore(STORES.cards);
    expect(cards.index('byWordId').unique).toBe(true);
    expect(db.transaction(STORES.reviewLogs).objectStore(STORES.reviewLogs).indexNames).toContain(
      'byCardId',
    );
    expect(db.transaction(STORES.sessionLogs).objectStore(STORES.sessionLogs).indexNames).toContain(
      'byStartedAt',
    );
    expect(
      db.transaction(STORES.behaviorEvents).objectStore(STORES.behaviorEvents).indexNames,
    ).toContain('byOccurredAt');
    db.close();
  });

  it('重新打开时保留学习数据', async () => {
    const first = await openDatabase(TEST_DB);
    await idbPut(first, STORES.cards, CARD);
    first.close();

    const reopened = await openDatabase(TEST_DB);
    expect(reopened.version).toBe(DATABASE_VERSION);
    expect(await idbGetAll(reopened, STORES.cards)).toEqual([CARD]);
    reopened.close();
  });

  it('删除数据空间时主动关闭已有连接', async () => {
    const connection = await openDatabase(TEST_DB);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(TEST_DB);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    expect(() => connection.transaction(STORES.cards)).toThrow();
  });
});

describe('显式故障重建', () => {
  afterEach(async () => {
    await deleteDatabase();
  });

  it('清空数据并重建完整结构', async () => {
    const original = await openDatabase(TEST_DB);
    await idbPut(original, STORES.cards, CARD);
    original.close();

    const rebuilt = await rebuildDatabase(TEST_DB);
    expect(rebuilt.version).toBe(DATABASE_VERSION);
    expect([...rebuilt.objectStoreNames].sort()).toEqual(Object.values(STORES).sort());
    expect(await idbGetAll(rebuilt, STORES.cards)).toEqual([]);
    rebuilt.close();
  });
});
