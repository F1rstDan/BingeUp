import type { CardRecord, ReviewLogRecord } from '@/types';
import { STORES, idbGet, idbGetAll, idbGetByIndex } from '@/storage/database';

/**
 * 持久化层抛出的唯一约束冲突错误（Issue #19 AC1/AC2）。
 * LearningService 捕获此错误后将单词视为“已有学习卡”，实现幂等接受。
 */
export class CardUniquenessError extends Error {
  constructor(public readonly wordId: string) {
    super(`单词已有学习卡，持久化层拒绝重复创建：${wordId}`);
    this.name = 'CardUniquenessError';
  }
}

/**
 * 学习卡仓库端口。学习服务通过此端口访问持久化层，
 * 测试可用内存实现替换（见 spec 的 Testing Decisions）。
 *
 * Issue #19 AC3：`saveCardAndLog` 在同一持久化事务内更新学习卡并追加复习日志，
 * 保证一次题目提交的调度更新与日志写入要么同时成功、要么都不发生。
 */
export interface CardRepositoryPort {
  save(card: CardRecord): Promise<void>;
  getById(id: string): Promise<CardRecord | undefined>;
  getByWordId(wordId: string): Promise<CardRecord | undefined>;
  getAll(): Promise<CardRecord[]>;
  /**
   * 在同一持久化事务内更新学习卡并写入复习日志（Issue #19 AC3）。
   * 任一写入失败会回滚另一写入，保证调度状态与历史始终一致。
   */
  saveCardAndLog(card: CardRecord, log: ReviewLogRecord): Promise<void>;
}

/** IndexedDB 驱动的学习卡仓库。 */
export class CardRepository implements CardRepositoryPort {
  constructor(private readonly db: IDBDatabase) {}

  async save(card: CardRecord): Promise<void> {
    await this.putCardWithUniqueGuard(card);
  }

  async getById(id: string): Promise<CardRecord | undefined> {
    return idbGet<CardRecord>(this.db, STORES.cards, id);
  }

  async getByWordId(wordId: string): Promise<CardRecord | undefined> {
    return idbGetByIndex<CardRecord>(this.db, STORES.cards, 'byWordId', wordId);
  }

  async getAll(): Promise<CardRecord[]> {
    return idbGetAll<CardRecord>(this.db, STORES.cards);
  }

  async saveCardAndLog(card: CardRecord, log: ReviewLogRecord): Promise<void> {
    await this.runCardAndLogTransaction(card, log);
  }

  /**
   * 写入学习卡；若违反 byWordId 唯一约束则抛出 `CardUniquenessError`（Issue #19 AC1/AC2）。
   * `card.id` 与既有记录相同时为合法覆盖（更新学习卡），不触发唯一约束。
   */
  private putCardWithUniqueGuard(card: CardRecord): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORES.cards, 'readwrite');
      const store = tx.objectStore(STORES.cards);
      const request = store.put(card);
      request.onerror = () => {
        const error = request.error;
        if (error !== null && error.name === 'ConstraintError') {
          reject(new CardUniquenessError(card.wordId));
        } else {
          reject(error ?? new Error('学习卡写入失败'));
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        const error = tx.error;
        if (error !== null && error.name === 'ConstraintError') {
          reject(new CardUniquenessError(card.wordId));
        } else {
          reject(error ?? new Error('学习卡事务失败'));
        }
      };
      tx.onabort = () => {
        const error = tx.error;
        if (error !== null && error.name === 'ConstraintError') {
          reject(new CardUniquenessError(card.wordId));
        } else {
          reject(error ?? new Error('学习卡事务已中止'));
        }
      };
    });
  }

  /**
   * 在单一事务内更新 cards 与 reviewLogs 两个仓库（Issue #19 AC3）。
   * 任一请求失败会中止事务并回滚另一仓库的写入。
   * 若 card.wordId 违反唯一约束，抛出 `CardUniquenessError`。
   */
  private runCardAndLogTransaction(card: CardRecord, log: ReviewLogRecord): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([STORES.cards, STORES.reviewLogs], 'readwrite');
      const handleConstraint = (error: DOMException | null, fallback: string) => {
        if (error !== null && error.name === 'ConstraintError') {
          reject(new CardUniquenessError(card.wordId));
        } else {
          reject(error ?? new Error(fallback));
        }
      };
      try {
        tx.objectStore(STORES.cards).put(card);
        tx.objectStore(STORES.reviewLogs).put(log);
      } catch (error) {
        tx.abort();
        handleConstraint(error instanceof DOMException ? error : null, '学习卡与复习日志事务失败');
        return;
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => handleConstraint(tx.error, '学习卡与复习日志事务失败');
      tx.onabort = () => handleConstraint(tx.error, '学习卡与复习日志事务已中止');
    });
  }
}
