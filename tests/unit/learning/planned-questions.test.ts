import { describe, expect, it } from 'vitest';
import { LearningService, type WordBankPort } from '@/learning/learning-service';
import { computeQuestionPlanHashes } from '@/dictionary/content-contract';
import { ContentUnavailableError } from '@/learning/planned-questions';
import type {
  CardRecord,
  DeckRecord,
  LearningItem,
  MultipleChoiceQuestion,
  ReviewLogRecord,
  SpellingQuestion,
  WordQuestionPlan,
  WordRecord,
} from '@/types';

function word(id: string, text: string, meaning: string, surface: string): WordRecord {
  return {
    id,
    word: text,
    lemma: text,
    phonetic: `/${text}/`,
    partOfSpeech: ['v.'],
    coreMeaningZh: [meaning],
    exampleSentence: `We ${surface} the plan.`,
    exampleTranslation: `我们${meaning}了计划。`,
    surfaceFormInExample: surface,
    difficulty: 2,
    frequencyRank: 1,
    source: 'bingeup-dictionary',
    license: 'LicenseRef-BingeUp-Dictionary-v1',
  };
}

const WORDS = [
  word('w-abandon', 'abandon', '放弃', 'abandoned'),
  word('w-decline', 'decline', '下降', 'declined'),
  word('w-accept', 'accept', '接受', 'accepted'),
  word('w-reduce', 'reduce', '减少', 'reduced'),
];

const DECK: DeckRecord = {
  id: 'deck-test',
  name: '测试',
  source: 'bingeup-dictionary',
  license: 'LicenseRef-BingeUp-Dictionary-v1',
  wordIds: WORDS.map((item) => item.id),
};

async function makePlans(): Promise<WordQuestionPlan[]> {
  const byId = new Map(WORDS.map((item) => [item.id, item]));
  const result: WordQuestionPlan[] = [];
  for (const item of WORDS) {
    const others = WORDS.filter((candidate) => candidate.id !== item.id);
    const distractors = others.map((candidate) => candidate.id) as [string, string, string];
    const draft: WordQuestionPlan = {
      wordId: item.id,
      enToZh: { distractors, checkedContentHash: '' },
      zhToEn: { distractors, checkedContentHash: '' },
      contextChoice: {
        distractors: others.map((candidate) => ({
          wordId: candidate.id,
          surfaceForm: candidate.word,
        })) as [
          { wordId: string; surfaceForm: string },
          { wordId: string; surfaceForm: string },
          { wordId: string; surfaceForm: string },
        ],
        checkedContentHash: '',
      },
      spelling: { prefixLength: 1, checkedContentHash: '' },
    };
    const hashes = await computeQuestionPlanHashes(item, draft, byId);
    result.push({
      ...draft,
      enToZh: { ...draft.enToZh, checkedContentHash: hashes.enToZh },
      zhToEn: { ...draft.zhToEn!, checkedContentHash: hashes.zhToEn! },
      contextChoice: { ...draft.contextChoice!, checkedContentHash: hashes.contextChoice! },
      spelling: { ...draft.spelling!, checkedContentHash: hashes.spelling! },
    });
  }
  return result;
}

class PlannedWordBank implements WordBankPort {
  constructor(
    private readonly all: WordRecord[],
    private readonly questionPlans: Map<string, WordQuestionPlan>,
  ) {}
  async getDefaultDeck(): Promise<DeckRecord> {
    return DECK;
  }
  async getDeck(deckId: string): Promise<DeckRecord | null> {
    return deckId === DECK.id ? DECK : null;
  }
  async getWord(wordId: string): Promise<WordRecord | null> {
    return this.all.find((item) => item.id === wordId) ?? null;
  }
  async getWordsByIds(wordIds: string[]): Promise<WordRecord[]> {
    return this.all.filter((item) => wordIds.includes(item.id));
  }
  async listWords(): Promise<WordRecord[]> {
    return [...this.all];
  }
  async sampleDeckWords(): Promise<WordRecord[]> {
    return [...this.all];
  }
  async getQuestionPlan(wordId: string): Promise<WordQuestionPlan | null> {
    return this.questionPlans.get(wordId) ?? null;
  }
  getContentVersion(): string {
    return 'test-content';
  }
  getContentKind(): 'legacy-v1' | 'content-v2' {
    return 'content-v2';
  }
}

class Cards {
  private readonly map = new Map<string, CardRecord>();
  add(card: CardRecord) {
    this.map.set(card.id, card);
  }
  async save(card: CardRecord) {
    this.map.set(card.id, card);
  }
  async saveCardAndLog(card: CardRecord, log: ReviewLogRecord) {
    this.map.set(card.id, card);
    logs.add(log);
  }
  async getById(id: string) {
    return this.map.get(id);
  }
  async getByWordId(wordId: string) {
    return [...this.map.values()].find((card) => card.wordId === wordId);
  }
  async getAll() {
    return [...this.map.values()];
  }
}

