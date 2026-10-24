import type {
  BehaviorEventRecord,
  CardRecord,
  CardStage,
  DeckRecord,
  ReviewLogRecord,
  SessionLogRecord,
  WordRecord,
} from '@/types';
import type { DevScenario } from '@/dev-tools/messages';
import type { WordBankPort } from '@/learning/learning-service';
import { STORES } from '@/storage/database';
import { CONTENT_COMPAT_ID } from '@/storage/content-compat';
import type { LocalSettingsStore } from '@/storage/local-settings';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

interface ScenarioProfile {
  historyDays: number;
  cardFraction: number;
  maxCards: number;
  minCards: number;
  logCount: number;
  todayLogs: number;
  sessionCount: number;
}

const PROFILES: Record<DevScenario, ScenarioProfile> = {
  week: {
    historyDays: 7,
    cardFraction: 0.08,
    maxCards: 80,
    minCards: 8,
    logCount: 80,
    todayLogs: 8,
    sessionCount: 7,
  },
  month: {
    historyDays: 30,
    cardFraction: 0.2,
    maxCards: 260,
    minCards: 12,
    logCount: 320,
    todayLogs: 12,
    sessionCount: 24,
  },
  year: {
    historyDays: 365,
    cardFraction: 0.55,
    maxCards: 900,
    minCards: 16,
    logCount: 900,
    todayLogs: 18,
    sessionCount: 120,
  },
  complete: {
    historyDays: 365,
    cardFraction: 1,
    maxCards: Number.MAX_SAFE_INTEGER,
    minCards: 1,
    logCount: 1200,
    todayLogs: 12,
    sessionCount: 120,
  },
};

const QUESTION_TYPES: ReviewLogRecord['questionType'][] = [
  'en-to-zh',
  'zh-to-en',
  'context-choice',
  'spelling',
];

export interface DevScenarioSeed {
  cards: CardRecord[];
  reviewLogs: ReviewLogRecord[];
  sessionLogs: SessionLogRecord[];
  behaviorEvents: BehaviorEventRecord[];
}

export interface DevScenarioSeederDeps {
  db: IDBDatabase;
  words: Pick<WordBankPort, 'getDeck' | 'getDefaultDeck' | 'listWords'>;
  store: Pick<LocalSettingsStore, 'getAppSettings'>;
  clock: { now(): number };
}

/** 开发环境模拟学习历史；只替换学习进度，不修改设置、网站或内容包。 */
export class DevScenarioSeeder {
  constructor(private readonly deps: DevScenarioSeederDeps) {}

  async seed(scenario: DevScenario): Promise<void> {
    const settings = await this.deps.store.getAppSettings();
    const deck =
      (settings.selectedDeckId ? await this.deps.words.getDeck(settings.selectedDeckId) : null) ??
      (await this.deps.words.getDefaultDeck());
    const words = await this.deps.words.listWords();
    const data = buildDevScenarioSeed({
      scenario,
      deck,
      words,
      now: this.deps.clock.now(),
    });
    await replaceLearningProgress(this.deps.db, data);
  }
}

function replaceLearningProgress(db: IDBDatabase, data: DevScenarioSeed): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      [
        STORES.cards,
        STORES.reviewLogs,
        STORES.sessionLogs,
        STORES.behaviorEvents,
        STORES.authoritativeState,
      ],
      'readwrite',
    );
    try {
      for (const [storeName, records] of [
        [STORES.cards, data.cards],
        [STORES.reviewLogs, data.reviewLogs],
        [STORES.sessionLogs, data.sessionLogs],
        [STORES.behaviorEvents, data.behaviorEvents],
      ] as const) {
        const store = tx.objectStore(storeName);
        store.clear();
        for (const record of records) store.put(record);
      }
      tx.objectStore(STORES.authoritativeState).delete(CONTENT_COMPAT_ID);
    } catch (error) {
      tx.abort();
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('模拟学习历史写入失败'));
    tx.onabort = () => reject(tx.error ?? new Error('模拟学习历史事务已中止'));
  });
}

