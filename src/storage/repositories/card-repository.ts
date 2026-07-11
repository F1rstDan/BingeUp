import type { CardRecord } from '@/types';
import { STORES, idbGet, idbPut, idbGetAll, idbGetByIndex } from '@/storage/database';

/**
 * 学习卡仓库端口。学习服务通过此端口访问持久化层，
 * 测试可用内存实现替换（见 spec 的 Testing Decisions）。
 */
export interface CardRepositoryPort {
  save(card: CardRecord): Promise<void>;
  getById(id: string): Promise<CardRecord | undefined>;
  getByWordId(wordId: string): Promise<CardRecord | undefined>;
  getAll(): Promise<CardRecord[]>;
}

/** IndexedDB 驱动的学习卡仓库。 */
export class CardRepository implements CardRepositoryPort {
  constructor(private readonly db: IDBDatabase) {}

  async save(card: CardRecord): Promise<void> {
    await idbPut(this.db, STORES.cards, card);
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
}
