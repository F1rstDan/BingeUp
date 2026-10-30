/** IndexedDB 连接、结构初始化与事务辅助函数。 */

import type { StorageMetaRecord } from '@/types';

/**
 * 数据库名是本地存档的持久化身份，不得为了整理命名而更改。
 * 改名会让旧 IndexedDB 无法被读取，表现为关闭浏览器后存档全部丢失。
 */
export const DATABASE_NAME = 'bingeup';
export const DATABASE_VERSION = 2;
export const STORAGE_META_ID = 'current';

/** 对象仓库名称常量。 */
export const STORES = {
  cards: 'cards',
  reviewLogs: 'reviewLogs',
  words: 'words',
  decks: 'decks',
  sessionLogs: 'sessionLogs',
  behaviorEvents: 'behaviorEvents',
  authoritativeState: 'authoritativeState',
  storageMeta: 'storageMeta',
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

function createBaseSchema(db: IDBDatabase): void {
  const cards = db.createObjectStore(STORES.cards, { keyPath: 'id' });
  cards.createIndex('byWordId', 'wordId', { unique: true });

  const logs = db.createObjectStore(STORES.reviewLogs, { keyPath: 'id' });
  logs.createIndex('byCardId', 'cardId', { unique: false });

  db.createObjectStore(STORES.words, { keyPath: 'id' });
  db.createObjectStore(STORES.decks, { keyPath: 'id' });

  const sessions = db.createObjectStore(STORES.sessionLogs, { keyPath: 'id' });
  sessions.createIndex('byStartedAt', 'startedAt', { unique: false });

  const events = db.createObjectStore(STORES.behaviorEvents, { keyPath: 'id' });
  events.createIndex('byOccurredAt', 'occurredAt', { unique: false });

  db.createObjectStore(STORES.authoritativeState, { keyPath: 'id' });
}

export function createInitialStorageMeta(): StorageMetaRecord {
  return {
    id: STORAGE_META_ID,
    revision: 0,
    generation: crypto.randomUUID(),
    pendingBackup: true,
    committedAt: 0,
  };
}

function upgradeSchema(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) createBaseSchema(db);
  if (oldVersion < 2) {
    const store = db.createObjectStore(STORES.storageMeta, { keyPath: 'id' });
    store.add(createInitialStorageMeta());
  }
}

/** 打开数据库；首次打开时创建仓库与索引。 */
export function openDatabase(name = DATABASE_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DATABASE_VERSION);
    let settled = false;
    let openError: Error | null = null;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    request.onupgradeneeded = (event) => {
      try {
        upgradeSchema(request.result, event.oldVersion);
      } catch (err) {
        openError = err instanceof Error ? err : new Error(String(err));
        request.transaction!.abort();
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      if (settled) {
        db.close();
        return;
      }
      // 删除或重建数据空间时，释放其他页面持有的连接。
      db.onversionchange = () => db.close();
      settled = true;
      resolve(db);
    };
    request.onerror = () => {
      fail(openError ?? request.error ?? new Error('数据库打开失败'));
    };
    request.onblocked = () => {
      fail(new Error('数据库打开被阻塞，请关闭其他标签页后重试'));
    };
  });
}

/** 用户明确确认后的故障恢复：删除整个数据空间并按当前结构重建。 */
export function rebuildDatabase(name = DATABASE_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onerror = () => reject(request.error ?? new Error('删除本地数据失败'));
    request.onblocked = () => reject(new Error('数据库被其他页面占用，请关闭其他扩展页面后重试'));
    request.onsuccess = () => {
      openDatabase(name).then(resolve, reject);
    };
  });
}

// ─── IDB 辅助函数 ───────────────────────────────────────────────

/** 等待 IDBRequest 完成。 */
function awaitRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IDB 请求失败'));
  });
}

const transactionFailures = new WeakMap<IDBTransaction, Error>();

function asError(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(fallback);
}

function abortTrackedTransaction(transaction: IDBTransaction, error: unknown): void {
  transactionFailures.set(transaction, asError(error, '存储元数据事务失败'));
  try {
    transaction.abort();
  } catch {
    // 事务已结束时，保留首个跟踪到的失败原因。
  }
}

