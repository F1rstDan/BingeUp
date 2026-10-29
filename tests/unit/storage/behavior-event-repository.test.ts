import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BehaviorEventRepository } from '@/storage/repositories/behavior-event-repository';
import {
  STORES,
  idbGetAll,
  idbReplaceAll,
  openDatabase,
  readStorageMeta,
} from '@/storage/database';
import type { BehaviorEventRecord } from '@/types';

const TEST_DB = 'test-behavior-event-repository';
const openedDatabases: IDBDatabase[] = [];

function makeEvent(id: string, occurredAt: number): BehaviorEventRecord {
  return {
    id,
    kind: 'site-enabled',
    occurredAt,
    hostname: 'youtube.com',
    enabled: true,
    baseline: true,
  };
}

async function openTestDatabase(): Promise<IDBDatabase> {
  const db = await openDatabase(TEST_DB);
  openedDatabases.push(db);
  return db;
}

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(TEST_DB);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

describe('BehaviorEventRepository — 行为事件时间戳写入', () => {
  afterEach(async () => {
    for (const db of openedDatabases.splice(0)) db.close();
    await deleteDatabase();
    vi.restoreAllMocks();
  });

  it('空表从 -1 开始，相同时间戳逐项递增', async () => {
    const db = await openTestDatabase();
    const repo = new BehaviorEventRepository(db);
    const transaction = vi.spyOn(db, 'transaction');

    await repo.save(makeEvent('event-a', 0));
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledWith(
      [STORES.behaviorEvents, STORES.storageMeta],
      'readwrite',
    );
    await repo.save(makeEvent('event-b', 0));
    expect(transaction).toHaveBeenCalledTimes(2);

    expect(await repo.getAll()).toEqual([makeEvent('event-a', 0), makeEvent('event-b', 1)]);
    expect((await readStorageMeta(db)).revision).toBe(2);
  });

  it('乱序输入取最大值，相同时间戳递增，同 id 覆盖沿用现有规则', async () => {
    const db = await openTestDatabase();
    const repo = new BehaviorEventRepository(db);

    await repo.save(makeEvent('first', 100));
    await repo.save(makeEvent('low', 50));
    await repo.save(makeEvent('same', 101));
    await repo.save(makeEvent('high', 500));
    await repo.save(makeEvent('first', 10));
    await repo.save(makeEvent('after-overwrite', 50));

    const byId = new Map((await repo.getAll()).map((event) => [event.id, event.occurredAt]));
    expect([...byId.values()].sort((a, b) => a - b)).toEqual([101, 102, 500, 501, 502]);
    expect(byId.get('first')).toBe(501);
    expect(byId.get('high')).toBe(500);
    expect(byId.get('after-overwrite')).toBe(502);
  });

  it('不同仓库实例并发写入同一数据库时严格递增', async () => {
    const firstDb = await openTestDatabase();
    const secondDb = await openTestDatabase();
    const firstRepo = new BehaviorEventRepository(firstDb);
    const secondRepo = new BehaviorEventRepository(secondDb);
    const count = 64;

    await Promise.all(
      Array.from({ length: count }, (_, index) =>
        (index % 2 === 0 ? firstRepo : secondRepo).save(makeEvent(`event-${index}`, 0)),
      ),
    );

    const occurredAt = (await firstRepo.getAll())
      .map((event) => event.occurredAt)
      .sort((a, b) => a - b);
    expect(occurredAt).toEqual(Array.from({ length: count }, (_, index) => index));
  });

  it('预置数百事件时从索引尾项继续，不调用 getAll', async () => {
    const db = await openTestDatabase();
    const repo = new BehaviorEventRepository(db);
    const seeded = Array.from({ length: 400 }, (_, index) => makeEvent(`seed-${index}`, index));
    await idbReplaceAll(db, { [STORES.behaviorEvents]: seeded });
    const getAll = vi.spyOn(repo, 'getAll');

    await repo.save(makeEvent('tail', 0));

    const stored = await idbGetAll<BehaviorEventRecord>(db, STORES.behaviorEvents);
    expect(stored.find((event) => event.id === 'tail')?.occurredAt).toBe(400);
    expect(getAll).not.toHaveBeenCalled();
  });

  it('游标回调内同步 put 失败时拒绝并中止事务，下一次保存可成功', async () => {
    const db = await openTestDatabase();
    const repo = new BehaviorEventRepository(db);
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new Error('synthetic put failure');
    });

    const beforeFailure = await readStorageMeta(db);
    await expect(repo.save(makeEvent('failed', 100))).rejects.toThrow('synthetic put failure');
    expect(await repo.getAll()).toEqual([]);
    expect(await readStorageMeta(db)).toEqual(beforeFailure);

    await expect(repo.save(makeEvent('retry', 100))).resolves.toBeUndefined();
    expect((await repo.getAll()).map((event) => event.occurredAt)).toEqual([100]);
  });
});
