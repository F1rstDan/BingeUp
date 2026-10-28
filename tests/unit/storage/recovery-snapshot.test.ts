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
  failNextSet: boolean;
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
  const state: StorageState = { values: {}, failNextSet: false };
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.map((key) => [key, state.values[key]]));
        }),
        set: vi.fn(async (entries: Record<string, unknown>) => {
          if (state.failNextSet) {
            state.failNextSet = false;
            throw new Error('QUOTA_BYTES quota exceeded');
          }
          Object.assign(state.values, entries);
        }),
      },
    },
  });
  return state;
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
    storage.failNextSet = true;

    expect(await saveRecoverySnapshot(store)).toBe(true);
    const snapshot = storage.values[RECOVERY_SNAPSHOT_KEY] as {
      payload: { data: { cards: unknown[]; reviewLogs: unknown[] } };
    };
    expect(snapshot.payload.data.cards).toHaveLength(1);
    expect(snapshot.payload.data.reviewLogs).toEqual([]);
  });

  it('明确清除后写入空快照，空库不再恢复旧进度', async () => {
    await seedLearningData();
    await saveRecoverySnapshot(store);
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

    expect(await resetRecoverySnapshot(store)).toBe(true);
    await wipeDatabase();
    expect((await restoreRecoverySnapshotIfNeeded(store)).restored).toBe(false);
  });

  it('启动备份不覆盖仍有学习卡可恢复的空库快照', async () => {
    await seedLearningData();
    await saveRecoverySnapshot(store);
    const original = storage.values[RECOVERY_SNAPSHOT_KEY];
    await wipeDatabase();

    expect(await saveStartupRecoverySnapshot(store)).toBe(false);
    expect(storage.values[RECOVERY_SNAPSHOT_KEY]).toBe(original);
  });

  it('启动时快照学习卡数量一致就不重复写入', async () => {
    await seedLearningData();
    await saveRecoverySnapshot(store);
    const original = storage.values[RECOVERY_SNAPSHOT_KEY];

    expect(await saveStartupRecoverySnapshot(store)).toBe(false);
    expect(storage.values[RECOVERY_SNAPSHOT_KEY]).toBe(original);
  });
});
