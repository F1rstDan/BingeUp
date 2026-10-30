import type { CardRecord, ReviewLogRecord } from '@/types';
import {
  STORES,
  idbGet,
  idbGetAll,
  idbGetByIndex,
  getTrackedTransactionError,
  markStorageMetaChanged,
  openTrackedTransaction,
} from '@/storage/database';

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

/** 答题提交持久化结果；重复提交时返回事务内读到的既存日志和当前学习卡。 */
export interface SubmissionSaveResult {
  inserted: boolean;
  card: CardRecord;
  log: ReviewLogRecord;
}

/** 同一 question id 被用于不同学习卡、单词或题型时拒绝覆盖既存日志。 */
export class SubmissionLogConflictError extends Error {
  constructor(
    public readonly logId: string,
    public readonly field: 'cardId' | 'wordId' | 'questionType',
  ) {
    super(`答题日志 ${logId} 的 ${field} 与既存记录不一致`);
    this.name = 'SubmissionLogConflictError';
  }
}

/** 最终写事务发现学习卡已删除或身份被替换时拒绝复活旧卡。 */
export class CardIdentityConflictError extends Error {
  readonly code = 'CARD_IDENTITY_CONFLICT';

  constructor(
    public readonly cardId: string,
    public readonly reason: 'missing' | 'changed',
  ) {
    super(
      reason === 'missing'
        ? `学习卡已不存在，拒绝写入：${cardId}`
        : `学习卡 wordId 或 deckId 已变化，拒绝写入：${cardId}`,
    );
    this.name = 'CardIdentityConflictError';
  }
}

