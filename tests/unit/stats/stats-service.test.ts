import { describe, expect, it } from 'vitest';
import {
  StatsService,
  startOfLocalDay,
  startOfLocalWeek,
  isSameLocalDay,
} from '@/stats/stats-service';
import type { CardRecord, ReviewLogRecord, SessionLogRecord } from '@/types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// 固定"现在"为 2026-07-11 10:00:00 本地时间（周六）
const NOW = new Date(2026, 6, 11, 10, 0, 0).getTime();

function makeCard(overrides: Partial<CardRecord> = {}): CardRecord {
  return {
    id: 'card-1',
    wordId: 'w-1',
    deckId: 'deck-test',
    stage: 'short-term',
    origin: 'accepted-new',
    createdAt: NOW - 5 * MS_PER_DAY,
    updatedAt: NOW - 5 * MS_PER_DAY,
    ...overrides,
  };
}

function makeLog(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    id: 'log-1',
    cardId: 'card-1',
    wordId: 'w-1',
    questionType: 'en-to-zh',
    selectedAnswer: '放弃',
    correctAnswer: '放弃',
    isCorrect: true,
    responseTimeMs: 2000,
    reviewedAt: NOW,
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionLogRecord> = {}): SessionLogRecord {
  return {
    id: 'session-1',
    startedAt: NOW,
    endedAt: NOW + 5000,
    mode: 'single',
    outcome: 'submitted',
    questionsAnswered: 1,
    ...overrides,
  };
}

function makeService(now: number = NOW): StatsService {
  return new StatsService({ clock: { now: () => now } });
}

// ─── 日期辅助函数 ─────────────────────────────────────────────

describe('startOfLocalDay — 本地自然日起始', () => {
  it('返回当天 00:00:00.000', () => {
    const noon = new Date(2026, 6, 11, 12, 30, 0).getTime();
    const start = startOfLocalDay(noon);
    const expected = new Date(2026, 6, 11, 0, 0, 0).getTime();
    expect(start).toBe(expected);
  });
});

describe('startOfLocalWeek — 本地自然周起始（周一）', () => {
  it('周六返回本周一', () => {
    // 2026-07-11 是周六
    const saturday = new Date(2026, 6, 11, 10, 0, 0).getTime();
    const start = startOfLocalWeek(saturday);
    const expected = new Date(2026, 6, 6, 0, 0, 0).getTime(); // 2026-07-06 周一
    expect(start).toBe(expected);
  });

  it('周日返回上周一', () => {
    // 2026-07-12 是周日
    const sunday = new Date(2026, 6, 12, 10, 0, 0).getTime();
    const start = startOfLocalWeek(sunday);
    const expected = new Date(2026, 6, 6, 0, 0, 0).getTime(); // 2026-07-06 周一
    expect(start).toBe(expected);
  });

  it('周一返回当天', () => {
    // 2026-07-06 是周一
    const monday = new Date(2026, 6, 6, 15, 0, 0).getTime();
    const start = startOfLocalWeek(monday);
    const expected = new Date(2026, 6, 6, 0, 0, 0).getTime();
    expect(start).toBe(expected);
  });
});

describe('isSameLocalDay — 同日本地日判定', () => {
  it('同一天不同时刻返回 true', () => {
    const morning = new Date(2026, 6, 11, 6, 0, 0).getTime();
    const evening = new Date(2026, 6, 11, 23, 0, 0).getTime();
    expect(isSameLocalDay(morning, evening)).toBe(true);
  });

  it('跨天返回 false', () => {
    const day1 = new Date(2026, 6, 11, 23, 59, 0).getTime();
    const day2 = new Date(2026, 6, 12, 0, 1, 0).getTime();
    expect(isSameLocalDay(day1, day2)).toBe(false);
  });
});

// ─── AC1：今日统计 ─────────────────────────────────────────────