const logs = {
  items: [] as ReviewLogRecord[],
  add(log: ReviewLogRecord) {
    this.items.push(log);
  },
  async save(log: ReviewLogRecord) {
    this.items.push(log);
  },
  async getById(id: string) {
    return this.items.find((log) => log.id === id);
  },
  async getByCardId(cardId: string) {
    return this.items.filter((log) => log.cardId === cardId);
  },
  async getAll() {
    return [...this.items];
  },
};

function card(overrides: Partial<CardRecord> = {}): CardRecord {
  return {
    id: 'card-1',
    wordId: 'w-abandon',
    deckId: DECK.id,
    stage: 'long-term',
    createdAt: 1_000,
    updatedAt: 2_000,
    nextReviewAt: 0,
    schedulerState: {
      stability: 1,
      difficulty: 5,
      reps: 3,
      lapses: 0,
      state: 2,
      scheduledDays: 1,
      learningSteps: 0,
    },
    ...overrides,
  };
}

async function serviceFor(
  questionPlans: Map<string, WordQuestionPlan>,
  all: WordRecord[] = WORDS,
  cards: Cards = new Cards(),
  dailyNewWordLimit = 10,
) {
  return new LearningService({
    cards,
    logs,
    words: new PlannedWordBank(all, questionPlans),
    clock: { now: () => 10_000 },
    settings: {
      get: async () => ({
        dailyNewWordLimit,
        selectedDeckId: DECK.id,
        selfRatedLevel: 'intermediate' as const,
        spellingEnabled: true,
      }),
    },
    random: () => 0.1,
  });
}

function questionOf(item: LearningItem | null): MultipleChoiceQuestion {
  if (item?.kind !== 'question') throw new Error(`expected question, got ${item?.kind}`);
  return item.question;
}

describe('固定题组运行时', () => {
  it('语境题使用存储的表层词形，且恰好一个空位', async () => {
    const plans = await makePlans();
    const cards = new Cards();
    cards.add(card());
    const service = await serviceFor(
      new Map(plans.map((plan) => [plan.wordId, plan])),
      WORDS,
      cards,
    );
    const question = questionOf(await service.getNextItem());
    expect(question.type).toBe('context-choice');
    expect(question.prompt.match(/____/g)).toHaveLength(1);
    expect(question.options[question.correctIndex]).toBe('abandoned');
  });

  it('语境题不可用时按同卡回退到中选英', async () => {
    const plans = await makePlans();
    const first = { ...plans[0]!, contextChoice: null };
    const cards = new Cards();
    cards.add(card());
    const service = await serviceFor(new Map([[first.wordId, first]]), WORDS, cards);
    const question = questionOf(await service.getNextItem());
    expect(question.type).toBe('zh-to-en');
    expect(question.cardId).toBe('card-1');
  });

  it('拼写计划缺失时仍返回同卡选择题', async () => {
    const plans = await makePlans();
    const first = { ...plans[0]!, spelling: null };
    const cards = new Cards();
    cards.add(card());
    const service = await serviceFor(new Map([[first.wordId, first]]), WORDS, cards);
    const question = questionOf(await service.getNextItem({ allowSpelling: true }));
    expect(question.type).toBe('context-choice');
  });

  it('到期卡词条缺失时抛内容错误，不转去新词', async () => {
    const plans = await makePlans();
    const cards = new Cards();
    cards.add(card());
    const service = await serviceFor(
      new Map([[plans[0]!.wordId, plans[0]!]]),
      WORDS.slice(1),
      cards,
    );
    await expect(service.getNextItem()).rejects.toBeInstanceOf(ContentUnavailableError);
  });

  it('拼写题提示包含词性、空位、前缀和字母数', async () => {
    const plans = await makePlans();
    const cards = new Cards();
    cards.add(card({ wordId: 'w-reduce', schedulerState: { ...card().schedulerState!, reps: 3 } }));
    const service = await serviceFor(
      new Map(plans.map((plan) => [plan.wordId, plan])),
      WORDS,
      cards,
    );
    const item = await service.getNextItem({ allowSpelling: true });
    if (item?.kind !== 'spelling-question') throw new Error('expected spelling');
    const question: SpellingQuestion = item.question;
    expect(question.correctAnswer).toBe('reduce');
    expect(question.hint).toMatchObject({ partOfSpeech: 'v.', prefix: 'r', letterCount: 6 });
    expect(question.hint?.exampleSentence).toContain('____');
  });

  it('每日额度用尽时跳过停用卡，提前复习正常短期卡', async () => {
    const plans = await makePlans();
    const cards = new Cards();
    cards.add(
      card({
        id: 'card-disabled',
        wordId: 'w-decline',
        stage: 'short-term',
        nextReviewAt: 20_000,
        createdAt: 1,
        disabled: true,
      }),
    );
    cards.add(
      card({
        id: 'card-active',
        wordId: 'w-reduce',
        stage: 'short-term',
        nextReviewAt: 20_000,
        createdAt: 2,
      }),
    );
    const service = await serviceFor(
      new Map(plans.map((plan) => [plan.wordId, plan])),
      WORDS,
      cards,
      0,
    );
    const item = await service.getNextItem({ allowEarlyShortTermReview: true });
    expect(item?.kind).toBe('question');
    if (item?.kind === 'question') expect(item.question.cardId).toBe('card-active');
  });
});
