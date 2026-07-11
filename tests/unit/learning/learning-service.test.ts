import { describe, expect, it } from 'vitest';
import { LearningService, type WordBankPort } from '@/learning/learning-service';
import type { CardRepositoryPort } from '@/storage/repositories/card-repository';
import type { ReviewLogRepositoryPort } from '@/storage/repositories/review-log-repository';
import type {
  CardRecord,
  DeckRecord,
  ReviewLogRecord,
  WordRecord,
  MultipleChoiceQuestion,
  AnswerSubmission,
} from '@/types';

// ─── 内存 Fake 实现 ─────────────────────────────────────────────

class FakeCardRepository implements CardRepositoryPort {
  private readonly map = new Map<string, CardRecord>();

  async save(card: CardRecord): Promise<void> {
    this.map.set(card.id, { ...card });
  }
  async getById(id: string): Promise<CardRecord | undefined> {
    return this.map.get(id);
  }
  async getByWordId(wordId: string): Promise<CardRecord | undefined> {
    for (const card of this.map.values()) {
      if (card.wordId === wordId) return { ...card };
    }
    return undefined;
  }
  async getAll(): Promise<CardRecord[]> {
    return [...this.map.values()];
  }
}

class FakeReviewLogRepository implements ReviewLogRepositoryPort {
  private readonly map = new Map<string, ReviewLogRecord>();

  async save(log: ReviewLogRecord): Promise<void> {
    this.map.set(log.id, { ...log });
  }
  async getById(id: string): Promise<ReviewLogRecord | undefined> {
    return this.map.get(id);
  }
  async getByCardId(cardId: string): Promise<ReviewLogRecord[]> {
    return [...this.map.values()].filter((l) => l.cardId === cardId);
  }
  async getAll(): Promise<ReviewLogRecord[]> {
    return [...this.map.values()];
  }
}

function makeWord(id: string, meaning: string): WordRecord {
  return {
    id,
    word: id.replace('w-', ''),
    lemma: id.replace('w-', ''),
    phonetic: '/test/',
    partOfSpeech: ['v.'],
    coreMeaningZh: [meaning],
    exampleSentence: 'Example sentence.',
    exampleTranslation: '示例翻译。',
    difficulty: 2,
    source: 'builtin-sample',
    license: 'CC0-1.0',
  };
}

const WORDS: WordRecord[] = [
  makeWord('w-abandon', '放弃；遗弃'),
  makeWord('w-benefit', '利益；好处'),
  makeWord('w-capable', '有能力的；能干的'),
  makeWord('w-deliberate', '故意的；深思熟虑的'),
];

const DECK: DeckRecord = {
  id: 'deck-test',
  name: '测试词库',
  source: 'builtin-sample',
  license: 'CC0-1.0',
  wordIds: WORDS.map((w) => w.id),
};

class FakeWordBank implements WordBankPort {
  getDefaultDeck(): DeckRecord {
    return DECK;
  }
  getWord(wordId: string): WordRecord | null {
    return WORDS.find((w) => w.id === wordId) ?? null;
  }
  listWords(): WordRecord[] {
    return [...WORDS];
  }
}

function makeService(opts: {
  cards?: CardRepositoryPort;
  logs?: ReviewLogRepositoryPort;
  words?: WordBankPort;
  now?: number;
} = {}) {
  const cards = opts.cards ?? new FakeCardRepository();
  const logs = opts.logs ?? new FakeReviewLogRepository();
  const words = opts.words ?? new FakeWordBank();
  const clock = { now: () => opts.now ?? 1_000_000 };
  const service = new LearningService({ cards, logs, words, clock });
  return { service, cards, logs, words, clock };
}

// ─── 测试 ───────────────────────────────────────────────────────

describe('LearningService — 生成题目（Issue #5 验收标准 2）', () => {
  it('从本地词库生成可回答的英语选中文题目', async () => {
    const { service } = makeService();
    const question = await service.getNextQuestion();

    expect(question).not.toBeNull();
    expect(question!.type).toBe('en-to-zh');
    expect(question!.options).toHaveLength(4);
  });

  it('生成的题目只有一个正确答案', async () => {
    const { service, words } = makeService();
    const question = await service.getNextQuestion();

    const targetWord = words.getWord(question!.wordId);
    expect(targetWord).not.toBeNull();

    const correctOption = question!.options[question!.correctIndex];
    expect(correctOption).toBe(targetWord!.coreMeaningZh.join('；'));

    const correctCount = question!.options.filter(
      (o) => o === correctOption,
    ).length;
    expect(correctCount).toBe(1);
  });

  it('四个选项互不重复', async () => {
    const { service } = makeService();
    const question = await service.getNextQuestion();

    const unique = new Set(question!.options);
    expect(unique.size).toBe(4);
  });
});

