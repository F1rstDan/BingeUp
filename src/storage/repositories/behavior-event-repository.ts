import type { BehaviorEventRecord } from '@/types';
import { STORES, idbGetAll } from '@/storage/database';

export interface BehaviorEventRepositoryPort {
  save(event: BehaviorEventRecord): Promise<void>;
  getAll(): Promise<BehaviorEventRecord[]>;
}

export class BehaviorEventRepository implements BehaviorEventRepositoryPort {
  constructor(private readonly db: IDBDatabase) {}

  save(event: BehaviorEventRecord): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(STORES.behaviorEvents, 'readwrite');
      const store = transaction.objectStore(STORES.behaviorEvents);
      const cursorRequest = store.index('byOccurredAt').openCursor(null, 'prev');

      cursorRequest.onsuccess = () => {
        const lastOccurredAt = cursorRequest.result?.value.occurredAt ?? -1;
        try {
          store.put({
            ...event,
            occurredAt: Math.max(event.occurredAt, lastOccurredAt + 1),
          });
        } catch (error) {
          try {
            transaction.abort();
          } catch {
            // 事务已中止时，保留触发失败的原始错误。
          }
          reject(error);
        }
      };
      cursorRequest.onerror = () => {
        reject(cursorRequest.error ?? new Error('读取行为事件尾项失败'));
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('写入行为事件事务失败'));
      transaction.onabort = () => reject(transaction.error ?? new Error('写入行为事件事务已中止'));
    });
  }

  getAll(): Promise<BehaviorEventRecord[]> {
    return idbGetAll<BehaviorEventRecord>(this.db, STORES.behaviorEvents);
  }
}
