import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '@/storage/database';
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
    source: 'natural',
    continuousQuestionsAnswered: 0,
    ...overrides,
  };
}

describe('SessionLogRepository — 会话日志持久化（Issue #12）', () => {
  afterEach(async () => {
    await deleteDatabase(TEST_DB);
  });

  it('save 写入后 getAll 可读', async () => {
    const db = await openDatabase(TEST_DB);
    const repo = new SessionLogRepository(db);
    const session = makeSession();
    await repo.save(session);

    const all = await repo.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(session);
    db.close();
  });

  it('save 覆盖同 id 记录', async () => {
    const db = await openDatabase(TEST_DB);
    const repo = new SessionLogRepository(db);
    await repo.save(makeSession({ outcome: 'submitted' }));
    await repo.save(makeSession({ outcome: 'skipped' }));

    const all = await repo.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.outcome).toBe('skipped');
    db.close();
  });

  it('刷新或重启浏览器后会话日志仍可读取（新实例模拟重启）', async () => {
    const db1 = await openDatabase(TEST_DB);
    const repo1 = new SessionLogRepository(db1);
    await repo1.save(makeSession({ id: 'session-persist' }));
    db1.close();

    const db2 = await openDatabase(TEST_DB);
    const repo2 = new SessionLogRepository(db2);
    const restored = await repo2.getAll();
    expect(restored).toHaveLength(1);
    expect(restored[0]!.id).toBe('session-persist');
    db2.close();
  });

  it('getAll 返回所有会话日志', async () => {
    const db = await openDatabase(TEST_DB);
    const repo = new SessionLogRepository(db);
    await repo.save(makeSession({ id: 's1' }));
    await repo.save(makeSession({ id: 's2', mode: 'continuous' }));
    await repo.save(makeSession({ id: 's3', outcome: 'skipped' }));

    const all = await repo.getAll();
    expect(all).toHaveLength(3);
    db.close();
  });
});
