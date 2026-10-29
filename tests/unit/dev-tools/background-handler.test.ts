import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleDevExtensionMessage } from '@/dev-tools/background-handler';
import { BuiltInWordBank } from '@/dictionary/built-in-word-bank';
import { LocalSettingsStore } from '@/storage/local-settings';
import { idbGetAll, openDatabase, readStorageMeta, STORES } from '@/storage/database';
import type { CardRecord, DeckRecord, WordQuestionPlan, WordRecord } from '@/types';

const TEST_DB = 'test-dev-background-handler';

const WORDS: WordRecord[] = Array.from({ length: 4 }, (_, index) => ({
  id: `w-dev-${index + 1}`,
  word: `dev${index + 1}`,
  lemma: `dev${index + 1}`,
  partOfSpeech: ['n.'],
  coreMeaningZh: [`释义${index + 1}`],
  exampleSentence: `dev${index + 1} example.`,
  exampleTranslation: `例句${index + 1}`,
  surfaceFormInExample: `dev${index + 1}`,
  difficulty: 2,
  frequencyRank: index + 1,
  source: 'test',
  license: 'test',
}));
const DECK: DeckRecord = {
  id: 'deck-dev',
  name: '开发词库',
  source: 'test',
  license: 'test',
  wordIds: WORDS.map((word) => word.id),
};

function planFor(word: WordRecord): WordQuestionPlan {
  const distractors = WORDS.filter((candidate) => candidate.id !== word.id)
    .slice(0, 3)
    .map((candidate) => candidate.id) as [string, string, string];
  return {
    wordId: word.id,
    enToZh: { distractors, checkedContentHash: 'dev-en' },
    zhToEn: { distractors, checkedContentHash: 'dev-zh' },
    contextChoice: {
      distractors: distractors.map((wordId) => ({ wordId, surfaceForm: wordId })) as [
        { wordId: string; surfaceForm: string },
        { wordId: string; surfaceForm: string },
        { wordId: string; surfaceForm: string },
      ],
      checkedContentHash: 'dev-context',
    },
    spelling: { prefixLength: 2, checkedContentHash: 'dev-spelling' },
  };
}

describe('开发后台消息 — storageMeta', () => {
  beforeEach(() => {
    vi.spyOn(BuiltInWordBank.prototype, 'getDefaultDeck').mockResolvedValue(DECK);
    vi.spyOn(BuiltInWordBank.prototype, 'getDeck').mockImplementation(async (deckId) =>
      deckId === DECK.id ? DECK : null,
    );
    vi.spyOn(BuiltInWordBank.prototype, 'listWords').mockResolvedValue(WORDS);
    vi.spyOn(BuiltInWordBank.prototype, 'getWord').mockImplementation(
      async (wordId) => WORDS.find((word) => word.id === wordId) ?? null,
    );
    vi.spyOn(BuiltInWordBank.prototype, 'getWordsByIds').mockImplementation(async (wordIds) =>
      WORDS.filter((word) => wordIds.includes(word.id)),
    );
    vi.spyOn(BuiltInWordBank.prototype, 'getQuestionPlan').mockImplementation(async (wordId) => {
      const word = WORDS.find((candidate) => candidate.id === wordId);
      return word ? planFor(word) : null;
    });
    vi.spyOn(BuiltInWordBank.prototype, 'sampleDeckWords').mockImplementation(async (params) =>
      WORDS.filter(
        (word) =>
          !params.excludeWordIds.includes(word.id) &&
          params.preferredDifficulty.includes(word.difficulty),
      ).slice(0, params.count),
    );
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(TEST_DB);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('DEV_PREPARE_CARD 建卡时递增一次 revision，不轮换 generation', async () => {
    const db = await openDatabase(TEST_DB);
    try {
      const store = new LocalSettingsStore(db);
      await store.setAppSettings({ ...(await store.getAppSettings()), selectedDeckId: DECK.id });
      const before = await readStorageMeta(db);

      const result = await handleDevExtensionMessage(
        { type: 'DEV_PREPARE_CARD', cardType: 'en-to-zh' },
        { db, store },
      );

      expect(result).toMatchObject({ ok: true, item: { kind: 'question' } });
      expect(await idbGetAll<CardRecord>(db, STORES.cards)).toHaveLength(1);
      expect(await readStorageMeta(db)).toMatchObject({
        revision: before.revision + 1,
        generation: before.generation,
        pendingBackup: true,
      });
    } finally {
      db.close();
    }
  });
});
