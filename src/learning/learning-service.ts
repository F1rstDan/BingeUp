import type {
  AnswerSubmission,
  CardRecord,
  DeckRecord,
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

export interface LearningServiceDeps {
  cards: CardRepositoryPort;
  logs: ReviewLogRepositoryPort;
  words: WordBankPort;
  clock: Clock;
}

/**
 * 学习服务：编排词库、题目生成、学习卡与复习日志的持久化（Issue #5）。
 *
 * 职责：
 * - 从本地词库出题（英文选中文，四选一，唯一正确答案）；
 * - 为每个新单词创建学习卡（stage = short-term）；
 * - 提交答案后持久化复习日志并更新学习卡；
 * - 同一单词不重复创建学习卡。
 */
export class LearningService {
  readonly deps: LearningServiceDeps;

  constructor(deps: LearningServiceDeps) {
    this.deps = deps;
  }

  /**
   * 生成下一题。
   *
   * 出词优先级：
   * 1. 优先选择尚无学习卡的单词；
   * 2. 所有单词都有卡时，从已有卡对应的单词中选取。
   *
   * 若卡不存在则创建（stage = short-term），然后生成题目。
   * 词库为空或干扰项不足时返回 null。
   */
  async getNextQuestion(): Promise<MultipleChoiceQuestion | null> {
    const { cards, words, clock } = this.deps;
    const allWords = words.listWords();
    if (allWords.length === 0) return null;

    const existingCards = await cards.getAll();
    const wordIdToCard = new Map<string, CardRecord>();
    for (const card of existingCards) {
      wordIdToCard.set(card.wordId, card);
    }

    // 优先选没有卡的单词
    const candidatesWithoutCard = allWords.filter((w) => !wordIdToCard.has(w.id));
    const pool = candidatesWithoutCard.length > 0 ? candidatesWithoutCard : allWords;
    const targetWord = pool[0]!;

    // 获取或创建学习卡
    let card = wordIdToCard.get(targetWord.id);
    if (!card) {
      const now = clock.now();
      card = {
        id: crypto.randomUUID(),
        wordId: targetWord.id,
        deckId: this.deps.words.getDefaultDeck().id,
        stage: 'short-term',
        createdAt: now,
        updatedAt: now,
      };
      await cards.save(card);
    }

    // 选取干扰词：与目标不同的其他单词
    const distractors = allWords.filter((w) => w.id !== targetWord.id);
    if (distractors.length < 3) return null;

    return generateEnToZhQuestion({
      targetWord,
      distractors,
      cardId: card.id,
    });
  }

  /**
   * 提交答案并持久化结果。
   *
   * - 判定正误；
   * - 写入复习日志（含完整判定信息）；
   * - 更新学习卡的 updatedAt；
   * - 返回判定结果。
   */
  async submitAnswer(submission: AnswerSubmission): Promise<SubmissionResult> {
    const { question } = submission;
    const { cards, logs, clock } = this.deps;

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
      reviewedAt: clock.now(),
    };
    await logs.save(reviewLog);

    // 更新学习卡 updatedAt
    const card = await cards.getById(question.cardId);
    if (card) {
      card.updatedAt = clock.now();
      await cards.save(card);
    }

    return {
      isCorrect,
      correctIndex: question.correctIndex,
      cardId: question.cardId,
      reviewLogId: reviewLog.id,
    };
  }
}
