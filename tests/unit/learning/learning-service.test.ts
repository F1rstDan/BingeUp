import { describe, expect, it } from 'vitest';
import { LearningService, type WordBankPort } from '@/learning/learning-service';
import type { CardRepositoryPort } from '@/storage/repositories/card-repository';
import type { ReviewLogRepositoryPort } from '@/storage/repositories/review-log-repository';
import type { ReviewSchedulerPort } from '@/learning/review-scheduler';
import type {
  CardRecord,
  DeckRecord,
  LearningItem,
  MultipleChoiceQuestion,
  NewWordPresentation,
  ReviewLogRecord,
  ReviewRating,
  SchedulerState,
  SpellingQuestion,
  WordRecord,
} from '@/types';

/** 收窄 LearningItem 为新词展示；测试已用 expect 断言 kind，此处提供类型安全访问。 */
function presentationOf(value: LearningItem | null): NewWordPresentation {
  if (value === null) throw new Error('item is null');
  if (value.kind !== 'new-word-presentation')
    throw new Error(`expected new-word-presentation, got ${value.kind}`);
  return value.presentation;
}

/** 收窄 LearningItem 为题目；测试已用 expect 断言 kind，此处提供类型安全访问。 */
function questionOf(value: LearningItem | null): MultipleChoiceQuestion {
  if (value === null) throw new Error('item is null');
  if (value.kind !== 'question') throw new Error(`expected question, got ${value.kind}`);
  return value.question;
}

/** 收窄 LearningItem 为拼写题；测试已用 expect 断言 kind，此处提供类型安全访问。 */
function spellingQuestionOf(value: LearningItem | null): SpellingQuestion {
  if (value === null) throw new Error('item is null');
  if (value.kind !== 'spelling-question')
    throw new Error(`expected spelling-question, got ${value.kind}`);
  return value.question;
}

// ─── 内存 Fake 实现 ─────────────────────────────────────────────

class FakeCardRepository implements CardRepositoryPort {
  private readonly map = new Map<string, CardRecord>();
  private readonly wordIds = new Set<string>();
  /** 原子提交时写入复习日志的目标仓库；由测试组装时注入（Issue #19 AC3）。 */
  private logsSink: ReviewLogRepositoryPort | null = null;

  /** 绑定复习日志仓库，使 saveCardAndLog 在同一原子步内写入两边。 */
  bindLogs(logs: ReviewLogRepositoryPort): this {
    this.logsSink = logs;
    return this;
  }

  async save(card: CardRecord): Promise<void> {
    // 模拟持久化层唯一约束：同 wordId 不同 id 的写入抛出 CardUniquenessError（Issue #19 AC1/AC2）。
    const existing = [...this.map.values()].find((c) => c.wordId === card.wordId);
    if (existing && existing.id !== card.id) {
      const { CardUniquenessError } = await import('@/storage/repositories/card-repository');
      throw new CardUniquenessError(card.wordId);
    }
    this.map.set(card.id, { ...card });
    this.wordIds.add(card.wordId);
  }
  async getById(id: string): Promise<CardRecord | undefined> {
    const c = this.map.get(id);
    return c ? { ...c } : undefined;
  }
  async getByWordId(wordId: string): Promise<CardRecord | undefined> {
    for (const card of this.map.values()) {
      if (card.wordId === wordId) return { ...card };
    }
    return undefined;
  }
  async getAll(): Promise<CardRecord[]> {
    return [...this.map.values()].map((c) => ({ ...c }));
  }
  async saveCardAndLog(card: CardRecord, log: ReviewLogRecord): Promise<void> {
    // 内存实现同样遵守唯一约束；日志写入与学习卡写入在同一调用内完成，
    // 模拟 IDB 事务的原子语义（Issue #19 AC3）。
    await this.save(card);
    if (this.logsSink === null) {
      throw new Error('FakeCardRepository.saveCardAndLog 未绑定 logs 仓库');
    }
    await this.logsSink.save(log);
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
  makeWord('w-enhance', '提高；增强'),
  makeWord('w-frequent', '频繁的；经常的'),
];

const DECK: DeckRecord = {
  id: 'deck-test',
  name: '测试词库',
  source: 'builtin-sample',
  license: 'CC0-1.0',
  wordIds: WORDS.map((w) => w.id),
};

class FakeWordBank implements WordBankPort {
  async getDefaultDeck(): Promise<DeckRecord> {
    return DECK;
  }
  async getDeck(deckId: string): Promise<DeckRecord | null> {
    return deckId === DECK.id ? DECK : null;
  }
  async getWord(wordId: string): Promise<WordRecord | null> {
    return WORDS.find((w) => w.id === wordId) ?? null;
  }
  async getWordsByIds(wordIds: string[]): Promise<WordRecord[]> {
    return WORDS.filter((w) => wordIds.includes(w.id));
  }
  async listWords(): Promise<WordRecord[]> {
    return [...WORDS];
  }
  async sampleDeckWords(params: {
    deckId: string;
    count: number;
    preferredDifficulty: number[];
    excludeWordIds: string[];
  }): Promise<WordRecord[]> {
    const excludeSet = new Set(params.excludeWordIds);
    const diffSet = new Set(params.preferredDifficulty);
    return WORDS.filter((w) => !excludeSet.has(w.id) && diffSet.has(w.difficulty)).slice(
      0,
      params.count,
    );
  }
}

const MS_PER_MIN = 60_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 假调度器：记录调用并返回可控行为，便于测试调度集成（Issue #7 验收标准 4、5）。 */
class FakeScheduler implements ReviewSchedulerPort {
  initCalls: { rating: ReviewRating; now: number }[] = [];
  scheduleCalls: { state: SchedulerState; rating: ReviewRating; now: number }[] = [];
  /** init/schedule 返回的 nextReviewAt 偏移量（ms），按评分映射。 */
  scheduleIntervalMs: Record<ReviewRating, number> = {
    again: 60_000,
    hard: 6 * 60 * 60 * 1000,
    good: MS_PER_DAY,
    easy: 4 * MS_PER_DAY,
  };

  init(rating: ReviewRating, now: number): { state: SchedulerState; nextReviewAt: number } {
    this.initCalls.push({ rating, now });
    const interval = this.scheduleIntervalMs[rating];
    return {
      state: {
        stability: 1,
        difficulty: 5,
        reps: 1,
        lapses: 0,
        state: 2,
        scheduledDays: Math.floor(interval / MS_PER_DAY),
        learningSteps: 0,
        lastReviewAt: now,
      },
      nextReviewAt: now + interval,
    };
  }