describe('StatsService — 今日统计（Issue #12 AC1）', () => {
  it('空数据返回全零今日统计', () => {
    const service = makeService();
    const stats = service.computeStats([], [], []);

    expect(stats.today).toEqual({
      completedQuestions: 0,
      correctAnswers: 0,
      skipped: 0,
      reviewedWords: 0,
      newWords: 0,
      continuousSessions: 0,
      continuousQuestions: 0,
    });
  });

  it('完成题目数 = 今日复习日志数', () => {
    const service = makeService();
    const logs = [
      makeLog({ id: 'l1', reviewedAt: NOW }),
      makeLog({ id: 'l2', reviewedAt: NOW - 100 }),
      makeLog({ id: 'l3', reviewedAt: NOW - 200 }),
    ];
    const stats = service.computeStats([], logs, []);
    expect(stats.today.completedQuestions).toBe(3);
  });

  it('正确题数 = 今日复习日志中 isCorrect=true 的数量', () => {
    const service = makeService();
    const logs = [
      makeLog({ id: 'l1', isCorrect: true, reviewedAt: NOW }),
      makeLog({ id: 'l2', isCorrect: false, reviewedAt: NOW - 100 }),
      makeLog({ id: 'l3', isCorrect: true, reviewedAt: NOW - 200 }),
    ];
    const stats = service.computeStats([], logs, []);
    expect(stats.today.correctAnswers).toBe(2);
  });

  it('跳过数 = 今日会话日志中 outcome=skipped 的数量', () => {
    const service = makeService();
    const sessions = [
      makeSession({ id: 's1', outcome: 'skipped', startedAt: NOW }),
      makeSession({ id: 's2', outcome: 'submitted', startedAt: NOW - 100 }),
      makeSession({ id: 's3', outcome: 'skipped', startedAt: NOW - 200 }),
    ];
    const stats = service.computeStats([], [], sessions);
    expect(stats.today.skipped).toBe(2);
  });

  it('复习词数 = 今日有复习日志且学习卡在今日之前创建的不同单词数', () => {
    const service = makeService();
    const todayStart = startOfLocalDay(NOW);
    const cards = [
      // 在今日之前创建 → 复习词
      makeCard({ id: 'c1', wordId: 'w-old', createdAt: NOW - 5 * MS_PER_DAY }),
      makeCard({ id: 'c2', wordId: 'w-old2', createdAt: NOW - 3 * MS_PER_DAY }),
      // 今日创建 → 新词，不计入复习词
      makeCard({ id: 'c3', wordId: 'w-new', createdAt: todayStart + 3600_000 }),
    ];
    const logs = [
      makeLog({ id: 'l1', cardId: 'c1', wordId: 'w-old', reviewedAt: NOW }),
      makeLog({ id: 'l2', cardId: 'c2', wordId: 'w-old2', reviewedAt: NOW - 100 }),
      makeLog({ id: 'l3', cardId: 'c3', wordId: 'w-new', reviewedAt: NOW - 200 }),
    ];
    const stats = service.computeStats(cards, logs, []);
    expect(stats.today.reviewedWords).toBe(2);
  });

  it('同一单词多次复习只计一次复习词', () => {
    const service = makeService();
    const cards = [makeCard({ id: 'c1', wordId: 'w-same', createdAt: NOW - 5 * MS_PER_DAY })];
    const logs = [
      makeLog({ id: 'l1', cardId: 'c1', wordId: 'w-same', reviewedAt: NOW }),
      makeLog({ id: 'l2', cardId: 'c1', wordId: 'w-same', reviewedAt: NOW - 100 }),
    ];
    const stats = service.computeStats(cards, logs, []);
    expect(stats.today.reviewedWords).toBe(1);
  });

  it('新词数 = 今日通过"知道了"接受的学习卡数', () => {
    const service = makeService();
    const todayStart = startOfLocalDay(NOW);
    const cards = [
      // 今日接受的新词
      makeCard({ id: 'c1', origin: 'accepted-new', createdAt: todayStart + 3600_000 }),
      makeCard({ id: 'c2', origin: 'accepted-new', createdAt: todayStart + 7200_000 }),
      // 今日自报认识词（不计入新词）
      makeCard({ id: 'c3', origin: 'self-reported', createdAt: todayStart + 10800_000 }),
      // 昨日接受的新词（不计入今日）
      makeCard({ id: 'c4', origin: 'accepted-new', createdAt: todayStart - MS_PER_DAY }),
    ];
    const stats = service.computeStats(cards, [], []);
    expect(stats.today.newWords).toBe(2);
  });

  it('连续学习会话数 = 今日 mode=continuous 的会话数', () => {
    const service = makeService();
    const sessions = [
      makeSession({ id: 's1', mode: 'continuous', startedAt: NOW }),
      makeSession({ id: 's2', mode: 'single', startedAt: NOW - 100 }),
      makeSession({ id: 's3', mode: 'continuous', startedAt: NOW - 200 }),
    ];
    const stats = service.computeStats([], [], sessions);
    expect(stats.today.continuousSessions).toBe(2);
  });

  it('连续题数 = 今日连续学习会话中提交的题目总数', () => {
    const service = makeService();
    const sessions = [
      makeSession({ id: 's1', mode: 'continuous', questionsAnswered: 3, startedAt: NOW }),
      makeSession({ id: 's2', mode: 'single', questionsAnswered: 1, startedAt: NOW - 100 }),
      makeSession({ id: 's3', mode: 'continuous', questionsAnswered: 2, startedAt: NOW - 200 }),
    ];
    const stats = service.computeStats([], [], sessions);
    expect(stats.today.continuousQuestions).toBe(5); // 3 + 2
  });

  it('昨日的数据不计入今日统计', () => {
    const service = makeService();
    const todayStart = startOfLocalDay(NOW);
    const yesterday = todayStart - 1;
    const logs = [
      makeLog({ id: 'l-today', reviewedAt: NOW }),
      makeLog({ id: 'l-yesterday', reviewedAt: yesterday }),
    ];
    const sessions = [
      makeSession({ id: 's-today', startedAt: NOW }),
      makeSession({ id: 's-yesterday', startedAt: yesterday }),
    ];
    const stats = service.computeStats([], logs, sessions);
    expect(stats.today.completedQuestions).toBe(1);
    expect(stats.today.skipped).toBe(0); // s-today outcome=submitted
    expect(stats.today.continuousSessions).toBe(0);
  });
});

