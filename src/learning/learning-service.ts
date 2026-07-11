import type {
  AnswerSubmission,
  CardRecord,
  CorrectionResult,
  DeckRecord,
  LearningItem,
  MultipleChoiceQuestion,
  Question,
  ReviewLogRecord,
  ReviewRating,
  SpellingQuestion,
  SpellingSubmission,
  SubmissionResult,
  UserCorrection,
  WordRecord,
} from '@/types';
import type { CardRepositoryPort } from '@/storage/repositories/card-repository';
import type { ReviewLogRepositoryPort } from '@/storage/repositories/review-log-repository';
import type { ReviewSchedulerPort } from '@/learning/review-scheduler';
import { FsrsReviewScheduler } from '@/learning/review-scheduler';
import {
  chooseQuestionType,
  generateContextChoiceQuestion,
  generateEnToZhQuestion,
  generateSpellingQuestion,
  generateZhToEnQuestion,
} from '@/learning/question-generator';

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

/**
 * 自动评分阈值（Issue #7 验收标准 5）。
 *
 * - 慢速提交阈值（ms）：超过视为费力。
 * - 多次切换阈值：超过视为犹豫。
 */
const SLOW_RESPONSE_MS = 10_000;
const MANY_ANSWER_CHANGES = 2;

export interface LearningServiceDeps {
  cards: CardRepositoryPort;
  logs: ReviewLogRepositoryPort;
  words: WordBankPort;
  clock: Clock;
  /** 复习调度器（Issue #7 验收标准 4）。缺省时使用 FsrsReviewScheduler。 */
  scheduler?: ReviewSchedulerPort;
  /** 每日新词上限，缺省为 5。 */
  dailyNewWordLimit?: number;
  /** 随机函数，用于自报认识词验证题延迟（[1,2) 天），缺省 Math.random。 */
  random?: () => number;
}