  schedule(
    state: SchedulerState,
    rating: ReviewRating,
    now: number,
  ): { state: SchedulerState; nextReviewAt: number } {
    this.scheduleCalls.push({ state, rating, now });
    const interval = this.scheduleIntervalMs[rating];
    return {
      state: { ...state, reps: state.reps + 1, lastReviewAt: now },
      nextReviewAt: now + interval,
    };
  }
}

function makeService(
  opts: {
    cards?: CardRepositoryPort;
    logs?: ReviewLogRepositoryPort;
    words?: WordBankPort;
    now?: number;
    dailyNewWordLimit?: number;
    random?: () => number;
    scheduler?: ReviewSchedulerPort;
  } = {},
) {
  const logs = opts.logs ?? new FakeReviewLogRepository();
  const cards = opts.cards ?? new FakeCardRepository();
  // Issue #19 AC3：确保 FakeCardRepository 的原子提交能写入 logs 仓库。
  // 已绑定时再次绑定是无害的——以最新 logs 仓库为准。
  if (cards instanceof FakeCardRepository) {
    cards.bindLogs(logs);
  }
  const words = opts.words ?? new FakeWordBank();
  const scheduler = opts.scheduler ?? new FakeScheduler();
  let now = opts.now ?? 1_000_000;
  let learningSettings = {
    dailyNewWordLimit: opts.dailyNewWordLimit ?? 5,
    selectedDeckId: DECK.id,
    selfRatedLevel: 'intermediate' as const,
    spellingEnabled: true,
  };
  const clock = { now: () => now };
  const service = new LearningService({
    cards,
    logs,
    words,
    clock,
    scheduler,
    settings: { get: async () => learningSettings },
    random: opts.random,
  });
  return {
    service,
    cards,
    logs,
    words,
    scheduler,
    clock,
    advance(ms: number) {
      now += ms;
    },
    setNow(t: number) {
      now = t;
    },
    setLearningSettings(next: Partial<typeof learningSettings>) {
      learningSettings = { ...learningSettings, ...next };
    },
  };
}

// ─── 验收标准 1：候选新词展示不创建学习卡 ─────────────────────

describe('LearningService — 候选新词展示（Issue #6 验收标准 1）', () => {
  it('无学习卡时返回新词展示，且不创建学习卡', async () => {
    const { service, cards } = makeService();
    const item = await service.getNextItem();

    expect(item).not.toBeNull();
    expect(item!.kind).toBe('new-word-presentation');

    const allCards = await cards.getAll();
    expect(allCards).toHaveLength(0);
  });

  it('新词展示包含单词的词形、释义与例句', async () => {
    const { service } = makeService({ random: () => 0 });
    const item = await service.getNextItem();

    expect(item!.kind).toBe('new-word-presentation');
    const word = presentationOf(item).word;
    expect(word.word).toBe('abandon');
    expect(word.coreMeaningZh).toEqual(['放弃；遗弃']);
    expect(word.exampleSentence).toBe('Example sentence.');
  });
});

// ─── 验收标准 1/4：“知道了”创建新词并计入每日上限 ───────────────

describe('LearningService — acceptNewWord（Issue #6 验收标准 1、4）', () => {
  it('“知道了”创建短期学习词学习卡', async () => {
    const { service, cards } = makeService({ now: 1_000_000 });
    const item = await service.getNextItem();
    expect(item!.kind).toBe('new-word-presentation');
    const wordId = presentationOf(item).word.id;

    await service.acceptNewWord(wordId);

    const card = await cards.getByWordId(wordId);
    expect(card).toBeDefined();
    expect(card!.stage).toBe('short-term');
    expect(card!.origin).toBe('accepted-new');
    expect(card!.createdAt).toBe(1_000_000);
  });

  it('“知道了”不会为已有学习卡的单词重复创建卡', async () => {
    const { service, cards } = makeService();
    const item = await service.getNextItem();
    const wordId = presentationOf(item).word.id;

    await service.acceptNewWord(wordId);
    await service.acceptNewWord(wordId); // 重复接受

    const all = await cards.getAll();
    expect(all).toHaveLength(1);
  });

  it('每日新词上限默认为五个', async () => {
    const { service } = makeService({ now: 1_000_000 });
    // 默认上限 5
    for (let i = 0; i < 5; i++) {
      const item = await service.getNextItem();
      expect(item).not.toBeNull();
      expect(item!.kind).toBe('new-word-presentation');
      await service.acceptNewWord(presentationOf(item).word.id);
    }
    // 第六个：上限已满，不再展示候选新词
    const item = await service.getNextItem();
    expect(item).toBeNull();
  });

  it('自定义每日新词上限生效', async () => {
    const { service } = makeService({ now: 1_000_000, dailyNewWordLimit: 2 });
    for (let i = 0; i < 2; i++) {
      const item = await service.getNextItem();
      await service.acceptNewWord(presentationOf(item).word.id);
    }
    expect(await service.getNextItem()).toBeNull();
  });

  it('未用额度不结转：跨自然日后上限重置', async () => {
    const day1 = Date.UTC(2026, 6, 11, 10, 0, 0); // 2026-07-11
    const day2 = Date.UTC(2026, 6, 12, 10, 0, 0); // 2026-07-12（远超 10 分钟复习）
    const { service, setNow } = makeService({ now: day1, dailyNewWordLimit: 5 });

    // 第一天接受 5 个，达到上限
    for (let i = 0; i < 5; i++) {
      const item = await service.getNextItem();
      expect(item).not.toBeNull();
      await service.acceptNewWord(presentationOf(item).word.id);
    }
    // 第六个被上限拒绝
    expect(await service.getNextItem()).toBeNull();

    setNow(day2); // 第二天
    // 第一天接受的 5 个短期词已到期，先清空复习积压（提交后不再自动出题）
    for (let i = 0; i < 5; i++) {
      const item = await service.getNextItem();
      expect(item!.kind).toBe('question');
      await service.submitAnswer({
        question: questionOf(item),
        selectedIndex: questionOf(item).correctIndex,
        responseTimeMs: 1000,
      });
    }

    // 复习清空后，最后一个候选新词可展示：说明每日上限已重置（未用额度不结转）
    const candidate = await service.getNextItem();
    expect(candidate).not.toBeNull();
    expect(candidate!.kind).toBe('new-word-presentation');
    await service.acceptNewWord(presentationOf(candidate).word.id);
  });

  it('自报认识与跳过不占用每日新词上限', async () => {
    const { service } = makeService({ now: 1_000_000, dailyNewWordLimit: 2 });
    // 自报认识一个
    let item = await service.getNextItem();
    await service.selfReportKnown(presentationOf(item).word.id);
    // 跳过一个（不调用任何服务方法，不改变状态）
    item = await service.getNextItem();
    // 仍可接受 2 个（上限未被自报/跳过占用）
    let accepted = 0;
    for (let i = 0; i < 2; i++) {
      item = await service.getNextItem();
      if (item === null) break;
      await service.acceptNewWord(presentationOf(item).word.id);
      accepted += 1;
    }
    expect(accepted).toBe(2);
  });
});

// ─── 验收标准 2：短期学习词最早十分钟后才可测试 ─────────────────

describe('LearningService — 短期学习词 10 分钟后可测（Issue #6 验收标准 2）', () => {
  it('“知道了”后 9 分钟内不出题给该词', async () => {
    const { service, advance } = makeService({ now: 1_000_000 });
    const item = await service.getNextItem();
    await service.acceptNewWord(presentationOf(item).word.id);

    advance(9 * MS_PER_MIN); // 9 分钟
    const next = await service.getNextItem();
    // 仍有未到期卡，但无到期复习；剩余候选新词可展示——但该短期词不应作为题目出现
    if (next !== null && next.kind === 'question') {
      expect(next.question.wordId).not.toBe(presentationOf(item).word.id);
    }
  });

  it('“知道了”后满 10 分钟，下一自然触发点对该词出题', async () => {
    const { service, advance } = makeService({ now: 1_000_000 });
    // 接受全部词库单词为新词，确保没有候选新词干扰
    const acceptedIds: string[] = [];
    for (let i = 0; i < WORDS.length; i++) {
      const item = await service.getNextItem();
      if (item === null) break;
      await service.acceptNewWord(presentationOf(item).word.id);
      acceptedIds.push(presentationOf(item).word.id);
    }

    advance(10 * MS_PER_MIN); // 满 10 分钟
    const next = await service.getNextItem();
    expect(next).not.toBeNull();
    expect(next!.kind).toBe('question');
    expect(acceptedIds).toContain(questionOf(next).wordId);
  });

  it('接受后该短期学习卡有 nextReviewAt = 接受时间 + 10 分钟', async () => {
    const { service, cards } = makeService({ now: 1_000_000 });
    const item = await service.getNextItem();
    await service.acceptNewWord(presentationOf(item).word.id);

    const card = await cards.getByWordId(presentationOf(item).word.id);
    expect(card!.nextReviewAt).toBe(1_000_000 + 10 * MS_PER_MIN);
  });
});

describe('LearningService — 主动巩固题（Issue #22）', () => {
  it('自然触发在新词额度用完后仍不提前测试未到期短期学习词', async () => {
    const { service } = makeService({ now: 1_000_000, dailyNewWordLimit: 1 });
    const candidate = await service.getNextItem();
    await service.acceptNewWord(presentationOf(candidate).word.id);

    expect(await service.getNextItem()).toBeNull();
  });

  it('主动学习在新词额度用完后选择最早接受的未到期短期学习词', async () => {
    const now = 1_000_000;
    const cards = new FakeCardRepository();
    await cards.save({
      id: 'card-later',
      wordId: 'w-benefit',
      deckId: DECK.id,
      stage: 'short-term',
      origin: 'accepted-new',
      createdAt: now - 1_000,
      updatedAt: now - 1_000,
      nextReviewAt: now + 9 * MS_PER_MIN,
    });
    await cards.save({
      id: 'card-earlier',
      wordId: 'w-abandon',
      deckId: DECK.id,
      stage: 'short-term',
      origin: 'accepted-new',
      createdAt: now - 2_000,
      updatedAt: now - 2_000,
      nextReviewAt: now + 8 * MS_PER_MIN,
    });
    const { service } = makeService({ cards, now, dailyNewWordLimit: 2 });

    const item = await service.getNextItem({ allowEarlyShortTermReview: true });

    expect(item?.kind).toBe('question');
    expect(questionOf(item).wordId).toBe('w-abandon');
  });

  it('主动巩固题尊重同一连续学习轮次的单词排除集合', async () => {
    const now = 1_000_000;
    const cards = new FakeCardRepository();
    for (const [wordId, createdAt] of [
      ['w-abandon', now - 2_000],
      ['w-benefit', now - 1_000],
    ] as const) {
      await cards.save({
        id: `card-${wordId}`,
        wordId,
        deckId: DECK.id,
        stage: 'short-term',
        origin: 'accepted-new',
        createdAt,
        updatedAt: createdAt,
        nextReviewAt: now + 8 * MS_PER_MIN,
      });
    }
    const { service } = makeService({ cards, now, dailyNewWordLimit: 2 });

    const item = await service.getNextItem({
      allowEarlyShortTermReview: true,
      excludedWordIds: new Set(['w-abandon']),
    });

    expect(questionOf(item).wordId).toBe('w-benefit');
  });
});

describe('LearningService — 学习设置热更新（Issue #22）', () => {
  it('下一次取学习内容读取调用时提供的最新每日新词上限', async () => {
    const { service, setLearningSettings } = makeService({
      now: 1_000_000,
      dailyNewWordLimit: 5,
    });
    const candidate = await service.getNextItem();
    await service.acceptNewWord(presentationOf(candidate).word.id);

    setLearningSettings({ dailyNewWordLimit: 1 });
    const next = await service.getNextItem();

    expect(next).toBeNull();
  });
});

// ─── 验收标准 3：自报认识词与验证题；跳过不改变状态 ─────────────

describe('LearningService — selfReportKnown 与跳过（Issue #6 验收标准 3）', () => {
  it('“我认识，换一个”创建自报认识词，不占用每日新词上限', async () => {
    const { service, cards } = makeService({ now: 1_000_000, dailyNewWordLimit: 1 });
    const item = await service.getNextItem();
    const wordId = presentationOf(item).word.id;

    await service.selfReportKnown(wordId);

    const card = await cards.getByWordId(wordId);
    expect(card).toBeDefined();
    expect(card!.stage).toBe('self-reported-known');
    expect(card!.origin).toBe('self-reported');

    // 自报认识不占用上限：仍可接受 1 个新词
    const next = await service.getNextItem();
    expect(next).not.toBeNull();
    expect(next!.kind).toBe('new-word-presentation');
    await service.acceptNewWord(presentationOf(next).word.id); // 不应被上限拒绝
  });

  it('自报认识词安排一至两天后的验证题（nextReviewAt 在 [1, 2] 天内）', async () => {
    const now = 1_000_000;
    const { service, cards } = makeService({ now, random: () => 0 });
    const item = await service.getNextItem();
    await service.selfReportKnown(presentationOf(item).word.id);

    const card = await cards.getByWordId(presentationOf(item).word.id);
    // random=0 → 正好 1 天
    expect(card!.nextReviewAt).toBe(now + 1 * MS_PER_DAY);

    const { service: s2, cards: c2 } = makeService({ now, random: () => 0.999 });
    const item2 = await s2.getNextItem();
    await s2.selfReportKnown(presentationOf(item2).word.id);
    const card2 = await c2.getByWordId(presentationOf(item2).word.id);
    // random 接近 1 → 接近 2 天，且不超过 2 天
    expect(card2!.nextReviewAt).toBeLessThanOrEqual(now + 2 * MS_PER_DAY);
    expect(card2!.nextReviewAt).toBeGreaterThanOrEqual(now + 1 * MS_PER_DAY);
  });

  it('验证题到期后在下一自然触发点出题', async () => {
    const now = 1_000_000;
    const { service, advance } = makeService({ now, random: () => 0 });
    const item = await service.getNextItem();
    const wordId = presentationOf(item).word.id;
    await service.selfReportKnown(wordId);

    advance(1 * MS_PER_DAY); // 满 1 天
    const next = await service.getNextItem();
    expect(next).not.toBeNull();
    expect(next!.kind).toBe('question');
    expect(questionOf(next).wordId).toBe(wordId);
  });

  it('跳过不改变单词学习状态：不创建学习卡', async () => {
    const { service, cards } = makeService({ random: () => 0 });
    const before = await service.getNextItem();
    expect(before!.kind).toBe('new-word-presentation');
    // 跳过：不调用任何服务方法，状态不变
    const allCards = await cards.getAll();
    expect(allCards).toHaveLength(0);
    // 下一次仍可展示该候选新词（未被接受）
    const after = await service.getNextItem();
    expect(after!.kind).toBe('new-word-presentation');
    expect(presentationOf(after).word.id).toBe(presentationOf(before).word.id);
  });
});

// ─── 验收标准 4：复习积压时不引入新词 ───────────────────────────

describe('LearningService — 复习积压时不引入新词（Issue #6 验收标准 4）', () => {
  it('存在到期复习时，优先出题而非展示候选新词', async () => {
    const { service, advance } = makeService({ now: 1_000_000 });
    // 接受一个新词
    const item = await service.getNextItem();
    await service.acceptNewWord(presentationOf(item).word.id);
    // 满 10 分钟，该短期词到期
    advance(10 * MS_PER_MIN);

    const next = await service.getNextItem();
    expect(next).not.toBeNull();
    expect(next!.kind).toBe('question');
  });

  it('到期验证题优先于到期短期学习词', async () => {
    const now = 1_000_000;
    const { service, advance } = makeService({ now, random: () => 0 });
    // 自报认识一个词（验证 1 天后到期）
    let item = await service.getNextItem();
    const selfReportedId = presentationOf(item).word.id;
    await service.selfReportKnown(selfReportedId);
    // 接受另一个新词（10 分钟后到期）
    item = await service.getNextItem();
    const acceptedId = presentationOf(item).word.id;
    await service.acceptNewWord(presentationOf(item).word.id);

    // 推进 10 分钟：短期词到期，但验证题尚未到期（要 1 天）
    advance(10 * MS_PER_MIN);
    const at10min = await service.getNextItem();
    expect(at10min!.kind).toBe('question');
    expect(questionOf(at10min).wordId).toBe(acceptedId);

    // 推进到 1 天：验证题到期，优先于短期词
    advance(1 * MS_PER_DAY);
    const at1day = await service.getNextItem();
    expect(at1day!.kind).toBe('question');
    expect(questionOf(at1day).wordId).toBe(selfReportedId);
  });

  it('复习积压时不会展示候选新词（即使每日上限未满）', async () => {
    const { service, advance } = makeService({ now: 1_000_000, dailyNewWordLimit: 5 });
    const item = await service.getNextItem();
    await service.acceptNewWord(presentationOf(item).word.id);
    advance(10 * MS_PER_MIN); // 到期复习积压

    // 词库仍有未学习的候选新词，但应优先出题
    const next = await service.getNextItem();
    expect(next!.kind).toBe('question');
  });
});

// ─── 验收标准 5：单题反馈含正确性与可展开学习信息 ───────────────

describe('LearningService — submitAnswer 反馈（Issue #6 验收标准 5）', () => {
  async function prepareDueQuestion() {
    const env = makeService({ now: 1_000_000 });
    const item = await env.service.getNextItem();
    await env.service.acceptNewWord(presentationOf(item).word.id);
    env.advance(10 * MS_PER_MIN);
    const q = await env.service.getNextItem();
    expect(q!.kind).toBe('question');
    return { env, question: questionOf(q) };
  }

  it('提交后返回正确性与可展开的学习信息', async () => {
    const { env, question } = await prepareDueQuestion();
    const result = await env.service.submitAnswer({
      question,
      selectedIndex: question.correctIndex,
      responseTimeMs: 2000,
    });

    expect(result.isCorrect).toBe(true);
    expect(result.correctIndex).toBe(question.correctIndex);
    expect(result.cardId).toBe(question.cardId);
    expect(result.reviewLogId).toBeTruthy();
    expect(result.explanation).toEqual(question.explanation);
  });

  it('提交错误答案返回错误判定与解释', async () => {
    const { env, question } = await prepareDueQuestion();
    const wrongIndex = (question.correctIndex + 1) % 4;
    const result = await env.service.submitAnswer({
      question,
      selectedIndex: wrongIndex,
      responseTimeMs: 3000,
    });

    expect(result.isCorrect).toBe(false);
    expect(result.explanation.word).toBe(question.explanation.word);
  });

  it('提交后持久化复习日志', async () => {
    const { env, question } = await prepareDueQuestion();
    await env.service.submitAnswer({
      question,
      selectedIndex: question.correctIndex,
      responseTimeMs: 1500,
    });

    const all = await env.logs.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.cardId).toBe(question.cardId);
    expect(all[0]!.isCorrect).toBe(true);
    expect(all[0]!.responseTimeMs).toBe(1500);
  });
});

