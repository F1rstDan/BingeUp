import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { buildDevScenarioSeed, DevScenarioSeeder } from '@/dev-tools/scenario-seeder';
import {
  idbGet,
  idbGetAll,
  idbPut,
  openDatabase,
  readStorageMeta,
  STORES,
} from '@/storage/database';
import type { CardRecord, DeckRecord, WordRecord } from '@/types';

const NOW = new Date(2026, 9, 25, 15, 30, 0, 0).getTime();

function words(count: number): WordRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `w-${index + 1}`,
    word: `word${index + 1}`,
    lemma: `word${index + 1}`,
    phonetic: `/wɜːd${index + 1}/`,
    partOfSpeech: ['n.'],
    coreMeaningZh: [`释义${index + 1}`],
    exampleSentence: `This is word${index + 1}.`,
    exampleTranslation: `这是单词 ${index + 1}。`,
    surfaceFormInExample: `word${index + 1}`,
    difficulty: 1 + (index % 4),
    frequencyRank: index + 1,
    source: 'test',
    license: 'CC0',
  }));
}

function deck(source: WordRecord[]): DeckRecord {
  return {
    id: 'deck-test',
    name: '测试词库',
    source: 'test',
    license: 'CC0',
    wordIds: source.map((word) => word.id),
  };
}

describe('开发场景数据', () => {
  it('一周场景生成分阶段学习卡、近期复习和会话数据', () => {
    const source = words(20);
    const data = buildDevScenarioSeed({
      scenario: 'week',
      deck: deck(source),
      words: source,
      now: NOW,
    });

    expect(data.cards).toHaveLength(8);
    expect(data.cards.filter((card) => card.stage === 'new')).toHaveLength(2);
    expect(data.cards.filter((card) => card.stage === 'short-term')).toHaveLength(3);
    expect(data.reviewLogs).toHaveLength(80);
    const todayStart = new Date(NOW);
    todayStart.setHours(0, 0, 0, 0);
    expect(data.reviewLogs.filter((log) => log.reviewedAt >= todayStart.getTime())).toHaveLength(8);
    expect(data.sessionLogs).toHaveLength(7);
    expect(data.behaviorEvents.length).toBeGreaterThan(0);
  });

  it('全部学完场景为词库内每个单词建立长期学习卡，且不再到期', () => {
    const source = words(20);
    const data = buildDevScenarioSeed({
      scenario: 'complete',
      deck: deck(source),
      words: source,
      now: NOW,
    });

    expect(data.cards).toHaveLength(source.length);
    expect(data.cards.every((card) => card.stage === 'long-term')).toBe(true);
    expect(data.cards.every((card) => (card.nextReviewAt ?? 0) > NOW)).toBe(true);
    expect(new Set(data.cards.map((card) => card.id)).size).toBe(data.cards.length);
    expect(new Set(data.reviewLogs.map((log) => log.id)).size).toBe(data.reviewLogs.length);
    expect(data.reviewLogs.every((log) => log.reviewedAt <= NOW)).toBe(true);
  });

  it('当前词库没有单词时明确失败', () => {
    expect(() =>
      buildDevScenarioSeed({
        scenario: 'month',
        deck: deck([]),
        words: [],
        now: NOW,
      }),
    ).toThrow('当前词库没有可模拟的单词');
  });

  it('写入场景时只替换学习进度并在索引库中可读', async () => {
    const source = words(20);
    const deckRecord = deck(source);
    const dbName = `dev-scenario-${Date.now()}`;
    const db = await openDatabase(dbName);
    try {
      await idbPut(db, STORES.authoritativeState, { id: 'keep-settings', value: 'keep' });
      const seeder = new DevScenarioSeeder({
        db,
        words: {
          getDeck: async (deckId) => (deckId === deckRecord.id ? deckRecord : null),
          getDefaultDeck: async () => deckRecord,
          listWords: async () => source,
        },
        store: {
          getAppSettings: async () => ({ selectedDeckId: deckRecord.id }) as never,
        },
        clock: { now: () => NOW },
      });

      const beforeSeed = await readStorageMeta(db);
      await seeder.seed('month');

      const cards = await idbGetAll<CardRecord>(db, STORES.cards);
      expect(cards).toHaveLength(12);
      expect(
        cards.reduce<Record<string, number>>((counts, card) => {
          counts[card.stage] = (counts[card.stage] ?? 0) + 1;
          return counts;
        }, {}),
      ).toMatchObject({
        new: 1,
        'short-term': 4,
        'long-term': 6,
        'self-reported-known': 1,
      });
      expect(await idbGetAll(db, STORES.reviewLogs)).toHaveLength(320);
      expect(await idbGetAll(db, STORES.sessionLogs)).toHaveLength(24);
      expect(await idbGetAll(db, STORES.behaviorEvents)).toHaveLength(4);
      expect(await idbGet(db, STORES.authoritativeState, 'keep-settings')).toEqual({
        id: 'keep-settings',
        value: 'keep',
      });
      expect(await readStorageMeta(db)).toMatchObject({
        revision: beforeSeed.revision + 1,
        generation: beforeSeed.generation,
        pendingBackup: true,
      });
    } finally {
      db.close();
    }
  });
});