/** 取得由事务内异步回调记录的原始错误，供调用方保留稳定错误码。 */
export function getTrackedTransactionError(transaction: IDBTransaction, fallback: string): Error {
  return transactionFailures.get(transaction) ?? transaction.error ?? new Error(fallback);
}

/** 等待事务完成（用于写操作提交）。 */
function awaitTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(getTrackedTransactionError(tx, '事务失败'));
    tx.onabort = () => reject(getTrackedTransactionError(tx, '事务已中止'));
  });
}

export class StorageMetaInvalidError extends Error {
  readonly code = 'STORAGE_META_INVALID';

  constructor(message = '存储元数据无效') {
    super(message);
    this.name = 'StorageMetaInvalidError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeStorageMeta(value: unknown): StorageMetaRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new StorageMetaInvalidError('storageMeta 缺失或不是对象');
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.id !== STORAGE_META_ID) {
    throw new StorageMetaInvalidError('storageMeta.id 无效');
  }
  if (
    typeof candidate.revision !== 'number' ||
    !Number.isSafeInteger(candidate.revision) ||
    candidate.revision < 0
  ) {
    throw new StorageMetaInvalidError('storageMeta.revision 必须是非负安全整数');
  }
  if (typeof candidate.generation !== 'string' || !UUID_PATTERN.test(candidate.generation)) {
    throw new StorageMetaInvalidError('storageMeta.generation 必须是 UUID');
  }
  if (typeof candidate.pendingBackup !== 'boolean') {
    throw new StorageMetaInvalidError('storageMeta.pendingBackup 必须是布尔值');
  }
  if (
    typeof candidate.committedAt !== 'number' ||
    !Number.isSafeInteger(candidate.committedAt) ||
    candidate.committedAt < 0
  ) {
    throw new StorageMetaInvalidError('storageMeta.committedAt 必须是非负安全整数');
  }
  return {
    id: candidate.id,
    revision: candidate.revision,
    generation: candidate.generation,
    pendingBackup: candidate.pendingBackup,
    committedAt: candidate.committedAt,
  };
}

/** 所有权威写事务必须同时包含 storageMeta，才能原子提交修订号。 */
export function openTrackedTransaction(
  db: IDBDatabase,
  stores: StoreName | readonly StoreName[],
  mode: IDBTransactionMode = 'readwrite',
): IDBTransaction {
  const names = [...(typeof stores === 'string' ? [stores] : stores), STORES.storageMeta];
  return db.transaction([...new Set(names)], mode);
}

export async function readStorageMeta(db: IDBDatabase): Promise<StorageMetaRecord> {
  return normalizeStorageMeta(await idbGet(db, STORES.storageMeta, STORAGE_META_ID));
}

/** 只确认已写入快照的版本；备份期间的新写入仍保持待备份状态。 */
export async function acknowledgeStorageBackup(
  db: IDBDatabase,
  saved: Pick<StorageMetaRecord, 'generation' | 'revision'>,
): Promise<void> {
  const tx = db.transaction(STORES.storageMeta, 'readwrite');
  const done = awaitTransaction(tx);
  const store = tx.objectStore(STORES.storageMeta);
  const request = store.get(STORAGE_META_ID);
  request.onsuccess = () => {
    try {
      const current = normalizeStorageMeta(request.result);
      if (current.generation === saved.generation && current.revision === saved.revision) {
        store.put({ ...current, pendingBackup: false });
      }
    } catch (error) {
      abortTrackedTransaction(tx, error);
    }
  };
  request.onerror = () => abortTrackedTransaction(tx, request.error);
  await done;
}

/** 在已经包含 storageMeta 的写事务中安排一次 revision 提交。 */
export function markStorageMetaChanged(
  transaction: IDBTransaction,
  options: { rotateGeneration?: boolean } = {},
): void {
  if (transaction.mode !== 'readwrite') {
    throw new Error('只读事务不能更新 storageMeta');
  }
  const store = transaction.objectStore(STORES.storageMeta);
  let request: IDBRequest<StorageMetaRecord | undefined>;
  try {
    request = store.get(STORAGE_META_ID);
  } catch (error) {
    abortTrackedTransaction(transaction, error);
    throw error;
  }
  request.onerror = () => {
    abortTrackedTransaction(transaction, request.error);
  };
  request.onsuccess = () => {
    try {
      const current = normalizeStorageMeta(request.result);
      const nextRevision = current.revision + 1;
      if (!Number.isSafeInteger(nextRevision)) {
        throw new StorageMetaInvalidError('storageMeta.revision 递增后溢出');
      }
      store.put({
        ...current,
        revision: nextRevision,
        generation: options.rotateGeneration ? crypto.randomUUID() : current.generation,
        pendingBackup: true,
        committedAt: Date.now(),
      } satisfies StorageMetaRecord);
    } catch (error) {
      abortTrackedTransaction(transaction, error);
    }
  };
}