/**
 * 学习服务：编排词库、新词展示、题目生成、学习卡与复习日志（Issue #5 / #6 / #7）。
 *
 * 职责：
 * - 按学习优先级返回下一个学习项目（新词展示或题目）；
 * - 候选新词展示不创建学习卡；只有“知道了”创建新词并计入每日上限；
 * - “我认识，换一个”创建自报认识词并安排一至两天后的验证题；
 * - 提交答案后持久化复习日志、更新学习卡，并返回带解释的反馈；
 * - 短期学习词答对后进入长期复习；答错后按短期规则重新安排；
 * - 长期复习词通过隔离的 FSRS 调度接口持久化完整复习历史与下次时间；
 * - 自动评分来自正误、用时、选项切换次数与历史；用户可在反馈阶段纠正评分。
 *
 * 出词优先级（CONTEXT.md / Issue #7 验收标准 1）：
 * 1. 近期答错的到期长期复习词；
 * 2. 其他到期长期复习词；
 * 3. 到期自报认识词验证题；
 * 4. 到期短期学习词；
 * 5. 候选新词（仅在无到期复习且每日上限未满时）。
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

  private get scheduler(): ReviewSchedulerPort {
    return this.deps.scheduler ?? this.defaultScheduler;
  }

  private readonly defaultScheduler: ReviewSchedulerPort = new FsrsReviewScheduler();

  /**
   * 获取下一个学习项目。
   *
   * 出词优先级（Issue #7 验收标准 1）：
   * 1. 近期答错的到期长期复习词；
   * 2. 其他到期长期复习词；
   * 3. 到期自报认识词验证题；
   * 4. 到期短期学习词；
   * 5. 候选新词（受每日上限约束）。
   *
   * 连续学习模式（Issue #8 验收标准 3、5）：
   * - `allowSpelling` 为 true 时，长期复习词有概率出现拼写题；
   * - `excludedWordIds` 中的单词不会被选为候选新词，避免连续模式中重复展示。
   */
  async getNextItem(options?: {
    excludedWordIds?: Set<string>;
    allowSpelling?: boolean;
  }): Promise<LearningItem | null> {
    const now = this.deps.clock.now();
    const allCards = await this.deps.cards.getAll();
    const allowSpelling = options?.allowSpelling ?? false;
    const excludedWordIds = options?.excludedWordIds;

    // 1. 近期答错的到期长期复习词（lastWrongAt 存在且到期）
    const dueWrongLongTerm = this.findDueLongTermWithRecentError(allCards, now);
    if (dueWrongLongTerm) {
      const question = await this.makeQuestionForCard(dueWrongLongTerm, allowSpelling);
      if (question) return this.wrapQuestion(question);
    }

    // 2. 其他到期长期复习词（无近期答错记录）
    const dueLongTerm = this.findDueLongTermWithoutRecentError(allCards, now);
    if (dueLongTerm) {
      const question = await this.makeQuestionForCard(dueLongTerm, allowSpelling);
      if (question) return this.wrapQuestion(question);
    }

    // 3. 到期自报认识词验证题
    const dueVerification = this.findDueCard(allCards, 'self-reported-known', now);
    if (dueVerification) {
      const question = await this.makeQuestionForCard(dueVerification, allowSpelling);
      if (question) return this.wrapQuestion(question);
    }

    // 4. 到期短期学习词
    const dueShortTerm = this.findDueCard(allCards, 'short-term', now);
    if (dueShortTerm) {
      const question = await this.makeQuestionForCard(dueShortTerm, allowSpelling);
      if (question) return this.wrapQuestion(question);
    }

    // 5. 无到期复习：候选新词（受每日上限约束）
    if (this.countTodayNewWords(allCards, now) >= this.dailyLimit) {
      return null;
    }

    const candidate = this.pickCandidateNewWord(allCards, excludedWordIds);
    if (candidate) {
      return { kind: 'new-word-presentation', presentation: { word: candidate } };
    }

    return null;
  }

  /** 将 Question 包装为对应的 LearningItem。 */
  private wrapQuestion(question: Question): LearningItem {
    if (question.type === 'spelling') {
      return { kind: 'spelling-question', question: question as SpellingQuestion };
    }
    return { kind: 'question', question: question as MultipleChoiceQuestion };
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
   * 提交选择题答案并持久化结果（Issue #7 验收标准 3、4、5）。
   *
   * - 判定正误并写入复习日志（含自动评分）；
   * - 短期学习词答对 → 进入长期复习（通过调度器初始化）；答错 → 10 分钟后重测；
   * - 自报认识词验证题答对 → 进入长期复习；答错 → 短期学习词（10 分钟后重测）；
   * - 长期复习词 → 通过调度器更新状态与下次时间；
   * - 返回带可展开学习信息和评分的判定结果。
   */
  async submitAnswer(submission: AnswerSubmission): Promise<SubmissionResult> {
    const { question } = submission;
    const isCorrect = submission.selectedIndex === question.correctIndex;
    const correctAnswer = question.options[question.correctIndex]!;
    const selectedAnswer = question.options[submission.selectedIndex]!;

    return this.processSubmission({
      question,
      isCorrect,
      selectedAnswer,
      correctAnswer,
      responseTimeMs: submission.responseTimeMs,
      answerChanges: submission.answerChanges ?? 0,
      correctIndex: question.correctIndex,
    });
  }

  /**
   * 提交拼写题答案并持久化结果（Issue #8 验收标准 3）。
   *
   * 判定逻辑：忽略大小写和首尾空格后与正确答案比较，
   * 或匹配可接受的其他形式。
   */
  async submitSpellingAnswer(submission: SpellingSubmission): Promise<SubmissionResult> {
    const { question } = submission;
    const normalized = submission.spelledAnswer.trim().toLowerCase();
    const correct = question.correctAnswer.trim().toLowerCase();
    const acceptable = (question.acceptableAnswers ?? []).map((a) => a.trim().toLowerCase());
    const isCorrect = normalized === correct || acceptable.includes(normalized);

    return this.processSubmission({
      question,
      isCorrect,
      selectedAnswer: submission.spelledAnswer,
      correctAnswer: question.correctAnswer,
      responseTimeMs: submission.responseTimeMs,
      answerChanges: submission.answerChanges ?? 0,
    });
  }

  /**
   * 提交判定的通用逻辑：写入复习日志、更新学习卡、调度下次复习。
   * 选择题和拼写题共用此方法（Issue #8）。
   */
  private async processSubmission(input: {
    question: Question;
    isCorrect: boolean;
    selectedAnswer: string;
    correctAnswer: string;
    responseTimeMs: number;
    answerChanges: number;
    correctIndex?: number;
  }): Promise<SubmissionResult> {
    const { question, isCorrect, selectedAnswer, correctAnswer } = input;
    const { cards, logs, clock } = this.deps;
    const now = clock.now();

    // 自动评分（Issue #7 验收标准 5）
    const card = await cards.getById(question.cardId);
    const recentLogs = card ? await logs.getByCardId(card.id) : [];
    const rating = this.autoRate({
      isCorrect,
      responseTimeMs: input.responseTimeMs,
      answerChanges: input.answerChanges,
      recentLogs,
    });

    const reviewLog: ReviewLogRecord = {
      id: crypto.randomUUID(),
      cardId: question.cardId,
      wordId: question.wordId,
      questionType: question.type,
      selectedAnswer,
      correctAnswer,
      isCorrect,
      responseTimeMs: input.responseTimeMs,
      reviewedAt: now,
      rating,
      answerChanges: input.answerChanges,
    };

    let nextReviewAt: number | undefined;

    if (card) {
      // 记录评分前的调度器状态，供用户纠正评分时回滚重放（Issue #7 验收标准 5）
      reviewLog.previousSchedulerState = card.schedulerState;
      if (card.stage === 'self-reported-known') {
        // 验证题流转（CONTEXT.md：答对进入长期复习，答错进入普通学习流程）
        if (isCorrect) {
          const { state, nextReviewAt: due } = this.scheduler.init(rating, now);
          card.stage = 'long-term';
          card.schedulerState = state;
          card.nextReviewAt = due;
          nextReviewAt = due;
        } else {
          card.stage = 'short-term';
          card.nextReviewAt = now + SHORT_TERM_DELAY_MS;
          nextReviewAt = card.nextReviewAt;
        }
      } else if (card.stage === 'short-term') {
        // 短期学习词答对 → 进入长期复习；答错 → 按短期规则重新安排（Issue #7 验收标准 3）
        if (isCorrect) {
          const { state, nextReviewAt: due } = this.scheduler.init(rating, now);
          card.stage = 'long-term';
          card.schedulerState = state;
          card.nextReviewAt = due;
          nextReviewAt = due;
        } else {
          card.nextReviewAt = now + SHORT_TERM_DELAY_MS;
          nextReviewAt = card.nextReviewAt;
        }
      } else if (card.stage === 'long-term') {
        // 长期复习词：通过调度器更新状态与下次时间（Issue #7 验收标准 4）
        const currentState = card.schedulerState;
        if (currentState) {
          const { state, nextReviewAt: due } = this.scheduler.schedule(
            currentState,
            rating,
            now,
          );
          card.schedulerState = state;
          card.nextReviewAt = due;
          nextReviewAt = due;
        }
        if (!isCorrect) {
          // 近期答错：标记以便优先级 1 优先出题（Issue #7 验收标准 1）
          card.lastWrongAt = now;
        } else {
          // 答对后清除"近期答错"标记：以正确答案赎回后不再属于"近期答错"
          card.lastWrongAt = undefined;
        }
      }
      card.updatedAt = now;
      await cards.save(card);
    }
    await logs.save(reviewLog);

    return {
      isCorrect,
      correctIndex: input.correctIndex,
      correctAnswer,
      cardId: question.cardId,
      reviewLogId: reviewLog.id,
      explanation: question.explanation,
      rating,
      nextReviewAt,
    };
  }

  /**
   * 用户在反馈阶段纠正评分（Issue #7 验收标准 5）。
   *
   * - `guessed`（其实是蒙的）：将评分降低至 again（如果是答对的话）；
   * - `too-easy`（这个太简单）：将评分提升至 easy。
   *
   * 纠正会回滚到评分前的调度器状态，再用纠正后的评分重新调度，
   * 避免重复推进调度器状态。并更新复习日志的评分与纠正标记。
   */
  async correctRating(reviewLogId: string, correction: UserCorrection): Promise<CorrectionResult> {
    const { cards, logs, clock } = this.deps;
    const now = clock.now();

    const log = await logs.getById(reviewLogId);
    if (!log) {
      throw new Error(`复习日志不存在：${reviewLogId}`);
    }

    const originalRating = log.rating ?? 'good';
    const correctedRating = this.applyCorrection(originalRating, correction);

    log.rating = correctedRating;
    log.userCorrection = correction;

    const card = await cards.getById(log.cardId);
    let nextReviewAt: number | undefined;

    if (card && card.stage === 'long-term') {
      // 回滚-重放：用评分前的调度器状态 + 纠正后评分重新调度（Issue #7 验收标准 5）
      const previousState = log.previousSchedulerState;
      if (previousState) {
        // 评分前已是长期复习词：从评分前状态重新 schedule
        const { state, nextReviewAt: due } = this.scheduler.schedule(
          previousState,
          correctedRating,
          now,
        );
        card.schedulerState = state;
        card.nextReviewAt = due;
        nextReviewAt = due;
      } else {
        // 评分前尚未进入长期复习（本次评分使其首次进入）：用纠正后评分重新 init
        const { state, nextReviewAt: due } = this.scheduler.init(correctedRating, now);
        card.schedulerState = state;
        card.nextReviewAt = due;
        nextReviewAt = due;
      }
      card.updatedAt = now;
      await cards.save(card);
    }

    await logs.save(log);

    return {
      cardId: log.cardId,
      reviewLogId: log.id,
      rating: correctedRating,
      nextReviewAt,
    };
  }

  // ─── 内部辅助 ───────────────────────────────────────────────

  /**
   * 自动评分（Issue #7 验收标准 5）。
   *
   * 评分规则：
   * - 答错 → again；
   * - 答对 + 答案切换次数 > 2 → hard（犹豫）；
   * - 答对 + 用时 > 10s → hard（费力）；
   * - 答对 + 最近有答错记录 → hard（不稳定）；
   * - 答对 + 快速 + 无切换 + 无近期答错 → good；
   * - 答对 + 用时 < 2s + 无切换 + 无近期答错 + 历史 ≥ 1 → easy。
   */
  private autoRate(input: {
    isCorrect: boolean;
    responseTimeMs: number;
    answerChanges: number;
    recentLogs: ReviewLogRecord[];
  }): ReviewRating {
    if (!input.isCorrect) return 'again';

    const hasRecentWrong = input.recentLogs.some((l) => !l.isCorrect);
    const fast = input.responseTimeMs < 2_000;
    const slow = input.responseTimeMs > SLOW_RESPONSE_MS;
    const manyChanges = input.answerChanges > MANY_ANSWER_CHANGES;
    const hasHistory = input.recentLogs.length > 0;

    if (manyChanges || slow || hasRecentWrong) return 'hard';
    if (fast && !manyChanges && !hasRecentWrong && hasHistory) return 'easy';
    return 'good';
  }

  /** 应用用户纠正（Issue #7 验收标准 5）。 */
  private applyCorrection(rating: ReviewRating, correction: UserCorrection): ReviewRating {
    if (correction === 'guessed') {
      // 蒙对的：降低到 again（重新学习）
      return 'again';
    }
    // too-easy：提升到 easy
    return 'easy';
  }

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

  /**
   * 查找近期答错的到期长期复习词（Issue #7 验收标准 1：第 1 优先级）。
   * "近期答错"指上次答错后尚未以正确答案赎回：答错时设置 lastWrongAt，答对时清除。
   */
  private findDueLongTermWithRecentError(cards: CardRecord[], now: number): CardRecord | undefined {
    return cards
      .filter(
        (c) =>
          c.stage === 'long-term' &&
          c.nextReviewAt !== undefined &&
          now >= c.nextReviewAt &&
          c.lastWrongAt !== undefined,
      )
      .sort((a, b) => (a.nextReviewAt! - b.nextReviewAt!))[0];
  }

  /** 查找无近期答错记录的到期长期复习词（Issue #7 验收标准 1：第 2 优先级）。 */
  private findDueLongTermWithoutRecentError(cards: CardRecord[], now: number): CardRecord | undefined {
    return cards
      .filter(
        (c) =>
          c.stage === 'long-term' &&
          c.nextReviewAt !== undefined &&
          now >= c.nextReviewAt &&
          c.lastWrongAt === undefined,
      )
      .sort((a, b) => (a.nextReviewAt! - b.nextReviewAt!))[0];
  }

  /**
   * 为已有学习卡生成题目（根据阶段选择题型，四选一）。
   *
   * 连续学习模式（Issue #8 验收标准 3）：`allowSpelling` 为 true 时，
   * 长期复习词（reps >= 2）有 50% 概率出现拼写题替代语境选择题。
   */
  private async makeQuestionForCard(
    card: CardRecord,
    allowSpelling: boolean = false,
  ): Promise<Question | null> {
    const targetWord = this.deps.words.getWord(card.wordId);
    if (!targetWord) return null;
    const allWords = this.deps.words.listWords();
    const distractors = allWords.filter((w) => w.id !== card.wordId);
    if (distractors.length < 3) return null;

    let questionType = chooseQuestionType(card.stage, card.schedulerState?.reps);

    // 连续学习模式：长期复习词有概率出现拼写题（Issue #8 验收标准 3）
    if (allowSpelling && questionType === 'context-choice' && this.random() < 0.5) {
      questionType = 'spelling';
    }

    const baseInput = {
      targetWord,
      distractors,
      cardId: card.id,
      random: this.random,
    };

    switch (questionType) {
      case 'en-to-zh':
        return generateEnToZhQuestion(baseInput);
      case 'zh-to-en':
        return generateZhToEnQuestion(baseInput);
      case 'context-choice':
        return generateContextChoiceQuestion(baseInput);
      case 'spelling':
        return generateSpellingQuestion(baseInput);
    }
  }

  /**
   * 选取尚无学习卡的候选新词（取第一个）。
   * 连续学习模式排除已展示过的单词（Issue #8 验收标准 5）。
   */
  private pickCandidateNewWord(
    existingCards: CardRecord[],
    excludedWordIds?: Set<string>,
  ): WordRecord | null {
    const allWords = this.deps.words.listWords();
    const cardWordIds = new Set(existingCards.map((c) => c.wordId));
    return (
      allWords.find(
        (w) => !cardWordIds.has(w.id) && !(excludedWordIds?.has(w.id) ?? false),
      ) ?? null
    );
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
