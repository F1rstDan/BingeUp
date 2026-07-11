import type {
  AnswerSubmission,
  CardRecord,
  DeckRecord,
  LearningItem,
  MultipleChoiceQuestion,
  ReviewLogRecord,
  SubmissionResult,
  WordRecord,
} from '@/types';
import type { CardRepositoryPort } from '@/storage/repositories/card-repository';
import type { ReviewLogRepositoryPort } from '@/storage/repositories/review-log-repository';
import { generateEnToZhQuestion } from '@/learning/question-generator';

/**
 * 本地词库端口：学习服务通过此端口读取单词与词库，
 * 默认实现为内置词库（见 `src/dictionary/built-in`）。
 */
export interface WordBankPort {
  getDefaultDeck(): DeckRecord;
  getWord(wordId: string): WordRecord | null;
  listWords(): WordRecord[];
}

/** 时钟端口，便于测试注入。 */
interface Clock {
  now(): number;
}

/** 每日新词上限默认值（CONTEXT.md：每日新词上限默认五个）。 */
const DEFAULT_DAILY_NEW_WORD_LIMIT = 5;

/** 短期学习词接受后最早可测试的延迟（CONTEXT.md：最早十分钟后才可测试）。 */
const SHORT_TERM_DELAY_MS = 10 * 60_000;

/** 自报认识词验证题延迟区间：一至两天后（CONTEXT.md）。 */
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SELF_REPORTED_MIN_DELAY_MS = ONE_DAY_MS;
const SELF_REPORTED_MAX_DELAY_MS = 2 * ONE_DAY_MS;

export interface LearningServiceDeps {
  cards: CardRepositoryPort;
  logs: ReviewLogRepositoryPort;
  words: WordBankPort;
  clock: Clock;
  /** 每日新词上限，缺省为 5。 */
  dailyNewWordLimit?: number;
  /** 随机函数，用于自报认识词验证题延迟（[1,2) 天），缺省 Math.random。 */
  random?: () => number;
}

/**
 * 学习服务：编排词库、新词展示、题目生成、学习卡与复习日志（Issue #5 / #6）。
 *
 * 职责：
 * - 按学习优先级返回下一个学习项目（新词展示或题目）；
 * - 候选新词展示不创建学习卡；只有“知道了”创建新词并计入每日上限；
 * - “我认识，换一个”创建自报认识词并安排一至两天后的验证题；
 * - 提交答案后持久化复习日志、更新学习卡，并返回带解释的反馈；
 * - 验证题答对进入长期复习，答错进入普通学习流程（短期学习词）。
 *
 * 出词优先级（CONTEXT.md / 规格 Implementation Decisions）：
 * 1. 到期自报认识词验证题；
 * 2. 到期短期学习词；
 * 3. 候选新词（仅在无到期复习且每日上限未满时）。
 * （长期复习词 FSRS 调度由后续 Issue 引入。）
 */
export class LearningService {
  readonly deps: LearningServiceDeps;

  constructor(deps: LearningServiceDeps) {
    this.deps = deps;
  }

  private get dailyLimit(): number {
    return this.deps.dailyNewWordLimit ?? DEFAULT_DAILY_NEW_WORD_LIMIT;
  }

  private get random(): () => number {
    return this.deps.random ?? Math.random;
  }

  /**
   * 获取下一个学习项目（单题模式）。
   *
   * - 优先返回到期复习题（验证题、短期学习词）；
   * - 无到期复习且每日上限未满时，返回候选新词展示；
   * - 候选新词展示不创建学习卡；
   * - 无可展示内容时返回 null。
   */
  async getNextItem(): Promise<LearningItem | null> {
    const now = this.deps.clock.now();
    const allCards = await this.deps.cards.getAll();

    // 1. 到期自报认识词验证题
    const dueVerification = this.findDueCard(allCards, 'self-reported-known', now);
    if (dueVerification) {
      const question = await this.makeQuestionForCard(dueVerification);
      if (question) return { kind: 'question', question };
    }

    // 2. 到期短期学习词
    const dueShortTerm = this.findDueCard(allCards, 'short-term', now);
    if (dueShortTerm) {
      const question = await this.makeQuestionForCard(dueShortTerm);
      if (question) return { kind: 'question', question };
    }

    // 3. 无到期复习：候选新词（受每日上限约束）
    if (this.countTodayNewWords(allCards, now) >= this.dailyLimit) {
      return null;
    }

    const candidate = this.pickCandidateNewWord(allCards);
    if (candidate) {
      return { kind: 'new-word-presentation', presentation: { word: candidate } };
    }

    return null;
  }

  /**
   * “知道了”：接受候选新词，创建短期学习词学习卡，计入每日新词上限。
   * 已存在学习卡时不重复创建。
   */
  async acceptNewWord(wordId: string): Promise<void> {
    const now = this.deps.clock.now();
    const existing = await this.deps.cards.getByWordId(wordId);
    if (existing) return;

    const card: CardRecord = {
      id: crypto.randomUUID(),
      wordId,
      deckId: this.deps.words.getDefaultDeck().id,
      stage: 'short-term',
      origin: 'accepted-new',
      createdAt: now,
      updatedAt: now,
      nextReviewAt: now + SHORT_TERM_DELAY_MS,
    };
    await this.deps.cards.save(card);
  }