export function buildDevScenarioSeed(params: {
  scenario: DevScenario;
  deck: DeckRecord;
  words: WordRecord[];
  now: number;
}): DevScenarioSeed {
  const { scenario, deck, words, now } = params;
  const profile = PROFILES[scenario];
  const wordById = new Map(words.map((word) => [word.id, word]));
  const deckWords = deck.wordIds
    .map((wordId) => wordById.get(wordId))
    .filter((word): word is WordRecord => word !== undefined)
    .sort((left, right) => left.frequencyRank - right.frequencyRank);
  if (deckWords.length === 0) throw new Error('当前词库没有可模拟的单词');

  const targetCardCount =
    scenario === 'complete'
      ? deckWords.length
      : Math.min(
          deckWords.length,
          Math.max(profile.minCards, Math.round(deckWords.length * profile.cardFraction)),
          profile.maxCards,
        );
  const todayStart = startOfLocalDay(now);
  const cards = deckWords.slice(0, targetCardCount).map((word, index) => {
    const stage = stageFor(index, targetCardCount, scenario);
    const createdAt = createdAtFor(index, stage, profile.historyDays, todayStart, now);
    const updatedAt = createdAt + Math.floor((now - createdAt) * (0.45 + (index % 5) * 0.1));
    return makeCard({
      scenario,
      deckId: deck.id,
      word,
      index,
      stage,
      createdAt,
      updatedAt: Math.min(now, updatedAt),
      now,
    });
  });

  const reviewLogs = buildLogs({
    scenario,
    profile,
    cards,
    wordById,
    todayStart,
    now,
  });
  const sessionLogs = buildSessions({ scenario, profile, todayStart, now });
  const behaviorEvents = buildBehaviorEvents({ scenario, profile, todayStart, now });
  return { cards, reviewLogs, sessionLogs, behaviorEvents };
}

function stageFor(index: number, total: number, scenario: DevScenario): CardStage {
  if (scenario === 'complete') return 'long-term';
  const ratio = (index + 1) / total;
  if (scenario === 'year') {
    if (ratio <= 0.9) return 'long-term';
    if (ratio <= 0.97) return 'short-term';
    return 'self-reported-known';
  }
  if (scenario === 'month') {
    if (ratio <= 0.5) return 'long-term';
    if (ratio <= 0.84) return 'short-term';
    if (ratio <= 0.92) return 'self-reported-known';
    return 'new';
  }
  if (ratio <= 0.3) return 'long-term';
  if (ratio <= 0.625) return 'short-term';
  if (ratio <= 0.75) return 'self-reported-known';
  return 'new';
}

function createdAtFor(
  index: number,
  stage: CardStage,
  historyDays: number,
  todayStart: number,
  now: number,
): number {
  const daysAgo = stage === 'new' ? 0 : 1 + (index % Math.max(1, historyDays - 1));
  const candidate = todayStart - daysAgo * DAY + (8 + (index % 10)) * HOUR;
  return Math.min(candidate, now - ((index % 45) + 1) * MINUTE);
}

function makeCard(params: {
  scenario: DevScenario;
  deckId: string;
  word: WordRecord;
  index: number;
  stage: CardStage;
  createdAt: number;
  updatedAt: number;
  now: number;
}): CardRecord {
  const { scenario, deckId, word, index, stage, createdAt, updatedAt, now } = params;
  const due = scenario !== 'complete' && index % 5 === 0;
  const nextReviewAt =
    stage === 'new'
      ? undefined
      : stage === 'long-term'
        ? due
          ? now - ((index % 48) + 1) * HOUR
          : now + ((index % 30) + 1) * DAY
        : stage === 'short-term'
          ? due
            ? now - ((index % 10) + 1) * HOUR
            : now + ((index % 12) + 1) * HOUR
          : now + DAY;
  return {
    id: `dev-${scenario}-card-${index + 1}`,
    wordId: word.id,
    deckId,
    stage,
    origin: stage === 'self-reported-known' ? 'self-reported' : 'accepted-new',
    createdAt,
    updatedAt,
    ...(nextReviewAt === undefined ? {} : { nextReviewAt }),
    ...(index % 7 === 0 ? { lastWrongAt: now - ((index % 12) + 1) * HOUR } : {}),
    ...(stage === 'long-term'
      ? {
          schedulerState: {
            stability: 2 + (index % 30),
            difficulty: 2 + (index % 8),
            reps: 1 + (index % 12),
            lapses: index % 3,
            state: 2,
            scheduledDays: 1 + (index % 30),
            learningSteps: 0,
            lastReviewAt: updatedAt,
          },
        }
      : {}),
  };
}