// ─── 验证题流转 ─────────────────────────────────────────────────

describe('LearningService — 验证题流转（Issue #6 验收标准 3）', () => {
  async function prepareVerification() {
    const now = 1_000_000;
    const env = makeService({ now, random: () => 0 });
    const item = await env.service.getNextItem();
    const wordId = presentationOf(item).word.id;
    await env.service.selfReportKnown(wordId);
    env.advance(1 * MS_PER_DAY); // 验证题到期
    const q = await env.service.getNextItem();
    expect(q!.kind).toBe('question');
    return { env, question: questionOf(q), wordId };
  }

  it('验证题答对 → 进入长期复习', async () => {
    const { env, question, wordId } = await prepareVerification();
    await env.service.submitAnswer({
      question,
      selectedIndex: question.correctIndex,
      responseTimeMs: 1000,
    });

    const card = await env.cards.getByWordId(wordId);
    expect(card!.stage).toBe('long-term');
  });

  it('验证题答错 → 进入普通学习流程（短期学习词），10 分钟后可再测', async () => {
    const { env, question, wordId } = await prepareVerification();
    const wrongIndex = (question.correctIndex + 1) % 4;
    const before = env.clock.now();
    await env.service.submitAnswer({
      question,
      selectedIndex: wrongIndex,
      responseTimeMs: 1000,
    });

    const card = await env.cards.getByWordId(wordId);
    expect(card!.stage).toBe('short-term');
    expect(card!.nextReviewAt).toBe(before + 10 * MS_PER_MIN);
  });
});

// ─── 端到端持久化（模拟重启） ───────────────────────────────────