function requireUnchangedCard(current: CardRecord | undefined, proposed: CardRecord): CardRecord {
  if (current === undefined) throw new CardIdentityConflictError(proposed.id, 'missing');
  if (current.wordId !== proposed.wordId || current.deckId !== proposed.deckId) {
    throw new CardIdentityConflictError(proposed.id, 'changed');
  }
  return current;
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
  /**
   * 原子提交一次答题：在同一事务内按 log.id 最终查重。
   * 重复提交不覆盖学习卡或日志，返回既存日志和当前学习卡。
   */
  saveSubmission(card: CardRecord, log: ReviewLogRecord): Promise<SubmissionSaveResult>;
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

  async saveSubmission(card: CardRecord, log: ReviewLogRecord): Promise<SubmissionSaveResult> {
    return this.runSubmissionTransaction(card, log);
  }

  /**
   * 写入学习卡；若违反 byWordId 唯一约束则抛出 `CardUniquenessError`（Issue #19 AC1/AC2）。
   * `card.id` 与既有记录相同时为合法覆盖（更新学习卡），不触发唯一约束。
   */
  private putCardWithUniqueGuard(card: CardRecord): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = openTrackedTransaction(this.db, STORES.cards);
      const store = tx.objectStore(STORES.cards);
      const request = store.put(card);
      markStorageMetaChanged(tx);
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
      const tx = openTrackedTransaction(this.db, [STORES.cards, STORES.reviewLogs]);
      const cardStore = tx.objectStore(STORES.cards);
      const logStore = tx.objectStore(STORES.reviewLogs);
      let failure: Error | null = null;

      const fail = (error: unknown, fallback: string): void => {
        failure ??= error instanceof Error ? error : new Error(fallback);
        try {
          tx.abort();
        } catch {
          // 事务已结束时，保留首个失败原因。
        }
      };
      const transactionError = (fallback: string): Error => {
        if (failure !== null) return failure;
        if (tx.error?.name === 'ConstraintError') return new CardUniquenessError(card.wordId);
        return getTrackedTransactionError(tx, fallback);
      };

      const currentCardRequest = cardStore.get(card.id);
      currentCardRequest.onerror = () => fail(currentCardRequest.error, '读取当前学习卡失败');
      currentCardRequest.onsuccess = () => {
        try {
          requireUnchangedCard(currentCardRequest.result as CardRecord | undefined, card);
          markStorageMetaChanged(tx);
          cardStore.put(card);
          logStore.put(log);
        } catch (error) {
          fail(error, '学习卡与复习日志事务失败');
        }
      };

      tx.oncomplete = () => {
        if (failure !== null) {
          reject(failure);
          return;
        }
        resolve();
      };
      tx.onerror = () => reject(transactionError('学习卡与复习日志事务失败'));
      tx.onabort = () => reject(transactionError('学习卡与复习日志事务已中止'));
    });
  }

  /**
   * 在 cards 与 reviewLogs 的同一 readwrite 事务内先按 log.id 查重。
   * 已存在时只读取并返回既存日志和最新学习卡，不执行任何 put。
   */
  private runSubmissionTransaction(
    card: CardRecord,
    log: ReviewLogRecord,
  ): Promise<SubmissionSaveResult> {
    return new Promise((resolve, reject) => {
      const tx = openTrackedTransaction(this.db, [STORES.cards, STORES.reviewLogs]);
      const cardStore = tx.objectStore(STORES.cards);
      const logStore = tx.objectStore(STORES.reviewLogs);
      let result: SubmissionSaveResult | undefined;
      let failure: Error | null = null;

      const fail = (error: unknown, fallback: string): void => {
        failure ??= error instanceof Error ? error : new Error(fallback);
        try {
          tx.abort();
        } catch {
          // 事务已结束或被其他请求中止时，保留首个失败原因。
        }
      };
      const transactionError = (fallback: string): Error => {
        if (failure !== null) return failure;
        if (tx.error?.name === 'ConstraintError') return new CardUniquenessError(card.wordId);
        return getTrackedTransactionError(tx, fallback);
      };

      const existingRequest = logStore.get(log.id);
      existingRequest.onerror = () => fail(existingRequest.error, '读取答题日志失败');
      existingRequest.onsuccess = () => {
        const existing = existingRequest.result as ReviewLogRecord | undefined;
        if (existing) {
          const mismatchedField =
            existing.cardId !== log.cardId
              ? 'cardId'
              : existing.wordId !== log.wordId
                ? 'wordId'
                : existing.questionType !== log.questionType
                  ? 'questionType'
                  : null;
          if (mismatchedField !== null) {
            fail(new SubmissionLogConflictError(log.id, mismatchedField), '答题日志冲突');
            return;
          }

          const currentCardRequest = cardStore.get(existing.cardId);
          currentCardRequest.onerror = () => fail(currentCardRequest.error, '读取当前学习卡失败');
          currentCardRequest.onsuccess = () => {
            try {
              const currentCard = requireUnchangedCard(
                currentCardRequest.result as CardRecord | undefined,
                card,
              );
              result = { inserted: false, card: currentCard, log: existing };
            } catch (error) {
              fail(error, '当前学习卡不存在或身份已变化');
            }
          };
          return;
        }

        const currentCardRequest = cardStore.get(card.id);
        currentCardRequest.onerror = () => fail(currentCardRequest.error, '读取当前学习卡失败');
        currentCardRequest.onsuccess = () => {
          try {
            requireUnchangedCard(currentCardRequest.result as CardRecord | undefined, card);
            markStorageMetaChanged(tx);
            cardStore.put(card);
            logStore.put(log);
            result = { inserted: true, card, log };
          } catch (error) {
            fail(error, '学习卡与复习日志事务失败');
          }
        };
      };

      tx.oncomplete = () => {
        if (result === undefined) {
          reject(new Error('学习卡与复习日志事务完成但未返回提交结果'));
          return;
        }
        resolve(result);
      };
      tx.onerror = () => reject(transactionError('学习卡与复习日志事务失败'));
      tx.onabort = () => reject(transactionError('学习卡与复习日志事务已中止'));
    });
  }
}
