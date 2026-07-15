import type {
  CardRecord,
  CardStatusStats,
  BehaviorEventRecord,
  LearningStats,
  ReviewLogRecord,
  SessionLogRecord,
  TodayStats,
  WeekComparison,
  ReviewPerformance,
} from '@/types';

/**
 * 本地学习统计服务（Issue #12）。
 *
 * 统计完全派生自源数据（复习日志 + 学习卡 + 会话日志），不存储聚合结果。
 * 因此评分纠正（修改复习日志而非新增）、日期切换、清除数据和导入数据
 * 都不会造成重复或过期统计（AC3），且统计可由复习日志和学习卡状态交叉验证（AC5）。
 *
 * 时钟端口用于确定"今日"和"本周"的本地自然日边界。
 */
export interface StatsClock {
  now(): number;
}

export interface StatsServiceDeps {
  clock: StatsClock;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PAUSE_GRACE_MS = 5 * 60 * 1000;

/**
 * 计算本地自然日的起始时间戳（00:00:00.000）。
 * 以浏览器本地时区为准（CONTEXT.md：本地自然日）。
 */
export function startOfLocalDay(timestamp: number): number {
  const d = new Date(timestamp);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function shiftLocalDay(dayStart: number, days: number): number {
  const date = new Date(dayStart);
  date.setDate(date.getDate() + days);
  return startOfLocalDay(date.getTime());
}

/**
 * 计算本地自然周的起始时间戳（周一 00:00:00.000）。
 * 以周一为一周的开始（ISO 8601）。
 */
export function startOfLocalWeek(timestamp: number): number {
  const d = new Date(timestamp);
  const dayOfWeek = d.getDay(); // 0=Sunday, 1=Monday, ...
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // 距周一的天数
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 判断两个时间戳是否属于同一个本地自然日。 */
function isSameLocalDay(a: number, b: number): boolean {
  return startOfLocalDay(a) === startOfLocalDay(b);
}

export { isSameLocalDay };

/** "本地周"维度：以周一为起点。 */
export class StatsService {
  readonly deps: StatsServiceDeps;

  constructor(deps: StatsServiceDeps) {
    this.deps = deps;
  }

  /**
   * 从源数据计算学习统计汇总（AC1 / AC2）。
   *
   * @param cards 所有学习卡
   * @param logs 所有复习日志
   * @param sessions 所有会话日志
   */
  computeStats(
    cards: CardRecord[],
    logs: ReviewLogRecord[],
    sessions: SessionLogRecord[],
    behaviorEvents: BehaviorEventRecord[] = [],
    siteStates: Record<string, boolean> = {},
  ): LearningStats {
    const now = this.deps.clock.now();
    const todayStart = startOfLocalDay(now);
    const thisWeekStart = startOfLocalWeek(now);
    const lastWeekStart = thisWeekStart - 7 * MS_PER_DAY;

    const longTermLogs = logs.filter((log) => log.stageAtSubmission === 'long-term');
    const sevenDaysStart = shiftLocalDay(startOfLocalDay(now), -6);
    const longTermAllTime = this.computeReviewPerformance(longTermLogs);

    return {
      today: this.computeTodayStats(cards, logs, sessions, behaviorEvents, todayStart, now),
      weekLearningDays: this.computeWeekLearningDays(logs, sessions, thisWeekStart, now),
      cardStatus: this.computeCardStatus(cards),
      dueReviewCount: this.computeDueReviewCount(cards, now),
      delayedReviewAccuracy: longTermAllTime.accuracy,
      longTermReview: {
        today: this.computeReviewPerformance(
          longTermLogs.filter((log) => log.reviewedAt >= todayStart),
        ),
        last7Days: this.computeReviewPerformance(
          longTermLogs.filter((log) => log.reviewedAt >= sevenDaysStart),
        ),
        allTime: longTermAllTime,
      },
      last7Days: this.computeLast7Days(logs, sessions, behaviorEvents, now),
      defaultSites: ['bilibili.com', 'youtube.com'].map((hostname) =>
        this.computeSiteMetric(hostname, behaviorEvents, siteStates[hostname] ?? false, now),
      ),
      weekComparison: this.computeWeekComparison(logs, thisWeekStart, lastWeekStart, now),
    };
  }

  /** 今日统计（AC1）。 */
  private computeTodayStats(
    cards: CardRecord[],
    logs: ReviewLogRecord[],
    sessions: SessionLogRecord[],
    behaviorEvents: BehaviorEventRecord[],
    todayStart: number,
    now: number,
  ): TodayStats {
    const todayLogs = logs.filter((l) => l.reviewedAt >= todayStart);
    const todaySessions = sessions.filter((s) => s.startedAt >= todayStart);

    // 复习词数：今日有复习日志、且学习卡在今日之前创建的不同单词数
    const cardCreatedAtByWordId = new Map<string, number>();
    for (const card of cards) {
      cardCreatedAtByWordId.set(card.wordId, card.createdAt);
    }
    const reviewedWordIds = new Set<string>();
    for (const log of todayLogs) {
      const createdAt = cardCreatedAtByWordId.get(log.wordId);
      // 学习卡在今日之前创建 → 复习词；今日创建 → 新词（不计入复习词）
      if (createdAt !== undefined && createdAt < todayStart) {
        reviewedWordIds.add(log.wordId);
      }
    }

    // 新词数：今日通过"知道了"接受的学习卡数
    const newWords = cards.filter(
      (c) => (c.origin ?? 'accepted-new') === 'accepted-new' && c.createdAt >= todayStart,
    ).length;

    const sessionMetrics = this.computeSessionMetrics(todaySessions);

    return {
      completedQuestions: todayLogs.length,
      correctAnswers: todayLogs.filter((l) => l.isCorrect).length,
      skipped: todaySessions.filter((s) => s.outcome === 'skipped').length,
      reviewedWords: reviewedWordIds.size,
      newWords,
      continuousSessions: sessionMetrics.continuousSessions,
      continuousQuestions: sessionMetrics.continuousQuestions,
      naturalCompletedQuestions: todayLogs.filter((log) => log.source === 'natural').length,
      naturalSkipRate: sessionMetrics.naturalSkipRate,
      activePauseCount: this.computeActivePauseCount(behaviorEvents, todayStart, now),
    };
  }

  private computeSessionMetrics(sessions: SessionLogRecord[]): {
    naturalSkipRate: number | null;
    continuousSessions: number;
    continuousQuestions: number;
  } {
    const naturalSessions = sessions.filter(
      (session) => session.source === 'natural' && session.initialOutcome !== undefined,
    );
    const naturalSkipped = naturalSessions.filter(
      (session) => session.initialOutcome === 'skipped',
    ).length;
    const continuousSessions = sessions.filter((session) => session.mode === 'continuous');
    return {
      naturalSkipRate:
        naturalSessions.length === 0 ? null : naturalSkipped / naturalSessions.length,
      continuousSessions: continuousSessions.length,
      continuousQuestions: continuousSessions.reduce(
        (sum, session) => sum + (session.continuousQuestionsAnswered ?? session.questionsAnswered),
        0,
      ),
    };
  }

  private computeReviewPerformance(logs: ReviewLogRecord[]): ReviewPerformance {
    const correct = logs.filter((log) => log.isCorrect).length;
    return {
      completed: logs.length,
      correct,
      accuracy: logs.length === 0 ? 0 : correct / logs.length,
    };
  }

  private computeActivePauseCount(
    events: BehaviorEventRecord[],
    rangeStart: number,
    now: number,
  ): number {
    const pauseEvents = events
      .filter((event) => event.kind === 'global-pause')
      .sort((a, b) => a.occurredAt - b.occurredAt);
    let count = 0;
    for (let index = 0; index < pauseEvents.length; index += 1) {
      const event = pauseEvents[index]!;
      if (event.action !== 'started' || event.occurredAt < rangeStart || event.occurredAt > now)
        continue;
      const resume = pauseEvents
        .slice(index + 1)
        .find((candidate) => candidate.action === 'resumed' || candidate.action === 'started');
      const endedAt = Math.min(event.pausedUntil, resume?.occurredAt ?? now);
      if (endedAt - event.occurredAt >= PAUSE_GRACE_MS) count += 1;
    }
    return count;
  }

  private computeLast7Days(
    logs: ReviewLogRecord[],
    sessions: SessionLogRecord[],
    events: BehaviorEventRecord[],
    now: number,
  ): LearningStats['last7Days'] {
    const today = startOfLocalDay(now);
    return Array.from({ length: 7 }, (_, index) => shiftLocalDay(today, index - 6)).map(
      (dayStart) => {
        const dayEnd = shiftLocalDay(dayStart, 1);
        const dayLogs = logs.filter((log) => log.reviewedAt >= dayStart && log.reviewedAt < dayEnd);
        const daySessions = sessions.filter(
          (session) => session.startedAt >= dayStart && session.startedAt < dayEnd,
        );
        const sessionMetrics = this.computeSessionMetrics(daySessions);
        return {
          dayStart,
          naturalCompletedQuestions: dayLogs.filter((log) => log.source === 'natural').length,
          naturalSkipRate: sessionMetrics.naturalSkipRate,
          activePauseCount: this.computeActivePauseCount(events, dayStart, Math.min(dayEnd, now)),
          continuousSessions: sessionMetrics.continuousSessions,
          continuousQuestions: sessionMetrics.continuousQuestions,
          longTermReview: this.computeReviewPerformance(
            dayLogs.filter((log) => log.stageAtSubmission === 'long-term'),
          ),
        };
      },
    );
  }

  private computeSiteMetric(
    hostname: string,
    events: BehaviorEventRecord[],
    currentEnabled: boolean,
    now: number,
  ): LearningStats['defaultSites'][number] {
    const siteEvents = events
      .filter(
        (event): event is Extract<BehaviorEventRecord, { kind: 'site-enabled' }> =>
          event.kind === 'site-enabled' && event.hostname === hostname,
      )
      .sort((a, b) => a.occurredAt - b.occurredAt);
    let streakStart = siteEvents.find((event) => event.enabled)?.occurredAt ?? now;
    let pendingDisable: number | null = null;
    for (const event of siteEvents) {
      if (!event.enabled) {
        pendingDisable = event.occurredAt;
      } else if (pendingDisable !== null) {
        if (event.occurredAt - pendingDisable > PAUSE_GRACE_MS) streakStart = event.occurredAt;
        pendingDisable = null;
      } else if (streakStart === now) {
        streakStart = event.occurredAt;
      }
    }
    const effectivelyInterrupted =
      pendingDisable !== null && now - pendingDisable > PAUSE_GRACE_MS && !currentEnabled;
    return {
      hostname,
      currentEnabled,
      continuousEnabledDays: effectivelyInterrupted
        ? 0
        : Math.max(0, Math.floor((now - streakStart) / MS_PER_DAY)),
    };
  }

  /**
   * 本周学习天数（AC2）。
   * 本周内有复习日志或会话日志的不同本地自然日数。
   */
  private computeWeekLearningDays(
    logs: ReviewLogRecord[],
    sessions: SessionLogRecord[],
    thisWeekStart: number,
    now: number,
  ): number {
    const days = new Set<number>();
    for (const log of logs) {
      if (log.reviewedAt >= thisWeekStart && log.reviewedAt <= now) {
        days.add(startOfLocalDay(log.reviewedAt));
      }
    }
    for (const session of sessions) {
      if (session.startedAt >= thisWeekStart && session.startedAt <= now) {
        days.add(startOfLocalDay(session.startedAt));
      }
    }
    return days.size;
  }

  /** 学习卡状态分布（AC2）。 */
  private computeCardStatus(cards: CardRecord[]): CardStatusStats {
    return {
      shortTerm: cards.filter((c) => c.stage === 'short-term').length,
      longTerm: cards.filter((c) => c.stage === 'long-term').length,
      selfReported: cards.filter((c) => c.stage === 'self-reported-known').length,
    };
  }

  /** 待复习词数（AC2）：nextReviewAt <= now 的学习卡数。 */
  private computeDueReviewCount(cards: CardRecord[], now: number): number {
    return cards.filter((c) => c.nextReviewAt !== undefined && c.nextReviewAt <= now).length;
  }

  /**
   * 延迟复习正确率（AC2）。
   * 只统计长期复习词的复习日志正确率（isCorrect=true 的比例）。
   * 通过 cardId 关联学习卡阶段来过滤（AC5：可由复习日志和学习卡状态交叉验证）。
   * 无长期复习日志时返回 0。
   */
  private computeDelayedReviewAccuracy(
    logs: ReviewLogRecord[],
    longTermCardIds: Set<string>,
  ): number {
    const longTermLogs = logs.filter((l) => longTermCardIds.has(l.cardId));
    if (longTermLogs.length === 0) return 0;
    const correct = longTermLogs.filter((l) => l.isCorrect).length;
    return correct / longTermLogs.length;
  }

  /** 周对比（AC2）：本周与上周的完成题数和正确率。 */
  private computeWeekComparison(
    logs: ReviewLogRecord[],
    thisWeekStart: number,
    lastWeekStart: number,
    now: number,
  ): WeekComparison {
    const thisWeekLogs = logs.filter((l) => l.reviewedAt >= thisWeekStart && l.reviewedAt <= now);
    const lastWeekLogs = logs.filter(
      (l) => l.reviewedAt >= lastWeekStart && l.reviewedAt < thisWeekStart,
    );

    const thisWeekCompleted = thisWeekLogs.length;
    const lastWeekCompleted = lastWeekLogs.length;
    const thisWeekAccuracy =
      thisWeekLogs.length > 0
        ? thisWeekLogs.filter((l) => l.isCorrect).length / thisWeekLogs.length
        : 0;
    const lastWeekAccuracy =
      lastWeekLogs.length > 0
        ? lastWeekLogs.filter((l) => l.isCorrect).length / lastWeekLogs.length
        : 0;

    return {
      thisWeekCompleted,
      lastWeekCompleted,
      thisWeekAccuracy,
      lastWeekAccuracy,
    };
  }
}