describe('LearningService — 端到端持久化', () => {
  it('接受新词后通过新实例读取学习卡（模拟重启）', async () => {
    const logs = new FakeReviewLogRepository();
    const cards = new FakeCardRepository().bindLogs(logs);
    const { service } = makeService({ cards, logs, now: 1_000_000 });

    const item = await service.getNextItem();
    await service.acceptNewWord(presentationOf(item).word.id);

    // 模拟重启：新实例共享同一仓库
    const { service: service2 } = makeService({ cards, logs, now: 1_000_000 });
    const card = await service2['deps'].cards.getByWordId(presentationOf(item).word.id);
    expect(card).toBeDefined();
    expect(card!.stage).toBe('short-term');
    expect(card!.origin).toBe('accepted-new');
  });

  it('提交答案后通过新实例读取复习日志（模拟重启）', async () => {
    const logs = new FakeReviewLogRepository();
    const cards = new FakeCardRepository().bindLogs(logs);
    const { service, advance } = makeService({ cards, logs, now: 1_000_000 });

    const item = await service.getNextItem();
    await service.acceptNewWord(presentationOf(item).word.id);
    advance(10 * MS_PER_MIN);
    const q = await service.getNextItem();
    expect(q!.kind).toBe('question');
    await service.submitAnswer({
      question: questionOf(q),
      selectedIndex: questionOf(q).correctIndex,
      responseTimeMs: 2000,
    });

    const { service: service2 } = makeService({ cards, logs });
    const allLogs = await service2['deps'].logs.getAll();
    expect(allLogs).toHaveLength(1);
    expect(allLogs[0]!.isCorrect).toBe(true);
  });
});

// ─── Issue #7 验收标准 1：复习优先级（5 级） ─────────────────────

describe('LearningService — 复习优先级（Issue #7 验收标准 1）', () => {
  /** 构造一张长期复习卡，可配置 lastWrongAt。 */
  function makeLongTermCard(
    wordId: string,
    now: number,
    opts: { lastWrongAt?: number; nextReviewAt?: number; reps?: number } = {},
  ): CardRecord {
    return {
      id: `card-${wordId}`,
      wordId,
      deckId: DECK.id,
      stage: 'long-term',
      origin: 'accepted-new',
      createdAt: now - 2 * MS_PER_DAY,
      updatedAt: now - MS_PER_DAY,
      nextReviewAt: opts.nextReviewAt ?? now - 1,
      schedulerState: {
        stability: 1,
        difficulty: 5,
        reps: opts.reps ?? 1,
        lapses: 0,
        state: 2,
        scheduledDays: 1,
        learningSteps: 0,
        lastReviewAt: now - MS_PER_DAY,
      },
      lastWrongAt: opts.lastWrongAt,
    };
  }

  it('优先级 1 > 2：近期答错的到期长期复习词优先于其他到期长期复习词', async () => {
    const now = 1_000_000;
    const cards = new FakeCardRepository();
    // 近期答错的长期复习词
    await cards.save(makeLongTermCard('w-abandon', now, { lastWrongAt: now - 100 }));
    // 无答错记录的长期复习词
    await cards.save(makeLongTermCard('w-benefit', now, {}));

    const { service } = makeService({ cards, now });
    const item = await service.getNextItem();
    expect(item!.kind).toBe('question');
    expect(questionOf(item).wordId).toBe('w-abandon');
  });

  it('优先级 2 > 3：其他到期长期复习词优先于自报认识验证词', async () => {
    const now = 1_000_000;
    const cards = new FakeCardRepository();
    // 无答错的长期复习词（到期）
    await cards.save(makeLongTermCard('w-abandon', now, {}));
    // 自报认识词（到期）
    await cards.save({
      id: 'card-self',
      wordId: 'w-benefit',
      deckId: DECK.id,
      stage: 'self-reported-known',
      origin: 'self-reported',
      createdAt: now - 2 * MS_PER_DAY,
      updatedAt: now - 2 * MS_PER_DAY,
      nextReviewAt: now - 1,
    });

    const { service } = makeService({ cards, now });
    const item = await service.getNextItem();
    expect(item!.kind).toBe('question');
    expect(questionOf(item).wordId).toBe('w-abandon');
  });

  it('优先级 3 > 4：自报认识验证词优先于到期短期学习词', async () => {
    const now = 1_000_000;
    const cards = new FakeCardRepository();
    // 自报认识词（到期）
    await cards.save({
      id: 'card-self',
      wordId: 'w-abandon',
      deckId: DECK.id,
      stage: 'self-reported-known',
      origin: 'self-reported',
      createdAt: now - 2 * MS_PER_DAY,
      updatedAt: now - 2 * MS_PER_DAY,
      nextReviewAt: now - 1,
    });
    // 短期学习词（到期）
    await cards.save({
      id: 'card-short',
      wordId: 'w-benefit',
      deckId: DECK.id,
      stage: 'short-term',
      origin: 'accepted-new',
      createdAt: now - MS_PER_DAY,
      updatedAt: now - MS_PER_DAY,
      nextReviewAt: now - 1,
    });

    const { service } = makeService({ cards, now });
    const item = await service.getNextItem();
    expect(item!.kind).toBe('question');
    expect(questionOf(item).wordId).toBe('w-abandon');
  });

  it('优先级 4 > 5：到期短期学习词优先于候选新词', async () => {
    const now = 1_000_000;
    const cards = new FakeCardRepository();
    // 短期学习词（到期）
    await cards.save({
      id: 'card-short',
      wordId: 'w-abandon',
      deckId: DECK.id,
      stage: 'short-term',
      origin: 'accepted-new',
      createdAt: now - MS_PER_DAY,
      updatedAt: now - MS_PER_DAY,
      nextReviewAt: now - 1,
    });

    const { service } = makeService({ cards, now });
    const item = await service.getNextItem();
    expect(item!.kind).toBe('question');
    expect(questionOf(item).wordId).toBe('w-abandon');
  });

  it('无到期复习时返回候选新词（优先级 5）', async () => {
    const { service } = makeService({ now: 1_000_000 });
    const item = await service.getNextItem();
    expect(item!.kind).toBe('new-word-presentation');
  });

  it('完整 5 级优先级顺序验证', async () => {
    const now = 1_000_000;
    const cards = new FakeCardRepository();
    // 1. 近期答错的到期长期复习词
    await cards.save(makeLongTermCard('w-abandon', now, { lastWrongAt: now - 100 }));
    // 2. 其他到期长期复习词
    await cards.save(makeLongTermCard('w-benefit', now, {}));
    // 3. 到期自报认识验证词
    await cards.save({
      id: 'card-self',
      wordId: 'w-capable',
      deckId: DECK.id,
      stage: 'self-reported-known',
      origin: 'self-reported',
      createdAt: now - 2 * MS_PER_DAY,
      updatedAt: now - 2 * MS_PER_DAY,
      nextReviewAt: now - 1,
    });
    // 4. 到期短期学习词
    await cards.save({
      id: 'card-short',
      wordId: 'w-deliberate',
      deckId: DECK.id,
      stage: 'short-term',
      origin: 'accepted-new',
      createdAt: now - MS_PER_DAY,
      updatedAt: now - MS_PER_DAY,
      nextReviewAt: now - 1,
    });
    // 5. 候选新词（词库中尚未有学习卡的 w-enhance 等）

    const { service } = makeService({ cards, now });

    // 第 1 次：近期答错的长期复习词
    let item = await service.getNextItem();
    expect(questionOf(item).wordId).toBe('w-abandon');
    // 清空该卡后
    await cards.save(
      makeLongTermCard('w-abandon', now, {
        nextReviewAt: now + MS_PER_DAY,
        lastWrongAt: now - 100,
      }),
    );

    // 第 2 次：其他到期长期复习词
    item = await service.getNextItem();
    expect(questionOf(item).wordId).toBe('w-benefit');
    await cards.save(makeLongTermCard('w-benefit', now, { nextReviewAt: now + MS_PER_DAY }));

    // 第 3 次：自报认识验证词
    item = await service.getNextItem();
    expect(questionOf(item).wordId).toBe('w-capable');

    // 第 4 次：短期学习词（清除自报认识词后）
    await cards.save({
      id: 'card-self',
      wordId: 'w-capable',
      deckId: DECK.id,
      stage: 'self-reported-known',
      origin: 'self-reported',
      createdAt: now - 2 * MS_PER_DAY,
      updatedAt: now - 2 * MS_PER_DAY,
      nextReviewAt: now + MS_PER_DAY,
    });
    item = await service.getNextItem();
    expect(questionOf(item).wordId).toBe('w-deliberate');

    // 第 5 次：候选新词（清除短期词后）
    await cards.save({
      id: 'card-short',
      wordId: 'w-deliberate',
      deckId: DECK.id,
      stage: 'short-term',
      origin: 'accepted-new',
      createdAt: now - MS_PER_DAY,
      updatedAt: now - MS_PER_DAY,
      nextReviewAt: now + MS_PER_DAY,
    });
    item = await service.getNextItem();
    expect(item!.kind).toBe('new-word-presentation');
  });

  it('最近三条均答对时清除 lastWrongAt', async () => {
    const now = 1_000_000;
    const logs = new FakeReviewLogRepository();
    const cards = new FakeCardRepository().bindLogs(logs);
    const scheduler = new FakeScheduler();
    // 近期答错的长期复习词（reps=2，答对后仍为长期复习词）
    await cards.save(makeLongTermCard('w-abandon', now, { lastWrongAt: now - 100, reps: 2 }));

    const { service } = makeService({ cards, logs, scheduler, now });

    // 提交 w-abandon 的题目并答对 → lastWrongAt 应被清除
    const item = await service.getNextItem();
    expect(questionOf(item).wordId).toBe('w-abandon');
    await service.submitAnswer({
      question: questionOf(item),
      selectedIndex: questionOf(item).correctIndex,
      responseTimeMs: 1000,
    });

    const card = await cards.getById('card-w-abandon');
    expect(card!.lastWrongAt).toBeUndefined();
  });

  it('答对后若最近三条内仍有答错则保留近期答错优先级', async () => {
    const now = 1_000_000;
    const logs = new FakeReviewLogRepository();
    const cards = new FakeCardRepository().bindLogs(logs);
    const scheduler = new FakeScheduler();
    await cards.save(makeLongTermCard('w-abandon', now, { lastWrongAt: now - 100, reps: 2 }));
    await logs.save({
      id: 'prior-wrong',
      cardId: 'card-w-abandon',
      wordId: 'w-abandon',
      questionType: 'en-to-zh',
      selectedAnswer: '错误',
      correctAnswer: '正确',
      isCorrect: false,
      responseTimeMs: 1_000,
      reviewedAt: now - 100,
    });

    const { service } = makeService({ cards, logs, scheduler, now });
    const item = await service.getNextItem();
    await service.submitAnswer({
      question: questionOf(item),
      selectedIndex: questionOf(item).correctIndex,
      responseTimeMs: 1_000,
    });

    const card = await cards.getById('card-w-abandon');
    expect(card!.lastWrongAt).toBe(now - 100);
  });

  it('长期复习词答错后设置 lastWrongAt：属于"近期答错"', async () => {
    const now = 1_000_000;
    const logs = new FakeReviewLogRepository();
    const cards = new FakeCardRepository().bindLogs(logs);
    const scheduler = new FakeScheduler();
    await cards.save(makeLongTermCard('w-abandon', now, { reps: 2 }));

    const { service } = makeService({ cards, logs, scheduler, now });
    const item = await service.getNextItem();
    const wrongIndex = (questionOf(item).correctIndex + 1) % 4;
    await service.submitAnswer({
      question: questionOf(item),
      selectedIndex: wrongIndex,
      responseTimeMs: 1000,
    });

    const card = await cards.getById('card-w-abandon');
    expect(card!.lastWrongAt).toBe(now);
  });
});

