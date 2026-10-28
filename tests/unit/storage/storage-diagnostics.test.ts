import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORES, idbPut, openDatabase } from '@/storage/database';
import { LocalSettingsStore } from '@/storage/local-settings';
import { saveRecoverySnapshot } from '@/storage/recovery-snapshot';
import {
  getStorageDiagnostics,
  readStorageCounts,
  recordDatabaseOpenError,
  recordDatabaseOpened,
  recordStartupRead,
  startStorageDiagnosticSession,
} from '@/storage/storage-diagnostics';
import type { BehaviorEventRecord, CardRecord, ReviewLogRecord, SessionLogRecord } from '@/types';

const TEST_DB = 'test-storage-diagnostics';

const CARD: CardRecord = {
  id: 'card-1',
  wordId: 'w-test',
  deckId: 'deck-cet4',
  stage: 'short-term',
  origin: 'accepted-new',
  createdAt: 1,
  updatedAt: 1,
};

const LOG: ReviewLogRecord = {
  id: 'log-1',
  cardId: CARD.id,
  wordId: CARD.wordId,
  questionType: 'en-to-zh',
  selectedAnswer: '测试',
  correctAnswer: '测试',
  isCorrect: true,
  responseTimeMs: 100,
  reviewedAt: 2,
  stageAtSubmission: 'short-term',
  source: 'natural',
  rating: 'good',
};

const SESSION: SessionLogRecord = {
  id: 'session-1',
  startedAt: 1,
  endedAt: 2,
  mode: 'single',
  outcome: 'submitted',
  questionsAnswered: 1,
  source: 'natural',
  continuousQuestionsAnswered: 0,
};

const EVENT: BehaviorEventRecord = {
  id: 'event-1',
  kind: 'site-enabled',
  occurredAt: 1,
  hostname: 'youtube.com',
  enabled: true,
};

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(TEST_DB);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

function installChromeMock(): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.map((key) => [key, values[key]]));
        }),
        set: vi.fn(async (entries: Record<string, unknown>) => {
          Object.assign(values, entries);
        }),
      },
    },
  });
  return values;
}

describe('存档诊断记录', () => {
  let db: IDBDatabase;
  let store: LocalSettingsStore;

  beforeEach(async () => {
    installChromeMock();
    db = await openDatabase(TEST_DB);
    store = new LocalSettingsStore(db);
    await Promise.all([
      idbPut(db, STORES.cards, CARD),
      idbPut(db, STORES.reviewLogs, LOG),
      idbPut(db, STORES.sessionLogs, SESSION),
      idbPut(db, STORES.behaviorEvents, EVENT),
    ]);
  });

  afterEach(async () => {
    db.close();
    await deleteDatabase();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('记录启动读取、当前计数和快照信息', async () => {
    await startStorageDiagnosticSession(1_000);
    await recordDatabaseOpened(1);
    const counts = await readStorageCounts(store);
    expect(counts).toMatchObject({ cards: 1, reviewLogs: 1, sessionLogs: 1, behaviorEvents: 1 });
    await recordStartupRead({
      counts,
      restoredFromSnapshot: false,
      snapshotPresent: false,
    });
    await saveRecoverySnapshot(store);

    const diagnostics = await getStorageDiagnostics(store);
    expect(diagnostics.databaseOpen).toBe(true);
    expect(diagnostics.startup?.startedAt).toBe(1_000);
    expect(diagnostics.startup?.counts?.cards).toBe(1);
    expect(diagnostics.current?.counts.cards).toBe(1);
    expect(diagnostics.snapshot.present).toBe(true);
    expect(diagnostics.snapshot.counts?.cards).toBe(1);
    expect(diagnostics.history).toHaveLength(1);
  });

  it('新启动记录排在最前，且保留数据库打开失败原因', async () => {
    await startStorageDiagnosticSession(1_000);
    await recordDatabaseOpenError('数据库被占用');
    await startStorageDiagnosticSession(2_000);
    await recordDatabaseOpened(1);
    await recordStartupRead({
      counts: { cards: 1, reviewLogs: 1, sessionLogs: 1, behaviorEvents: 1, words: 0, decks: 0 },
      restoredFromSnapshot: true,
      restoreError: undefined,
      snapshotPresent: true,
      snapshotSavedAt: 900,
      snapshotMode: 'full',
      snapshotCards: 1,
    });

    const diagnostics = await getStorageDiagnostics(store);
    expect(diagnostics.history).toHaveLength(2);
    expect(diagnostics.history[0]?.startedAt).toBe(2_000);
    expect(diagnostics.history[1]?.databaseOpenError).toBe('数据库被占用');
    expect(diagnostics.startup?.restoredFromSnapshot).toBe(true);
  });

  it('数据库不可用时仍返回启动历史和快照摘要', async () => {
    await startStorageDiagnosticSession(1_000);
    await recordDatabaseOpenError('数据库打开失败');

    const diagnostics = await getStorageDiagnostics(null);
    expect(diagnostics.databaseOpen).toBe(false);
    expect(diagnostics.current).toBeNull();
    expect(diagnostics.databaseOpenError).toBe('数据库打开失败');
    expect(diagnostics.history[0]?.startedAt).toBe(1_000);
  });
});
