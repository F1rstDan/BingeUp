import type { BehaviorEventRecord, CardRecord, ReviewLogRecord, SessionLogRecord } from '@/types';
import { openDatabase, idbReplaceAll, STORES, DATABASE_NAME } from '@/storage/database';
import { DEFAULT_AUTHORITATIVE_STATE } from '@/storage/local-settings';

import {
  DAY,
  HOUR,
  localDayStart,
  makeDemoDevDeckSummary,
  type PreviewLearningScenario,
} from './demo-data';

/**
 * 统计页演示数据。
 *
 * 预览站直接复用真实统计链路：把学习卡 / 复习日志 / 会话日志 / 指标源事件与
 * 权威状态（网站启用、应用设置）写入同一个 IndexedDB，再由
 * StatsApp 通过真实仓储与 StatsService 派生全部指标。
 *
 * 「非空」与「空态」两个预览通过 seed / clear 切换；StatsApp 在挂载时读取一次，
 * 因此预览页在切换时以 key 重挂载。完整的时间戳都相对“今天”生成，保证
 * 今日、近 7 日、周对比等区块都有数据。
 */

function buildCards(now: number): CardRecord[] {
  const today = localDayStart(now);
  return [
    {
      id: 'demo-card-deliberate',
      wordId: 'w-deliberate',
      deckId: 'deck-daily-high-frequency',
      stage: 'long-term',
      origin: 'accepted-new',
      createdAt: today - 6 * DAY,
      updatedAt: now - 2 * HOUR,
      nextReviewAt: now - HOUR,
      lastWrongAt: now - 20 * 60 * 1000,
      schedulerState: {
        stability: 12.4,
        difficulty: 4.6,
        reps: 5,
        lapses: 1,
        state: 2,
        scheduledDays: 3,
        learningSteps: 0,
        lastReviewAt: now - 2 * HOUR,
      },
    },
    {
      id: 'demo-card-mitigate',
      wordId: 'w-mitigate',
      deckId: 'deck-daily-high-frequency',
      stage: 'long-term',
      origin: 'accepted-new',
      createdAt: today - 9 * DAY,
      updatedAt: now - 5 * DAY,
      nextReviewAt: now + 2 * DAY,
      schedulerState: {
        stability: 30.2,
        difficulty: 6.1,
        reps: 7,
        lapses: 0,
        state: 2,
        scheduledDays: 7,
        learningSteps: 0,
        lastReviewAt: now - 5 * DAY,
      },
    },
    {
      id: 'demo-card-enhance',
      wordId: 'w-enhance',
      deckId: 'deck-daily-high-frequency',
      stage: 'short-term',
      origin: 'accepted-new',
      createdAt: today - 2 * DAY,
      updatedAt: now - 3 * HOUR,
      nextReviewAt: now - 20 * 60 * 1000,
    },
    {
      id: 'demo-card-frequent',
      wordId: 'w-frequent',
      deckId: 'deck-daily-high-frequency',
      stage: 'short-term',
      origin: 'accepted-new',
      createdAt: today - 2 * DAY,
      updatedAt: now - 2 * HOUR,
      nextReviewAt: now + 40 * 60 * 1000,
    },
    {
      id: 'demo-card-legacy',
      wordId: 'w-legacy',
      deckId: 'deck-cet4',
      stage: 'short-term',
      origin: 'accepted-new',
      createdAt: today - 1 * DAY,
      updatedAt: now - 5 * HOUR,
      nextReviewAt: now + 3 * HOUR,
    },
    {
      id: 'demo-card-genuine',
      wordId: 'w-genuine',
      deckId: 'deck-daily-high-frequency',
      stage: 'short-term',
      origin: 'accepted-new',
      // 今天接受的新词：用于“今日新词”指标。
      createdAt: now - 45 * 60 * 1000,
      updatedAt: now - 45 * 60 * 1000,
      nextReviewAt: now + 10 * 60 * 1000,
    },
    {
      id: 'demo-card-hesitate',
      wordId: 'w-hesitate',
      deckId: 'deck-cet6',
      stage: 'self-reported-known',
      origin: 'self-reported',
      createdAt: today - 3 * DAY,
      updatedAt: today - 3 * DAY,
      nextReviewAt: now + 20 * HOUR,
    },
  ];
}

let logSeq = 0;