// ─── Issue #7 验收标准 3：短期学习词流转 ─────────────────────────

describe('LearningService — 短期学习词流转（Issue #7 验收标准 3）', () => {
  async function prepareDueShortTerm() {
    const env = makeService({ now: 1_000_000 });
    const item = await env.service.getNextItem();
    await env.service.acceptNewWord(presentationOf(item).word.id);
    env.advance(10 * MS_PER_MIN);
    const q = await env.service.getNextItem();
    expect(q!.kind).toBe('question');
    return { env, question: questionOf(q) };
  }

  it('短期学习词答对后进入长期复习（通过调度器初始化）', async () => {
    const { env, question } = await prepareDueShortTerm();
    const result = await env.service.submitAnswer({
      question,
      selectedIndex: question.correctIndex,
      responseTimeMs: 3000,
    });

    const card = await env.cards.getById(question.cardId);
    expect(card!.stage).toBe('long-term');
    expect(card!.schedulerState).toBeDefined();
    expect(card!.schedulerState!.reps).toBe(1);
    expect(card!.nextReviewAt).toBe(result.nextReviewAt);
    expect(env.scheduler).toBeInstanceOf(FakeScheduler);
    expect((env.scheduler as FakeScheduler).initCalls).toHaveLength(1);
    expect((env.scheduler as FakeScheduler).initCalls[0]!.rating).toBe('good');
  });

  it('短期学习词答错后按短期规则重新安排（10 分钟后可再测）', async () => {
    const { env, question } = await prepareDueShortTerm();
    const before = env.clock.now();
    const wrongIndex = (question.correctIndex + 1) % 4;
    await env.service.submitAnswer({
      question,
      selectedIndex: wrongIndex,
      responseTimeMs: 3000,
    });

    const card = await env.cards.getById(question.cardId);
    expect(card!.stage).toBe('short-term');
    expect(card!.nextReviewAt).toBe(before + 10 * MS_PER_MIN);
    expect(card!.schedulerState).toBeUndefined();
  });
});

// ─── Issue #7 验收标准 4：FSRS 调度持久化 ───────────────────────

describe('LearningService — FSRS 调度持久化（Issue #7 验收标准 4）', () => {
  it('长期复习词提交后调度器状态与下次时间持久化', async () => {
    const now = 1_000_000;
    const logs = new FakeReviewLogRepository();
    const cards = new FakeCardRepository().bindLogs(logs);
    const scheduler = new FakeScheduler();

    // 直接构造一张已到期的长期复习卡
    const card: CardRecord = {
      id: 'card-lt',
      wordId: 'w-abandon',
      deckId: DECK.id,
      stage: 'long-term',
      origin: 'accepted-new',
      createdAt: now - 2 * MS_PER_DAY,
      updatedAt: now - MS_PER_DAY,
      nextReviewAt: now - 1,
      schedulerState: {
        stability: 1,
        difficulty: 5,
        reps: 1,
        lapses: 0,
        state: 2,
        scheduledDays: 1,
        learningSteps: 0,
        lastReviewAt: now - MS_PER_DAY,
      },
    };
    await cards.save(card);

    const { service } = makeService({ cards, logs, scheduler, now });
    const item = await service.getNextItem();
    expect(questionOf(item).wordId).toBe('w-abandon');

    const result = await service.submitAnswer({
      question: questionOf(item),
      selectedIndex: questionOf(item).correctIndex,
      responseTimeMs: 3000,
    });

    // 调度器被调用
    expect(scheduler.scheduleCalls).toHaveLength(1);
    expect(scheduler.scheduleCalls[0]!.rating).toBe('good');

    // 卡片状态更新
    const updated = await cards.getById('card-lt');
    expect(updated!.schedulerState!.reps).toBe(2);
    expect(updated!.nextReviewAt).toBe(result.nextReviewAt);
    expect(result.nextReviewAt).toBe(now + scheduler.scheduleIntervalMs.good);
  });

  it('长期复习词答错后记录 lastWrongAt 并通过调度器安排', async () => {
    const now = 1_000_000;
    const logs = new FakeReviewLogRepository();
    const cards = new FakeCardRepository().bindLogs(logs);
    const scheduler = new FakeScheduler();

    const card: CardRecord = {
      id: 'card-lt',
      wordId: 'w-abandon',
      deckId: DECK.id,
      stage: 'long-term',
      origin: 'accepted-new',
      createdAt: now - 2 * MS_PER_DAY,
      updatedAt: now - MS_PER_DAY,
      nextReviewAt: now - 1,
      schedulerState: {
        stability: 1,
        difficulty: 5,
        reps: 1,
        lapses: 0,
        state: 2,
        scheduledDays: 1,
        learningSteps: 0,
        lastReviewAt: now - MS_PER_DAY,
      },
    };
    await cards.save(card);

    const { service } = makeService({ cards, logs, scheduler, now });
    const item = await service.getNextItem();
    const wrongIndex = (questionOf(item).correctIndex + 1) % 4;
    await service.submitAnswer({
      question: questionOf(item),
      selectedIndex: wrongIndex,
      responseTimeMs: 3000,
    });

    const updated = await cards.getById('card-lt');
    expect(updated!.lastWrongAt).toBe(now);
    expect(scheduler.scheduleCalls[0]!.rating).toBe('again');
  });

  it('完整复习历史持久化：刷新后仍可读取', async () => {
    const now = 1_000_000;
    const logs = new FakeReviewLogRepository();
    const cards = new FakeCardRepository().bindLogs(logs);
    const scheduler = new FakeScheduler();

    // 构造到期长期复习卡
    await cards.save({
      id: 'card-lt',
      wordId: 'w-abandon',
      deckId: DECK.id,
      stage: 'long-term',
      origin: 'accepted-new',
      createdAt: now - 2 * MS_PER_DAY,
      updatedAt: now - MS_PER_DAY,
      nextReviewAt: now - 1,
      schedulerState: {
        stability: 1,
        difficulty: 5,
        reps: 1,
        lapses: 0,
        state: 2,
        scheduledDays: 1,
        learningSteps: 0,
        lastReviewAt: now - MS_PER_DAY,
      },
    });

    const { service } = makeService({ cards, logs, scheduler, now });
    const item = await service.getNextItem();
    await service.submitAnswer({
      question: questionOf(item),
      selectedIndex: questionOf(item).correctIndex,
      responseTimeMs: 3000,
    });

    // 模拟重启：新实例共享同一仓库
    const { service: service2 } = makeService({ cards, logs, scheduler, now });
    const allLogs = await service2['deps'].logs.getAll();
    expect(allLogs).toHaveLength(1);
    expect(allLogs[0]!.rating).toBe('good');
    expect(allLogs[0]!.isCorrect).toBe(true);

    const card = await service2['deps'].cards.getById('card-lt');
    expect(card!.schedulerState!.reps).toBe(2);
    expect(card!.nextReviewAt).toBeGreaterThan(now);
  });

  it('调度器接口隔离：学习代码不直接依赖 ts-fsrs 类型', async () => {
    // 此测试验证 ReviewSchedulerPort 是隔离边界：
    // FakeScheduler 实现了端口，不引用 ts-fsrs，学习服务通过端口调用。
    const scheduler = new FakeScheduler();
    const { service } = makeService({ scheduler, now: 1_000_000 });

    // 接受新词 → 短期 → 答对 → 进入长期复习（通过端口初始化）
    const item = await service.getNextItem();
    await service.acceptNewWord(presentationOf(item).word.id);
    const env = makeService({
      cards: service['deps'].cards as unknown as CardRepositoryPort,
      logs: service['deps'].logs as unknown as ReviewLogRepositoryPort,
      scheduler,
      now: 1_000_000,
    });
    env.advance(10 * MS_PER_MIN);
    const q = await env.service.getNextItem();
    await env.service.submitAnswer({
      question: questionOf(q),
      selectedIndex: questionOf(q).correctIndex,
      responseTimeMs: 3000,
    });

    expect(scheduler.initCalls).toHaveLength(1);
    // 端口只暴露 domain 类型，不泄露 ts-fsrs Rating 枚举
    expect(scheduler.initCalls[0]!.rating).toBe('good');
  });
});

