import { BuiltInWordBank } from '@/dictionary/built-in-word-bank';
import { BUILT_IN_DECK_IDS } from '@/dictionary/content-contract';
import { validateAppSettings } from '@/settings/validator';
import {
  STORES,
  STORAGE_META_ID,
  idbReplaceAll,
  markStorageMetaChanged,
  normalizeStorageMeta,
  openTrackedTransaction,
} from '@/storage/database';
import {
  AUTHORITATIVE_STATE_ID,
  DEFAULT_AUTHORITATIVE_STATE,
  copyAuthoritativeState,
  type AuthoritativeStateRecord,
  type LocalSettingsStore,
} from '@/storage/local-settings';
import type {
  AppSettings,
  BehaviorEventRecord,
  CardRecord,
  DeckRecord,
  ReviewLogRecord,
  SchedulerState,
  SessionLogRecord,
  SiteSettings,
  StorageMetaRecord,
  WordRecord,
} from '@/types';

export const EXPORT_VERSION = 1;

export interface ExportedData {
  cards: CardRecord[];
  reviewLogs: ReviewLogRecord[];
  sessionLogs: SessionLogRecord[];
  behaviorEvents: BehaviorEventRecord[];
  /** 仅用户创建或导入的内容；内置内容不进入备份。 */
  words: WordRecord[];
  decks: DeckRecord[];
}

export interface ExportPayload {
  version: 1;
  exportedAt: number;
  authoritativeState: Omit<AuthoritativeStateRecord, 'id'>;
  data: ExportedData;
}

/** 自动快照使用的一致导出；revision 与 payload 来自同一只读事务。 */
export interface ExportSnapshotBundle {
  payload: ExportPayload;
  storageMeta: StorageMetaRecord;
}

export interface DataOperationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface LocalDataValidationResult {
  ok: boolean;
  errors: string[];
  payload?: ExportPayload;
}

export type ImportResult = DataOperationResult;

/** 导入校验使用的内置内容。 */
interface BuiltInContent {
  words: WordRecord[];
  decks: DeckRecord[];
}

/** 备份校验共享词库实例，避免每次快照轮换都重新加载完整词库。 */
const validationWordBank = new BuiltInWordBank();

async function loadBuiltInContent(): Promise<BuiltInContent> {
  const [words, decks] = await Promise.all([
    validationWordBank.listWords(),
    Promise.all(BUILT_IN_DECK_IDS.map((id) => validationWordBank.getDeck(id))),
  ]);
  return {
    words,
    decks: decks.filter((deck): deck is DeckRecord => deck !== null),
  };
}

/** 导出本地用户数据快照。 */
export async function exportLocalData(store: LocalSettingsStore): Promise<ExportPayload> {
  return (await readConsistentExport(store)).payload;
}

function readRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('读取导出一致性数据失败'));
  });
}

function awaitReadTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('导出一致性事务失败'));
    transaction.onabort = () => reject(transaction.error ?? new Error('导出一致性事务已中止'));
  });
}

interface ConsistentExportRead {
  payload: ExportPayload;
  rawStorageMeta: unknown;
}