function buildLogs(params: {
  scenario: DevScenario;
  profile: ScenarioProfile;
  cards: CardRecord[];
  wordById: Map<string, WordRecord>;
  todayStart: number;
  now: number;
}): ReviewLogRecord[] {
  const { scenario, profile, cards, wordById, todayStart, now } = params;
  const logCards = cards.filter((card) => card.stage !== 'new');
  const usableCards = logCards.length > 0 ? logCards : cards;
  const logs: ReviewLogRecord[] = [];
  const total = Math.max(profile.logCount, profile.todayLogs);
  for (let index = 0; index < total; index += 1) {
    const card = usableCards[(index * 7 + 3) % usableCards.length]!;
    const word = wordById.get(card.wordId)!;
    const distractorWord = wordById.get(usableCards[(index * 5 + 1) % usableCards.length]!.wordId);
    const isCorrect = index % 7 !== 0;
    const reviewedAt =
      index < profile.todayLogs
        ? todayStart + Math.floor(((index + 1) / (profile.todayLogs + 1)) * (now - todayStart))
        : logTimeBeforeToday(index, profile, todayStart, now);
    const source: ReviewLogRecord['source'] =
      index % 3 === 0 ? 'continuous' : index % 5 === 0 ? 'manual' : 'natural';
    logs.push({
      id: `dev-${scenario}-log-${index + 1}`,
      cardId: card.id,
      wordId: word.id,
      questionType: QUESTION_TYPES[index % QUESTION_TYPES.length]!,
      selectedAnswer: isCorrect
        ? word.coreMeaningZh.join('；')
        : (distractorWord?.coreMeaningZh.join('；') ?? word.coreMeaningZh.join('；')),
      correctAnswer: word.coreMeaningZh.join('；'),
      isCorrect,
      responseTimeMs: 1800 + (index % 20) * 170,
      reviewedAt,
      stageAtSubmission: card.stage === 'long-term' ? 'long-term' : 'short-term',
      source,
      rating: isCorrect ? 'good' : 'again',
      answerChanges: index % 4,
    });
  }
  return logs;
}

function logTimeBeforeToday(
  index: number,
  profile: ScenarioProfile,
  todayStart: number,
  now: number,
): number {
  const days = Math.max(1, profile.historyDays - 1);
  const daysAgo = 1 + ((index - profile.todayLogs) % days);
  const candidate = todayStart - daysAgo * DAY + (8 + (index % 11)) * HOUR;
  return Math.min(now - MINUTE, candidate);
}

function buildSessions(params: {
  scenario: DevScenario;
  profile: ScenarioProfile;
  todayStart: number;
  now: number;
}): SessionLogRecord[] {
  const { scenario, profile, todayStart, now } = params;
  return Array.from({ length: profile.sessionCount }, (_, index) => {
    const daysAgo = index % Math.max(1, profile.historyDays);
    const candidate = todayStart - daysAgo * DAY + (9 + (index % 10)) * HOUR;
    const startedAt = Math.min(candidate, now - ((index % 30) + 1) * MINUTE);
    const outcome: SessionLogRecord['outcome'] =
      index % 9 === 0 ? 'skipped' : index % 13 === 0 ? 'exit' : 'submitted';
    const mode: SessionLogRecord['mode'] = index % 2 === 0 ? 'continuous' : 'single';
    const questionsAnswered = outcome === 'skipped' ? 0 : 1 + (index % 4);
    return {
      id: `dev-${scenario}-session-${index + 1}`,
      startedAt,
      endedAt: Math.min(now, startedAt + (5 + (index % 15)) * MINUTE),
      mode,
      outcome,
      questionsAnswered,
      source: index % 3 === 0 ? 'manual' : 'natural',
      initialItemKind: index % 4 === 0 ? 'new-word-presentation' : 'question',
      initialOutcome:
        outcome === 'skipped' ? 'skipped' : index % 4 === 0 ? 'accepted-new' : 'submitted',
      ...(mode === 'continuous' ? { continuousQuestionsAnswered: questionsAnswered } : {}),
    };
  });
}

function buildBehaviorEvents(params: {
  scenario: DevScenario;
  profile: ScenarioProfile;
  todayStart: number;
  now: number;
}): BehaviorEventRecord[] {
  const { scenario, profile, todayStart, now } = params;
  const historyStart = todayStart - profile.historyDays * DAY;
  return [
    {
      id: `dev-${scenario}-event-site-bilibili`,
      kind: 'site-enabled',
      occurredAt: historyStart,
      hostname: 'bilibili.com',
      enabled: true,
      baseline: true,
    },
    {
      id: `dev-${scenario}-event-site-youtube`,
      kind: 'site-enabled',
      occurredAt: historyStart + DAY,
      hostname: 'youtube.com',
      enabled: false,
      baseline: true,
    },
    {
      id: `dev-${scenario}-event-pause-started`,
      kind: 'global-pause',
      occurredAt: now - 3 * HOUR,
      action: 'started',
      pausedUntil: now - 2 * HOUR,
    },
    {
      id: `dev-${scenario}-event-pause-resumed`,
      kind: 'global-pause',
      occurredAt: now - 2 * HOUR,
      action: 'resumed',
      pausedUntil: 0,
    },
  ];
}

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
