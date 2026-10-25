/** IndexedDB 连接、结构初始化与事务辅助函数。 */

export const DATABASE_NAME = 'bingeup';
export const DATABASE_VERSION = 1;

/** 对象仓库名称常量。 */
export const STORES = {
  cards: 'cards',
  reviewLogs: 'reviewLogs',
  words: 'words',
  decks: 'decks',
  sessionLogs: 'sessionLogs',
  behaviorEvents: 'behaviorEvents',
  authoritativeState: 'authoritativeState',
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

function createSchema(db: IDBDatabase): void {
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

    request.onupgradeneeded = () => {
      try {
        createSchema(request.result);
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

/** 等待事务完成（用于写操作提交）。 */
function awaitTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('事务失败'));
    tx.onabort = () => reject(tx.error ?? new Error('事务已中止'));
  });
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
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  await awaitTransaction(tx);
}

/** 按 key 删除单条记录；key 不存在时视为成功。 */
export async function idbDelete(
  db: IDBDatabase,
  store: StoreName,
  key: IDBValidKey,
): Promise<void> {
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
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
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).clear();
  await awaitTransaction(tx);
}

/** 在一个事务内完整替换多个仓库；任一请求失败会回滚全部仓库。 */
export async function idbReplaceAll(
  db: IDBDatabase,
  records: Partial<Record<StoreName, readonly unknown[]>>,
): Promise<void> {
  const stores = Object.keys(records) as StoreName[];
  const tx = db.transaction(stores, 'readwrite');
  try {
    for (const storeName of stores) {
      const store = tx.objectStore(storeName);
      store.clear();
      for (const record of records[storeName] ?? []) store.put(record);
    }
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
  key: IDBValidKey,
): Promise<T[]> {
  const tx = db.transaction(store, 'readonly');
  const index = tx.objectStore(store).index(indexName);
  const results = await awaitRequest<T[]>(index.getAll(key));
  return results;
}
