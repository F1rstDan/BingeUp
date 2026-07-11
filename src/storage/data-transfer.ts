import type {
  AppSettings,
  CardRecord,
  CooldownState,
  DeckRecord,
  ReviewLogRecord,
  SiteSettings,
  WordRecord,
} from '@/types';
import { STORES, idbClear, idbGetAll, idbPut } from '@/storage/database';
import type { LocalSettingsStore, PersistedState } from '@/storage/local-settings';
import { normalizeAppSettings, validateAppSettings } from '@/settings/validator';
import { DEFAULT_SETTINGS } from '@/settings/defaults';

/**
 * 本地数据导出/导入/清除（Issue #10 AC4）。
 *
 * 设计要点：
 * - 导出包含可恢复的完整本地数据（chrome.storage.local 状态 + IDB 全部仓库）；
 * - 导入先校验 payload 结构与字段，校验通过才写入，避免污染目标环境；
 * - 清除学习进度只清空 cards/reviewLogs，保留设置与词库；
 * - 清除全部数据重置 IDB 全部仓库与 chrome.storage.local 状态。
 */

/** 当前导出格式版本。 */
export const EXPORT_VERSION = 1;

/** 导出 payload 的设置区（对应 PersistedState）。 */
export interface ExportedSettings {
  appSettings: AppSettings;
  sites: Record<string, SiteSettings>;
  cooldown: CooldownState;
  onboardingCompleted: boolean;
  globalPausedUntil: number;
}

/** 导出 payload 的数据区（IDB 全部仓库）。 */
export interface ExportedData {
  cards: CardRecord[];
  reviewLogs: ReviewLogRecord[];
  words: WordRecord[];
  decks: DeckRecord[];
}

/** 完整导出 payload。 */
export interface ExportPayload {
  version: number;
  exportedAt: number;
  settings: ExportedSettings;
  data: ExportedData;
}

/** 导入结果。 */
export interface ImportResult {
  ok: boolean;
  errors: string[];
}

/**
 * 导出本地全部数据为可恢复 payload。
 */
export async function exportLocalData(
  store: LocalSettingsStore,
  db: IDBDatabase,
): Promise<ExportPayload> {
  const state = await store.read();
  const [cards, reviewLogs, words, decks] = await Promise.all([
    idbGetAll<CardRecord>(db, STORES.cards),
    idbGetAll<ReviewLogRecord>(db, STORES.reviewLogs),
    idbGetAll<WordRecord>(db, STORES.words),
    idbGetAll<DeckRecord>(db, STORES.decks),
  ]);

  const appSettings = state.appSettings ?? DEFAULT_SETTINGS;

  return {
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    settings: {
      appSettings,
      sites: { ...state.sites },
      cooldown: { ...state.cooldown },
      onboardingCompleted: state.onboardingCompleted,
      globalPausedUntil: state.globalPausedUntil,
    },
    data: { cards, reviewLogs, words, decks },
  };
}

/**
 * 校验导入 payload（先校验再写入，AC4）。
 * 返回错误列表；空列表表示合法。
 */
export function validateExportPayload(payload: unknown): string[] {
  const errors: string[] = [];
  if (typeof payload !== 'object' || payload === null) {
    return ['payload 不是对象'];
  }
  const p = payload as Partial<ExportPayload>;
  if (p.version !== EXPORT_VERSION) {
    errors.push(`版本不匹配：期望 ${EXPORT_VERSION}，实际 ${String(p.version)}`);
  }
  const s = p.settings as Partial<ExportedSettings> | undefined;
  if (!s) {
    errors.push('缺少 settings 字段');
  } else {
    if (s.appSettings === undefined) {
      errors.push('缺少 settings.appSettings');
    } else {
      const v = validateAppSettings(s.appSettings as Partial<AppSettings>);
      if (!v.valid) errors.push(...v.errors);
    }
    if (typeof s.onboardingCompleted !== 'boolean') {
      errors.push('settings.onboardingCompleted 必须为布尔值');
    }
    if (typeof s.globalPausedUntil !== 'number') {
      errors.push('settings.globalPausedUntil 必须为数字');
    }
    if (
      !s.cooldown ||
      typeof s.cooldown.nextAllowedAt !== 'number' ||
      typeof s.cooldown.consecutiveSkipCount !== 'number'
    ) {
      errors.push('settings.cooldown 结构非法');
    }
    if (typeof s.sites !== 'object' || s.sites === null) {
      errors.push('settings.sites 必须为对象');
    }
  }
  const d = p.data as Partial<ExportedData> | undefined;
  if (!d) {
    errors.push('缺少 data 字段');
  } else {
    if (!Array.isArray(d.cards)) errors.push('data.cards 必须为数组');
    if (!Array.isArray(d.reviewLogs)) errors.push('data.reviewLogs 必须为数组');
    if (!Array.isArray(d.words)) errors.push('data.words 必须为数组');
    if (!Array.isArray(d.decks)) errors.push('data.decks 必须为数组');
  }
  return errors;
}

/**
 * 导入本地数据：先校验，校验通过才写入（AC4）。
 * 写入前清空 IDB 数据仓库，确保导出→导入往返可恢复原始状态。
 */
export async function importLocalData(
  store: LocalSettingsStore,
  db: IDBDatabase,
  payload: unknown,
): Promise<ImportResult> {
  const errors = validateExportPayload(payload);
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const p = payload as ExportPayload;

  // 写入设置区：构造完整 PersistedState 并落盘（store.write 替换整个状态）。
  const nextState: PersistedState = {
    cooldown: { ...p.settings.cooldown },
    sites: { ...p.settings.sites },
    onboardingCompleted: p.settings.onboardingCompleted,
    globalPausedUntil: p.settings.globalPausedUntil,
    appSettings: normalizeAppSettings(p.settings.appSettings),
  };
  await store.write(nextState);

  // 清空 IDB 数据仓库后写入导入数据，确保往返可恢复。
  await Promise.all([
    idbClear(db, STORES.cards),
    idbClear(db, STORES.reviewLogs),
    idbClear(db, STORES.words),
    idbClear(db, STORES.decks),
  ]);
  await Promise.all([
    ...p.data.cards.map((c) => idbPut(db, STORES.cards, c)),
    ...p.data.reviewLogs.map((l) => idbPut(db, STORES.reviewLogs, l)),
    ...p.data.words.map((w) => idbPut(db, STORES.words, w)),
    ...p.data.decks.map((d) => idbPut(db, STORES.decks, d)),
  ]);

  return { ok: true, errors: [] };
}

/**
 * 清除学习进度：只清空 cards 与 reviewLogs，保留设置、词库与单词（AC4）。
 */
export async function clearLearningProgress(db: IDBDatabase): Promise<void> {
  await Promise.all([idbClear(db, STORES.cards), idbClear(db, STORES.reviewLogs)]);
}

/**
 * 清除全部本地数据：重置 IDB 全部仓库与 chrome.storage.local 状态（AC4）。
 */
export async function clearAllLocalData(
  store: LocalSettingsStore,
  db: IDBDatabase,
): Promise<void> {
  await Promise.all([
    idbClear(db, STORES.cards),
    idbClear(db, STORES.reviewLogs),
    idbClear(db, STORES.words),
    idbClear(db, STORES.decks),
  ]);
  await store.write({
    cooldown: { nextAllowedAt: 0, consecutiveSkipCount: 0 },
    sites: {},
    onboardingCompleted: false,
    globalPausedUntil: 0,
  });
}