/** 按 key 读取单条记录。 */
export async function idbGet<T>(
  db: IDBDatabase,
  store: StoreName,
  key: IDBValidKey,
): Promise<T | undefined> {
  const tx = db.transaction(store, 'readonly');
  const result = await awaitRequest<T>(tx.objectStore(store).get(key));
  return result;
}

/** 写入（或覆盖）一条记录。 */
export async function idbPut<T>(db: IDBDatabase, store: StoreName, value: T): Promise<void> {
  const tx = openTrackedTransaction(db, store);
  tx.objectStore(store).put(value);
  markStorageMetaChanged(tx);
  await awaitTransaction(tx);
}

/** 按 key 删除单条记录；key 不存在时视为成功。 */
export async function idbDelete(
  db: IDBDatabase,
  store: StoreName,
  key: IDBValidKey,
): Promise<void> {
  const tx = openTrackedTransaction(db, store);
  tx.objectStore(store).delete(key);
  markStorageMetaChanged(tx);
  await awaitTransaction(tx);
}

/** 读取仓库内所有记录。 */
export async function idbGetAll<T>(db: IDBDatabase, store: StoreName): Promise<T[]> {
  const tx = db.transaction(store, 'readonly');
  const result = await awaitRequest<T[]>(tx.objectStore(store).getAll());
  return result;
}

/** 返回仓库内记录数。 */
export async function idbCount(db: IDBDatabase, store: StoreName): Promise<number> {
  const tx = db.transaction(store, 'readonly');
  const result = await awaitRequest<number>(tx.objectStore(store).count());
  return result;
}

/** 清空指定仓库内的所有记录（Issue #10 AC4 数据清除）。 */
export async function idbClear(db: IDBDatabase, store: StoreName): Promise<void> {
  const tx = openTrackedTransaction(db, store);
  tx.objectStore(store).clear();
  markStorageMetaChanged(tx);
  await awaitTransaction(tx);
}

/** 在一个事务内完整替换多个仓库；任一请求失败会回滚全部仓库。 */
export async function idbReplaceAll(
  db: IDBDatabase,
  records: Partial<Record<StoreName, readonly unknown[]>>,
  options: { rotateGeneration?: boolean } = {},
): Promise<void> {
  const stores = Object.keys(records) as StoreName[];
  const tx = openTrackedTransaction(db, stores);
  try {
    for (const storeName of stores) {
      const store = tx.objectStore(storeName);
      store.clear();
      for (const record of records[storeName] ?? []) store.put(record);
    }
    markStorageMetaChanged(tx, options);
  } catch (error) {
    tx.abort();
    try {
      await awaitTransaction(tx);
    } catch {
      /* 使用触发中止的原始错误。 */
    }
    throw error;
  }
  await awaitTransaction(tx);
}

/** 按索引查询，返回第一条匹配记录。 */
export async function idbGetByIndex<T>(
  db: IDBDatabase,
  store: StoreName,
  indexName: string,
  key: IDBValidKey,
): Promise<T | undefined> {
  const tx = db.transaction(store, 'readonly');
  const index = tx.objectStore(store).index(indexName);
  const results = await awaitRequest<T[]>(index.getAll(key));
  return results[0];
}

/** 按索引查询，返回所有匹配记录。 */
export async function idbGetAllByIndex<T>(
  db: IDBDatabase,
  store: StoreName,
  indexName: string,
  key: IDBValidKey | IDBKeyRange,
): Promise<T[]> {
  const tx = db.transaction(store, 'readonly');
  const index = tx.objectStore(store).index(indexName);
  const results = await awaitRequest<T[]>(index.getAll(key));
  return results;
}