// ─── AC2：统计页显示指标 ───────────────────────────────────────

describe('StatsService — 统计页指标（Issue #12 AC2）', () => {
  it('本周学习天数 = 本周内有复习日志或会话日志的不同自然日数', () => {
    const service = makeService();
    const thisWeekStart = startOfLocalWeek(NOW);
    // 本周内三天有活动
    const day1 = thisWeekStart + 2 * MS_PER_DAY; // 周三
    const day2 = thisWeekStart + 4 * MS_PER_DAY; // 周五
    const day3 = thisWeekStart + 5 * MS_PER_DAY; // 周六（今天）
    const logs = [
      makeLog({ id: 'l1', reviewedAt: day1 }),
      makeLog({ id: 'l2', reviewedAt: day2 }),
      makeLog({ id: 'l3', reviewedAt: day3 }),
    ];
    const sessions = [
      makeSession({ id: 's1', startedAt: day1 }),
      makeSession({ id: 's2', startedAt: day3 }),
    ];
    const stats = service.computeStats([], logs, sessions);
    expect(stats.weekLearningDays).toBe(3);
  });

  it('上周的活动不计入本周学习天数', () => {
    const service = makeService();
    const thisWeekStart = startOfLocalWeek(NOW);
    const lastWeek = thisWeekStart - 3 * MS_PER_DAY;
    const logs = [
      makeLog({ id: 'l-last', reviewedAt: lastWeek }),
      makeLog({ id: 'l-this', reviewedAt: thisWeekStart + MS_PER_DAY }),
    ];
    const stats = service.computeStats([], logs, []);
    expect(stats.weekLearningDays).toBe(1);
  });

  it('学习卡状态分布按 stage 统计', () => {
    const service = makeService();
    const cards = [
      makeCard({ id: 'c1', stage: 'short-term' }),
      makeCard({ id: 'c2', stage: 'short-term' }),
      makeCard({ id: 'c3', stage: 'long-term' }),
      makeCard({ id: 'c4', stage: 'self-reported-known' }),
      makeCard({ id: 'c5', stage: 'long-term' }),
    ];
    const stats = service.computeStats(cards, [], []);
    expect(stats.cardStatus).toEqual({
      shortTerm: 2,
      longTerm: 2,
      selfReported: 1,
    });
  });

  it('待复习词数 = nextReviewAt <= now 的学习卡数', () => {
    const service = makeService();
    const cards = [
      makeCard({ id: 'c1', nextReviewAt: NOW - 1000 }), // 到期
      makeCard({ id: 'c2', nextReviewAt: NOW + 5000 }), // 未到期
      makeCard({ id: 'c3', nextReviewAt: NOW }), // 恰好到期
      makeCard({ id: 'c4' }), // 无 nextReviewAt
      makeCard({ id: 'c5', nextReviewAt: NOW - 5000 }), // 到期
    ];
    const stats = service.computeStats(cards, [], []);
    expect(stats.dueReviewCount).toBe(3); // c1, c3, c5
  });

  it('延迟复习正确率 = 长期复习词的复习日志正确率', () => {
    const service = makeService();
    const cards = [
      makeCard({ id: 'c-lt1', stage: 'long-term' }),
      makeCard({ id: 'c-lt2', stage: 'long-term' }),
      makeCard({ id: 'c-st', stage: 'short-term' }),
    ];
    const logs = [
      // 长期复习词：3 对 1 错 → 0.75
      makeLog({ id: 'l1', cardId: 'c-lt1', isCorrect: true }),
      makeLog({ id: 'l2', cardId: 'c-lt1', isCorrect: true }),
      makeLog({ id: 'l3', cardId: 'c-lt2', isCorrect: true }),
      makeLog({ id: 'l4', cardId: 'c-lt2', isCorrect: false }),
      // 短期学习词：不计入延迟复习正确率
      makeLog({ id: 'l5', cardId: 'c-st', isCorrect: false }),
    ];
    const stats = service.computeStats(cards, logs, []);
    expect(stats.delayedReviewAccuracy).toBeCloseTo(0.75, 5);
  });

  it('无长期复习日志时延迟复习正确率为 0', () => {
    const service = makeService();
    const cards = [makeCard({ id: 'c-st', stage: 'short-term' })];
    const logs = [makeLog({ id: 'l1', cardId: 'c-st', isCorrect: true })];
    const stats = service.computeStats(cards, logs, []);
    expect(stats.delayedReviewAccuracy).toBe(0);
  });

  it('周对比：本周与上周的完成题数和正确率', () => {
    const service = makeService();
    const thisWeekStart = startOfLocalWeek(NOW);
    const lastWeekStart = thisWeekStart - 7 * MS_PER_DAY;

    const logs = [
      // 本周：3 对 1 错
      makeLog({ id: 'l-t1', isCorrect: true, reviewedAt: thisWeekStart + MS_PER_DAY }),
      makeLog({ id: 'l-t2', isCorrect: true, reviewedAt: thisWeekStart + 2 * MS_PER_DAY }),
      makeLog({ id: 'l-t3', isCorrect: true, reviewedAt: thisWeekStart + 3 * MS_PER_DAY }),
      makeLog({ id: 'l-t4', isCorrect: false, reviewedAt: thisWeekStart + 4 * MS_PER_DAY }),
      // 上周：2 对 2 错
      makeLog({ id: 'l-l1', isCorrect: true, reviewedAt: lastWeekStart + MS_PER_DAY }),
      makeLog({ id: 'l-l2', isCorrect: true, reviewedAt: lastWeekStart + 2 * MS_PER_DAY }),
      makeLog({ id: 'l-l3', isCorrect: false, reviewedAt: lastWeekStart + 3 * MS_PER_DAY }),
      makeLog({ id: 'l-l4', isCorrect: false, reviewedAt: lastWeekStart + 4 * MS_PER_DAY }),
    ];
    const stats = service.computeStats([], logs, []);
    expect(stats.weekComparison).toEqual({
      thisWeekCompleted: 4,
      lastWeekCompleted: 4,
      thisWeekAccuracy: 0.75,
      lastWeekAccuracy: 0.5,
    });
  });

  it('周对比：无日志时正确率为 0', () => {
    const service = makeService();
    const stats = service.computeStats([], [], []);
    expect(stats.weekComparison).toEqual({
      thisWeekCompleted: 0,
      lastWeekCompleted: 0,
      thisWeekAccuracy: 0,
      lastWeekAccuracy: 0,
    });
  });
});