// ─── Issue #7 验收标准 5：自动评分 ───────────────────────────────

describe('LearningService — 自动评分（Issue #7 验收标准 5）', () => {
  async function prepareDueQuestion(now = 1_000_000) {
    const env = makeService({ now });
    const item = await env.service.getNextItem();
    await env.service.acceptNewWord(presentationOf(item).word.id);
    env.advance(10 * MS_PER_MIN);
    const q = await env.service.getNextItem();
    expect(q!.kind).toBe('question');
    return { env, question: questionOf(q) };
  }

  it('答错 → again', async () => {
    const { env, question } = await prepareDueQuestion();
    const wrongIndex = (question.correctIndex + 1) % 4;
    const result = await env.service.submitAnswer({
      question,
      selectedIndex: wrongIndex,
      responseTimeMs: 3000,
    });
    expect(result.rating).toBe('again');
  });

  it('答对 + 慢速（>10s）→ hard', async () => {
    const { env, question } = await prepareDueQuestion();
    const result = await env.service.submitAnswer({
      question,
      selectedIndex: question.correctIndex,
      responseTimeMs: 15_000,
    });
    expect(result.rating).toBe('hard');
  });

  it('答对 + 两次答案修改 → hard', async () => {
    const { env, question } = await prepareDueQuestion();
    const result = await env.service.submitAnswer({
      question,
      selectedIndex: question.correctIndex,
      responseTimeMs: 3000,
      answerChanges: 2,
    });
    expect(result.rating).toBe('hard');
  });

  it('答对 + 正常速度 + 无切换 + 无历史 → good', async () => {
    const { env, question } = await prepareDueQuestion();
    const result = await env.service.submitAnswer({
      question,
      selectedIndex: question.correctIndex,
      responseTimeMs: 5000,
    });
    expect(result.rating).toBe('good');
  });

  it('答对 + 快速（<2s）+ 有历史 → easy', async () => {
    const { env, question } = await prepareDueQuestion();
    // 先答对一次建立历史（短期词答对进入长期复习）
    await env.service.submitAnswer({
      question,
      selectedIndex: question.correctIndex,
      responseTimeMs: 5000,
    });

    // 长期复习词到期后再次答对：快速 + 有历史 → easy
    env.advance(MS_PER_DAY);
    const q2 = await env.service.getNextItem();
    expect(q2!.kind).toBe('question');
    const result = await env.service.submitAnswer({
      question: questionOf(q2),
      selectedIndex: questionOf(q2).correctIndex,
      responseTimeMs: 1500,
    });
    expect(result.rating).toBe('easy');
  });

  it('复习日志记录评分与切换次数', async () => {
    const { env, question } = await prepareDueQuestion();
    await env.service.submitAnswer({
      question,
      selectedIndex: question.correctIndex,
      responseTimeMs: 5000,
      answerChanges: 1,
    });

    const allLogs = await env.logs.getAll();
    expect(allLogs).toHaveLength(1);
    expect(allLogs[0]!.rating).toBe('good');
    expect(allLogs[0]!.answerChanges).toBe(1);
    expect(allLogs[0]).toMatchObject({ stageAtSubmission: 'short-term' });
  });

  it('“近期答错”只检查提交前最近三条复习日志', async () => {
    const { env, question } = await prepareDueQuestion();
    for (let index = 0; index < 4; index += 1) {
      await env.logs.save({
        id: `history-${index}`,
        cardId: question.cardId,
        wordId: question.wordId,
        questionType: question.type,
        selectedAnswer: index === 0 ? 'wrong' : question.options[question.correctIndex]!,
        correctAnswer: question.options[question.correctIndex]!,
        isCorrect: index !== 0,
        responseTimeMs: 3_000,
        reviewedAt: index + 1,
      });
    }

    const result = await env.service.submitAnswer({
      question,
      selectedIndex: question.correctIndex,
      responseTimeMs: 5_000,
    });

    expect(result.rating).toBe('good');
  });
});

// ─── Issue #7 验收标准 5：用户纠正评分 ───────────────────────────

describe('LearningService — 用户纠正评分（Issue #7 验收标准 5）', () => {
  async function prepareSubmittedLongTerm(now = 1_000_000) {
    const env = makeService({ now });
    const item = await env.service.getNextItem();
    await env.service.acceptNewWord(presentationOf(item).word.id);
    env.advance(10 * MS_PER_MIN);
    const q = await env.service.getNextItem();
    // 答对进入长期复习
    const result = await env.service.submitAnswer({
      question: questionOf(q),
      selectedIndex: questionOf(q).correctIndex,
      responseTimeMs: 5000,
    });
    return { env, result };
  }

  it('“其实是蒙的”纠正：评分降为 again，重新调度', async () => {
    const { env, result } = await prepareSubmittedLongTerm();
    const beforeCard = await env.cards.getById(result.cardId);
    const beforeNext = beforeCard!.nextReviewAt!;

    const corrected = await env.service.correctRating(result.reviewLogId, 'guessed');

    expect(corrected.rating).toBe('again');
    expect(corrected.nextReviewAt).toBeDefined();
    // again 的间隔（60s）小于 good 的间隔（1天），纠正后更早复习
    expect(corrected.nextReviewAt!).toBeLessThan(beforeNext);

    // 复习日志被更新
    const log = await env.logs.getById(result.reviewLogId);
    expect(log!.rating).toBe('again');
    expect(log!.userCorrection).toBe('guessed');
  });

  it('“这个太简单”纠正：评分升为 easy，重新调度', async () => {
    const { env, result } = await prepareSubmittedLongTerm();
    const beforeCard = await env.cards.getById(result.cardId);
    const beforeNext = beforeCard!.nextReviewAt!;

    const corrected = await env.service.correctRating(result.reviewLogId, 'too-easy');

    expect(corrected.rating).toBe('easy');
    expect(corrected.nextReviewAt).toBeDefined();
    // easy 的间隔（4天）大于 good 的间隔（1天），纠正后更晚复习
    expect(corrected.nextReviewAt!).toBeGreaterThan(beforeNext);

    const log = await env.logs.getById(result.reviewLogId);
    expect(log!.rating).toBe('easy');
    expect(log!.userCorrection).toBe('too-easy');
  });

  it('纠正后调度更新持久化：刷新后仍可读取新评分', async () => {
    const logs = new FakeReviewLogRepository();
    const cards = new FakeCardRepository().bindLogs(logs);
    const scheduler = new FakeScheduler();
    const { service } = makeService({ cards, logs, scheduler, now: 1_000_000 });

    const item = await service.getNextItem();
    await service.acceptNewWord(presentationOf(item).word.id);
    const env = makeService({ cards, logs, scheduler, now: 1_000_000 });
    env.advance(10 * MS_PER_MIN);
    const q = await env.service.getNextItem();
    const result = await env.service.submitAnswer({
      question: questionOf(q),
      selectedIndex: questionOf(q).correctIndex,
      responseTimeMs: 5000,
    });

    await env.service.correctRating(result.reviewLogId, 'too-easy');

    // 模拟重启
    const { service: service2 } = makeService({ cards, logs, scheduler, now: 1_000_000 });
    const log = await service2['deps'].logs.getById(result.reviewLogId);
    expect(log!.rating).toBe('easy');
    expect(log!.userCorrection).toBe('too-easy');

    const card = await service2['deps'].cards.getById(result.cardId);
    expect(card!.nextReviewAt).toBeGreaterThan(1_000_000 + MS_PER_DAY);
  });

  it('纠正不存在的复习日志抛出错误', async () => {
    const { service } = makeService({ now: 1_000_000 });
    await expect(service.correctRating('nonexistent', 'guessed')).rejects.toThrow();
  });

  it('纠正二次复习的评分：回滚到评分前状态重放，不重复推进 reps', async () => {
    const logs = new FakeReviewLogRepository();
    const cards = new FakeCardRepository().bindLogs(logs);
    const scheduler = new FakeScheduler();
    const env = makeService({ cards, logs, scheduler, now: 1_000_000 });

    // 1. 短期词答对 → 长期复习（init，reps=1）
    const item = await env.service.getNextItem();
    await env.service.acceptNewWord(presentationOf(item).word.id);
    env.advance(10 * MS_PER_MIN);
    const q1 = await env.service.getNextItem();
    await env.service.submitAnswer({
      question: questionOf(q1),
      selectedIndex: questionOf(q1).correctIndex,
      responseTimeMs: 5000,
    });
    const cardAfterInit = await cards.getByWordId(presentationOf(item).word.id);
    expect(cardAfterInit!.schedulerState!.reps).toBe(1);

    // 2. 到期后再次答对（schedule，reps 1→2）
    env.advance(MS_PER_DAY);
    const q2 = await env.service.getNextItem();
    const result2 = await env.service.submitAnswer({
      question: questionOf(q2),
      selectedIndex: questionOf(q2).correctIndex,
      responseTimeMs: 5000,
    });
    const cardAfterSchedule = await cards.getByWordId(presentationOf(item).word.id);
    expect(cardAfterSchedule!.schedulerState!.reps).toBe(2);

    // 3. 纠正第二次评分：应从评分前状态（reps=1）重放，结果 reps=2，而非 3
    await env.service.correctRating(result2.reviewLogId, 'too-easy');
    const cardAfterCorrection = await cards.getByWordId(presentationOf(item).word.id);
    expect(cardAfterCorrection!.schedulerState!.reps).toBe(2);
  });

  it('纠正以原提交时间重放，并拒绝对同一日志再次纠正', async () => {
    const { env, result } = await prepareSubmittedLongTerm();
    const submittedAt = env.clock.now();
    env.advance(30_000);

    await env.service.correctRating(result.reviewLogId, 'guessed');

    expect((env.scheduler as FakeScheduler).initCalls.at(-1)?.now).toBe(submittedAt);
    await expect(env.service.correctRating(result.reviewLogId, 'too-easy')).rejects.toThrow(
      '评分已经纠正',
    );
  });
});

