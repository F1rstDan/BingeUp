import type {
  AppSettings,
  BehaviorEventRecord,
  CardRecord,
  DeckRecord,
  LegacyRegistry,
  ReviewLogRecord,
  SchedulerState,
  SessionLogRecord,
  SiteSettings,
  WordRecord,
} from '@/types';
import { STORES, idbDelete, idbGetAll, idbReplaceAll } from '@/storage/database';
import {
  AUTHORITATIVE_STATE_ID,
  DEFAULT_AUTHORITATIVE_STATE,
  type AuthoritativeStateRecord,
  type LocalSettingsStore,
} from '@/storage/local-settings';
import { validateAppSettings } from '@/settings/validator';
import { BuiltInWordBank } from '@/dictionary/built-in-word-bank';
import {
  CONTENT_COMPAT_ID,
  buildCompatibilityPlan,
  legacyMembership,
  resolveIdentity,
  type ContentCompatibilityRecord,
} from '@/storage/content-compat';

/** 当前导出版本。导入仍支持 v1。 */
export const EXPORT_VERSION = 2;

export interface ExportedData {
  cards: CardRecord[];
  reviewLogs: ReviewLogRecord[];
  sessionLogs: SessionLogRecord[];
  behaviorEvents: BehaviorEventRecord[];
  /** 仅用户创建/导入的内容；内置内容不导出。 */
  words: WordRecord[];
  decks: DeckRecord[];
}

export interface ExportPayloadV1 {
  version: 1;
  exportedAt: number;
  authoritativeState: Omit<AuthoritativeStateRecord, 'id'>;
  data: ExportedData;
}

export interface ExportContentIdentity {
  version: string;
  registryVersion: string | null;
  registryHash: string | null;
}

export interface ExportPayloadV2 {
  version: 2;
  exportedAt: number;
  authoritativeState: Omit<AuthoritativeStateRecord, 'id'>;
  content: ExportContentIdentity;
  compatibility: ContentCompatibilityRecord | null;
  data: ExportedData;
}

export type ExportPayload = ExportPayloadV1 | ExportPayloadV2;

export interface DataOperationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}
export type ImportResult = DataOperationResult;

interface BuiltInContent {
  contentVersion: string;
  contentKind: 'legacy-v1' | 'content-v2';
  registry: LegacyRegistry | null;
  /** 有效内置词与全部旧身份 ID，用于拒绝自定义内容占用保留 ID。 */
  allWordIds: Set<string>;
  decksById: Map<string, DeckRecord>;
  originalMembership: Map<string, Set<string>>;
}

/** 与学习服务读取同一份运行时 JSON，不把内置词库打进备份或后台 bundle。 */
async function loadBuiltInContent(): Promise<BuiltInContent> {
  const wordBank = new BuiltInWordBank();
  const [words, decks, registry] = await Promise.all([
    wordBank.listWords(),
    Promise.all(
      ['deck-daily-high-frequency', 'deck-cet4', 'deck-cet6'].map((id) => wordBank.getDeck(id)),
    ),
    wordBank.getLegacyRegistry(),
  ]);
  const effectiveWordIds = new Set(words.map(({ id }) => id));
  const allWordIds = new Set(effectiveWordIds);
  for (const entry of registry?.entries ?? []) {
    allWordIds.add(entry.legacyId);
    allWordIds.add(entry.canonicalId);
  }
  return {
    contentVersion: wordBank.getContentVersion(),
    contentKind: wordBank.getContentKind(),
    registry,
    allWordIds,
    decksById: new Map(
      decks.filter((deck): deck is DeckRecord => deck !== null).map((deck) => [deck.id, deck]),
    ),
    originalMembership: registry ? legacyMembership(registry) : new Map(),
  };
}

