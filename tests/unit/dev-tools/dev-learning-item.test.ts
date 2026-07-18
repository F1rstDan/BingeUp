import { describe, expect, it } from 'vitest';
import { DevLearningItemService } from '@/dev-tools/dev-learning-item';
import {
  CardUniquenessError,
  type CardRepositoryPort,
} from '@/storage/repositories/card-repository';
import type { CardRecord, DeckRecord, ReviewLogRecord, WordRecord } from '@/types';
import type { WordBankPort } from '@/learning/learning-service';

class MemoryCards implements CardRepositoryPort {
  protected readonly rows: CardRecord[];

  constructor(initial: CardRecord[] = []) {
    this.rows = initial.map((row) => ({ ...row }));
  }

  async save(card: CardRecord): Promise<void> {
    this.rows.push({ ...card });
  }

  async getById(id: string): Promise<CardRecord | undefined> {
    const card = this.rows.find((row) => row.id === id);
    return card ? { ...card } : undefined;
  }

  async getByWordId(wordId: string): Promise<CardRecord | undefined> {
    const card = this.rows.find((row) => row.wordId === wordId);
    return card ? { ...card } : undefined;
  }

  async getAll(): Promise<CardRecord[]> {
    return this.rows.map((row) => ({ ...row }));
  }

  async saveCardAndLog(_card: CardRecord, _log: ReviewLogRecord): Promise<void> {
    throw new Error('not used by the development item seam');
  }
}

class UniqueCards extends MemoryCards {
  override async save(card: CardRecord): Promise<void> {
    if (this.rows.some((row) => row.wordId === card.wordId)) {
      throw new CardUniquenessError(card.wordId);
    }
    this.rows.push({ ...card });
  }
}

function word(id: string): WordRecord {
  return {
    id,
    word: id.replace('word-', ''),
    lemma: id.replace('word-', ''),
    partOfSpeech: ['n.'],
    coreMeaningZh: [`${id} 的释义`],
    exampleSentence: `${id.replace('word-', '')} example.`,
    exampleTranslation: '例句翻译',
    difficulty: 2,
    frequencyRank: 1,
    source: 'test',
    license: 'test',
  };
}

const words = [word('word-target'), word('word-two'), word('word-three'), word('word-four')];
const deck: DeckRecord = {
  id: 'deck-current',
  name: '当前词库',
  source: 'test',
  license: 'test',
  wordIds: words.map((item) => item.id),
};

const emptyDeck: DeckRecord = {
  ...deck,
  id: 'deck-empty',
  name: '空词库',
  wordIds: [],
};

class MemoryWords implements WordBankPort {
  async getDefaultDeck(): Promise<DeckRecord> {
    return deck;
  }

  async getDeck(deckId: string): Promise<DeckRecord | null> {
    return deckId === deck.id ? deck : null;
  }

  async getWord(wordId: string): Promise<WordRecord | null> {
    return words.find((item) => item.id === wordId) ?? null;
  }

  async getWordsByIds(wordIds: string[]): Promise<WordRecord[]> {
    return words.filter((item) => wordIds.includes(item.id));
  }

  async listWords(): Promise<WordRecord[]> {
    return [...words];
  }

  async sampleDeckWords(params: {
    deckId: string;
    count: number;
    preferredDifficulty: number[];
    excludeWordIds: string[];
  }): Promise<WordRecord[]> {
    if (params.deckId !== deck.id) return [];
    const excluded = new Set(params.excludeWordIds);
    return words
      .filter(
        (item) => !excluded.has(item.id) && params.preferredDifficulty.includes(item.difficulty),
      )
      .slice(0, params.count);
  }
}

class EmptyDeckWords implements WordBankPort {
  async getDefaultDeck(): Promise<DeckRecord> {
    return emptyDeck;
  }

  async getDeck(deckId: string): Promise<DeckRecord | null> {
    return deckId === emptyDeck.id ? emptyDeck : null;
  }

  async getWord(): Promise<WordRecord | null> {
    return null;
  }

  async getWordsByIds(): Promise<WordRecord[]> {
    return [];
  }

