import { describe, expect, it } from 'vitest';
import { LearningService, type WordBankPort } from '@/learning/learning-service';
import type { CardRepositoryPort } from '@/storage/repositories/card-repository';
import type { ReviewLogRepositoryPort } from '@/storage/repositories/review-log-repository';
import type {
  AnswerSubmission,
  CardRecord,
  DeckRecord,
  LearningItem,
  MultipleChoiceQuestion,
  NewWordPresentation,
  ReviewLogRecord,
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

// ─── 内存 Fake 实现 ─────────────────────────────────────────────

class FakeCardRepository implements CardRepositoryPort {
  private readonly map = new Map<string, CardRecord>();

  async save(card: CardRecord): Promise<void> {
    this.map.set(card.id, { ...card });
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

const MS_PER_MIN = 60_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function makeService(opts: {
  cards?: CardRepositoryPort;
  logs?: ReviewLogRepositoryPort;
  words?: WordBankPort;
  now?: number;
  dailyNewWordLimit?: number;
  random?: () => number;
} = {}) {
  const cards = opts.cards ?? new FakeCardRepository();
  const logs = opts.logs ?? new FakeReviewLogRepository();
  const words = opts.words ?? new FakeWordBank();
  let now = opts.now ?? 1_000_000;
  const clock = { now: () => now };
  const service = new LearningService({
    cards,
    logs,
    words,
    clock,
    dailyNewWordLimit: opts.dailyNewWordLimit,
    random: opts.random,
  });
  return {
    service,
    cards,
    logs,
    words,
    clock,
    advance(ms: number) {
      now += ms;
    },
    setNow(t: number) {
      now = t;
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
    const { service } = makeService();
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
    const { service, cards } = makeService();
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
    const cards = new FakeCardRepository();
    const logs = new FakeReviewLogRepository();
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
    const cards = new FakeCardRepository();
    const logs = new FakeReviewLogRepository();
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
