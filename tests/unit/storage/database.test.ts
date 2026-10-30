import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DATABASE_VERSION,
  STORAGE_META_ID,
  STORES,
  acknowledgeStorageBackup,
  idbGet,
  idbGetAll,
  idbPut,
  normalizeStorageMeta,
  openDatabase,
  readStorageMeta,
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

async function writeRawStorageMeta(db: IDBDatabase, value: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORES.storageMeta, 'readwrite');
    tx.objectStore(STORES.storageMeta).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function deleteRawStorageMeta(db: IDBDatabase): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORES.storageMeta, 'readwrite');
    tx.objectStore(STORES.storageMeta).delete(STORAGE_META_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function storageMetaInvalidError(value: unknown): unknown {
  try {
    normalizeStorageMeta(value);
  } catch (error) {
    return error;
  }
  return null;
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

  it('首次打开时创建版本 1、8 个仓库和索引', async () => {
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
    expect(await readStorageMeta(db)).toMatchObject({
      id: STORAGE_META_ID,
      revision: 0,
      generation: expect.stringMatching(/^[0-9a-f-]{36}$/),
      pendingBackup: true,
      committedAt: 0,
    });
    db.close();
  });

  it('结构不完整时拒绝打开，不自动升级、删库或修改记录', async () => {
    const incomplete = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(TEST_DB, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORES.cards, { keyPath: 'id' }).put(CARD);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    incomplete.close();
    await expect(openDatabase(TEST_DB)).rejects.toThrow('数据库结构与当前内测代码不一致');
    const unchanged = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(TEST_DB);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(unchanged.version).toBe(1);
    expect([...unchanged.objectStoreNames]).toEqual([STORES.cards]);
    expect(await idbGetAll(unchanged, STORES.cards)).toEqual([CARD]);
    unchanged.close();
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

  it('旧版本的备份确认不能清除新写入或新代次的待备份标记', async () => {
    const db = await openDatabase(TEST_DB);
    const original = await readStorageMeta(db);
    await idbPut(db, STORES.cards, CARD);
    const changed = await readStorageMeta(db);
    await acknowledgeStorageBackup(db, original);
    expect(await readStorageMeta(db)).toEqual(changed);
    await acknowledgeStorageBackup(db, { ...changed, generation: 'another-generation' });
    expect(await readStorageMeta(db)).toEqual(changed);
    await acknowledgeStorageBackup(db, changed);
    expect(await readStorageMeta(db)).toEqual({ ...changed, pendingBackup: false });
    db.close();
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

describe('storageMeta 严格校验', () => {
  afterEach(async () => {
    await deleteDatabase();
  });

  it('拒绝缺失、负数和溢出 revision，不生成替代 stamp', () => {
    const generation = '00000000-0000-4000-8000-000000000000';
    const valid = {
      id: STORAGE_META_ID,
      revision: 3,
      generation,
      pendingBackup: false,
      committedAt: 100,
    };
    expect(normalizeStorageMeta(valid)).toEqual(valid);

    for (const invalid of [
      undefined,
      null,
      { ...valid, revision: -1 },
      { ...valid, revision: Number.MAX_SAFE_INTEGER + 1 },
      { ...valid, generation: 'not-a-generation' },
      { ...valid, pendingBackup: 1 },
      { ...valid, committedAt: -1 },
      { ...valid, committedAt: 1.5 },
    ]) {
      expect(storageMetaInvalidError(invalid)).toMatchObject({ code: 'STORAGE_META_INVALID' });
    }
  });

  it('v2 中 meta 缺失时读取失败且不会在运行期补建', async () => {
    const db = await openDatabase(TEST_DB);
    await deleteRawStorageMeta(db);

    await expect(readStorageMeta(db)).rejects.toMatchObject({ code: 'STORAGE_META_INVALID' });
    await expect(idbGet(db, STORES.storageMeta, STORAGE_META_ID)).resolves.toBeUndefined();
    db.close();
  });

  it('非法 meta 使权威写入整体中止，学习卡和原始异常记录保持不变', async () => {
    const db = await openDatabase(TEST_DB);
    await idbPut(db, STORES.cards, CARD);
    const invalid = {
      id: STORAGE_META_ID,
      revision: -1,
      generation: '00000000-0000-4000-8000-000000000000',
      pendingBackup: true,
      committedAt: 0,
    };
    await writeRawStorageMeta(db, invalid);

    await expect(idbPut(db, STORES.cards, { ...CARD, updatedAt: 2 })).rejects.toMatchObject({
      code: 'STORAGE_META_INVALID',
    });
    await expect(idbGetAll(db, STORES.cards)).resolves.toEqual([CARD]);
    await expect(idbGet(db, STORES.storageMeta, STORAGE_META_ID)).resolves.toEqual(invalid);
    db.close();
  });

  it('revision 已到安全整数上限时拒绝递增并回滚写入', async () => {
    const db = await openDatabase(TEST_DB);
    const atLimit = {
      id: STORAGE_META_ID,
      revision: Number.MAX_SAFE_INTEGER,
      generation: '00000000-0000-4000-8000-000000000000',
      pendingBackup: false,
      committedAt: 100,
    };
    await writeRawStorageMeta(db, atLimit);

    await expect(idbPut(db, STORES.cards, CARD)).rejects.toThrow(/溢出/);
    await expect(idbGetAll(db, STORES.cards)).resolves.toEqual([]);
    await expect(idbGet(db, STORES.storageMeta, STORAGE_META_ID)).resolves.toEqual(atLimit);
    db.close();
  });

  it('非法 meta 不允许 ack 清除待备份标记', async () => {
    const db = await openDatabase(TEST_DB);
    const invalid = {
      id: STORAGE_META_ID,
      revision: 4,
      generation: '00000000-0000-4000-8000-000000000000',
      pendingBackup: true,
      committedAt: -1,
    };
    await writeRawStorageMeta(db, invalid);

    await expect(
      acknowledgeStorageBackup(db, {
        generation: invalid.generation,
        revision: invalid.revision,
      }),
    ).rejects.toMatchObject({ code: 'STORAGE_META_INVALID' });
    await expect(idbGet(db, STORES.storageMeta, STORAGE_META_ID)).resolves.toEqual(invalid);
    db.close();
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
    const meta = await readStorageMeta(rebuilt);
    expect(meta).toMatchObject({ revision: 0, pendingBackup: true });
    rebuilt.close();
  });
});