export async function exportLocalData(store: LocalSettingsStore): Promise<ExportPayload> {
  const db = store.database;
  const [state, cards, reviewLogs, sessionLogs, behaviorEvents, words, decks, compatibility] =
    await Promise.all([
      store.getAuthoritativeState(),
      idbGetAll<CardRecord>(db, STORES.cards),
      idbGetAll<ReviewLogRecord>(db, STORES.reviewLogs),
      idbGetAll<SessionLogRecord>(db, STORES.sessionLogs),
      idbGetAll<BehaviorEventRecord>(db, STORES.behaviorEvents),
      idbGetAll<WordRecord>(db, STORES.words),
      idbGetAll<DeckRecord>(db, STORES.decks),
      idbGetAll<ContentCompatibilityRecord>(db, STORES.authoritativeState).then(
        (records) => records.find((record) => record.id === CONTENT_COMPAT_ID) ?? null,
      ),
    ]);
  const { id: _id, ...authoritativeState } = state;
  const builtIn = await loadBuiltInContent();
  const exportedAt = Date.now();
  const compat: ContentCompatibilityRecord | null =
    builtIn.contentKind !== 'content-v2'
      ? null
      : (compatibility ??
        (builtIn.registry
          ? {
              id: CONTENT_COMPAT_ID,
              schemaVersion: 1,
              contentVersion: builtIn.contentVersion,
              registryVersion: builtIn.registry.registryVersion,
              registryHash: builtIn.registry.registryHash,
              completedAt: exportedAt,
              originals: [],
              merges: [],
              deactivatedCardIds: [],
            }
          : null));
  return {
    version: 2,
    exportedAt,
    authoritativeState,
    content: {
      version: builtIn.contentVersion,
      registryVersion: builtIn.registry?.registryVersion ?? null,
      registryHash: builtIn.registry?.registryHash ?? null,
    },
    compatibility: compat,
    data: {
      cards,
      reviewLogs,
      sessionLogs,
      behaviorEvents,
      words: words.filter(({ id }) => !builtIn.allWordIds.has(id)),
      decks: decks.filter(({ id }) => !builtIn.decksById.has(id)),
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
      disabled: (candidate) => isOptional(candidate, (flag) => typeof flag === 'boolean'),
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

function validateBaseReferences(
  data: ExportedData,
  authoritativeState: Omit<AuthoritativeStateRecord, 'id'>,
  builtIn: BuiltInContent,
  errors: string[],
): void {
  const wordIds = new Set(data.words.map(({ id }) => id));
  const deckIds = new Set(data.decks.map(({ id }) => id));
  const cardsById = new Map(data.cards.map((card) => [card.id, card]));
  data.words.forEach(({ id }, index) => {
    if (builtIn.allWordIds.has(id)) errors.push(`data.words[${index}] 与内置单词 id 冲突：${id}`);
  });
  data.decks.forEach(({ id }, index) => {
    if (builtIn.decksById.has(id)) errors.push(`data.decks[${index}] 与内置词库 id 冲突：${id}`);
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
  data.decks.forEach((deck, index) =>
    deck.wordIds.forEach((wordId) => {
      if (!wordIds.has(wordId) && !builtIn.allWordIds.has(wordId))
        errors.push(`data.decks[${index}] 引用不存在的单词：${wordId}`);
    }),
  );
  data.cards.forEach((card, index) => {
    if (!wordIds.has(card.wordId) && !builtIn.allWordIds.has(card.wordId))
      errors.push(`data.cards[${index}] 引用不存在的单词：${card.wordId}`);
    if (!deckIds.has(card.deckId) && !builtIn.decksById.has(card.deckId))
      errors.push(`data.cards[${index}] 引用不存在的词库：${card.deckId}`);
    const customDeck = data.decks.find((deck) => deck.id === card.deckId);
    if (customDeck) {
      const canonical = (wordId: string) =>
        builtIn.registry
          ? (resolveIdentity(builtIn.registry, wordId)?.canonicalId ?? wordId)
          : wordId;
      if (!customDeck.wordIds.map(canonical).includes(canonical(card.wordId))) {
        errors.push(`data.cards[${index}] 的单词不属于引用的自定义词库`);
      }
    }
  });
  data.reviewLogs.forEach((log, index) => {
    const card = cardsById.get(log.cardId);
    if (!card) errors.push(`data.reviewLogs[${index}] 引用不存在的学习卡：${log.cardId}`);
    else if (card.wordId !== log.wordId)
      errors.push(`data.reviewLogs[${index}] 的单词引用与学习卡不一致`);
    if (!wordIds.has(log.wordId) && !builtIn.allWordIds.has(log.wordId))
      errors.push(`data.reviewLogs[${index}] 引用不存在的单词：${log.wordId}`);
  });
  const selectedDeckId = authoritativeState.appSettings.selectedDeckId;
  if (!deckIds.has(selectedDeckId) && !builtIn.decksById.has(selectedDeckId)) {
    errors.push(
      `authoritativeState.appSettings.selectedDeckId 引用不存在的词库：${selectedDeckId}`,
    );
  }
}

/** v1 先按冻结原成员关系检查，不允许先映射再洗白非法引用。 */
function validateV1Membership(data: ExportedData, builtIn: BuiltInContent, errors: string[]): void {
  for (const [index, card] of data.cards.entries()) {
    const deck = builtIn.decksById.get(card.deckId);
    if (!deck) continue;
    const original = builtIn.originalMembership.get(card.deckId);
    if (original && !original.has(card.wordId)) {
      errors.push(`data.cards[${index}] 的单词不属于原词库：${card.wordId}`);
    } else if (!original && !deck.wordIds.includes(card.wordId)) {
      errors.push(`data.cards[${index}] 的单词不属于引用的词库`);
    }
  }
}

function validateV2Compatibility(
  payload: ExportPayloadV2,
  builtIn: BuiltInContent,
  errors: string[],
): void {
  const compat = payload.compatibility;
  if (!compat) {
    if (builtIn.registry) errors.push('v2 备份缺少兼容记录');
    return;
  }
  if (compat.id !== CONTENT_COMPAT_ID || compat.schemaVersion !== 1) {
    errors.push('兼容记录版本不支持');
  }
  if (compat.contentVersion !== builtIn.contentVersion) {
    errors.push(`兼容记录内容版本不一致：${compat.contentVersion}`);
  }
  if (builtIn.registry) {
    if (compat.registryVersion !== builtIn.registry.registryVersion) {
      errors.push('兼容记录注册表版本不一致');
    }
    if (compat.registryHash !== builtIn.registry.registryHash) {
      errors.push('兼容记录注册表哈希不一致');
    }
  }
  if (
    !Array.isArray(compat.originals) ||
    !Array.isArray(compat.merges) ||
    !Array.isArray(compat.deactivatedCardIds)
  ) {
    errors.push('兼容记录结构非法');
    return;
  }
  const cardsById = new Map(payload.data.cards.map((card) => [card.id, card]));
  const logIds = new Set(payload.data.reviewLogs.map((log) => log.id));
  const originalCardIds = new Set<string>();
  for (const original of compat.originals) {
    if (
      !isRecord(original) ||
      !isRecord(original.card) ||
      !isNonEmptyString(original.card.id) ||
      !isNonEmptyString(original.canonicalWordId) ||
      !Array.isArray(original.reviewLogIds) ||
      !original.reviewLogIds.every(isNonEmptyString)
    ) {
      errors.push('兼容记录原卡结构非法');
      continue;
    }
    if (originalCardIds.has(original.card.id)) {
      errors.push(`兼容记录原卡重复：${original.card.id}`);
    }
    originalCardIds.add(original.card.id);
    if (!builtIn.registry) continue;
    const resolved = resolveIdentity(builtIn.registry, original.card.wordId);
    if (!resolved || resolved.canonicalId !== original.canonicalWordId) {
      errors.push(`兼容记录原卡身份无法解释：${original.card.id}`);
    }
    for (const logId of original.reviewLogIds ?? []) {
      if (!logIds.has(logId)) errors.push(`兼容记录引用不存在的日志：${logId}`);
    }
  }
  for (const merge of compat.merges) {
    if (
      !isRecord(merge) ||
      !isNonEmptyString(merge.fromCardId) ||
      !isNonEmptyString(merge.toCardId)
    ) {
      errors.push('兼容合并记录结构非法');
      continue;
    }
    if (!cardsById.has(merge.toCardId)) errors.push(`兼容合并目标不存在：${merge.toCardId}`);
  }
  for (const cardId of compat.deactivatedCardIds) {
    if (!isNonEmptyString(cardId)) {
      errors.push('停用卡引用结构非法');
      continue;
    }
    const card = cardsById.get(cardId);
    if (!card) errors.push(`停用卡不存在：${cardId}`);
    else if (!card.disabled) errors.push(`停用卡未标记 disabled：${cardId}`);
  }
}

function validateCardUniqueness(cards: CardRecord[], errors: string[]): void {
  if (new Set(cards.map(({ wordId }) => wordId)).size !== cards.length) {
    errors.push('data.cards 中同一单词存在多张学习卡');
  }
}

function normalizeCustomDecks(decks: DeckRecord[], registry: LegacyRegistry | null): DeckRecord[] {
  return decks.map((deck) => {
    if (!registry) return deck;
    const seen = new Set<string>();
    const wordIds: string[] = [];
    for (const wordId of deck.wordIds) {
      const mapped = resolveIdentity(registry, wordId)?.canonicalId ?? wordId;
      if (seen.has(mapped)) continue;
      seen.add(mapped);
      wordIds.push(mapped);
    }
    return { ...deck, wordIds };
  });
}

interface ParsedBackup {
  ok: boolean;
  errors: string[];
  payload?: ExportPayloadV1 | ExportPayloadV2;
  normalized?: {
    authoritativeState: Omit<AuthoritativeStateRecord, 'id'>;
    data: ExportedData;
    compatibility: ContentCompatibilityRecord | null;
  };
  builtIn?: BuiltInContent;
}

async function parseAndValidateBackup(input: unknown): Promise<ParsedBackup> {
  if (!isRecord(input)) return { ok: false, errors: ['payload 不是对象'] };
  const version = input.version;
  if (version !== 1 && version !== 2) {
    return {
      ok: false,
      errors: [`不支持的备份版本：${String(version)}（当前支持版本：1、2）`],
    };
  }
  const errors: string[] = [];
  if (!isFiniteNumber(input.exportedAt)) errors.push('exportedAt 必须为数字');
  validateAuthoritativeState(input.authoritativeState, errors);
  if (!isRecord(input.data)) errors.push('缺少 data 字段');
  else {
    for (const collection of Object.keys(ENTITY_VALIDATORS) as (keyof ExportedData)[]) {
      if (!Array.isArray(input.data[collection])) errors.push(`data.${collection} 必须为数组`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const payload = input as unknown as ExportPayloadV1 | ExportPayloadV2;
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
  if (payload.version === 2) {
    if (!isRecord(payload.content) || !isNonEmptyString(payload.content.version)) {
      errors.push('v2 备份缺少内容版本');
    } else if (payload.content.version !== builtIn.contentVersion) {
      errors.push(
        `备份内容版本与当前词库不一致：${payload.content.version} / ${builtIn.contentVersion}`,
      );
    }
    if (isRecord(payload.content)) {
      if (payload.content.registryVersion !== (builtIn.registry?.registryVersion ?? null)) {
        errors.push('备份注册表版本与当前词库不一致');
      }
      if (payload.content.registryHash !== (builtIn.registry?.registryHash ?? null)) {
        errors.push('备份注册表哈希与当前词库不一致');
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors, builtIn };

  if (payload.version === 1) {
    validateV1Membership(payload.data, builtIn, errors);
    validateCardUniqueness(payload.data.cards, errors);
    if (errors.length > 0) return { ok: false, errors, builtIn };
    const normalizedDecks = normalizeCustomDecks(payload.data.decks, builtIn.registry);
    let data: ExportedData = { ...payload.data, decks: normalizedDecks };
    let compatibility: ContentCompatibilityRecord | null = null;
    if (builtIn.registry) {
      const plan = buildCompatibilityPlan({
        cards: payload.data.cards,
        logs: payload.data.reviewLogs,
        registry: builtIn.registry,
        contentVersion: builtIn.contentVersion,
        now: Date.now(),
      });
      data = { ...data, cards: plan.cards, reviewLogs: plan.logs };
      compatibility = plan.record;
    }
    validateCardUniqueness(data.cards, errors);
    validateV2CardMembership(data, builtIn, errors);
    if (errors.length > 0) return { ok: false, errors, builtIn };
    return {
      ok: true,
      errors: [],
      payload,
      builtIn,
      normalized: { authoritativeState: payload.authoritativeState, data, compatibility },
    };
  }

  validateV2Compatibility(payload as ExportPayloadV2, builtIn, errors);
  validateCardUniqueness(payload.data.cards, errors);
  validateV2CardMembership(payload.data, builtIn, errors);
  if (errors.length > 0) return { ok: false, errors, builtIn };
  return {
    ok: true,
    errors: [],
    payload,
    builtIn,
    normalized: {
      authoritativeState: payload.authoritativeState,
      data: payload.data,
      compatibility: (payload as ExportPayloadV2).compatibility,
    },
  };
}

/** 规范化后的引用检查：内置卡必须仍属于当前词库；停用卡按原关系保留。 */
function validateV2CardMembership(
  data: ExportedData,
  builtIn: BuiltInContent,
  errors: string[],
): void {
  data.cards.forEach((card, index) => {
    const deck = builtIn.decksById.get(card.deckId);
    if (!deck) return;
    if (deck.wordIds.includes(card.wordId)) return;
    const original = builtIn.originalMembership.get(card.deckId);
    if (card.disabled && original?.has(card.wordId)) return;
    errors.push(`data.cards[${index}] 的单词不属于引用的词库`);
  });
}

export async function validateExportPayload(input: unknown): Promise<string[]> {
  const parsed = await parseAndValidateBackup(input);
  return parsed.errors;
}

function authoritativeRecord(payload: {
  authoritativeState: Omit<AuthoritativeStateRecord, 'id'>;
}) {
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
  const parsed = await parseAndValidateBackup(input);
  if (!parsed.ok || !parsed.normalized) {
    return { ok: false, errors: parsed.errors, warnings: [] };
  }
  const { normalized } = parsed;
  const authoritativeState = [
    authoritativeRecord({ authoritativeState: normalized.authoritativeState }),
    ...(normalized.compatibility ? [normalized.compatibility] : []),
  ];
  try {
    await idbReplaceAll(store.database, {
      [STORES.authoritativeState]: authoritativeState,
      [STORES.cards]: normalized.data.cards,
      [STORES.reviewLogs]: normalized.data.reviewLogs,
      [STORES.sessionLogs]: normalized.data.sessionLogs,
      [STORES.behaviorEvents]: normalized.data.behaviorEvents,
      [STORES.words]: normalized.data.words,
      [STORES.decks]: normalized.data.decks,
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

/** 清除学习进度：卡、日志、会话、行为事件和兼容记录在同一事务内清空。 */
export async function clearLearningProgress(
  db: IDBDatabase,
  siteBaselines: BehaviorEventRecord[] = [],
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
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
      for (const store of [
        STORES.cards,
        STORES.reviewLogs,
        STORES.sessionLogs,
        STORES.behaviorEvents,
      ]) {
        tx.objectStore(store).clear();
      }
      for (const event of siteBaselines) tx.objectStore(STORES.behaviorEvents).put(event);
      tx.objectStore(STORES.authoritativeState).delete(CONTENT_COMPAT_ID);
    } catch (error) {
      tx.abort();
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('清除学习进度失败'));
    tx.onabort = () => reject(tx.error ?? new Error('清除学习进度事务已中止'));
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

/** 清除兼容记录；供测试或故障恢复显式调用。 */
export async function clearContentCompatibility(db: IDBDatabase): Promise<void> {
  await idbDelete(db, STORES.authoritativeState, CONTENT_COMPAT_ID);
}
