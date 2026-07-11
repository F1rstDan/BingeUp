/**
 * IndexedDB 封装与版本迁移（Issue #5 验收标准 4）。
 *
 * 设计要点：
 * - 迁移在 `onupgradeneeded` 中按版本顺序执行，只运行 oldVersion 之后的迁移；
 * - 迁移失败时显式中止事务并抛出错误，不静默清空既有数据；
 * - 提供 Promise 风格的 IDB 辅助函数供仓库使用。
 */

/** 对象仓库名称常量。 */
export const STORES = {
  cards: 'cards',
  reviewLogs: 'reviewLogs',
  words: 'words',
  decks: 'decks',
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

/** 单次版本迁移。 */
export interface Migration {
  /** 目标版本号。 */
  version: number;
  description: string;
  run: (db: IDBDatabase, transaction: IDBTransaction) => void;
}

/**
 * 打开数据库并执行版本迁移。
 *
 * 迁移失败时会中止事务、拒绝 Promise，既有数据不会被清空。
 */
export function openDatabase(name: string, migrations: Migration[]): Promise<IDBDatabase> {
  if (migrations.length === 0) {
    return Promise.reject(new Error('迁移列表不能为空'));
  }
  const targetVersion = migrations[migrations.length - 1]!.version;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, targetVersion);
    let migrationError: Error | null = null;

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      if (tx === null) {
        migrationError = new Error('版本迁移事务不可用');
        return;
      }
      try {
        for (const migration of migrations) {
          if (migration.version > event.oldVersion) {
            migration.run(db, tx);
          }
        }
      } catch (err) {
        // 捕获迁移错误，中止事务以保留既有数据。
        migrationError = err instanceof Error ? err : new Error(String(err));
        tx.abort();
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      reject(migrationError ?? request.error ?? new Error('数据库打开失败'));
    };
    request.onblocked = () => {
      reject(new Error('数据库打开被阻塞，请关闭其他标签页后重试'));
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
export async function idbGet<T>(db: IDBDatabase, store: StoreName, key: IDBValidKey): Promise<T | undefined> {
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