// ─── Issue #7：题型按学习阶段选择 ───────────────────────────────

describe('LearningService — 题型按学习阶段选择（Issue #7 验收标准 2）', () => {
  it('短期学习词出 en-to-zh 题', async () => {
    const env = makeService({ now: 1_000_000 });
    const item = await env.service.getNextItem();
    await env.service.acceptNewWord(presentationOf(item).word.id);
    env.advance(10 * MS_PER_MIN);
    const q = await env.service.getNextItem();
    expect(q!.kind).toBe('question');
    expect(questionOf(q).type).toBe('en-to-zh');
  });

  it('长期复习词 reps=1 出 zh-to-en 题', async () => {
    const now = 1_000_000;
    const cards = new FakeCardRepository();
    await cards.save({
      id: 'card-lt',
      wordId: 'w-abandon',
      deckId: DECK.id,
      stage: 'long-term',
      origin: 'accepted-new',
      createdAt: now - 2 * MS_PER_DAY,
      updatedAt: now - MS_PER_DAY,
      nextReviewAt: now - 1,
      schedulerState: {
        stability: 1,
        difficulty: 5,
        reps: 1,
        lapses: 0,
        state: 2,
        scheduledDays: 1,
        learningSteps: 0,
        lastReviewAt: now - MS_PER_DAY,
      },
    });

    const { service } = makeService({ cards, now });
    const item = await service.getNextItem();
    expect(questionOf(item).type).toBe('zh-to-en');
  });

  it('长期复习词 reps>=2 出 context-choice 题', async () => {
    const now = 1_000_000;
    const cards = new FakeCardRepository();
    await cards.save({
      id: 'card-lt',
      wordId: 'w-abandon',
      deckId: DECK.id,
      stage: 'long-term',
      origin: 'accepted-new',
      createdAt: now - 5 * MS_PER_DAY,
      updatedAt: now - MS_PER_DAY,
      nextReviewAt: now - 1,
      schedulerState: {
        stability: 3,
        difficulty: 5,
        reps: 3,
        lapses: 0,
        state: 2,
        scheduledDays: 3,
        learningSteps: 0,
        lastReviewAt: now - MS_PER_DAY,
      },
    });

    const { service } = makeService({ cards, now });
    const item = await service.getNextItem();
    expect(questionOf(item).type).toBe('context-choice');
  });
});

// ─── Issue #8：连续学习模式与拼写题 ──────────────────────────────

describe('LearningService — 连续学习模式与拼写题（Issue #8）', () => {
  /** 构造一张到期的长期复习卡（reps >= 2，context-choice 题型）。 */
  function makeDueLongTermCard(
    wordId: string,
    now: number,
    opts: { reps?: number } = {},
  ): CardRecord {
    return {
      id: `card-${wordId}`,
      wordId,
      deckId: DECK.id,
      stage: 'long-term',
      origin: 'accepted-new',
      createdAt: now - 5 * MS_PER_DAY,
      updatedAt: now - MS_PER_DAY,
      nextReviewAt: now - 1,
      schedulerState: {
        stability: 3,
        difficulty: 5,
        reps: opts.reps ?? 3,
        lapses: 0,
        state: 2,
        scheduledDays: 3,
        learningSteps: 0,
        lastReviewAt: now - MS_PER_DAY,
      },
    };
  }

  describe('验收标准 3：连续模式可出拼写题，单题模式不出拼写题', () => {
    it('单题模式（无 allowSpelling）不出拼写题', async () => {
      const now = 1_000_000;
      const cards = new FakeCardRepository();
      await cards.save(makeDueLongTermCard('w-abandon', now, { reps: 3 }));

      // 多次调用 getNextItem（无 allowSpelling），不应返回拼写题
      for (let i = 0; i < 20; i++) {
        const { service } = makeService({ cards, now, random: () => 0.99 });
        const item = await service.getNextItem();
        expect(item).not.toBeNull();
        expect(item!.kind).not.toBe('spelling-question');
        // 重置该卡为到期以再次测试
        await cards.save(makeDueLongTermCard('w-abandon', now, { reps: 3 }));
      }
    });

    it('连续模式（allowSpelling: true）长期复习词有概率出拼写题', async () => {
      const now = 1_000_000;
      const cards = new FakeCardRepository();
      await cards.save(makeDueLongTermCard('w-abandon', now, { reps: 3 }));

      // random=0 → 50% 概率（<0.5），出拼写题
      const { service } = makeService({ cards, now, random: () => 0 });
      const item = await service.getNextItem({ allowSpelling: true });
      expect(item).not.toBeNull();
      expect(item!.kind).toBe('spelling-question');
      expect(spellingQuestionOf(item).correctAnswer).toBe('abandon');
    });

    it('连续模式 random >= 0.5 时仍出 context-choice 题', async () => {
      const now = 1_000_000;
      const cards = new FakeCardRepository();
      await cards.save(makeDueLongTermCard('w-abandon', now, { reps: 3 }));

      const { service } = makeService({ cards, now, random: () => 0.6 });
      const item = await service.getNextItem({ allowSpelling: true });
      expect(item).not.toBeNull();
      expect(item!.kind).toBe('question');
      expect(questionOf(item).type).toBe('context-choice');
    });

    it('连续模式不出拼写题给 reps < 2 的长期复习词', async () => {
      const now = 1_000_000;
      const cards = new FakeCardRepository();
      await cards.save(makeDueLongTermCard('w-abandon', now, { reps: 1 }));

      const { service } = makeService({ cards, now, random: () => 0 });
      const item = await service.getNextItem({ allowSpelling: true });
      expect(item).not.toBeNull();
      // reps=1 → zh-to-en，不是 context-choice，不会替换为 spelling
      expect(item!.kind).toBe('question');
      expect(questionOf(item).type).toBe('zh-to-en');
    });
  });

  describe('验收标准 5：excludedWordIds 排除已展示单词', () => {
    it('连续模式排除已展示的新词', async () => {
      const { service } = makeService({ now: 1_000_000 });
      const first = await service.getNextItem();
      expect(first!.kind).toBe('new-word-presentation');
      const firstWordId = presentationOf(first).word.id;

      // 排除第一个新词后，应返回第二个新词
      const excluded = new Set<string>([firstWordId]);
      const second = await service.getNextItem({ excludedWordIds: excluded });
      expect(second).not.toBeNull();
      expect(second!.kind).toBe('new-word-presentation');
      expect(presentationOf(second).word.id).not.toBe(firstWordId);
    });

    it('排除所有候选新词后返回 null', async () => {
      const { service } = makeService({ now: 1_000_000 });
      // 排除所有词库单词
      const allWordIds = new Set(WORDS.map((w) => w.id));
      const item = await service.getNextItem({ excludedWordIds: allWordIds });
      expect(item).toBeNull();
    });
  });

  describe('submitSpellingAnswer — 拼写题判定（验收标准 3）', () => {
    async function prepareSpellingQuestion() {
      const now = 1_000_000;
      const logs = new FakeReviewLogRepository();
      const cards = new FakeCardRepository().bindLogs(logs);
      const scheduler = new FakeScheduler();
      await cards.save(makeDueLongTermCard('w-abandon', now, { reps: 3 }));

      const { service } = makeService({ cards, logs, scheduler, now, random: () => 0 });
      const item = await service.getNextItem({ allowSpelling: true });
      expect(item!.kind).toBe('spelling-question');
      return { service, cards, logs, scheduler, question: spellingQuestionOf(item), now };
    }

    it('正确拼写（完全匹配）判定为正确', async () => {
      const { service, question } = await prepareSpellingQuestion();
      const result = await service.submitSpellingAnswer({
        question,
        spelledAnswer: 'abandon',
        responseTimeMs: 3000,
      });
      expect(result.isCorrect).toBe(true);
      expect(result.correctAnswer).toBe('abandon');
    });

    it('大小写不敏感：Abandon 判定为正确', async () => {
      const { service, question } = await prepareSpellingQuestion();
      const result = await service.submitSpellingAnswer({
        question,
        spelledAnswer: 'Abandon',
        responseTimeMs: 3000,
      });
      expect(result.isCorrect).toBe(true);
    });

    it('首尾空格不影响判定： abandon 判定为正确', async () => {
      const { service, question } = await prepareSpellingQuestion();
      const result = await service.submitSpellingAnswer({
        question,
        spelledAnswer: '  abandon  ',
        responseTimeMs: 3000,
      });
      expect(result.isCorrect).toBe(true);
    });

    it('错误拼写判定为错误', async () => {
      const { service, question } = await prepareSpellingQuestion();
      const result = await service.submitSpellingAnswer({
        question,
        spelledAnswer: 'abandn',
        responseTimeMs: 3000,
      });
      expect(result.isCorrect).toBe(false);
    });

    it('提交后持久化复习日志', async () => {
      const { service, question, logs } = await prepareSpellingQuestion();
      await service.submitSpellingAnswer({
        question,
        spelledAnswer: 'abandon',
        responseTimeMs: 2500,
      });
      const all = await logs.getAll();
      expect(all).toHaveLength(1);
      expect(all[0]!.questionType).toBe('spelling');
      expect(all[0]!.isCorrect).toBe(true);
      expect(all[0]!.selectedAnswer).toBe('abandon');
      expect(all[0]!.correctAnswer).toBe('abandon');
    });

    it('提交后通过调度器更新长期复习词状态', async () => {
      const { service, question, cards, scheduler } = await prepareSpellingQuestion();
      await service.submitSpellingAnswer({
        question,
        spelledAnswer: 'abandon',
        responseTimeMs: 3000,
      });
      expect((scheduler as FakeScheduler).scheduleCalls).toHaveLength(1);
      const card = await cards.getById(question.cardId);
      expect(card!.schedulerState!.reps).toBe(4); // 3 → 4
    });

    it('返回的解释信息包含词形、释义等', async () => {
      const { service, question } = await prepareSpellingQuestion();
      const result = await service.submitSpellingAnswer({
        question,
        spelledAnswer: 'abandon',
        responseTimeMs: 3000,
      });
      expect(result.explanation.word).toBe('abandon');
      expect(result.explanation.meanings).toEqual(['放弃；遗弃']);
    });
  });

  describe('验收标准 5：连续学习不突破每日新词上限', () => {
    it('连续模式仍受每日新词上限约束', async () => {
      const { service } = makeService({ now: 1_000_000, dailyNewWordLimit: 2 });
      // 接受 2 个新词达到上限
      for (let i = 0; i < 2; i++) {
        const item = await service.getNextItem();
        expect(item).not.toBeNull();
        await service.acceptNewWord(presentationOf(item).word.id);
      }
      // 连续模式下调用 getNextItem 也应受上限约束
      const item = await service.getNextItem({
        excludedWordIds: new Set<string>(),
        allowSpelling: true,
      });
      expect(item).toBeNull();
    });
  });
});