function buildLog(
  cardId: string,
  wordId: string,
  reviewedAt: number,
  options: {
    isCorrect: boolean;
    stage: CardRecord['stage'];
    questionType: 'en-to-zh' | 'zh-to-en' | 'context-choice' | 'spelling';
    source: 'natural' | 'manual' | 'continuous';
    selectedAnswer: string;
    correctAnswer: string;
  },
): ReviewLogRecord {
  logSeq += 1;
  return {
    id: `demo-log-${logSeq}`,
    cardId,
    wordId,
    questionType: options.questionType,
    selectedAnswer: options.selectedAnswer,
    correctAnswer: options.correctAnswer,
    isCorrect: options.isCorrect,
    responseTimeMs: 3200 + logSeq * 137,
    reviewedAt,
    stageAtSubmission: options.stage,
    source: options.source,
    rating: options.isCorrect ? 'good' : 'again',
    answerChanges: 0,
  };
}

function buildLogs(now: number): ReviewLogRecord[] {
  const today = localDayStart(now);
  return [
    // 今日：自然完成、连续完成、答错与长短期混合。
    buildLog('demo-card-deliberate', 'w-deliberate', now - 30 * 60 * 1000, {
      isCorrect: true,
      stage: 'long-term',
      questionType: 'en-to-zh',
      source: 'natural',
      selectedAnswer: '故意的；深思熟虑的',
      correctAnswer: '故意的；深思熟虑的',
    }),
    buildLog('demo-card-mitigate', 'w-mitigate', now - 50 * 60 * 1000, {
      isCorrect: true,
      stage: 'long-term',
      questionType: 'spelling',
      source: 'continuous',
      selectedAnswer: 'mitigate',
      correctAnswer: 'mitigate',
    }),
    buildLog('demo-card-deliberate', 'w-deliberate', now - 20 * 60 * 1000, {
      isCorrect: false,
      stage: 'long-term',
      questionType: 'zh-to-en',
      source: 'natural',
      selectedAnswer: 'mitigate',
      correctAnswer: 'deliberate',
    }),
    buildLog('demo-card-enhance', 'w-enhance', now - 10 * 60 * 1000, {
      isCorrect: true,
      stage: 'short-term',
      questionType: 'context-choice',
      source: 'natural',
      selectedAnswer: '提高；增强',
      correctAnswer: '提高；增强',
    }),
    buildLog('demo-card-frequent', 'w-frequent', now - 5 * 60 * 1000, {
      isCorrect: false,
      stage: 'short-term',
      questionType: 'en-to-zh',
      source: 'natural',
      selectedAnswer: '减轻；缓和',
      correctAnswer: '频繁的；经常的',
    }),
    buildLog('demo-card-genuine', 'w-genuine', now - 40 * 60 * 1000, {
      isCorrect: true,
      stage: 'short-term',
      questionType: 'en-to-zh',
      source: 'continuous',
      selectedAnswer: '真正的；真诚的',
      correctAnswer: '真正的；真诚的',
    }),
    // 最近几天（供近 7 日趋势；跨周的部分会进入上周对比）。
    buildLog('demo-card-deliberate', 'w-deliberate', today - 1 * DAY + 10 * HOUR, {
      isCorrect: true,
      stage: 'long-term',
      questionType: 'en-to-zh',
      source: 'natural',
      selectedAnswer: '故意的；深思熟虑的',
      correctAnswer: '故意的；深思熟虑的',
    }),
    buildLog('demo-card-mitigate', 'w-mitigate', today - 2 * DAY + 21 * HOUR, {
      isCorrect: false,
      stage: 'long-term',
      questionType: 'zh-to-en',
      source: 'natural',
      selectedAnswer: 'enhance',
      correctAnswer: 'mitigate',
    }),
    buildLog('demo-card-enhance', 'w-enhance', today - 4 * DAY + 9 * HOUR, {
      isCorrect: true,
      stage: 'short-term',
      questionType: 'en-to-zh',
      source: 'natural',
      selectedAnswer: '提高；增强',
      correctAnswer: '提高；增强',
    }),
    buildLog('demo-card-frequent', 'w-frequent', today - 5 * DAY + 19 * HOUR, {
      isCorrect: true,
      stage: 'short-term',
      questionType: 'en-to-zh',
      source: 'manual',
      selectedAnswer: '频繁的；经常的',
      correctAnswer: '频繁的；经常的',
    }),
    buildLog('demo-card-legacy', 'w-legacy', today - 6 * DAY + 12 * HOUR, {
      isCorrect: false,
      stage: 'short-term',
      questionType: 'en-to-zh',
      source: 'natural',
      selectedAnswer: '犹豫；踌躇',
      correctAnswer: '遗产；遗留',
    }),
    // 上周（周对比用；如今天在周初，这部分自然落到“上周”）。
    buildLog('demo-card-deliberate', 'w-deliberate', today - 8 * DAY + 14 * HOUR, {
      isCorrect: true,
      stage: 'long-term',
      questionType: 'en-to-zh',
      source: 'natural',
      selectedAnswer: '故意的；深思熟虑的',
      correctAnswer: '故意的；深思熟虑的',
    }),
    buildLog('demo-card-mitigate', 'w-mitigate', today - 9 * DAY + 11 * HOUR, {
      isCorrect: true,
      stage: 'long-term',
      questionType: 'spelling',
      source: 'natural',
      selectedAnswer: 'mitigate',
      correctAnswer: 'mitigate',
    }),
  ];
}

