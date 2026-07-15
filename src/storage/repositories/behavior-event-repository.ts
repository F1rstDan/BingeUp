import type { BehaviorEventRecord } from '@/types';
import { STORES, idbGetAll, idbPut } from '@/storage/database';

export interface BehaviorEventRepositoryPort {
  save(event: BehaviorEventRecord): Promise<void>;
  getAll(): Promise<BehaviorEventRecord[]>;
}

export class BehaviorEventRepository implements BehaviorEventRepositoryPort {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly db: IDBDatabase) {}

  save(event: BehaviorEventRecord): Promise<void> {
    const operation = this.writeQueue.then(async () => {
      const existing = await this.getAll();
      const lastOccurredAt = existing.reduce(
        (latest, candidate) => Math.max(latest, candidate.occurredAt),
        -1,
      );
      await idbPut(this.db, STORES.behaviorEvents, {
        ...event,
        occurredAt: Math.max(event.occurredAt, lastOccurredAt + 1),
      });
    });
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  getAll(): Promise<BehaviorEventRecord[]> {
    return idbGetAll<BehaviorEventRecord>(this.db, STORES.behaviorEvents);
  }
}