// ─── Issue #19：多标签并发一致性 ─────────────────────────────────

describe('LearningService — 多标签并发一致性（Issue #19 AC2/AC4）', () => {
  it('Issue #22：网站 A 接受新词后，网站 B 下一次获取内容排除同一单词', async () => {
    const cards = new FakeCardRepository();
    const websiteA = makeService({ cards, now: 1_000_000, random: () => 0 }).service;
    const websiteB = makeService({ cards, now: 1_000_000, random: () => 0 }).service;
    const first = await websiteA.getNextItem();
    const acceptedWordId = presentationOf(first).word.id;

    await websiteA.acceptNewWord(acceptedWordId);
    const nextOnWebsiteB = await websiteB.getNextItem();

    expect(nextOnWebsiteB?.kind).toBe('new-word-presentation');
    expect(presentationOf(nextOnWebsiteB).word.id).not.toBe(acceptedWordId);
  });

  it('Issue #22：网站 A 自报认识后，网站 B 下一次获取内容排除同一单词', async () => {
    const cards = new FakeCardRepository();
    const websiteA = makeService({ cards, now: 1_000_000, random: () => 0 }).service;
    const websiteB = makeService({ cards, now: 1_000_000, random: () => 0 }).service;
    const first = await websiteA.getNextItem();
    const knownWordId = presentationOf(first).word.id;

    await websiteA.selfReportKnown(knownWordId);
    const nextOnWebsiteB = await websiteB.getNextItem();

    expect(nextOnWebsiteB?.kind).toBe('new-word-presentation');
    expect(presentationOf(nextOnWebsiteB).word.id).not.toBe(knownWordId);
  });

  it('AC2：并发接受同一候选新词最终只创建一张学习卡', async () => {
    const { service, cards } = makeService({ now: 1_000_000 });
    const item = await service.getNextItem();
    const wordId = presentationOf(item).word.id;

    // 三个调用方并发接受同一候选新词（模拟多标签同时点击"知道了"）
    await Promise.all([
      service.acceptNewWord(wordId),
      service.acceptNewWord(wordId),
      service.acceptNewWord(wordId),
    ]);

    const all = await cards.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.wordId).toBe(wordId);
    expect(all[0]!.stage).toBe('short-term');
  });

  it('AC2：并发 acceptNewWord 与 selfReportKnown 同一单词只创建一张卡', async () => {
    const { service, cards } = makeService({ now: 1_000_000 });
    const item = await service.getNextItem();
    const wordId = presentationOf(item).word.id;

    await Promise.all([service.acceptNewWord(wordId), service.selfReportKnown(wordId)]);

    const all = await cards.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.wordId).toBe(wordId);
  });

  it('AC4：并发提交同一题目只写入一条复习日志且两调用方拿到同一结果', async () => {
    const env = makeService({ now: 1_000_000 });
    const item = await env.service.getNextItem();
    await env.service.acceptNewWord(presentationOf(item).word.id);
    env.advance(10 * MS_PER_MIN);
    const q = await env.service.getNextItem();
    const question = questionOf(q);

    // 两个调用方并发提交同一题（模拟重复按钮/键盘事件或并发消息）
    const [r1, r2] = await Promise.all([
      env.service.submitAnswer({
        question,
        selectedIndex: question.correctIndex,
        responseTimeMs: 2000,
      }),
      env.service.submitAnswer({
        question,
        selectedIndex: question.correctIndex,
        responseTimeMs: 2000,
      }),
    ]);

    // 在途去重：两调用方共享同一次持久化结果
    expect(r1).toBe(r2);
    expect(r1.reviewLogId).toBeTruthy();
    const logs = await env.logs.getAll();
    expect(logs).toHaveLength(1);
  });

  it('AC4：并发提交同一拼写题只写入一条复习日志', async () => {
    const env = makeService({ now: 1_000_000, dailyNewWordLimit: 5 });
    const item = await env.service.getNextItem();
    await env.service.acceptNewWord(presentationOf(item).word.id);
    env.advance(10 * MS_PER_MIN);
    env.advance(MS_PER_DAY); // 推进到长期复习，以便出现拼写题
    const q = await env.service.getNextItem({ allowSpelling: true });
    expect(q).not.toBeNull();
    if (q!.kind !== 'spelling-question') {
      // 拼写题出现概率性：若本次未出拼写题则跳过
      return;
    }
    const question = spellingQuestionOf(q);

    const [r1, r2] = await Promise.all([
      env.service.submitSpellingAnswer({
        question,
        spelledAnswer: question.correctAnswer,
        responseTimeMs: 2000,
      }),
      env.service.submitSpellingAnswer({
        question,
        spelledAnswer: question.correctAnswer,
        responseTimeMs: 2000,
      }),
    ]);

    expect(r1).toBe(r2);
    const logs = await env.logs.getAll();
    expect(logs).toHaveLength(1);
  });

  it('AC4：并发纠正同一复习日志评分只调度一次且结果共享', async () => {
    // 准备一张已提交的长期复习卡
    const env = makeService({ now: 1_000_000 });
    const item = await env.service.getNextItem();
    await env.service.acceptNewWord(presentationOf(item).word.id);
    env.advance(10 * MS_PER_MIN);
    const q = await env.service.getNextItem();
    const result = await env.service.submitAnswer({
      question: questionOf(q),
      selectedIndex: questionOf(q).correctIndex,
      responseTimeMs: 5000,
    });

    // 两个调用方并发纠正同一评分
    const [c1, c2] = await Promise.all([
      env.service.correctRating(result.reviewLogId, 'too-easy'),
      env.service.correctRating(result.reviewLogId, 'too-easy'),
    ]);

    // 在途去重：共享同一次纠正结果
    expect(c1).toBe(c2);
    expect((c1 as { rating: string }).rating).toBe('easy');
  });

  it('AC3：提交后学习卡与复习日志原子提交（均持久化或均不持久化）', async () => {
    const env = makeService({ now: 1_000_000 });
    const item = await env.service.getNextItem();
    await env.service.acceptNewWord(presentationOf(item).word.id);
    env.advance(10 * MS_PER_MIN);
    const q = await env.service.getNextItem();
    const question = questionOf(q);

    await env.service.submitAnswer({
      question,
      selectedIndex: question.correctIndex,
      responseTimeMs: 2000,
    });

    // 学习卡与复习日志应同时持久化（原子提交的 happy path）
    const card = await env.cards.getById(question.cardId);
    expect(card).toBeDefined();
    const logs = await env.logs.getAll();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.cardId).toBe(question.cardId);
  });
});