function buildSessions(now: number): SessionLogRecord[] {
  const today = localDayStart(now);
  return [
    {
      id: 'demo-session-1',
      startedAt: now - 55 * 60 * 1000,
      endedAt: now - 45 * 60 * 1000,
      mode: 'continuous',
      outcome: 'submitted',
      questionsAnswered: 2,
      source: 'manual',
      continuousQuestionsAnswered: 2,
    },
    {
      id: 'demo-session-2',
      startedAt: now - 70 * 60 * 1000,
      endedAt: now - 60 * 60 * 1000,
      mode: 'single',
      outcome: 'submitted',
      questionsAnswered: 1,
      source: 'natural',
      continuousQuestionsAnswered: 0,
      initialOutcome: 'accepted-new',
    },
    {
      id: 'demo-session-3',
      startedAt: now - 25 * 60 * 1000,
      endedAt: now - 24 * 60 * 1000,
      mode: 'single',
      outcome: 'skipped',
      questionsAnswered: 0,
      source: 'natural',
      continuousQuestionsAnswered: 0,
      initialOutcome: 'skipped',
    },
    {
      id: 'demo-session-4',
      startedAt: today - 1 * DAY + 10 * HOUR,
      endedAt: today - 1 * DAY + 10 * HOUR + 6 * 60 * 1000,
      mode: 'continuous',
      outcome: 'exit',
      questionsAnswered: 3,
      source: 'manual',
      continuousQuestionsAnswered: 3,
    },
    {
      id: 'demo-session-5',
      startedAt: today - 4 * DAY + 9 * HOUR,
      endedAt: today - 4 * DAY + 9 * HOUR + 2 * 60 * 1000,
      mode: 'single',
      outcome: 'submitted',
      questionsAnswered: 1,
      source: 'natural',
      continuousQuestionsAnswered: 0,
      initialOutcome: 'submitted',
    },
  ];
}

function buildEvents(now: number): BehaviorEventRecord[] {
  const today = localDayStart(now);
  return [
    {
      id: 'demo-event-site-bilibili',
      kind: 'site-enabled',
      occurredAt: today - 30 * DAY,
      hostname: 'bilibili.com',
      enabled: true,
      baseline: true,
    },
    {
      id: 'demo-event-site-youtube',
      kind: 'site-enabled',
      occurredAt: today - 20 * DAY,
      hostname: 'youtube.com',
      enabled: false,
      baseline: true,
    },
    {
      id: 'demo-event-pause-started',
      kind: 'global-pause',
      occurredAt: now - 3 * HOUR,
      action: 'started',
      pausedUntil: now - 2 * HOUR,
    },
    {
      id: 'demo-event-pause-resumed',
      kind: 'global-pause',
      occurredAt: now - 2 * HOUR,
      action: 'resumed',
      pausedUntil: 0,
    },
  ];
}

interface ScenarioStatsProfile {
  historyDays: number;
  todayLogs: number;
  totalLogs: number;
  sessions: number;
  todayContinuousSessions: number;
}

const SCENARIO_STATS_PROFILES: Record<
  Exclude<PreviewLearningScenario, 'base'>,
  ScenarioStatsProfile
> = {
  week: { historyDays: 7, todayLogs: 9, totalLogs: 28, sessions: 7, todayContinuousSessions: 2 },
  month: {
    historyDays: 30,
    todayLogs: 16,
    totalLogs: 80,
    sessions: 24,
    todayContinuousSessions: 4,
  },
  year: {
    historyDays: 365,
    todayLogs: 24,
    totalLogs: 180,
    sessions: 60,
    todayContinuousSessions: 6,
  },
  complete: {
    historyDays: 365,
    todayLogs: 0,
    totalLogs: 180,
    sessions: 60,
    todayContinuousSessions: 0,
  },
};