describe('LearningService — 持久化学习卡和复习日志（Issue #5 验收标准 3）', () => {
  it('生成题目时为单词创建学习卡', async () => {
    const { service, cards } = makeService();
    const question = await service.getNextQuestion();

    const card = await cards.getByWordId(question!.wordId);
    expect(card).toBeDefined();
    expect(card!.wordId).toBe(question!.wordId);
    expect(card!.stage).toBe('short-term');
  });

  it('提交答案后持久化复习日志', async () => {
    const { service, logs } = makeService();
    const question = await service.getNextQuestion();

    const submission: AnswerSubmission = {
      question: question!,
      selectedIndex: question!.correctIndex,
      responseTimeMs: 2000,
    };
    const result = await service.submitAnswer(submission);

    expect(result.isCorrect).toBe(true);
    expect(result.reviewLogId).toBeTruthy();

    const allLogs = await logs.getAll();
    expect(allLogs).toHaveLength(1);
    expect(allLogs[0]!.cardId).toBe(question!.cardId);
    expect(allLogs[0]!.isCorrect).toBe(true);
  });

  it('提交错误答案后记录错误结果', async () => {
    const { service, logs } = makeService();
    const question = await service.getNextQuestion();

    const wrongIndex = (question!.correctIndex + 1) % 4;
    const submission: AnswerSubmission = {
      question: question!,
      selectedIndex: wrongIndex,
      responseTimeMs: 5000,
    };
    const result = await service.submitAnswer(submission);

    expect(result.isCorrect).toBe(false);
    expect(result.correctIndex).toBe(question!.correctIndex);

    const log = await logs.getByCardId(question!.cardId);
    expect(log).toHaveLength(1);
    expect(log[0]!.isCorrect).toBe(false);
    expect(log[0]!.selectedAnswer).toBe(question!.options[wrongIndex]);
  });

  it('提交后学习卡的 updatedAt 更新', async () => {
    let now = 1_000_000;
    const cards = new FakeCardRepository();
    const logs = new FakeReviewLogRepository();
    const words = new FakeWordBank();
    const clock = { now: () => now };
    const service = new LearningService({ cards, logs, words, clock });

    const question = await service.getNextQuestion();
    const cardBefore = await cards.getByWordId(question!.wordId);
    const updatedAtBefore = cardBefore!.updatedAt;

    now = 2_000_000; // 推进时钟
    await service.submitAnswer({
      question: question!,
      selectedIndex: question!.correctIndex,
      responseTimeMs: 1000,
    });

    const cardAfter = await cards.getByWordId(question!.wordId);
    expect(cardAfter!.updatedAt).toBe(2_000_000);
    expect(cardAfter!.updatedAt).toBeGreaterThan(updatedAtBefore);
  });

  it('复习日志包含完整的判定信息', async () => {
    const { service, logs } = makeService({ now: 2_000_000 });
    const question = await service.getNextQuestion();

    await service.submitAnswer({
      question: question!,
      selectedIndex: question!.correctIndex,
      responseTimeMs: 3500,
    });

    const log = (await logs.getAll())[0]!;
    expect(log.questionType).toBe('en-to-zh');
    expect(log.correctAnswer).toBe(question!.options[question!.correctIndex]);
    expect(log.responseTimeMs).toBe(3500);
    expect(log.reviewedAt).toBe(2_000_000);
    expect(log.wordId).toBe(question!.wordId);
  });
});

describe('LearningService — 出词优先级', () => {
  it('优先选择尚无学习卡的单词', async () => {
    const { service, cards } = makeService();
    // 预先为第一个单词创建学习卡
    await cards.save({
      id: 'card-pre-existing',
      wordId: 'w-abandon',
      deckId: 'deck-test',
      stage: 'short-term',
      createdAt: 500_000,
      updatedAt: 500_000,
    });

    const question = await service.getNextQuestion();
    expect(question!.wordId).not.toBe('w-abandon');
  });

  it('所有单词都有学习卡时仍可生成题目', async () => {
    const { service, cards } = makeService();
    // 为所有单词创建学习卡
    for (const word of WORDS) {
      await cards.save({
        id: `card-${word.id}`,
        wordId: word.id,
        deckId: 'deck-test',
        stage: 'short-term',
        createdAt: 500_000,
        updatedAt: 500_000,
      });
    }

    const question = await service.getNextQuestion();
    expect(question).not.toBeNull();
    expect(question!.options).toHaveLength(4);
  });

  it('同一单词不会重复创建学习卡', async () => {
    const { service, cards } = makeService();
    // 为所有单词预创建学习卡
    for (const word of WORDS) {
      await cards.save({
        id: `card-${word.id}`,
        wordId: word.id,
        deckId: 'deck-test',
        stage: 'short-term',
        createdAt: 500_000,
        updatedAt: 500_000,
      });
    }

    // 所有单词都有卡，getNextQuestion 选第一个单词（w-abandon）
    const question = await service.getNextQuestion();
    expect(question!.wordId).toBe('w-abandon');
    // 题目应复用既有学习卡，而非创建新卡
    expect(question!.cardId).toBe('card-w-abandon');

    // 不应新增学习卡
    const allCards = await cards.getAll();
    expect(allCards).toHaveLength(WORDS.length);
  });
});

describe('LearningService — 端到端持久化', () => {
  it('提交结果后通过新实例读取学习卡和复习日志（模拟重启）', async () => {
    const cards = new FakeCardRepository();
    const logs = new FakeReviewLogRepository();
    const { service } = makeService({ cards, logs });

    const question = await service.getNextQuestion();
    await service.submitAnswer({
      question: question!,
      selectedIndex: question!.correctIndex,
      responseTimeMs: 2000,
    });

    // 模拟重启：用新 service 实例但共享同一仓库
    const { service: service2 } = makeService({ cards, logs });
    const card = await service2['deps'].cards.getByWordId(question!.wordId);
    const log = await service2['deps'].logs.getByCardId(question!.cardId);

    expect(card).toBeDefined();
    expect(card!.wordId).toBe(question!.wordId);
    expect(log).toHaveLength(1);
    expect(log[0]!.isCorrect).toBe(true);
  });
});
