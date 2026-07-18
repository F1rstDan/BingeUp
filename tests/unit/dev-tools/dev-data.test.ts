import { describe, expect, it } from 'vitest';
import { DevDataService } from '@/dev-tools/dev-data';
import type { CardRepositoryPort } from '@/storage/repositories/card-repository';
import type { ReviewLogRepositoryPort } from '@/storage/repositories/review-log-repository';
import type { SessionLogRepositoryPort } from '@/storage/repositories/session-log-repository';
import type {
  CardRecord,
  DeckRecord,
  ReviewLogRecord,
  SessionLogRecord,
  WordRecord,
} from '@/types';
import type { WordBankPort } from '@/learning/learning-service';

const deck: DeckRecord = {
  id: 'deck-current',
  name: '当前词库',
  source: 'test',
  license: 'test',
  wordIds: ['word-in-current'],
};

const word: WordRecord = {
  id: 'word-in-current',
  word: 'current',
  lemma: 'current',
  partOfSpeech: ['adj.'],
  coreMeaningZh: ['当前的'],
  difficulty: 2,
  frequencyRank: 1,
  source: 'test',
  license: 'test',
};

class MemoryWords implements WordBankPort {
  async getDefaultDeck(): Promise<DeckRecord> {
    return deck;
  }
  async getDeck(deckId: string): Promise<DeckRecord | null> {
    return deckId === deck.id ? deck : null;
  }
  async getWord(wordId: string): Promise<WordRecord | null> {
    return wordId === word.id ? word : null;
  }
  async getWordsByIds(wordIds: string[]): Promise<WordRecord[]> {
    return wordIds.includes(word.id) ? [word] : [];
  }
  async listWords(): Promise<WordRecord[]> {
    return [word];
  }
  async sampleDeckWords(): Promise<WordRecord[]> {
    return [];
  }
}

class MemoryCards implements CardRepositoryPort {
  constructor(private readonly rows: CardRecord[]) {}
  async save(): Promise<void> {}
  async getById(): Promise<CardRecord | undefined> {
    return undefined;
  }
  async getByWordId(): Promise<CardRecord | undefined> {
    return undefined;
  }
  async getAll(): Promise<CardRecord[]> {
    return this.rows;
  }
  async saveCardAndLog(): Promise<void> {}
}

class MemoryReviewLogs implements ReviewLogRepositoryPort {
  constructor(private readonly rows: ReviewLogRecord[]) {}
  async save(): Promise<void> {}
  async getById(): Promise<ReviewLogRecord | undefined> {
    return undefined;
  }
  async getByCardId(): Promise<ReviewLogRecord[]> {
    return [];
  }
  async getAll(): Promise<ReviewLogRecord[]> {
    return this.rows;
  }
}

class MemorySessionLogs implements SessionLogRepositoryPort {
  constructor(private readonly rows: SessionLogRecord[]) {}
  async save(): Promise<void> {}
  async getAll(): Promise<SessionLogRecord[]> {
    return this.rows;
  }
}

const currentDeckCard: CardRecord = {
  id: 'card-current',
  wordId: word.id,
  deckId: 'deck-other',
  stage: 'long-term',
  createdAt: 1,
  updatedAt: 1,
};

const otherDeckCard: CardRecord = {
  id: 'card-other',
  wordId: 'word-outside',
  deckId: 'deck-other',
  stage: 'short-term',
  createdAt: 1,
  updatedAt: 1,
};

function createService() {
  const cards = new MemoryCards([currentDeckCard, otherDeckCard]);
  const logs: ReviewLogRecord[] = [
    {
      id: 'log-1',
      cardId: currentDeckCard.id,
      wordId: word.id,
      questionType: 'en-to-zh',
      selectedAnswer: '当前的',
      correctAnswer: '当前的',
      isCorrect: true,
      responseTimeMs: 100,
      reviewedAt: 1,
    },
  ];
  const sessions: SessionLogRecord[] = [
    {
      id: 'session-1',
      startedAt: 1,
      endedAt: 2,
      mode: 'single',
      outcome: 'submitted',
      questionsAnswered: 1,
    },
  ];
  return new DevDataService({
    cards,
    reviewLogs: new MemoryReviewLogs(logs),
    sessionLogs: new MemorySessionLogs(sessions),
    words: new MemoryWords(),
    settings: { get: async () => ({ selectedDeckId: deck.id }) },
  });
}

describe('DevDataService', () => {
  it('按当前词库成员关系统计，而不是按学习卡创建词库统计', async () => {
    const service = createService();

    await expect(service.getCurrentDeckSummary()).resolves.toEqual({
      deck: { id: deck.id, name: deck.name },
      wordCount: 1,
      learningCardCount: 1,
      stageCounts: {
        new: 0,
        'short-term': 0,
        'long-term': 1,
        'self-reported-known': 0,
      },
    });
  });

  it('returns all learning records in the detailed snapshot', async () => {
    const service = createService();

    const snapshot = await service.getSnapshot();

    expect(snapshot.cards).toHaveLength(2);
    expect(snapshot.reviewLogs).toHaveLength(1);
    expect(snapshot.sessionLogs).toHaveLength(1);
  });
});
