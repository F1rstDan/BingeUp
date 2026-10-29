import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuiltInWordBank } from '@/dictionary/built-in-word-bank';
import { DEFAULT_SETTINGS } from '@/settings/defaults';
import { STORES, idbGetAll, idbPut, openDatabase } from '@/storage/database';
import { LocalSettingsStore } from '@/storage/local-settings';
import {
  RECOVERY_CLEARED_AT_KEY,
  RECOVERY_SNAPSHOT_KEY,
  resetRecoverySnapshot,
  restoreRecoverySnapshotIfNeeded,
  saveRecoverySnapshot,
  saveStartupRecoverySnapshot,
} from '@/storage/recovery-snapshot';
import type {
  BehaviorEventRecord,
  CardRecord,
  DeckRecord,
  ReviewLogRecord,
  SessionLogRecord,
  WordRecord,
} from '@/types';

const TEST_DB = 'test-recovery-snapshot';

const WORDS: WordRecord[] = [
  {
    id: 'w-high',
    word: 'high',
    lemma: 'high',
    partOfSpeech: ['adj.'],
    coreMeaningZh: ['高的'],
    difficulty: 1,
    frequencyRank: 1,
    source: 'test',
    license: 'test',
  },
];

const DECKS: DeckRecord[] = [
  {
    id: 'deck-daily-high-frequency',
    name: '日常高频',
    source: 'test',
    license: 'test',
    wordIds: ['w-high'],
  },
  { id: 'deck-cet4', name: '四级', source: 'test', license: 'test', wordIds: [] },
  { id: 'deck-cet6', name: '六级', source: 'test', license: 'test', wordIds: [] },
];

const CARD: CardRecord = {
  id: 'card-1',
  wordId: 'w-high',
  deckId: 'deck-daily-high-frequency',
  stage: 'short-term',
  origin: 'accepted-new',
  createdAt: 1_000,
  updatedAt: 1_000,
  nextReviewAt: 2_000,
  shortTermStep: 1,
};

const LOG: ReviewLogRecord = {
  id: 'log-1',
  cardId: CARD.id,
  wordId: CARD.wordId,
  questionType: 'en-to-zh',
  selectedAnswer: '错',
  correctAnswer: '高的',
  isCorrect: false,
  responseTimeMs: 300,
  reviewedAt: 1_500,
  stageAtSubmission: 'short-term',
  source: 'natural',
  rating: 'again',
};

const SESSION: SessionLogRecord = {
  id: 'session-1',
  startedAt: 1_000,
  endedAt: 1_600,
  mode: 'single',
  outcome: 'submitted',
  questionsAnswered: 1,
  source: 'natural',
  continuousQuestionsAnswered: 0,
};

const EVENT: BehaviorEventRecord = {
  id: 'event-1',
  kind: 'site-enabled',
  occurredAt: 900,
  hostname: 'youtube.com',
  enabled: false,
};

interface StorageState {
  values: Record<string, unknown>;
  failNextSetCalls: number;
  snapshotWrites: unknown[];
  snapshotWriteHold: SnapshotWriteHold | null;
}

interface SnapshotWriteHold {
  start: () => void;
  finished: Promise<void>;
}

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(TEST_DB);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

function installChromeMock() {
  const state: StorageState = {
    values: {},
    failNextSetCalls: 0,
    snapshotWrites: [],
    snapshotWriteHold: null,
  };
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.map((key) => [key, state.values[key]]));
        }),
        set: vi.fn(async (entries: Record<string, unknown>) => {
          if (state.failNextSetCalls > 0) {
            state.failNextSetCalls -= 1;
            throw new Error('QUOTA_BYTES quota exceeded');
          }
          const hold =
            entries[RECOVERY_SNAPSHOT_KEY] === undefined ? null : state.snapshotWriteHold;
          if (hold !== null) {
            state.snapshotWriteHold = null;
            hold.start();
            await hold.finished;
          }
          Object.assign(state.values, entries);
          if (entries[RECOVERY_SNAPSHOT_KEY] !== undefined) {
            state.snapshotWrites.push(structuredClone(entries[RECOVERY_SNAPSHOT_KEY]));
          }
        }),
      },
    },
  });
  return state;
}

function createSnapshotWriteHold() {
  let start!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { hold: { start, finished }, started, release };
}

