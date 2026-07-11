import type { ReviewRating, SchedulerState } from '@/types';
import { fsrs, generatorParameters, createEmptyCard, Rating, type Card, type Grade } from 'ts-fsrs';

/**
 * 复习调度器端口（Issue #7 验收标准 4）。
 *
 * 规格要求（Issue #1 Implementation Decisions）：
 * - 在该接口后封装 FSRS；其他学习代码不得依赖 ts-fsrs 字段；
 * - Beta 使用默认 FSRS 参数；
 * - 持久化完整复习历史与下次复习时间。
 *
 * 该端口只暴露领域语义（评分、状态、下次时间），
 * 不泄露 ts-fsrs 的 Card / ReviewLog / Rating 枚举。
 */
export interface ReviewSchedulerPort {
  /**
   * 为新进入长期复习的卡初始化调度状态。
   * 用首次评分计算 stability / difficulty / nextReviewAt。
   */
  init(rating: ReviewRating, now: number): { state: SchedulerState; nextReviewAt: number };

  /**
   * 根据当前状态与评分计算下一次复习。
   * 返回更新后的状态与下次复习时间戳（ms）。
   */
  schedule(
    state: SchedulerState,
    rating: ReviewRating,
    now: number,
  ): { state: SchedulerState; nextReviewAt: number };
}

/** ReviewRating（领域）→ ts-fsrs Grade（排除 Manual）。 */
function toFsrsGrade(rating: ReviewRating): Grade {
  switch (rating) {
    case 'again':
      return Rating.Again;
    case 'hard':
      return Rating.Hard;
    case 'good':
      return Rating.Good;
    case 'easy':
      return Rating.Easy;
  }
}

/** ts-fsrs Card → 领域 SchedulerState。 */
function toSchedulerState(card: Card): SchedulerState {
  return {
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    lastReviewAt: card.last_review ? card.last_review.getTime() : undefined,
  };
}

/** 领域 SchedulerState → ts-fsrs CardInput。 */
function toFsrsCard(state: SchedulerState, now: number): Card {
  return {
    due: new Date(now),
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: 0,
    scheduled_days: state.scheduledDays,
    learning_steps: state.learningSteps,
    reps: state.reps,
    lapses: state.lapses,
    state: state.state,
    last_review: state.lastReviewAt ? new Date(state.lastReviewAt) : undefined,
  };
}

/**
 * 基于 ts-fsrs 的复习调度器实现（Issue #7 验收标准 4）。
 *
 * - 使用默认 FSRS 参数（generatorParameters()）；
 * - 关闭短期间隔（enable_short_term=false），短期学习由学习服务自行管理，
 *   FSRS 仅负责长期复习调度；
 * - 关闭模糊（enable_fuzz=false）以保证测试可重复。
 */
export class FsrsReviewScheduler implements ReviewSchedulerPort {
  private readonly f: ReturnType<typeof fsrs>;

  constructor() {
    const params = generatorParameters({ enable_fuzz: false, enable_short_term: false });
    this.f = fsrs(params);
  }

  init(rating: ReviewRating, now: number): { state: SchedulerState; nextReviewAt: number } {
    const emptyCard = createEmptyCard(new Date(now));
    const grade = toFsrsGrade(rating);
    const { card } = this.f.next(emptyCard, new Date(now), grade);
    return {
      state: toSchedulerState(card),
      nextReviewAt: card.due.getTime(),
    };
  }

  schedule(
    state: SchedulerState,
    rating: ReviewRating,
    now: number,
  ): { state: SchedulerState; nextReviewAt: number } {
    const inputCard = toFsrsCard(state, now);
    const grade = toFsrsGrade(rating);
    const { card } = this.f.next(inputCard, new Date(now), grade);
    return {
      state: toSchedulerState(card),
      nextReviewAt: card.due.getTime(),
    };
  }
}
