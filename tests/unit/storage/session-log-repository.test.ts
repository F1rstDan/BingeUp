import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, STORES } from '@/storage/database';
import { MIGRATIONS } from '@/storage/migrations';
import { SessionLogRepository } from '@/storage/repositories/session-log-repository';
import type { SessionLogRecord } from '@/types';

const TEST_DB = 'test-bingeup-session-logs';

async function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

function makeSession(overrides: Partial<SessionLogRecord> = {}): SessionLogRecord {
  return {
    id: 'session-1',
    startedAt: 1_000_000,
    endedAt: 1_000_500,
    mode: 'single',
    outcome: 'submitted',
    questionsAnswered: 1,
    ...overrides,
  };
}

describe('SessionLogRepository — 会话日志持久化（Issue #12）', () => {
  afterEach(async () => {
    await deleteDatabase(TEST_DB);
  });

  it('save 写入后 getAll 可读', async () => {
    const db = await openDatabase(TEST_DB, MIGRATIONS);
    const repo = new SessionLogRepository(db);
    const session = makeSession();
    await repo.save(session);

    const all = await repo.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(session);
    db.close();
  });

  it('save 覆盖同 id 记录', async () => {
    const db = await openDatabase(TEST_DB, MIGRATIONS);
    const repo = new SessionLogRepository(db);
    await repo.save(makeSession({ outcome: 'submitted' }));
    await repo.save(makeSession({ outcome: 'skipped' }));

    const all = await repo.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.outcome).toBe('skipped');
    db.close();
  });

  it('刷新或重启浏览器后会话日志仍可读取（新实例模拟重启）', async () => {
    const db1 = await openDatabase(TEST_DB, MIGRATIONS);
    const repo1 = new SessionLogRepository(db1);
    await repo1.save(makeSession({ id: 'session-persist' }));
    db1.close();

    const db2 = await openDatabase(TEST_DB, MIGRATIONS);
    const repo2 = new SessionLogRepository(db2);
    const restored = await repo2.getAll();
    expect(restored).toHaveLength(1);
    expect(restored[0]!.id).toBe('session-persist');
    db2.close();
  });

  it('getAll 返回所有会话日志', async () => {
    const db = await openDatabase(TEST_DB, MIGRATIONS);
    const repo = new SessionLogRepository(db);
    await repo.save(makeSession({ id: 's1' }));
    await repo.save(makeSession({ id: 's2', mode: 'continuous' }));
    await repo.save(makeSession({ id: 's3', outcome: 'skipped' }));

    const all = await repo.getAll();
    expect(all).toHaveLength(3);
    db.close();
  });
});

describe('迁移 v2 — sessionLogs 仓库与索引（Issue #12）', () => {
  afterEach(async () => {
    await deleteDatabase(TEST_DB);
  });

  it('迁移后 sessionLogs 仓库存在', async () => {
    const db = await openDatabase(TEST_DB, MIGRATIONS);
    expect(db.objectStoreNames.contains(STORES.sessionLogs)).toBe(true);
    // Issue #26 新增 v5 迁移（behaviorEvents 指标源事件仓库）。
    expect(db.version).toBe(5);
    db.close();
  });

  it('sessionLogs 仓库包含 byStartedAt 索引', async () => {
    const db = await openDatabase(TEST_DB, MIGRATIONS);
    const tx = db.transaction(STORES.sessionLogs, 'readonly');
    const store = tx.objectStore(STORES.sessionLogs);
    expect(store.indexNames.contains('byStartedAt')).toBe(true);
    db.close();
  });

  it('从 v1 升级到 v2 后既有数据仍然可读', async () => {
    // 先用 v1 打开（只有 cards/reviewLogs/words/decks）
    const V1_ONLY: typeof MIGRATIONS = [MIGRATIONS[0]!];
    const db1 = await openDatabase(TEST_DB, V1_ONLY);
    const { idbPut } = await import('@/storage/database');
    await idbPut(db1, STORES.cards, { id: 'card-1', wordId: 'w-1' });
    db1.close();

    // 再用完整迁移（含 v2）升级
    const db2 = await openDatabase(TEST_DB, MIGRATIONS);
    const { idbGet } = await import('@/storage/database');
    const card = await idbGet<{ id: string; wordId: string }>(db2, STORES.cards, 'card-1');
    expect(card).toBeDefined();
    expect(card!.wordId).toBe('w-1');
    expect(db2.objectStoreNames.contains(STORES.sessionLogs)).toBe(true);
    db2.close();
  });
});