// ─── AC3：评分纠正、日期切换、清除数据、导入数据 ───────────────

describe('StatsService — 不重复/不过期统计（Issue #12 AC3）', () => {
  it('评分纠正不造成重复统计：纠正修改复习日志而非新增', () => {
    // 评分纠正（correctRating）修改已有复习日志的 rating 字段，
    // 不创建新日志。统计从日志派生，因此纠正不会增加完成题数。
    const service = makeService();
    const logs = [makeLog({ id: 'l1', isCorrect: true, rating: 'good', reviewedAt: NOW })];
    const stats1 = service.computeStats([], logs, []);
    expect(stats1.today.completedQuestions).toBe(1);

    // 模拟纠正后：同一日志，rating 变了，但日志数量不变
    const correctedLogs = [
      makeLog({
        id: 'l1',
        isCorrect: true,
        rating: 'easy',
        userCorrection: 'too-easy',
        reviewedAt: NOW,
      }),
    ];
    const stats2 = service.computeStats([], correctedLogs, []);
    expect(stats2.today.completedQuestions).toBe(1); // 仍是 1，不是 2
  });

  it('清除数据后统计为空', () => {
    const service = makeService();
    // 有数据时统计非零
    const logs = [makeLog({ id: 'l1', reviewedAt: NOW })];
    const stats1 = service.computeStats([], logs, []);
    expect(stats1.today.completedQuestions).toBe(1);

    // 清除数据后统计归零
    const stats2 = service.computeStats([], [], []);
    expect(stats2.today.completedQuestions).toBe(0);
  });

  it('导入数据后统计反映导入的数据', () => {
    const service = makeService();
    const todayStart = startOfLocalDay(NOW);
    const importedCards = [
      makeCard({ id: 'c1', wordId: 'w-imp1', createdAt: todayStart + 3600_000 }),
    ];
    const importedLogs = [makeLog({ id: 'l1', cardId: 'c1', wordId: 'w-imp1', reviewedAt: NOW })];
    const stats = service.computeStats(importedCards, importedLogs, []);
    expect(stats.today.completedQuestions).toBe(1);
    expect(stats.today.newWords).toBe(1);
  });

  it('日期切换：不同日期的日志不会混入今日统计', () => {
    const service = makeService();
    const todayStart = startOfLocalDay(NOW);
    const logs = [
      makeLog({ id: 'l-today', reviewedAt: NOW }),
      makeLog({ id: 'l-yesterday', reviewedAt: todayStart - 1 }),
      makeLog({ id: 'l-lastweek', reviewedAt: todayStart - 3 * MS_PER_DAY }),
    ];
    const stats = service.computeStats([], logs, []);
    expect(stats.today.completedQuestions).toBe(1);
  });
});