function buildScenarioCards(
  now: number,
  scenario: Exclude<PreviewLearningScenario, 'base'>,
): CardRecord[] {
  const today = localDayStart(now);
  const summary = makeDemoDevDeckSummary(scenario);
  const stages: CardRecord['stage'][] = [];
  for (const [stage, count] of Object.entries(summary.stageCounts)) {
    for (let index = 0; index < count; index += 1) {
      stages.push(stage as CardRecord['stage']);
    }
  }
  const profile = SCENARIO_STATS_PROFILES[scenario];
  return stages.map((stage, index) => {
    const daysAgo = stage === 'new' ? 0 : 1 + (index % Math.max(1, profile.historyDays - 1));
    const createdAt = Math.min(
      today - daysAgo * DAY + (9 + (index % 8)) * HOUR,
      now - ((index % 25) + 1) * 60 * 1000,
    );
    const updatedAt = Math.min(
      now,
      createdAt + Math.floor((now - createdAt) * (0.45 + (index % 5) * 0.1)),
    );
    const due = scenario !== 'complete' && index % 5 === 0;
    return {
      id: `demo-scenario-${scenario}-card-${index + 1}`,
      wordId: `demo-history-word-${index + 1}`,
      deckId: 'deck-daily-high-frequency',
      stage,
      origin: stage === 'self-reported-known' ? 'self-reported' : 'accepted-new',
      createdAt,
      updatedAt,
      ...(stage === 'new'
        ? {}
        : {
            nextReviewAt:
              stage === 'long-term'
                ? due
                  ? now - ((index % 30) + 1) * HOUR
                  : now + ((index % 24) + 1) * DAY
                : stage === 'short-term'
                  ? due
                    ? now - ((index % 8) + 1) * HOUR
                    : now + ((index % 12) + 1) * HOUR
                  : now + DAY,
          }),
      ...(stage === 'long-term'
        ? {
            schedulerState: {
              stability: 2 + (index % 28),
              difficulty: 2 + (index % 8),
              reps: 1 + (index % 10),
              lapses: index % 3,
              state: 2,
              scheduledDays: 1 + (index % 24),
              learningSteps: 0,
              lastReviewAt: updatedAt,
            },
          }
        : {}),
    } satisfies CardRecord;
  });
}

function buildScenarioLogs(
  now: number,
  scenario: Exclude<PreviewLearningScenario, 'base'>,
  cards: CardRecord[],
): ReviewLogRecord[] {
  const today = localDayStart(now);
  const profile = SCENARIO_STATS_PROFILES[scenario];
  const logCards = cards.filter((card) => card.stage !== 'new');
  const usable = logCards.length > 0 ? logCards : cards;
  return Array.from({ length: profile.totalLogs }, (_, index) => {
    const card = usable[index % usable.length]!;
    const isCorrect = index % 7 !== 0;
    const reviewedAt =
      index < profile.todayLogs
        ? today + Math.floor(((index + 1) / (profile.todayLogs + 1)) * (now - today))
        : Math.min(
            now - 60 * 1000,
            today -
              (1 + ((index - profile.todayLogs) % Math.max(1, profile.historyDays - 1))) * DAY +
              (8 + (index % 11)) * HOUR,
          );
    return {
      id: `demo-scenario-${scenario}-log-${index + 1}`,
      cardId: card.id,
      wordId: card.wordId,
      questionType: (['en-to-zh', 'zh-to-en', 'context-choice', 'spelling'] as const)[index % 4]!,
      selectedAnswer: isCorrect ? `释义 ${(index % 12) + 1}` : `干扰 ${(index % 12) + 1}`,
      correctAnswer: `释义 ${(index % 12) + 1}`,
      isCorrect,
      responseTimeMs: 1800 + (index % 20) * 150,
      reviewedAt,
      stageAtSubmission: card.stage === 'long-term' ? 'long-term' : 'short-term',
      source: index % 3 === 0 ? 'continuous' : index % 5 === 0 ? 'manual' : 'natural',
      rating: isCorrect ? 'good' : 'again',
      answerChanges: index % 3,
    } satisfies ReviewLogRecord;
  });
}