describe('本地自动恢复快照', () => {
  let db: IDBDatabase;
  let store: LocalSettingsStore;
  let storage: StorageState;

  beforeEach(async () => {
    storage = installChromeMock();
    vi.spyOn(BuiltInWordBank.prototype, 'listWords').mockResolvedValue(WORDS);
    vi.spyOn(BuiltInWordBank.prototype, 'getDeck').mockImplementation(
      async (deckId) => DECKS.find((candidate) => candidate.id === deckId) ?? null,
    );
    db = await openDatabase(TEST_DB);
    store = new LocalSettingsStore(db);
  });

  afterEach(async () => {
    db.close();
    await deleteDatabase();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function seedLearningData(): Promise<void> {
    await store.setAppSettings({ ...DEFAULT_SETTINGS, dailyNewWordLimit: 8 });
    await Promise.all([
      idbPut(db, STORES.cards, CARD),
      idbPut(db, STORES.reviewLogs, LOG),
      idbPut(db, STORES.sessionLogs, SESSION),
      idbPut(db, STORES.behaviorEvents, EVENT),
    ]);
  }

  async function wipeDatabase(): Promise<void> {
    db.close();
    await deleteDatabase();
    db = await openDatabase(TEST_DB);
    store = new LocalSettingsStore(db);
  }

  async function clearLearningData(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(
        [STORES.cards, STORES.reviewLogs, STORES.sessionLogs, STORES.behaviorEvents],
        'readwrite',
      );
      for (const storeName of [
        STORES.cards,
        STORES.reviewLogs,
        STORES.sessionLogs,
        STORES.behaviorEvents,
      ]) {
        tx.objectStore(storeName).clear();
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  it('IndexedDB 整体为空时从快照恢复学习数据与设置', async () => {
    await seedLearningData();
    expect(await saveRecoverySnapshot(store)).toBe(true);

    await wipeDatabase();
    expect((await restoreRecoverySnapshotIfNeeded(store)).restored).toBe(true);

    expect(await idbGetAll(db, STORES.cards)).toEqual([CARD]);
    expect(await idbGetAll(db, STORES.reviewLogs)).toEqual([LOG]);
    expect(await idbGetAll(db, STORES.sessionLogs)).toEqual([SESSION]);
    expect(await idbGetAll(db, STORES.behaviorEvents)).toEqual([EVENT]);
    expect((await store.getAppSettings()).dailyNewWordLimit).toBe(8);
  });

  it('已有学习数据时不覆盖当前 IndexedDB', async () => {
    await seedLearningData();
    await saveRecoverySnapshot(store);
    const newer = { ...CARD, updatedAt: 9_000 };
    await idbPut(db, STORES.cards, newer);

    expect((await restoreRecoverySnapshotIfNeeded(store)).restored).toBe(false);
    expect(await idbGetAll(db, STORES.cards)).toEqual([newer]);
  });

  it('用户清除数据后旧快照不会在下次启动时复活', async () => {
    await seedLearningData();
    await saveRecoverySnapshot(store);
    storage.values[RECOVERY_CLEARED_AT_KEY] = Date.now() + 1_000;

    await wipeDatabase();
    expect((await restoreRecoverySnapshotIfNeeded(store)).restored).toBe(false);
    expect(await idbGetAll(db, STORES.cards)).toEqual([]);
    expect(storage.values[RECOVERY_CLEARED_AT_KEY]).toEqual(expect.any(Number));
  });

  it('快照超出配额时退化为只保留学习卡与设置', async () => {
    await seedLearningData();
    storage.failNextSetCalls = 1;

    expect(await saveRecoverySnapshot(store)).toBe(true);
    const snapshot = storage.values[RECOVERY_SNAPSHOT_KEY] as {
      payload: { data: { cards: unknown[]; reviewLogs: unknown[] } };
    };
    expect(snapshot.payload.data.cards).toHaveLength(1);
    expect(snapshot.payload.data.reviewLogs).toEqual([]);
  });

  it('合并同一数据库的未开始尾任务，并等待快照落盘后返回', async () => {
    const cards = Array.from({ length: 6 }, (_, index) => ({
      ...CARD,
      id: `card-burst-${index}`,
      wordId: `w-burst-${index}`,
      updatedAt: CARD.updatedAt + index,
    }));
    await idbPut(db, STORES.cards, cards[0]);

    const firstHold = createSnapshotWriteHold();
    storage.snapshotWriteHold = firstHold.hold;
    const first = saveRecoverySnapshot(store);
    await firstHold.started;

    const pending = [];
    for (const card of cards.slice(1)) {
      await idbPut(db, STORES.cards, card);
      pending.push(saveRecoverySnapshot(store));
    }

    const batchHold = createSnapshotWriteHold();
    storage.snapshotWriteHold = batchHold.hold;
    firstHold.release();
    expect(await first).toBe(true);
    await batchHold.started;

    let batchSettled = false;
    const batch = Promise.all(pending).then((results) => {
      batchSettled = true;
      return results;
    });
    await Promise.resolve();
    expect(batchSettled).toBe(false);

    batchHold.release();
    expect(await batch).toEqual([true, true, true, true, true]);
    expect(storage.snapshotWrites).toHaveLength(2);

    const firstSnapshot = storage.snapshotWrites[0] as {
      payload: { data: { cards: { wordId: string }[] } };
    };
    const batchSnapshot = storage.snapshotWrites[1] as {
      payload: { data: { cards: { wordId: string }[] } };
    };
    expect(firstSnapshot.payload.data.cards.map((card) => card.wordId)).toEqual(['w-burst-0']);
    expect(batchSnapshot.payload.data.cards.map((card) => card.wordId)).toEqual(
      cards.map((card) => card.wordId),
    );
  });

  it('不同数据库的快照任务不共享导出结果', async () => {
    const otherDatabaseName = `${TEST_DB}-other`;
    const otherDb = await openDatabase(otherDatabaseName);
    try {
      const otherCard = { ...CARD, id: 'card-other', wordId: 'w-other' };
      await Promise.all([idbPut(db, STORES.cards, CARD), idbPut(otherDb, STORES.cards, otherCard)]);

      const firstHold = createSnapshotWriteHold();
      storage.snapshotWriteHold = firstHold.hold;
      const first = saveRecoverySnapshot(store);
      await firstHold.started;
      const second = saveRecoverySnapshot(new LocalSettingsStore(otherDb));
      firstHold.release();

      expect(await Promise.all([first, second])).toEqual([true, true]);
      const snapshots = storage.snapshotWrites as {
        payload: { data: { cards: { wordId: string }[] } };
      }[];
      expect(snapshots[0]?.payload.data.cards.map((card) => card.wordId)).toEqual([CARD.wordId]);
      expect(snapshots[1]?.payload.data.cards.map((card) => card.wordId)).toEqual([
        otherCard.wordId,
      ]);
    } finally {
      otherDb.close();
      await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase(otherDatabaseName);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      });
    }
  });

  it('快照失败后队列仍可重试', async () => {
    await seedLearningData();
    storage.failNextSetCalls = 2;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await saveRecoverySnapshot(store)).toBe(false);
    expect(await saveRecoverySnapshot(store)).toBe(true);
    expect(storage.values[RECOVERY_SNAPSHOT_KEY]).toBeDefined();
    expect(consoleError).toHaveBeenCalled();
  });

  it('明确清除后写入空快照，空库不再恢复旧进度', async () => {
    await seedLearningData();
    await saveRecoverySnapshot(store);
    await clearLearningData();

    expect(await resetRecoverySnapshot(store)).toBe(true);
    await wipeDatabase();
    expect((await restoreRecoverySnapshotIfNeeded(store)).restored).toBe(false);
  });

  it('清除快照不合并到已排队任务，并等待前面的快照完成', async () => {
    await idbPut(db, STORES.cards, CARD);
    const firstHold = createSnapshotWriteHold();
    storage.snapshotWriteHold = firstHold.hold;
    const first = saveRecoverySnapshot(store);
    await firstHold.started;
    const pending = saveRecoverySnapshot(store);
    await clearLearningData();
    const reset = resetRecoverySnapshot(store);

    firstHold.release();
    expect(await Promise.all([first, pending, reset])).toEqual([true, true, true]);
    expect(storage.snapshotWrites).toHaveLength(3);
    const finalSnapshot = storage.snapshotWrites[2] as {
      payload: { data: { cards: unknown[] } };
    };
    expect(finalSnapshot.payload.data.cards).toEqual([]);
  });

  it('启动备份不覆盖仍有学习卡可恢复的空库快照', async () => {
    await seedLearningData();
    await saveRecoverySnapshot(store);
    const original = storage.values[RECOVERY_SNAPSHOT_KEY];
    await wipeDatabase();

    expect((await saveStartupRecoverySnapshot(store)).saved).toBe(false);
    expect(storage.values[RECOVERY_SNAPSHOT_KEY]).toBe(original);
  });

  it('启动时快照学习卡数量一致就不重复写入', async () => {
    await seedLearningData();
    await saveRecoverySnapshot(store);
    const original = storage.values[RECOVERY_SNAPSHOT_KEY];

    const storageGet = vi.mocked(chrome.storage.local.get);
    storageGet.mockClear();
    const startup = await saveStartupRecoverySnapshot(store);
    expect(startup.saved).toBe(false);
    expect(startup.snapshot).toMatchObject({ present: true, counts: { cards: 1 } });
    expect(storageGet).toHaveBeenCalledTimes(1);
    expect(storage.values[RECOVERY_SNAPSHOT_KEY]).toBe(original);
  });
});
