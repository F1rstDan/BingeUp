import type {
  AppSettings,
  BehaviorEventRecord,
  CardRecord,
  DeckRecord,
  ReviewLogRecord,
  SchedulerState,
  SessionLogRecord,
  SiteSettings,
  WordRecord,
} from '@/types';
import { STORES, idbGetAll, idbReplaceAll } from '@/storage/database';
import {
  AUTHORITATIVE_STATE_ID,
  DEFAULT_AUTHORITATIVE_STATE,
  type AuthoritativeStateRecord,
  type LocalSettingsStore,
} from '@/storage/local-settings';
import { validateAppSettings } from '@/settings/validator';
import {
  BUILT_IN_DECKS,
  getBuiltInDeck,
  getBuiltInWord,
  listBuiltInWords,
} from '@/dictionary/built-in/decks';

/** 首次公开备份格式；开发期格式不兼容。 */
export const EXPORT_VERSION = 1;

export interface ExportedData {
  cards: CardRecord[];
  reviewLogs: ReviewLogRecord[];
  sessionLogs: SessionLogRecord[];
  behaviorEvents: BehaviorEventRecord[];
  /** 仅未来用户创建/导入的内容；内置内容不导出。 */
  words: WordRecord[];
  decks: DeckRecord[];
}

export interface ExportPayload {
  version: 1;
  exportedAt: number;
  authoritativeState: Omit<AuthoritativeStateRecord, 'id'>;
  data: ExportedData;
}

export interface DataOperationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}
export type ImportResult = DataOperationResult;

