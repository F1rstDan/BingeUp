import type { ReviewLogRecord } from '@/types';
import { STORES, idbGet, idbPut, idbGetAll, idbGetAllByIndex } from '@/storage/database';

/**
 * 复习日志仓库端口。学习服务通过此端口写入与查询复习日志。
 */
export interface ReviewLogRepositoryPort {
  save(log: ReviewLogRecord): Promise<void>;
  getById(id: string): Promise<ReviewLogRecord | undefined>;
  getByCardId(cardId: string): Promise<ReviewLogRecord[]>;
  getAll(): Promise<ReviewLogRecord[]>;
}

/** IndexedDB 驱动的复习日志仓库。 */
export class ReviewLogRepository implements ReviewLogRepositoryPort {
  constructor(private readonly db: IDBDatabase) {}

  async save(log: ReviewLogRecord): Promise<void> {
    await idbPut(this.db, STORES.reviewLogs, log);
  }

  async getById(id: string): Promise<ReviewLogRecord | undefined> {
    return idbGet<ReviewLogRecord>(this.db, STORES.reviewLogs, id);
  }

  async getByCardId(cardId: string): Promise<ReviewLogRecord[]> {
    return idbGetAllByIndex<ReviewLogRecord>(this.db, STORES.reviewLogs, 'byCardId', cardId);
  }

  async getAll(): Promise<ReviewLogRecord[]> {
    return idbGetAll<ReviewLogRecord>(this.db, STORES.reviewLogs);
  }
}