function buildScenarioSessions(
  now: number,
  scenario: Exclude<PreviewLearningScenario, 'base'>,
): SessionLogRecord[] {
  const today = localDayStart(now);
  const profile = SCENARIO_STATS_PROFILES[scenario];
  return Array.from({ length: profile.sessions }, (_, index) => {
    const isToday = index < Math.max(profile.todayContinuousSessions, 2);
    const daysAgo = isToday ? 0 : 1 + (index % Math.max(1, profile.historyDays - 1));
    const startedAt = Math.min(
      today - daysAgo * DAY + (9 + (index % 10)) * HOUR,
      now - ((index % 30) + 1) * 60 * 1000,
    );
    const mode = isToday && index < profile.todayContinuousSessions ? 'continuous' : 'single';
    const outcome = index % 9 === 0 ? 'skipped' : index % 13 === 0 ? 'exit' : 'submitted';
    const questionsAnswered = outcome === 'skipped' ? 0 : 1 + (index % 4);
    return {
      id: `demo-scenario-${scenario}-session-${index + 1}`,
      startedAt,
      endedAt: Math.min(now, startedAt + (5 + (index % 15)) * 60 * 1000),
      mode,
      outcome,
      questionsAnswered,
      source: index % 3 === 0 ? 'manual' : 'natural',
      initialOutcome:
        outcome === 'skipped' ? 'skipped' : index % 4 === 0 ? 'accepted-new' : 'submitted',
      continuousQuestionsAnswered: mode === 'continuous' ? questionsAnswered : 0,
    } satisfies SessionLogRecord;
  });
}

function buildScenarioEvents(
  now: number,
  scenario: Exclude<PreviewLearningScenario, 'base'>,
): BehaviorEventRecord[] {
  const today = localDayStart(now);
  const profile = SCENARIO_STATS_PROFILES[scenario];
  return [
    {
      id: `demo-scenario-${scenario}-event-site-bilibili`,
      kind: 'site-enabled',
      occurredAt: today - profile.historyDays * DAY,
      hostname: 'bilibili.com',
      enabled: true,
      baseline: true,
    },
    {
      id: `demo-scenario-${scenario}-event-site-youtube`,
      kind: 'site-enabled',
      occurredAt: today - profile.historyDays * DAY + DAY,
      hostname: 'youtube.com',
      enabled: false,
      baseline: true,
    },
  ];
}

/** 写入统计页非空演示数据（同一事务替换全部数据仓库）。 */
export async function seedStatsDemoData(scenario: PreviewLearningScenario = 'base'): Promise<void> {
  const now = Date.now();
  logSeq = 0;
  const cards = scenario === 'base' ? buildCards(now) : buildScenarioCards(now, scenario);
  const reviewLogs = scenario === 'base' ? buildLogs(now) : buildScenarioLogs(now, scenario, cards);
  const sessionLogs =
    scenario === 'base' ? buildSessions(now) : buildScenarioSessions(now, scenario);
  const behaviorEvents =
    scenario === 'base' ? buildEvents(now) : buildScenarioEvents(now, scenario);
  const db = await openDatabase(DATABASE_NAME);
  try {
    await idbReplaceAll(db, {
      [STORES.authoritativeState]: [
        {
          ...DEFAULT_AUTHORITATIVE_STATE,
          sites: {
            'bilibili.com': { enabled: true, mode: 'full-adaptation', firstQuestionPending: false },
            'youtube.com': { enabled: false, mode: 'full-adaptation', firstQuestionPending: false },
          },
          onboardingCompleted: true,
        },
      ],
      [STORES.cards]: cards,
      [STORES.reviewLogs]: reviewLogs,
      [STORES.sessionLogs]: sessionLogs,
      [STORES.behaviorEvents]: behaviorEvents,
      [STORES.words]: [],
      [STORES.decks]: [],
    });
  } finally {
    db.close();
  }
}

/** 清空演示数据，得到统计页的空态（无学习卡、无日志、无已启用网站）。 */
export async function clearStatsDemoData(): Promise<void> {
  const db = await openDatabase(DATABASE_NAME);
  try {
    await idbReplaceAll(db, {
      [STORES.authoritativeState]: [{ ...DEFAULT_AUTHORITATIVE_STATE }],
      [STORES.cards]: [],
      [STORES.reviewLogs]: [],
      [STORES.sessionLogs]: [],
      [STORES.behaviorEvents]: [],
      [STORES.words]: [],
      [STORES.decks]: [],
    });
  } finally {
    db.close();
  }
}
