import type {
  AppSettings, CardRecord, CooldownState, DeckRecord, ReviewLogRecord,
  SessionLogRecord, SiteSettings, WordRecord,
} from '@/types';
import { STORES, idbGetAll, idbReplaceAll } from '@/storage/database';
import type { LocalSettingsStore, PersistedState } from '@/storage/local-settings';
import { validateAppSettings } from '@/settings/validator';
import { DEFAULT_SETTINGS } from '@/settings/defaults';
import { getBuiltInDeck, getBuiltInWord } from '@/dictionary/built-in/decks';

export const EXPORT_VERSION = 2;
const SUPPORTED_VERSIONS = [1, EXPORT_VERSION] as const;

export interface ExportedSettings {
  appSettings: AppSettings;
  sites: Record<string, SiteSettings>;
  cooldown: CooldownState;
  onboardingCompleted: boolean;
  globalPausedUntil: number;
}

export interface ExportedData {
  cards: CardRecord[];
  reviewLogs: ReviewLogRecord[];
  sessionLogs: SessionLogRecord[];
  words: WordRecord[];
  decks: DeckRecord[];
}

export interface ExportPayload {
  version: number;
  exportedAt: number;
  settings: ExportedSettings;
  data: ExportedData;
}

export interface ImportResult { ok: boolean; errors: string[] }