  /**
   * “我认识，换一个”：创建自报认识词，安排一至两天后的验证题。
   * 不占用每日新词上限。已存在学习卡时不重复创建。
   */
  async selfReportKnown(wordId: string): Promise<void> {
    const now = this.deps.clock.now();
    const existing = await this.deps.cards.getByWordId(wordId);
    if (existing) return;

    const delay =
      SELF_REPORTED_MIN_DELAY_MS +
      this.random() * (SELF_REPORTED_MAX_DELAY_MS - SELF_REPORTED_MIN_DELAY_MS);
    const card: CardRecord = {
      id: crypto.randomUUID(),
      wordId,
      deckId: this.deps.words.getDefaultDeck().id,
      stage: 'self-reported-known',
      origin: 'self-reported',
      createdAt: now,
      updatedAt: now,
      nextReviewAt: now + delay,
    };
    await this.deps.cards.save(card);
  }

  /**
   * 提交答案并持久化结果。
   *
   * - 判定正误并写入复习日志；
   * - 更新学习卡：验证题答对 → 长期复习；答错 → 短期学习词（10 分钟后可再测）；
   * - 短期学习词提交后清除 nextReviewAt，避免在 FSRS 引入前反复出题；
   * - 返回带可展开学习信息的判定结果。
   */
  async submitAnswer(submission: AnswerSubmission): Promise<SubmissionResult> {
    const { question } = submission;
    const { cards, logs, clock } = this.deps;
    const now = clock.now();

    const isCorrect = submission.selectedIndex === question.correctIndex;
    const correctAnswer = question.options[question.correctIndex]!;
    const selectedAnswer = question.options[submission.selectedIndex]!;

    const reviewLog: ReviewLogRecord = {
      id: crypto.randomUUID(),
      cardId: question.cardId,
      wordId: question.wordId,
      questionType: question.type,
      selectedAnswer,
      correctAnswer,
      isCorrect,
      responseTimeMs: submission.responseTimeMs,
      reviewedAt: now,
    };
    await logs.save(reviewLog);

    const card = await cards.getById(question.cardId);
    if (card) {
      if (card.stage === 'self-reported-known') {
        // 验证题流转（CONTEXT.md：答对进入长期复习，答错进入普通学习流程）
        card.stage = isCorrect ? 'long-term' : 'short-term';
        card.nextReviewAt = isCorrect ? undefined : now + SHORT_TERM_DELAY_MS;
      } else if (card.stage === 'short-term') {
        // FSRS 调度由后续 Issue 引入；在此之前提交后不再自动出题。
        card.nextReviewAt = undefined;
      }
      card.updatedAt = now;
      await cards.save(card);
    }

    return {
      isCorrect,
      correctIndex: question.correctIndex,
      cardId: question.cardId,
      reviewLogId: reviewLog.id,
      explanation: question.explanation,
    };
  }

  // ─── 内部辅助 ───────────────────────────────────────────────

  /** 查找指定阶段中最早到期的复习卡。 */
  private findDueCard(
    cards: CardRecord[],
    stage: CardRecord['stage'],
    now: number,
  ): CardRecord | undefined {
    return cards
      .filter((c) => c.stage === stage && c.nextReviewAt !== undefined && now >= c.nextReviewAt)
      .sort((a, b) => (a.nextReviewAt! - b.nextReviewAt!))[0];
  }

  /** 为已有学习卡生成题目（英文选中文，四选一）。 */
  private async makeQuestionForCard(card: CardRecord): Promise<MultipleChoiceQuestion | null> {
    const targetWord = this.deps.words.getWord(card.wordId);
    if (!targetWord) return null;
    const allWords = this.deps.words.listWords();
    const distractors = allWords.filter((w) => w.id !== card.wordId);
    if (distractors.length < 3) return null;
    return generateEnToZhQuestion({ targetWord, distractors, cardId: card.id });
  }

  /** 选取尚无学习卡的候选新词（取第一个）。 */
  private pickCandidateNewWord(existingCards: CardRecord[]): WordRecord | null {
    const allWords = this.deps.words.listWords();
    const cardWordIds = new Set(existingCards.map((c) => c.wordId));
    return allWords.find((w) => !cardWordIds.has(w.id)) ?? null;
  }

  /** 统计本地自然日内通过“知道了”接受的新词数量。 */
  private countTodayNewWords(cards: CardRecord[], now: number): number {
    return cards.filter(
      (c) => (c.origin ?? 'accepted-new') === 'accepted-new' && isSameLocalDay(c.createdAt, now),
    ).length;
  }
}

/** 判断两个时间戳是否属于同一个本地自然日。 */
function isSameLocalDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}