export async function exportLocalData(store: LocalSettingsStore): Promise<ExportPayload> {
  const db = store.database;
  const [state, cards, reviewLogs, sessionLogs, behaviorEvents, words, decks] = await Promise.all([
    store.getAuthoritativeState(),
    idbGetAll<CardRecord>(db, STORES.cards),
    idbGetAll<ReviewLogRecord>(db, STORES.reviewLogs),
    idbGetAll<SessionLogRecord>(db, STORES.sessionLogs),
    idbGetAll<BehaviorEventRecord>(db, STORES.behaviorEvents),
    idbGetAll<WordRecord>(db, STORES.words),
    idbGetAll<DeckRecord>(db, STORES.decks),
  ]);
  const { id: _id, ...authoritativeState } = state;
  const builtInWordIds = new Set(listBuiltInWords().map(({ id }) => id));
  const builtInDeckIds = new Set(BUILT_IN_DECKS.map(({ id }) => id));
  return {
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    authoritativeState,
    data: {
      cards,
      reviewLogs,
      sessionLogs,
      behaviorEvents,
      words: words.filter(({ id }) => !builtInWordIds.has(id)),
      decks: decks.filter(({ id }) => !builtInDeckIds.has(id)),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}
function isOptional(value: unknown, validate: (candidate: unknown) => boolean): boolean {
  return value === undefined || validate(value);
}
function hasFields(
  value: unknown,
  fields: Record<string, (candidate: unknown) => boolean>,
): boolean {
  return (
    isRecord(value) && Object.entries(fields).every(([name, validate]) => validate(value[name]))
  );
}

const RATINGS = ['again', 'hard', 'good', 'easy'];
function isSchedulerState(value: unknown): value is SchedulerState {
  return hasFields(value, {
    stability: (candidate) => isFiniteNumber(candidate) && candidate > 0,
    difficulty: (candidate) => isFiniteNumber(candidate) && candidate >= 1 && candidate <= 10,
    reps: (candidate) => Number.isInteger(candidate) && Number(candidate) >= 0,
    lapses: (candidate) => Number.isInteger(candidate) && Number(candidate) >= 0,
    state: (candidate) =>
      Number.isInteger(candidate) && Number(candidate) >= 0 && Number(candidate) <= 3,
    scheduledDays: isNonNegativeNumber,
    learningSteps: (candidate) => Number.isInteger(candidate) && Number(candidate) >= 0,
    lastReviewAt: (candidate) => isOptional(candidate, isNonNegativeNumber),
  });
}

function isSiteSettings(value: unknown): value is SiteSettings {
  return hasFields(value, {
    enabled: (candidate) => typeof candidate === 'boolean',
    mode: (candidate) =>
      ['full-adaptation', 'generic-video', 'basic-web', 'unsupported'].includes(String(candidate)),
    firstQuestionPending: (candidate) => typeof candidate === 'boolean',
    promptDeclineCount: (candidate) =>
      isOptional(candidate, (count) => Number.isInteger(count) && Number(count) >= 0),
    pageLoadTrigger: (candidate) => isOptional(candidate, (flag) => typeof flag === 'boolean'),
    scrollTrigger: (candidate) => isOptional(candidate, (flag) => typeof flag === 'boolean'),
  });
}

const ENTITY_VALIDATORS: Record<keyof ExportedData, (value: unknown) => boolean> = {
  cards: (value) =>
    hasFields(value, {
      id: isNonEmptyString,
      wordId: isNonEmptyString,
      deckId: isNonEmptyString,
      stage: (candidate) =>
        ['new', 'short-term', 'long-term', 'self-reported-known'].includes(String(candidate)),
      origin: (candidate) =>
        isOptional(candidate, (origin) => origin === 'accepted-new' || origin === 'self-reported'),
      createdAt: isNonNegativeNumber,
      updatedAt: isNonNegativeNumber,
      nextReviewAt: (candidate) => isOptional(candidate, isNonNegativeNumber),
      schedulerState: (candidate) => isOptional(candidate, isSchedulerState),
      lastWrongAt: (candidate) => isOptional(candidate, isNonNegativeNumber),
    }),
  reviewLogs: (value) =>
    hasFields(value, {
      id: isNonEmptyString,
      cardId: isNonEmptyString,
      wordId: isNonEmptyString,
      questionType: (candidate) =>
        ['en-to-zh', 'zh-to-en', 'context-choice', 'spelling'].includes(String(candidate)),
      selectedAnswer: (candidate) => typeof candidate === 'string',
      correctAnswer: (candidate) => typeof candidate === 'string',
      isCorrect: (candidate) => typeof candidate === 'boolean',
      responseTimeMs: isNonNegativeNumber,
      reviewedAt: isNonNegativeNumber,
      stageAtSubmission: (candidate) =>
        isOptional(candidate, (stage) =>
          ['new', 'short-term', 'long-term', 'self-reported-known'].includes(String(stage)),
        ),
      source: (candidate) =>
        isOptional(candidate, (source) =>
          ['natural', 'manual', 'continuous'].includes(String(source)),
        ),
      rating: (candidate) => isOptional(candidate, (rating) => RATINGS.includes(String(rating))),
      userCorrection: (candidate) =>
        isOptional(
          candidate,
          (correction) => correction === 'guessed' || correction === 'too-easy',
        ),
      answerChanges: (candidate) =>
        isOptional(candidate, (count) => Number.isInteger(count) && Number(count) >= 0),
      previousSchedulerState: (candidate) => isOptional(candidate, isSchedulerState),
    }),
  sessionLogs: (value) =>
    hasFields(value, {
      id: isNonEmptyString,
      startedAt: isNonNegativeNumber,
      endedAt: isNonNegativeNumber,
      mode: (candidate) => candidate === 'single' || candidate === 'continuous',
      outcome: (candidate) =>
        candidate === 'submitted' || candidate === 'skipped' || candidate === 'exit',
      questionsAnswered: (candidate) => Number.isInteger(candidate) && Number(candidate) >= 0,
      source: (candidate) =>
        isOptional(candidate, (source) => source === 'natural' || source === 'manual'),
      initialItemKind: (candidate) =>
        isOptional(candidate, (kind) =>
          ['new-word-presentation', 'question', 'spelling-question'].includes(String(kind)),
        ),
      initialOutcome: (candidate) =>
        isOptional(candidate, (outcome) =>
          ['submitted', 'accepted-new', 'self-reported', 'skipped'].includes(String(outcome)),
        ),
      continuousQuestionsAnswered: (candidate) =>
        isOptional(candidate, (count) => Number.isInteger(count) && Number(count) >= 0),
    }) && (value as SessionLogRecord).endedAt >= (value as SessionLogRecord).startedAt,
  behaviorEvents: (value) => {
    if (
      !isRecord(value) ||
      !hasFields(value, { id: isNonEmptyString, occurredAt: isNonNegativeNumber })
    )
      return false;
    if (value.kind === 'site-enabled') {
      return (
        isNonEmptyString(value.hostname) &&
        typeof value.enabled === 'boolean' &&
        isOptional(value.baseline, (flag) => typeof flag === 'boolean')
      );
    }
    if (value.kind === 'global-pause') {
      return (
        ['started', 'extended', 'resumed'].includes(String(value.action)) &&
        isNonNegativeNumber(value.pausedUntil)
      );
    }
    return false;
  },
  words: (value) =>
    hasFields(value, {
      id: isNonEmptyString,
      word: isNonEmptyString,
      lemma: isNonEmptyString,
      phonetic: (candidate) => isOptional(candidate, (text) => typeof text === 'string'),
      partOfSpeech: (candidate) =>
        Array.isArray(candidate) && candidate.length > 0 && candidate.every(isNonEmptyString),
      coreMeaningZh: (candidate) =>
        Array.isArray(candidate) && candidate.length > 0 && candidate.every(isNonEmptyString),
      exampleSentence: isNonEmptyString,
      exampleTranslation: isNonEmptyString,
      difficulty: (candidate) => isFiniteNumber(candidate) && candidate > 0,
      source: isNonEmptyString,
      license: isNonEmptyString,
    }),
  decks: (value) =>
    hasFields(value, {
      id: isNonEmptyString,
      name: isNonEmptyString,
      description: (candidate) => isOptional(candidate, (text) => typeof text === 'string'),
      source: isNonEmptyString,
      license: isNonEmptyString,
      wordIds: (candidate) =>
        Array.isArray(candidate) && candidate.length > 0 && candidate.every(isNonEmptyString),
    }),
};

function validateAuthoritativeState(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push('缺少 authoritativeState 字段');
    return;
  }
  if (!isRecord(value.appSettings)) errors.push('authoritativeState.appSettings 结构非法');
  else errors.push(...validateAppSettings(value.appSettings as Partial<AppSettings>).errors);
  if (typeof value.onboardingCompleted !== 'boolean') {
    errors.push('authoritativeState.onboardingCompleted 必须为布尔值');
  }
  if (!isRecord(value.sites)) errors.push('authoritativeState.sites 结构非法');
  else
    Object.entries(value.sites).forEach(([hostname, settings]) => {
      if (!isNonEmptyString(hostname) || !isSiteSettings(settings)) {
        errors.push(`authoritativeState.sites.${hostname} 结构非法`);
      }
    });
}

function validateEntities(data: ExportedData, errors: string[]): void {
  (Object.keys(ENTITY_VALIDATORS) as (keyof ExportedData)[]).forEach((collection) => {
    data[collection].forEach((entity, index) => {
      if (!ENTITY_VALIDATORS[collection](entity))
        errors.push(`data.${collection}[${index}] 结构非法`);
    });
  });
}

function validateReferences(payload: ExportPayload, errors: string[]): void {
  const { data, authoritativeState } = payload;
  const wordIds = new Set(data.words.map(({ id }) => id));
  const deckIds = new Set(data.decks.map(({ id }) => id));
  const cardsById = new Map(data.cards.map((card) => [card.id, card]));
  data.words.forEach(({ id }, index) => {
    if (getBuiltInWord(id)) errors.push(`data.words[${index}] 与内置单词 id 冲突：${id}`);
  });
  data.decks.forEach(({ id }, index) => {
    if (getBuiltInDeck(id)) errors.push(`data.decks[${index}] 与内置词库 id 冲突：${id}`);
  });
  for (const [collection, ids] of [
    ['words', data.words.map(({ id }) => id)],
    ['decks', data.decks.map(({ id }) => id)],
    ['cards', data.cards.map(({ id }) => id)],
    ['reviewLogs', data.reviewLogs.map(({ id }) => id)],
    ['sessionLogs', data.sessionLogs.map(({ id }) => id)],
    ['behaviorEvents', data.behaviorEvents.map(({ id }) => id)],
  ] as const) {
    if (new Set(ids).size !== ids.length) errors.push(`data.${collection} 包含重复 id`);
  }
  if (new Set(data.cards.map(({ wordId }) => wordId)).size !== data.cards.length) {
    errors.push('data.cards 中同一单词存在多张学习卡');
  }
  data.decks.forEach((deck, index) =>
    deck.wordIds.forEach((wordId) => {
      if (!wordIds.has(wordId) && !getBuiltInWord(wordId))
        errors.push(`data.decks[${index}] 引用不存在的单词：${wordId}`);
    }),
  );
  data.cards.forEach((card, index) => {
    if (!wordIds.has(card.wordId) && !getBuiltInWord(card.wordId))
      errors.push(`data.cards[${index}] 引用不存在的单词：${card.wordId}`);
    if (!deckIds.has(card.deckId) && !getBuiltInDeck(card.deckId))
      errors.push(`data.cards[${index}] 引用不存在的词库：${card.deckId}`);
    const deck = data.decks.find(({ id }) => id === card.deckId) ?? getBuiltInDeck(card.deckId);
    if (deck && !deck.wordIds.includes(card.wordId)) {
      errors.push(`data.cards[${index}] 的单词不属于引用的词库`);
    }
  });
  data.reviewLogs.forEach((log, index) => {
    const card = cardsById.get(log.cardId);
    if (!card) errors.push(`data.reviewLogs[${index}] 引用不存在的学习卡：${log.cardId}`);
    else if (card.wordId !== log.wordId)
      errors.push(`data.reviewLogs[${index}] 的单词引用与学习卡不一致`);
    if (!wordIds.has(log.wordId) && !getBuiltInWord(log.wordId))
      errors.push(`data.reviewLogs[${index}] 引用不存在的单词：${log.wordId}`);
  });
  const selectedDeckId = authoritativeState.appSettings.selectedDeckId;
  if (!deckIds.has(selectedDeckId) && !getBuiltInDeck(selectedDeckId)) {
    errors.push(
      `authoritativeState.appSettings.selectedDeckId 引用不存在的词库：${selectedDeckId}`,
    );
  }
}

export function validateExportPayload(input: unknown): string[] {
  if (!isRecord(input)) return ['payload 不是对象'];
  if (input.version !== EXPORT_VERSION) {
    return [`不支持的备份版本：${String(input.version)}（当前支持版本：1）`];
  }
  const errors: string[] = [];
  if (!isFiniteNumber(input.exportedAt)) errors.push('exportedAt 必须为数字');
  validateAuthoritativeState(input.authoritativeState, errors);
  if (!isRecord(input.data)) errors.push('缺少 data 字段');
  else
    for (const collection of Object.keys(ENTITY_VALIDATORS) as (keyof ExportedData)[]) {
      if (!Array.isArray(input.data[collection])) errors.push(`data.${collection} 必须为数组`);
    }
  if (errors.length === 0) validateEntities(input.data as unknown as ExportedData, errors);
  if (errors.length === 0) validateReferences(input as unknown as ExportPayload, errors);
  return errors;
}

function authoritativeRecord(payload: ExportPayload): AuthoritativeStateRecord {
  return { id: AUTHORITATIVE_STATE_ID, ...payload.authoritativeState };
}

async function resetRuntimeState(store: LocalSettingsStore): Promise<string[]> {
  try {
    await store.resetRuntimeState();
    return [];
  } catch (error) {
    return [
      `权威数据已成功更新，但临时运行状态重置失败：${error instanceof Error ? error.message : String(error)}`,
    ];
  }
}

export async function importLocalData(
  store: LocalSettingsStore,
  input: unknown,
): Promise<ImportResult> {
  const db = store.database;
  const errors = validateExportPayload(input);
  if (errors.length > 0) return { ok: false, errors, warnings: [] };
  const payload = input as ExportPayload;
  try {
    await idbReplaceAll(db, {
      [STORES.authoritativeState]: [authoritativeRecord(payload)],
      [STORES.cards]: payload.data.cards,
      [STORES.reviewLogs]: payload.data.reviewLogs,
      [STORES.sessionLogs]: payload.data.sessionLogs,
      [STORES.behaviorEvents]: payload.data.behaviorEvents,
      [STORES.words]: payload.data.words,
      [STORES.decks]: payload.data.decks,
    });
  } catch (error) {
    return {
      ok: false,
      errors: [
        `恢复事务失败，原有权威数据未改变：${error instanceof Error ? error.message : String(error)}`,
      ],
      warnings: [],
    };
  }
  return { ok: true, errors: [], warnings: await resetRuntimeState(store) };
}

export async function clearLearningProgress(
  db: IDBDatabase,
  siteBaselines: BehaviorEventRecord[] = [],
): Promise<void> {
  await idbReplaceAll(db, {
    [STORES.cards]: [],
    [STORES.reviewLogs]: [],
    [STORES.sessionLogs]: [],
    [STORES.behaviorEvents]: siteBaselines,
  });
}

export async function clearAllLocalData(store: LocalSettingsStore): Promise<DataOperationResult> {
  const db = store.database;
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
  } catch (error) {
    return {
      ok: false,
      errors: [
        `清除事务失败，原有权威数据未改变：${error instanceof Error ? error.message : String(error)}`,
      ],
      warnings: [],
    };
  }
  return { ok: true, errors: [], warnings: await resetRuntimeState(store) };
}
