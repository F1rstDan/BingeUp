import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuiltInWordBank } from '@/dictionary/built-in-word-bank';
import { DEFAULT_SETTINGS } from '@/settings/defaults';
import { STORES, idbGetAll, idbPut, openDatabase } from '@/storage/database';
import { LocalSettingsStore } from '@/storage/local-settings';
import {
  RECOVERY_CLEARED_AT_KEY,
  RECOVERY_SNAPSHOT_KEY,
  inspectStorageHealth,
  isStorageIsolationActive,
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
  {
    id: 'w-low',
    word: 'low',
    lemma: 'low',
    partOfSpeech: ['adj.'],
    coreMeaningZh: ['低的'],
    difficulty: 1,
    frequencyRank: 2,
    source: 'test',
    license: 'test',
  },
  ...Array.from({ length: 6 }, (_, index) => ({
    id: `w-burst-${index}`,
    word: `burst-${index}`,
    lemma: `burst-${index}`,
    partOfSpeech: ['n.'],
    coreMeaningZh: [`突发词 ${index}`],
    difficulty: 1,
    frequencyRank: index + 3,
    source: 'test',
    license: 'test',
  })),
];

const DECKS: DeckRecord[] = [
  {
    id: 'deck-daily-high-frequency',
    name: '日常高频',
    source: 'test',
    license: 'test',
    wordIds: WORDS.map((word) => word.id),
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

const SECOND_CARD: CardRecord = {
  ...CARD,
  id: 'card-2',
  wordId: 'w-low',
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
  beforeSnapshotGet: (() => Promise<void>) | null;
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
    beforeSnapshotGet: null,
  };
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          if (list.includes(RECOVERY_SNAPSHOT_KEY) && state.beforeSnapshotGet !== null) {
            const hook = state.beforeSnapshotGet;
            state.beforeSnapshotGet = null;
            await hook();
          }
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
    const current = storage.values[RECOVERY_SNAPSHOT_KEY] as {
      savedAt: number;
      mode: 'full' | 'compact';
      payload: unknown;
    };
    storage.values[RECOVERY_SNAPSHOT_KEY] = {
      version: 1,
      savedAt: current.savedAt,
      mode: current.mode,
      payload: current.payload,
    };
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
      const otherCard = { ...CARD, id: 'card-other', wordId: 'w-low' };
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
    expect(await Promise.all([first, pending, reset])).toEqual([true, false, true]);
    expect(storage.snapshotWrites).toHaveLength(2);
    const finalSnapshot = storage.snapshotWrites[1] as {
      version: number;
      tombstone: { kind: string } | null;
      previous: unknown;
      payload: { data: { cards: unknown[] } };
    };
    expect(finalSnapshot.version).toBe(2);
    expect(finalSnapshot.tombstone).toMatchObject({ kind: 'clear-all' });
    expect(finalSnapshot.previous).toBeNull();
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
    expect(storage.values[RECOVERY_SNAPSHOT_KEY]).toBe(original);
  });

  it('健康检查识别相对快照的卡片异常减少', async () => {
    await Promise.all([idbPut(db, STORES.cards, CARD), idbPut(db, STORES.cards, SECOND_CARD)]);
    await saveRecoverySnapshot(store);
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORES.cards, 'readwrite');
      transaction.objectStore(STORES.cards).delete(CARD.id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    const health = await inspectStorageHealth(store);

    expect(health.status).toBe('attention');
    expect(health.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'card-count-decreased',
          currentCards: 1,
          healthyCards: 2,
        }),
      ]),
    );
  });

  it('健康检查识别找不到学习卡的孤立复习日志', async () => {
    await idbPut(db, STORES.reviewLogs, { ...LOG, id: 'log-orphan', cardId: 'missing-card' });

    const health = await inspectStorageHealth(store);

    expect(health.status).toBe('attention');
    expect(health.issues).toContainEqual(
      expect.objectContaining({ code: 'orphan-review-logs', count: 1 }),
    );
  });

  it('读取健康元数据期间提交新卡和快照时不会误报卡片减少', async () => {
    await idbPut(db, STORES.cards, CARD);
    await saveRecoverySnapshot(store);
    storage.beforeSnapshotGet = async () => {
      await idbPut(db, STORES.cards, SECOND_CARD);
      const current = storage.values[RECOVERY_SNAPSHOT_KEY] as {
        savedAt: number;
        mode: 'full' | 'compact';
        payload: { data: { cards: CardRecord[] } };
      };
      storage.values[RECOVERY_SNAPSHOT_KEY] = {
        ...current,
        savedAt: current.savedAt + 1,
        payload: {
          ...current.payload,
          data: { ...current.payload.data, cards: [CARD, SECOND_CARD] },
        },
      };
    };

    const health = await inspectStorageHealth(store);

    expect(health.currentCounts.cards).toBe(2);
    expect(health.issues).not.toContainEqual(
      expect.objectContaining({ code: 'card-count-decreased' }),
    );
  });

  it('恢复失败会持久化为可查询的健康问题', async () => {
    await seedLearningData();
    await saveRecoverySnapshot(store);
    await wipeDatabase();
    vi.mocked(BuiltInWordBank.prototype.listWords).mockResolvedValue([]);
    vi.mocked(BuiltInWordBank.prototype.getDeck).mockResolvedValue(null);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect((await restoreRecoverySnapshotIfNeeded(store)).error).toBeDefined();
    const health = await inspectStorageHealth(store);

    expect(health.status).toBe('isolated');
    expect(health.issues).toContainEqual(
      expect.objectContaining({ code: 'restore-failed', message: expect.any(String) }),
    );
  });

  it('部分丢失时隔离，保留当前数据库与健康快照并停止自动覆盖', async () => {
    await Promise.all([
      idbPut(db, STORES.cards, CARD),
      idbPut(db, STORES.cards, SECOND_CARD),
      idbPut(db, STORES.behaviorEvents, EVENT),
    ]);
    await saveRecoverySnapshot(store);
    const healthySnapshot = storage.values[RECOVERY_SNAPSHOT_KEY];
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORES.cards, 'readwrite');
      transaction.objectStore(STORES.cards).delete(CARD.id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    expect((await restoreRecoverySnapshotIfNeeded(store)).restored).toBe(false);
    expect(await idbGetAll(db, STORES.cards)).toEqual([SECOND_CARD]);
    expect(await isStorageIsolationActive()).toBe(true);
    expect(await saveRecoverySnapshot(store)).toBe(false);
    expect((await saveStartupRecoverySnapshot(store)).saved).toBe(false);
    expect(storage.values[RECOVERY_SNAPSHOT_KEY]).toBe(healthySnapshot);
  });

  it('孤立复习日志会触发隔离并保留快照', async () => {
    await idbPut(db, STORES.cards, CARD);
    await saveRecoverySnapshot(store);
    const healthySnapshot = storage.values[RECOVERY_SNAPSHOT_KEY];
    await idbPut(db, STORES.reviewLogs, { ...LOG, id: 'log-orphan', cardId: 'missing-card' });

    expect(await saveRecoverySnapshot(store)).toBe(false);
    expect(await isStorageIsolationActive()).toBe(true);
    expect(storage.values[RECOVERY_SNAPSHOT_KEY]).toBe(healthySnapshot);
  });

  it('恢复失败状态跨模块重载保留，并可在后续启动重试成功', async () => {
    await seedLearningData();
    await saveRecoverySnapshot(store);
    await wipeDatabase();
    vi.mocked(BuiltInWordBank.prototype.listWords).mockResolvedValue([]);
    vi.mocked(BuiltInWordBank.prototype.getDeck).mockResolvedValue(null);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect((await restoreRecoverySnapshotIfNeeded(store)).error).toBeDefined();
    vi.resetModules();
    const freshModule = await import('@/storage/recovery-snapshot');
    expect(await freshModule.isStorageIsolationActive()).toBe(true);

    vi.mocked(BuiltInWordBank.prototype.listWords).mockResolvedValue(WORDS);
    vi.mocked(BuiltInWordBank.prototype.getDeck).mockImplementation(
      async (deckId) => DECKS.find((deck) => deck.id === deckId) ?? null,
    );
    expect(await restoreRecoverySnapshotIfNeeded(store)).toMatchObject({
      restored: true,
    });
    expect(await freshModule.isStorageIsolationActive()).toBe(false);
  });

  it('明确替换数据后写入当前快照并解除隔离', async () => {
    await Promise.all([idbPut(db, STORES.cards, CARD), idbPut(db, STORES.cards, SECOND_CARD)]);
    await saveRecoverySnapshot(store);
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORES.cards, 'readwrite');
      transaction.objectStore(STORES.cards).delete(CARD.id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    expect(await saveRecoverySnapshot(store)).toBe(false);
    expect(await isStorageIsolationActive()).toBe(true);

    expect(await resetRecoverySnapshot(store)).toBe(true);

    expect(await isStorageIsolationActive()).toBe(false);
    expect((await inspectStorageHealth(store)).status).toBe('healthy');
    const snapshot = storage.values[RECOVERY_SNAPSHOT_KEY] as {
      payload: { data: { cards: CardRecord[] } };
    };
    expect(snapshot.payload.data.cards).toEqual([SECOND_CARD]);
  });

  it('连续保存时保留上一代快照并记录不同代次', async () => {
    await idbPut(db, STORES.cards, CARD);
    expect(await saveRecoverySnapshot(store)).toBe(true);
    const first = storage.values[RECOVERY_SNAPSHOT_KEY] as {
      version: number;
      generation: string;
    };
    await idbPut(db, STORES.cards, SECOND_CARD);

    expect(await saveRecoverySnapshot(store)).toBe(true);

    const archive = storage.values[RECOVERY_SNAPSHOT_KEY] as {
      version: number;
      generation: string;
      payload: { data: { cards: CardRecord[] } };
      previous: { generation?: string; payload: { data: { cards: CardRecord[] } } } | null;
    };
    expect(archive).toMatchObject({ version: 2, previous: expect.any(Object) });
    expect(archive.generation).not.toBe(first.generation);
    expect(archive.payload.data.cards.map((card) => card.id).sort()).toEqual(['card-1', 'card-2']);
    expect(archive.previous?.payload.data.cards).toEqual([CARD]);
    expect(archive.previous?.generation).toBe(first.generation);
    expect(await inspectStorageHealth(store)).toMatchObject({
      snapshotGeneration: archive.generation,
      previousSnapshot: {
        generation: first.generation,
        counts: { cards: 1 },
      },
    });
  });

  it('快照结构无效时保留原始字节并阻止自动和启动覆盖', async () => {
    await idbPut(db, STORES.cards, CARD);
    const invalidBytes = { version: 999, payload: { marker: '必须保留' } };
    storage.values[RECOVERY_SNAPSHOT_KEY] = structuredClone(invalidBytes);

    expect(await saveRecoverySnapshot(store)).toBe(false);
    expect((await saveStartupRecoverySnapshot(store)).saved).toBe(false);

    expect(storage.values[RECOVERY_SNAPSHOT_KEY]).toEqual(invalidBytes);
    expect((await inspectStorageHealth(store)).issues).toContainEqual(
      expect.objectContaining({ code: 'snapshot-invalid' }),
    );
  });

  it('旧快照未通过语义校验时保留原始字节并阻止覆盖', async () => {
    await idbPut(db, STORES.cards, CARD);
    await saveRecoverySnapshot(store);
    const current = structuredClone(storage.values[RECOVERY_SNAPSHOT_KEY]) as {
      savedAt: number;
      mode: 'full' | 'compact';
      payload: { data: { cards: CardRecord[] } };
    };
    current.payload.data.cards[0]!.wordId = 'w-missing';
    const invalid = {
      version: 1,
      savedAt: current.savedAt,
      mode: current.mode,
      payload: current.payload,
    };
    storage.values[RECOVERY_SNAPSHOT_KEY] = invalid;

    expect(await saveRecoverySnapshot(store)).toBe(false);
    expect((await saveStartupRecoverySnapshot(store)).saved).toBe(false);

    expect(storage.values[RECOVERY_SNAPSHOT_KEY]).toEqual(invalid);
    expect((await inspectStorageHealth(store)).issues).toContainEqual(
      expect.objectContaining({ code: 'snapshot-validation-failed' }),
    );
  });

  it('兼容旧版单快照并从新代次档案继续轮换', async () => {
    await idbPut(db, STORES.cards, CARD);
    await saveRecoverySnapshot(store);
    const currentArchive = storage.values[RECOVERY_SNAPSHOT_KEY] as {
      generation: string;
      savedAt: number;
      mode: 'full' | 'compact';
      payload: unknown;
    };
    const legacy = {
      version: 1,
      savedAt: currentArchive.savedAt,
      mode: currentArchive.mode,
      payload: currentArchive.payload,
    };
    storage.values[RECOVERY_SNAPSHOT_KEY] = structuredClone(legacy);
    await wipeDatabase();

    expect((await restoreRecoverySnapshotIfNeeded(store)).restored).toBe(true);
    await idbPut(db, STORES.cards, SECOND_CARD);
    expect(await saveRecoverySnapshot(store)).toBe(true);
    const upgraded = storage.values[RECOVERY_SNAPSHOT_KEY] as {
      version: number;
      previous: { payload: { data: { cards: CardRecord[] } } } | null;
    };
    expect(upgraded.version).toBe(2);
    expect(upgraded.previous?.payload.data.cards).toEqual([CARD]);
  });

  it('用户清除后使用新一代次和 tombstone，重启时不恢复旧数据', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(50_000);
    await seedLearningData();
    await saveRecoverySnapshot(store);
    const before = storage.values[RECOVERY_SNAPSHOT_KEY] as { generation: string };
    await clearLearningData();

    expect(await resetRecoverySnapshot(store, 'clear-all')).toBe(true);

    const archive = storage.values[RECOVERY_SNAPSHOT_KEY] as {
      generation: string;
      tombstone: { generation: string; kind: string } | null;
      payload: { data: { cards: unknown[] } };
      previous: { payload: { data: { cards: unknown[] } } } | null;
    };
    expect(archive.generation).not.toBe(before.generation);
    expect(archive.tombstone).toMatchObject({ generation: archive.generation, kind: 'clear-all' });
    expect(archive.payload.data.cards).toEqual([]);
    expect(archive.previous).toBeNull();
    expect(JSON.stringify(storage.values[RECOVERY_SNAPSHOT_KEY])).not.toContain(CARD.wordId);

    await wipeDatabase();
    expect((await restoreRecoverySnapshotIfNeeded(store)).restored).toBe(false);
    expect(await idbGetAll(db, STORES.cards)).toEqual([]);
  });

  it('清除学习进度时删除旧卡与日志，但保留自定义单词和词库', async () => {
    const customWord: WordRecord = {
      ...WORDS[0]!,
      id: 'w-custom',
      word: 'custom',
      lemma: 'custom',
      frequencyRank: 99,
    };
    const customDeck: DeckRecord = {
      ...DECKS[0]!,
      id: 'deck-custom',
      name: '自定义',
      wordIds: [customWord.id],
    };
    const customCard: CardRecord = {
      ...CARD,
      id: 'card-custom',
      wordId: customWord.id,
      deckId: customDeck.id,
    };
    const customLog: ReviewLogRecord = {
      ...LOG,
      id: 'log-custom',
      cardId: customCard.id,
      wordId: customWord.id,
    };
    await Promise.all([
      idbPut(db, STORES.words, customWord),
      idbPut(db, STORES.decks, customDeck),
      idbPut(db, STORES.cards, customCard),
      idbPut(db, STORES.reviewLogs, customLog),
    ]);
    await saveRecoverySnapshot(store);
    await clearLearningData();

    expect(await resetRecoverySnapshot(store, 'clear-learning-progress')).toBe(true);

    const archive = storage.values[RECOVERY_SNAPSHOT_KEY] as {
      payload: {
        data: {
          cards: CardRecord[];
          reviewLogs: ReviewLogRecord[];
          words: WordRecord[];
          decks: DeckRecord[];
        };
      };
      previous: unknown;
    };
    expect(archive.payload.data.cards).toEqual([]);
    expect(archive.payload.data.reviewLogs).toEqual([]);
    expect(archive.payload.data.words).toContainEqual(customWord);
    expect(archive.payload.data.decks).toContainEqual(customDeck);
    expect(archive.previous).toBeNull();
    expect(JSON.stringify(archive)).not.toContain(customCard.id);
    expect(JSON.stringify(archive)).not.toContain(customLog.id);
  });

  it('快照写入失败时保留旧代次字节，后续保存仍可重试', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(60_000);
    await idbPut(db, STORES.cards, CARD);
    await saveRecoverySnapshot(store);
    const healthyBytes = storage.values[RECOVERY_SNAPSHOT_KEY];
    await idbPut(db, STORES.cards, SECOND_CARD);
    storage.failNextSetCalls = 2;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await saveRecoverySnapshot(store)).toBe(false);
    expect(storage.values[RECOVERY_SNAPSHOT_KEY]).toBe(healthyBytes);
    expect(await saveRecoverySnapshot(store)).toBe(true);
    expect(storage.values[RECOVERY_SNAPSHOT_KEY]).not.toBe(healthyBytes);
  });

  it('同一毫秒内的用户操作仍使用不同 generation', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(70_000);
    await saveRecoverySnapshot(store);
    expect(await resetRecoverySnapshot(store, 'clear-all')).toBe(true);
    const first = (storage.values[RECOVERY_SNAPSHOT_KEY] as { generation: string }).generation;
    expect(await resetRecoverySnapshot(store, 'clear-all')).toBe(true);
    const second = (storage.values[RECOVERY_SNAPSHOT_KEY] as { generation: string }).generation;
    expect(second).not.toBe(first);
  });
});