/** 在同一只读事务中读取导出 payload 与原始 storageMeta。 */
async function readConsistentExport(store: LocalSettingsStore): Promise<ConsistentExportRead> {
  const db = store.database;
  const transaction = db.transaction(
    [
      STORES.authoritativeState,
      STORES.storageMeta,
      STORES.cards,
      STORES.reviewLogs,
      STORES.sessionLogs,
      STORES.behaviorEvents,
      STORES.words,
      STORES.decks,
    ],
    'readonly',
  );
  const transactionDone = awaitReadTransaction(transaction);
  const stateRequest = transaction
    .objectStore(STORES.authoritativeState)
    .get(AUTHORITATIVE_STATE_ID);
  const metaRequest = transaction.objectStore(STORES.storageMeta).get(STORAGE_META_ID);
  const cardsRequest = transaction.objectStore(STORES.cards).getAll();
  const reviewLogsRequest = transaction.objectStore(STORES.reviewLogs).getAll();
  const sessionLogsRequest = transaction.objectStore(STORES.sessionLogs).getAll();
  const behaviorEventsRequest = transaction.objectStore(STORES.behaviorEvents).getAll();
  const wordsRequest = transaction.objectStore(STORES.words).getAll();
  const decksRequest = transaction.objectStore(STORES.decks).getAll();

  const [storedState, storedMeta, cards, reviewLogs, sessionLogs, behaviorEvents, words, decks] =
    await Promise.all([
      readRequest(stateRequest),
      readRequest(metaRequest),
      readRequest(cardsRequest),
      readRequest(reviewLogsRequest),
      readRequest(sessionLogsRequest),
      readRequest(behaviorEventsRequest),
      readRequest(wordsRequest),
      readRequest(decksRequest),
      transactionDone,
    ]);
  const state = copyAuthoritativeState(
    storedState === undefined
      ? DEFAULT_AUTHORITATIVE_STATE
      : (storedState as AuthoritativeStateRecord),
  );
  const { id: _id, ...authoritativeState } = state;

  return {
    payload: {
      version: EXPORT_VERSION,
      exportedAt: Date.now(),
      authoritativeState,
      data: {
        cards: cards as CardRecord[],
        reviewLogs: reviewLogs as ReviewLogRecord[],
        sessionLogs: sessionLogs as SessionLogRecord[],
        behaviorEvents: behaviorEvents as BehaviorEventRecord[],
        words: words as WordRecord[],
        decks: decks as DeckRecord[],
      },
    },
    rawStorageMeta: storedMeta,
  };
}

/** 自动快照必须同时取得 payload 与经过严格校验的 storageMeta。 */
export async function exportLocalDataForSnapshot(
  store: LocalSettingsStore,
): Promise<ExportSnapshotBundle> {
  const { payload, rawStorageMeta } = await readConsistentExport(store);
  return { payload, storageMeta: normalizeStorageMeta(rawStorageMeta) };
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

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
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
      origin: (candidate) => candidate === 'accepted-new' || candidate === 'self-reported',
      createdAt: isNonNegativeNumber,
      updatedAt: isNonNegativeNumber,
      nextReviewAt: (candidate) => isOptional(candidate, isNonNegativeNumber),
      shortTermStep: (candidate) =>
        isOptional(
          candidate,
          (step) => Number.isInteger(step) && Number(step) >= 0 && Number(step) <= 2,
        ),
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
        ['new', 'short-term', 'long-term', 'self-reported-known'].includes(String(candidate)),
      source: (candidate) => ['natural', 'manual', 'continuous'].includes(String(candidate)),
      rating: (candidate) => RATINGS.includes(String(candidate)),
      userCorrection: (candidate) =>
        isOptional(
          candidate,
          (correction) =>
            correction === 'guessed' || correction === 'too-easy' || correction === 'too-hard',
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
      source: (candidate) => candidate === 'natural' || candidate === 'manual',
      initialOutcome: (candidate) =>
        isOptional(candidate, (outcome) =>
          ['submitted', 'accepted-new', 'self-reported', 'skipped'].includes(String(outcome)),
        ),
      continuousQuestionsAnswered: (candidate) =>
        Number.isInteger(candidate) && Number(candidate) >= 0,
    }) && (value as SessionLogRecord).endedAt >= (value as SessionLogRecord).startedAt,
  behaviorEvents: (value) => {
    if (
      !isRecord(value) ||
      !hasFields(value, { id: isNonEmptyString, occurredAt: isNonNegativeNumber })
    ) {
      return false;
    }
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
      secondaryMeanings: (candidate) =>
        isOptional(
          candidate,
          (items) =>
            Array.isArray(items) &&
            items.every((item) =>
              hasFields(item, {
                partOfSpeech: isNonEmptyString,
                meaningZh: isNonEmptyString,
              }),
            ),
        ),
      exampleSentence: (candidate) => isOptional(candidate, (text) => typeof text === 'string'),
      exampleTranslation: (candidate) => isOptional(candidate, (text) => typeof text === 'string'),
      surfaceFormInExample: (candidate) =>
        isOptional(candidate, (text) => typeof text === 'string'),
      difficulty: (candidate) => isFiniteNumber(candidate) && candidate > 0,
      frequencyRank: isNonNegativeNumber,
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
      wordDifficulties: (candidate) =>
        isOptional(
          candidate,
          (difficulties) =>
            isRecord(difficulties) &&
            Object.values(difficulties).every(
              (difficulty) =>
                Number.isInteger(difficulty) && Number(difficulty) >= 1 && Number(difficulty) <= 4,
            ),
        ),
    }),
};