  async listWords(): Promise<WordRecord[]> {
    return [];
  }

  async sampleDeckWords(): Promise<WordRecord[]> {
    return [];
  }
}

function createCard(wordId: string, deckId = deck.id): CardRecord {
  return {
    id: `card-${wordId}`,
    wordId,
    deckId,
    stage: 'long-term',
    origin: 'accepted-new',
    createdAt: 1,
    updatedAt: 1,
    nextReviewAt: 1,
  };
}

function createService(cards = new MemoryCards()) {
  return {
    cards,
    service: new DevLearningItemService({
      cards,
      words: new MemoryWords(),
      clock: { now: () => 1_000_000 },
      settings: {
        get: async () => ({
          dailyNewWordLimit: 0,
          selectedDeckId: deck.id,
          selfRatedLevel: 'intermediate' as const,
          spellingEnabled: false,
        }),
      },
      random: () => 0,
    }),
  };
}

describe('DevLearningItemService', () => {
  it('shows an unlearned word without creating a learning card', async () => {
    const { service, cards } = createService();

    const result = await service.prepare('new-word');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.item.kind).toBe('new-word-presentation');
      if (result.item.kind !== 'new-word-presentation') throw new Error('expected presentation');
      expect(result.item.presentation.word.id).toBe('word-target');
    }
    expect(await cards.getAll()).toHaveLength(0);
  });

  it('从当前词库学习卡生成请求的题型', async () => {
    const cards = new MemoryCards([createCard('word-target', 'deck-other')]);
    const { service } = createService(cards);

    const result = await service.prepare('zh-to-en');

    expect(result.ok).toBe(true);
    if (!result.ok || result.item.kind !== 'question') throw new Error('expected question');
    expect(result.item.question.type).toBe('zh-to-en');
    expect(result.item.question.cardId).toBe('card-word-target');
  });

  it('creates a real short-term card when a requested question has no card', async () => {
    const { service, cards } = createService();

    const result = await service.prepare('en-to-zh');

    expect(result.ok).toBe(true);
    if (!result.ok || result.item.kind !== 'question') throw new Error('expected question');
    const saved = await cards.getById(result.item.question.cardId);
    expect(saved?.stage).toBe('short-term');
    expect(saved?.origin).toBe('accepted-new');
  });

  it('并发自动建卡最终只保留一张学习卡', async () => {
    const cards = new UniqueCards();
    const first = createService(cards).service;
    const second = createService(cards).service;

    const results = await Promise.all([first.prepare('en-to-zh'), second.prepare('en-to-zh')]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(await cards.getAll()).toHaveLength(1);
  });

  it('generates spelling even when the normal spelling setting is disabled', async () => {
    const cards = new MemoryCards([createCard('word-target')]);
    const { service } = createService(cards);

    const result = await service.prepare('spelling');

    expect(result.ok).toBe(true);
    if (!result.ok || result.item.kind !== 'spelling-question')
      throw new Error('expected spelling question');
    expect(result.item.question.type).toBe('spelling');
  });

  it('keeps the context question type and creates a blank in the prompt', async () => {
    const cards = new MemoryCards([createCard('word-target')]);
    const { service } = createService(cards);

    const result = await service.prepare('context-choice');

    expect(result.ok).toBe(true);
    if (!result.ok || result.item.kind !== 'question') throw new Error('expected question');
    expect(result.item.question.type).toBe('context-choice');
    expect(result.item.question.prompt).toContain('____');
  });

  it('空当前词库返回 no-learning-content', async () => {
    const cards = new MemoryCards();
    const service = new DevLearningItemService({
      cards,
      words: new EmptyDeckWords(),
      clock: { now: () => 1_000_000 },
      settings: {
        get: async () => ({
          selectedDeckId: emptyDeck.id,
          selfRatedLevel: 'intermediate' as const,
        }),
      },
      random: () => 0,
    });

    await expect(service.prepare('context-choice')).resolves.toEqual({
      ok: false,
      reason: 'no-learning-content',
    });
  });
});
