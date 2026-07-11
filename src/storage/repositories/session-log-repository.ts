import type { SessionLogRecord } from '@/types';
import { STORES, idbPut, idbGetAll } from '@/storage/database';

/**
 * 学习会话日志仓库端口（Issue #12）。
 *
 * 内容控制器在结束交互时写入会话日志；统计服务读取全部会话日志计算指标。
 */
export interface SessionLogRepositoryPort {
  save(log: SessionLogRecord): Promise<void>;
  getAll(): Promise<SessionLogRecord[]>;
}

/** IndexedDB 驱动的学习会话日志仓库。 */
export class SessionLogRepository implements SessionLogRepositoryPort {
  constructor(private readonly db: IDBDatabase) {}

  async save(log: SessionLogRecord): Promise<void> {
    await idbPut(this.db, STORES.sessionLogs, log);
  }

  async getAll(): Promise<SessionLogRecord[]> {
    return idbGetAll<SessionLogRecord>(this.db, STORES.sessionLogs);
  }
}