const ENTITY_KEYS: Record<keyof ExportedData, string[]> = {
  cards: [
    'id',
    'wordId',
    'deckId',
    'stage',
    'origin',
    'createdAt',
    'updatedAt',
    'nextReviewAt',
    'shortTermStep',
    'schedulerState',
    'lastWrongAt',
  ],
  reviewLogs: [
    'id',
    'cardId',
    'wordId',
    'questionType',
    'selectedAnswer',
    'correctAnswer',
    'isCorrect',
    'responseTimeMs',
    'reviewedAt',
    'stageAtSubmission',
    'source',
    'rating',
    'userCorrection',
    'answerChanges',
    'previousSchedulerState',
  ],
  sessionLogs: [
    'id',
    'startedAt',
    'endedAt',
    'mode',
    'outcome',
    'questionsAnswered',
    'source',
    'initialOutcome',
    'continuousQuestionsAnswered',
  ],
  behaviorEvents: [
    'id',
    'kind',
    'occurredAt',
    'hostname',
    'enabled',
    'baseline',
    'action',
    'pausedUntil',
  ],
  words: [
    'id',
    'word',
    'lemma',
    'phonetic',
    'partOfSpeech',
    'coreMeaningZh',
    'secondaryMeanings',
    'exampleSentence',
    'exampleTranslation',
    'surfaceFormInExample',
    'difficulty',
    'frequencyRank',
    'source',
    'license',
  ],
  decks: ['id', 'name', 'description', 'source', 'license', 'wordIds', 'wordDifficulties'],
};

function validateAuthoritativeState(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push('缺少 authoritativeState 字段');
    return;
  }
  if (!hasOnlyKeys(value, ['appSettings', 'sites', 'onboardingCompleted'])) {
    errors.push('authoritativeState 包含未知字段');
  }
  if (!isRecord(value.appSettings)) errors.push('authoritativeState.appSettings 结构非法');
  else errors.push(...validateAppSettings(value.appSettings as Partial<AppSettings>).errors);
  if (typeof value.onboardingCompleted !== 'boolean') {
    errors.push('authoritativeState.onboardingCompleted 必须为布尔值');
  }
  if (!isRecord(value.sites)) errors.push('authoritativeState.sites 结构非法');
  else {
    Object.entries(value.sites).forEach(([hostname, settings]) => {
      if (!isNonEmptyString(hostname) || !isSiteSettings(settings)) {
        errors.push(`authoritativeState.sites.${hostname} 结构非法`);
      }
    });
  }
}

function validateEntities(data: ExportedData, errors: string[]): void {
  for (const collection of Object.keys(ENTITY_VALIDATORS) as (keyof ExportedData)[]) {
    data[collection].forEach((entity, index) => {
      if (
        !ENTITY_VALIDATORS[collection](entity) ||
        !isRecord(entity) ||
        !hasOnlyKeys(entity, ENTITY_KEYS[collection])
      ) {
        errors.push(`data.${collection}[${index}] 结构非法`);
      }
    });
  }
}

