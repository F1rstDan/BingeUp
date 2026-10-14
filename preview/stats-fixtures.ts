import type { BehaviorEventRecord, CardRecord, ReviewLogRecord, SessionLogRecord } from '@/types';
import { openDatabase, idbReplaceAll, STORES } from '@/storage/database';
import { DATABASE_NAME, MIGRATIONS } from '@/storage/migrations';
import { DEFAULT_AUTHORITATIVE_STATE } from '@/storage/local-settings';

import { DAY, HOUR, localDayStart } from './demo-data';

/**
 * 统计页演示数据。
 *
 * 预览站直接复用真实统计链路：把学习卡 / 复习日志 / 会话日志 / 指标源事件与
 * 权威状态（网站启用、应用设置）写入同一个 IndexedDB（bingeup-v1），再由
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
      initialItemKind: 'new-word-presentation',
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
      initialItemKind: 'question',
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
      initialItemKind: 'question',
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

/** 写入统计页非空演示数据（同一事务替换全部数据仓库）。 */
export async function seedStatsDemoData(): Promise<void> {
  const now = Date.now();
  logSeq = 0;
  const db = await openDatabase(DATABASE_NAME, MIGRATIONS);
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
      [STORES.cards]: buildCards(now),
      [STORES.reviewLogs]: buildLogs(now),
      [STORES.sessionLogs]: buildSessions(now),
      [STORES.behaviorEvents]: buildEvents(now),
      [STORES.words]: [],
      [STORES.decks]: [],
    });
  } finally {
    db.close();
  }
}

/** 清空演示数据，得到统计页的空态（无学习卡、无日志、无已启用网站）。 */
export async function clearStatsDemoData(): Promise<void> {
  const db = await openDatabase(DATABASE_NAME, MIGRATIONS);
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