export async function exportLocalData(store: LocalSettingsStore, db: IDBDatabase): Promise<ExportPayload> {
  const state = await store.read();
  const [cards, reviewLogs, sessionLogs, words, decks] = await Promise.all([
    idbGetAll<CardRecord>(db, STORES.cards),
    idbGetAll<ReviewLogRecord>(db, STORES.reviewLogs),
    idbGetAll<SessionLogRecord>(db, STORES.sessionLogs),
    idbGetAll<WordRecord>(db, STORES.words),
    idbGetAll<DeckRecord>(db, STORES.decks),
  ]);
  return {
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    settings: {
      appSettings: state.appSettings ?? DEFAULT_SETTINGS,
      sites: { ...state.sites }, cooldown: { ...state.cooldown },
      onboardingCompleted: state.onboardingCompleted,
      globalPausedUntil: state.globalPausedUntil,
    },
    data: { cards, reviewLogs, sessionLogs, words, decks },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isString(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function isNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function isNonNegative(value: unknown): value is number { return isNumber(value) && value >= 0; }
function fields(value: unknown, required: Record<string, (v: unknown) => boolean>): boolean {
  return isObject(value) && Object.entries(required).every(([key, check]) => check(value[key]));
}

function migratePayload(payload: unknown): { payload?: ExportPayload; errors: string[] } {
  if (!isObject(payload)) return { errors: ['payload 不是对象'] };
  if (!SUPPORTED_VERSIONS.includes(payload.version as 1 | 2)) {
    return { errors: [`不支持的备份版本：${String(payload.version)}（支持版本：1、2）`] };
  }
  if (payload.version === 1 && isObject(payload.data)) {
    return {
      payload: { ...payload, version: EXPORT_VERSION, data: { ...payload.data, sessionLogs: [] } } as unknown as ExportPayload,
      errors: [],
    };
  }
  return { payload: payload as unknown as ExportPayload, errors: [] };
}

function validateEntities(data: ExportedData, errors: string[]): void {
  const validators: Record<keyof ExportedData, (value: unknown) => boolean> = {
    cards: (v) => fields(v, { id: isString, wordId: isString, deckId: isString, stage: (x) => ['new', 'short-term', 'long-term', 'self-reported-known'].includes(String(x)), createdAt: isNonNegative, updatedAt: isNonNegative }),
    reviewLogs: (v) => fields(v, { id: isString, cardId: isString, wordId: isString, questionType: (x) => ['en-to-zh', 'zh-to-en', 'context-choice', 'spelling'].includes(String(x)), selectedAnswer: (x) => typeof x === 'string', correctAnswer: (x) => typeof x === 'string', isCorrect: (x) => typeof x === 'boolean', responseTimeMs: isNonNegative, reviewedAt: isNonNegative }),
    sessionLogs: (v) => fields(v, { id: isString, startedAt: isNonNegative, endedAt: isNonNegative, mode: (x) => x === 'single' || x === 'continuous', outcome: (x) => x === 'submitted' || x === 'skipped' || x === 'exit', questionsAnswered: (x) => Number.isInteger(x) && Number(x) >= 0 }) && (v as SessionLogRecord).endedAt >= (v as SessionLogRecord).startedAt,
    words: (v) => fields(v, { id: isString, word: isString, lemma: isString, partOfSpeech: (x) => Array.isArray(x) && x.length > 0 && x.every(isString), coreMeaningZh: (x) => Array.isArray(x) && x.length > 0 && x.every(isString), exampleSentence: isString, exampleTranslation: isString, difficulty: isNumber, source: isString, license: isString }),
    decks: (v) => fields(v, { id: isString, name: isString, source: isString, license: isString, wordIds: (x) => Array.isArray(x) && x.every(isString) }),
  };
  for (const collection of Object.keys(validators) as (keyof ExportedData)[]) {
    data[collection].forEach((entity, index) => {
      if (!validators[collection](entity)) errors.push(`data.${collection}[${index}] 结构非法`);
    });
  }
}

function validateReferences(payload: ExportPayload, errors: string[]): void {
  const { data, settings } = payload;
  const wordIds = new Set(data.words.map((word) => word.id));
  const deckIds = new Set(data.decks.map((deck) => deck.id));
  const cardIds = new Set(data.cards.map((card) => card.id));
  for (const [name, ids] of [
    ['words', data.words.map((record) => record.id)],
    ['decks', data.decks.map((record) => record.id)],
    ['cards', data.cards.map((record) => record.id)],
    ['reviewLogs', data.reviewLogs.map((record) => record.id)],
    ['sessionLogs', data.sessionLogs.map((record) => record.id)],
  ] as const) {
    if (new Set(ids).size !== ids.length) errors.push(`data.${name} 包含重复 id`);
  }
  if (new Set(data.cards.map((card) => card.wordId)).size !== data.cards.length) {
    errors.push('data.cards 中同一单词存在多张学习卡');
  }
  data.decks.forEach((deck, i) => deck.wordIds.forEach((id) => {
    if (!wordIds.has(id) && !getBuiltInWord(id)) errors.push(`data.decks[${i}] 引用不存在的单词：${id}`);
  }));
  data.cards.forEach((card, i) => {
    if (!wordIds.has(card.wordId) && !getBuiltInWord(card.wordId)) errors.push(`data.cards[${i}] 引用不存在的单词：${card.wordId}`);
    if (!deckIds.has(card.deckId) && !getBuiltInDeck(card.deckId)) errors.push(`data.cards[${i}] 引用不存在的词库：${card.deckId}`);
  });
  data.reviewLogs.forEach((log, i) => {
    if (!cardIds.has(log.cardId)) errors.push(`data.reviewLogs[${i}] 引用不存在的学习卡：${log.cardId}`);
    const card = data.cards.find((candidate) => candidate.id === log.cardId);
    if (card && card.wordId !== log.wordId) errors.push(`data.reviewLogs[${i}] 的单词引用与学习卡不一致`);
    if (!wordIds.has(log.wordId) && !getBuiltInWord(log.wordId)) errors.push(`data.reviewLogs[${i}] 引用不存在的单词：${log.wordId}`);
  });
  if (!deckIds.has(settings.appSettings.selectedDeckId) && !getBuiltInDeck(settings.appSettings.selectedDeckId)) {
    errors.push(`settings.appSettings.selectedDeckId 引用不存在的词库：${settings.appSettings.selectedDeckId}`);
  }
}

function validateMigratedPayload(payload: ExportPayload): string[] {
  const errors: string[] = [];
  if (!isNumber(payload.exportedAt)) errors.push('exportedAt 必须为数字');
  const s = payload.settings;
  if (!isObject(s)) return [...errors, '缺少 settings 字段'];
  if (!isObject(s.appSettings)) errors.push('缺少 settings.appSettings');
  else errors.push(...validateAppSettings(s.appSettings as unknown as Partial<AppSettings>).errors);
  if (!isObject(s.sites)) errors.push('settings.sites 必须为对象');
  else Object.entries(s.sites).forEach(([hostname, site]) => {
    if (!isString(hostname) || !fields(site, { enabled: (x) => typeof x === 'boolean', mode: (x) => ['full-adaptation', 'generic-video', 'basic-web', 'unsupported'].includes(String(x)), firstQuestionPending: (x) => typeof x === 'boolean' })) errors.push(`settings.sites.${hostname} 结构非法`);
  });
  if (!fields(s.cooldown, { nextAllowedAt: isNonNegative, consecutiveSkipCount: (x) => Number.isInteger(x) && Number(x) >= 0 })) errors.push('settings.cooldown 结构非法');
  if (typeof s.onboardingCompleted !== 'boolean') errors.push('settings.onboardingCompleted 必须为布尔值');
  if (!isNonNegative(s.globalPausedUntil)) errors.push('settings.globalPausedUntil 必须为非负数字');
  const d = payload.data;
  if (!isObject(d)) return [...errors, '缺少 data 字段'];
  for (const name of ['cards', 'reviewLogs', 'sessionLogs', 'words', 'decks'] as const) if (!Array.isArray(d[name])) errors.push(`data.${name} 必须为数组`);
  if (errors.length === 0) validateEntities(d, errors);
  if (errors.length === 0) validateReferences(payload, errors);
  return errors;
}

export function validateExportPayload(payload: unknown): string[] {
  const migrated = migratePayload(payload);
  return migrated.payload ? validateMigratedPayload(migrated.payload) : migrated.errors;
}

function asPersistedState(settings: ExportedSettings): PersistedState {
  return { cooldown: { ...settings.cooldown }, sites: { ...settings.sites }, onboardingCompleted: settings.onboardingCompleted, globalPausedUntil: settings.globalPausedUntil, appSettings: { ...settings.appSettings } };
}

async function replaceData(db: IDBDatabase, data: ExportedData): Promise<void> {
  await idbReplaceAll(db, {
    [STORES.cards]: data.cards, [STORES.reviewLogs]: data.reviewLogs,
    [STORES.sessionLogs]: data.sessionLogs, [STORES.words]: data.words, [STORES.decks]: data.decks,
  });
}

export async function importLocalData(store: LocalSettingsStore, db: IDBDatabase, input: unknown): Promise<ImportResult> {
  const migrated = migratePayload(input);
  if (!migrated.payload) return { ok: false, errors: migrated.errors };
  const errors = validateMigratedPayload(migrated.payload);
  if (errors.length) return { ok: false, errors };
  const previousSettings = await store.read();
  try {
    await store.write(asPersistedState(migrated.payload.settings));
    await replaceData(db, migrated.payload.data);
    return { ok: true, errors: [] };
  } catch (error) {
    try { await store.write(previousSettings); } catch { /* 原始错误更能说明失败原因。 */ }
    return { ok: false, errors: [`导入提交失败，原有数据未改变：${error instanceof Error ? error.message : String(error)}`] };
  }
}

export async function clearLearningProgress(db: IDBDatabase): Promise<void> {
  await idbReplaceAll(db, { [STORES.cards]: [], [STORES.reviewLogs]: [], [STORES.sessionLogs]: [] });
}

export async function clearAllLocalData(store: LocalSettingsStore, db: IDBDatabase): Promise<void> {
  const previousSettings = await store.read();
  try {
    await store.write({ cooldown: { nextAllowedAt: 0, consecutiveSkipCount: 0 }, sites: {}, onboardingCompleted: false, globalPausedUntil: 0 });
    await idbReplaceAll(db, { [STORES.cards]: [], [STORES.reviewLogs]: [], [STORES.sessionLogs]: [], [STORES.words]: [], [STORES.decks]: [] });
  } catch (error) {
    try { await store.write(previousSettings); } catch { /* 保留原始错误。 */ }
    throw error;
  }
}