function validateBaseReferences(
  data: ExportedData,
  authoritativeState: Omit<AuthoritativeStateRecord, 'id'>,
  builtIn: BuiltInContent,
  errors: string[],
): void {
  const userWordIds = new Set(data.words.map(({ id }) => id));
  const builtInWordIds = new Set(builtIn.words.map(({ id }) => id));
  const allWordIds = new Set([...userWordIds, ...builtInWordIds]);
  const customDecksById = new Map(data.decks.map((deck) => [deck.id, deck]));
  const builtInDecksById = new Map(builtIn.decks.map((deck) => [deck.id, deck]));
  const allDeckIds = new Set([...customDecksById.keys(), ...builtInDecksById.keys()]);
  const cardsById = new Map(data.cards.map((card) => [card.id, card]));

  data.words.forEach(({ id }, index) => {
    if (builtInWordIds.has(id)) errors.push(`data.words[${index}] 与内置单词 id 冲突：${id}`);
  });
  data.decks.forEach(({ id }, index) => {
    if (builtInDecksById.has(id)) errors.push(`data.decks[${index}] 与内置词库 id 冲突：${id}`);
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

  data.decks.forEach((deck, index) => {
    if (new Set(deck.wordIds).size !== deck.wordIds.length) {
      errors.push(`data.decks[${index}] 包含重复 wordId`);
    }
    deck.wordIds.forEach((wordId) => {
      if (!allWordIds.has(wordId)) {
        errors.push(`data.decks[${index}] 引用不存在的单词：${wordId}`);
      }
    });
  });

  data.cards.forEach((card, index) => {
    const deck = customDecksById.get(card.deckId) ?? builtInDecksById.get(card.deckId);
    if (!deck) {
      errors.push(`data.cards[${index}] 引用不存在的词库：${card.deckId}`);
    }
    if (!allWordIds.has(card.wordId)) {
      errors.push(`data.cards[${index}] 引用不存在的单词：${card.wordId}`);
    }
    if (deck && !deck.wordIds.includes(card.wordId)) {
      errors.push(`data.cards[${index}] 的单词不属于引用的词库`);
    }
  });

  data.reviewLogs.forEach((log, index) => {
    const card = cardsById.get(log.cardId);
    if (!card) {
      errors.push(`data.reviewLogs[${index}] 引用不存在的学习卡：${log.cardId}`);
      return;
    }
    if (card.wordId !== log.wordId) {
      errors.push(`data.reviewLogs[${index}] 的单词引用与学习卡不一致`);
    }
    if (!allWordIds.has(log.wordId)) {
      errors.push(`data.reviewLogs[${index}] 引用不存在的单词：${log.wordId}`);
    }
  });

  if (!allDeckIds.has(authoritativeState.appSettings.selectedDeckId)) {
    errors.push(
      `authoritativeState.appSettings.selectedDeckId 引用不存在的词库：${authoritativeState.appSettings.selectedDeckId}`,
    );
  }
}

function validateTopLevel(input: Record<string, unknown>, errors: string[]): void {
  if (!hasOnlyKeys(input, ['version', 'exportedAt', 'authoritativeState', 'data'])) {
    errors.push('备份包含未知字段');
  }
  if (!isFiniteNumber(input.exportedAt)) errors.push('exportedAt 必须为数字');
  validateAuthoritativeState(input.authoritativeState, errors);
  if (!isRecord(input.data)) {
    errors.push('缺少 data 字段');
    return;
  }
  if (!hasOnlyKeys(input.data, Object.keys(ENTITY_VALIDATORS))) {
    errors.push('data 包含未知字段');
  }
  for (const collection of Object.keys(ENTITY_VALIDATORS) as (keyof ExportedData)[]) {
    if (!Array.isArray(input.data[collection])) errors.push(`data.${collection} 必须为数组`);
  }
}

async function parseAndValidateBackup(input: unknown): Promise<LocalDataValidationResult> {
  if (!isRecord(input)) return { ok: false, errors: ['payload 不是对象'] };
  if (input.version !== EXPORT_VERSION) {
    return {
      ok: false,
      errors: ['备份格式无效'],
    };
  }

  const errors: string[] = [];
  validateTopLevel(input, errors);
  if (errors.length > 0) return { ok: false, errors };

  const payload = input as unknown as ExportPayload;
  validateEntities(payload.data, errors);
  if (errors.length > 0) return { ok: false, errors };

  let builtIn: BuiltInContent;
  try {
    builtIn = await loadBuiltInContent();
  } catch (error) {
    return {
      ok: false,
      errors: [
        `词库加载失败，无法校验备份：${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }

  validateBaseReferences(payload.data, payload.authoritativeState, builtIn, errors);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [], payload };
}

/** 只校验本地数据，不改变 IndexedDB 或运行状态。 */
export function validateLocalData(input: unknown): Promise<LocalDataValidationResult> {
  return parseAndValidateBackup(input);
}

function authoritativeRecord(payload: {
  authoritativeState: Omit<AuthoritativeStateRecord, 'id'>;
}) {
  return { ...payload.authoritativeState, id: AUTHORITATIVE_STATE_ID };
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
  const parsed = await parseAndValidateBackup(input);
  if (!parsed.ok || !parsed.payload) {
    return { ok: false, errors: parsed.errors, warnings: [] };
  }
  const { payload } = parsed;
  try {
    await idbReplaceAll(
      store.database,
      {
        [STORES.authoritativeState]: [authoritativeRecord(payload)],
        [STORES.cards]: payload.data.cards,
        [STORES.reviewLogs]: payload.data.reviewLogs,
        [STORES.sessionLogs]: payload.data.sessionLogs,
        [STORES.behaviorEvents]: payload.data.behaviorEvents,
        [STORES.words]: payload.data.words,
        [STORES.decks]: payload.data.decks,
      },
      { rotateGeneration: true },
    );
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

/** 清除学习进度：卡、日志、会话和行为事件在同一事务内清空。 */
export async function clearLearningProgress(
  db: IDBDatabase,
  siteBaselines: BehaviorEventRecord[] = [],
): Promise<DataOperationResult> {
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = openTrackedTransaction(db, [
        STORES.cards,
        STORES.reviewLogs,
        STORES.sessionLogs,
        STORES.behaviorEvents,
      ]);
      try {
        markStorageMetaChanged(tx, { rotateGeneration: true });
        for (const store of [
          STORES.cards,
          STORES.reviewLogs,
          STORES.sessionLogs,
          STORES.behaviorEvents,
        ]) {
          tx.objectStore(store).clear();
        }
        for (const event of siteBaselines) tx.objectStore(STORES.behaviorEvents).put(event);
      } catch (error) {
        tx.abort();
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('清除学习进度失败'));
      tx.onabort = () => reject(tx.error ?? new Error('清除学习进度事务已中止'));
    });
  } catch (error) {
    return {
      ok: false,
      errors: [
        `清除事务失败，原有学习进度未改变：${error instanceof Error ? error.message : String(error)}`,
      ],
      warnings: [],
    };
  }
  return { ok: true, errors: [], warnings: [] };
}

export async function clearAllLocalData(store: LocalSettingsStore): Promise<DataOperationResult> {
  try {
    await idbReplaceAll(
      store.database,
      {
        [STORES.authoritativeState]: [{ ...DEFAULT_AUTHORITATIVE_STATE }],
        [STORES.cards]: [],
        [STORES.reviewLogs]: [],
        [STORES.sessionLogs]: [],
        [STORES.behaviorEvents]: [],
        [STORES.words]: [],
        [STORES.decks]: [],
      },
      { rotateGeneration: true },
    );
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