// ─── AC5：交叉验证 ─────────────────────────────────────────────

describe('StatsService — 交叉验证（Issue #12 AC5）', () => {
  it('今日完成题数 = 复习日志中 reviewedAt >= 今日起始的数量', () => {
    const service = makeService();
    const todayStart = startOfLocalDay(NOW);
    const logs = [
      makeLog({ id: 'l1', reviewedAt: todayStart }),
      makeLog({ id: 'l2', reviewedAt: todayStart + 100 }),
      makeLog({ id: 'l3', reviewedAt: todayStart - 1 }),
    ];
    const stats = service.computeStats([], logs, []);
    const manualCount = logs.filter((l) => l.reviewedAt >= todayStart).length;
    expect(stats.today.completedQuestions).toBe(manualCount);
  });

  it('学习卡状态可由 cards 数组直接验证', () => {
    const service = makeService();
    const cards = [
      makeCard({ id: 'c1', stage: 'long-term' }),
      makeCard({ id: 'c2', stage: 'short-term' }),
    ];
    const stats = service.computeStats(cards, [], []);
    expect(stats.cardStatus.longTerm).toBe(cards.filter((c) => c.stage === 'long-term').length);
    expect(stats.cardStatus.shortTerm).toBe(cards.filter((c) => c.stage === 'short-term').length);
  });

  it('待复习词数可由 cards 的 nextReviewAt 直接验证', () => {
    const service = makeService();
    const cards = [
      makeCard({ id: 'c1', nextReviewAt: NOW - 1 }),
      makeCard({ id: 'c2', nextReviewAt: NOW + 1 }),
    ];
    const stats = service.computeStats(cards, [], []);
    const manualCount = cards.filter(
      (c) => c.nextReviewAt !== undefined && c.nextReviewAt <= NOW,
    ).length;
    expect(stats.dueReviewCount).toBe(manualCount);
  });
});
