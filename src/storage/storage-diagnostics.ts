import {
  DATABASE_NAME,
  DATABASE_VERSION,
  STORES,
  readStorageMeta,
  type StoreName,
} from '@/storage/database';
import { inspectRecoverySnapshot, inspectStorageHealth } from '@/storage/recovery-snapshot';
import type { LocalSettingsStore } from '@/storage/local-settings';
import { readStorageCapacity } from '@/storage/storage-capacity';
import type {
  CardRecord,
  StorageCapacityDiagnostic,
  StorageCardStages,
  StorageCounts,
  StorageDiagnostics,
  StorageHealth,
  StorageStartupRecord,
} from '@/types';

export const STORAGE_DIAGNOSTICS_KEY = 'bingeup:storage-diagnostics';

const MAX_STARTUP_HISTORY = 10;

interface DiagnosticsState {
  version: 1;
  history: StorageStartupRecord[];
}

function emptyState(): DiagnosticsState {
  return { version: 1, history: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeStartupRecord(value: unknown): StorageStartupRecord | null {
  if (!isRecord(value)) return null;
  if (typeof value.startedAt !== 'number' || typeof value.restoredFromSnapshot !== 'boolean') {
    return null;
  }
  return value as unknown as StorageStartupRecord;
}

function normalizeState(value: unknown): DiagnosticsState {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.history)) {
    return emptyState();
  }
  return {
    version: 1,
    history: value.history
      .map(normalizeStartupRecord)
      .filter((record): record is StorageStartupRecord => record !== null)
      .slice(0, MAX_STARTUP_HISTORY),
  };
}

async function readState(): Promise<DiagnosticsState> {
  const stored = await chrome.storage.local.get(STORAGE_DIAGNOSTICS_KEY);
  return normalizeState(stored[STORAGE_DIAGNOSTICS_KEY]);
}

async function writeState(state: DiagnosticsState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_DIAGNOSTICS_KEY]: state });
}

/** 串行化诊断状态读改写，避免并发启动记录互相覆盖。 */
let diagnosticsQueue: Promise<void> = Promise.resolve();

function enqueue(update: () => Promise<void>): Promise<void> {
  const next = diagnosticsQueue.then(update);
  diagnosticsQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next.catch((error) => {
    console.error('[BingeUp] 存档诊断记录失败', error);
  });
}

async function updateCurrentRecord(patch: Partial<StorageStartupRecord>): Promise<void> {
  const state = await readState();
  const current = state.history[0];
  if (current === undefined) return;
  state.history[0] = { ...current, ...patch };
  await writeState(state);
}

/** 每次后台启动时新增一条启动记录。 */
export function startStorageDiagnosticSession(startedAt = Date.now()): Promise<void> {
  return enqueue(async () => {
    const state = await readState();
    state.history = [
      { startedAt, restoredFromSnapshot: false, snapshotPresent: false },
      ...state.history,
    ].slice(0, MAX_STARTUP_HISTORY);
    await writeState(state);
  });
}

export function recordDatabaseOpened(databaseVersion: number): Promise<void> {
  return enqueue(() =>
    updateCurrentRecord({
      databaseOpenedAt: Date.now(),
      databaseVersion,
      databaseOpenError: undefined,
    }),
  );
}

export function recordDatabaseOpenError(error: string): Promise<void> {
  return enqueue(() => updateCurrentRecord({ databaseOpenError: error }));
}

interface StartupReadInput {
  counts: StorageCounts;
  cardStages: StorageCardStages;
  restoredFromSnapshot: boolean;
  restoreError?: string;
  restoreBeforeCounts?: StorageCounts;
  restoreAfterCounts?: StorageCounts;
  snapshotPresent: boolean;
  snapshotSavedAt?: number;
  snapshotMode?: 'full' | 'compact';
  snapshotCards?: number;
}

export function recordStartupRead(input: StartupReadInput): Promise<void> {
  return enqueue(() =>
    updateCurrentRecord({
      readAt: Date.now(),
      counts: input.counts,
      cardStages: input.cardStages,
      databaseOpenError: undefined,
      restoredFromSnapshot: input.restoredFromSnapshot,
      ...(input.restoreError ? { restoreError: input.restoreError } : {}),
      ...(input.restoreBeforeCounts === undefined
        ? {}
        : { restoreBeforeCounts: input.restoreBeforeCounts }),
      ...(input.restoreAfterCounts === undefined
        ? {}
        : { restoreAfterCounts: input.restoreAfterCounts }),
      snapshotPresent: input.snapshotPresent,
      ...(input.snapshotSavedAt === undefined ? {} : { snapshotSavedAt: input.snapshotSavedAt }),
      ...(input.snapshotMode === undefined ? {} : { snapshotMode: input.snapshotMode }),
      ...(input.snapshotCards === undefined ? {} : { snapshotCards: input.snapshotCards }),
    }),
  );
}

export function recordSnapshotSaveError(error: string): Promise<void> {
  return enqueue(() =>
    updateCurrentRecord({ snapshotSaveError: error, snapshotSaveErrorAt: Date.now() }),
  );
}

export function recordSelfReportActivity(wordId: string): Promise<void> {
  return enqueue(() =>
    updateCurrentRecord({ lastSelfReportAt: Date.now(), lastSelfReportWordId: wordId }),
  );
}

/** 读取 IndexedDB 当前各仓库的记录数。 */
export async function readStorageCounts(store: LocalSettingsStore): Promise<StorageCounts> {
  const stores: readonly StoreName[] = [
    STORES.cards,
    STORES.reviewLogs,
    STORES.sessionLogs,
    STORES.behaviorEvents,
    STORES.words,
    STORES.decks,
  ];
  const transaction = store.database.transaction(stores, 'readonly');
  const count = (name: StoreName) =>
    new Promise<number>((resolve, reject) => {
      const request = transaction.objectStore(name).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('读取仓库记录数失败'));
    });
  const [cards, reviewLogs, sessionLogs, behaviorEvents, words, decks] = await Promise.all([
    count(STORES.cards),
    count(STORES.reviewLogs),
    count(STORES.sessionLogs),
    count(STORES.behaviorEvents),
    count(STORES.words),
    count(STORES.decks),
  ]);
  return { cards, reviewLogs, sessionLogs, behaviorEvents, words, decks };
}

/** 读取学习卡阶段分布，便于确认“我认识”是否真的写入了学习卡。 */
export async function readCardStages(store: LocalSettingsStore): Promise<StorageCardStages> {
  const transaction = store.database.transaction(STORES.cards, 'readonly');
  const cards = await new Promise<CardRecord[]>((resolve, reject) => {
    const request = transaction.objectStore(STORES.cards).getAll();
    request.onsuccess = () => resolve(request.result as CardRecord[]);
    request.onerror = () => reject(request.error ?? new Error('读取学习卡阶段失败'));
  });
  const stages: StorageCardStages = { shortTerm: 0, longTerm: 0, selfReported: 0, other: 0 };
  for (const card of cards) {
    if (card.stage === 'short-term') stages.shortTerm += 1;
    else if (card.stage === 'long-term') stages.longTerm += 1;
    else if (card.stage === 'self-reported-known') stages.selfReported += 1;
    else stages.other += 1;
  }
  return stages;
}

/** 汇总启动记录、当前数据与快照信息，供设置页展示。 */
export async function getStorageDiagnostics(
  store: LocalSettingsStore | null,
): Promise<StorageDiagnostics> {
  const extensionId = chrome.runtime?.id ?? '—';
  const extensionVersion = chrome.runtime?.getManifest?.().version ?? '—';
  let capacity: StorageCapacityDiagnostic;
  try {
    capacity = await readStorageCapacity();
  } catch (error) {
    capacity = {
      unlimitedStorage: null,
      persisted: null,
      errors: [`容量诊断读取失败：${error instanceof Error ? error.message : String(error)}`],
    };
  }
  try {
    await diagnosticsQueue;
    const state = await readState();
    const snapshot = await inspectRecoverySnapshot();
    const startup = state.history[0] ?? null;
    let current: StorageDiagnostics['current'] = null;
    let currentError: string | undefined;
    let health: StorageHealth | undefined;
    let healthError: string | undefined;
    if (store !== null) {
      try {
        const readAt = Date.now();
        const [counts, cardStages] = await Promise.all([
          readStorageCounts(store),
          readCardStages(store),
        ]);
        current = {
          readAt,
          counts,
          cardStages,
        };
      } catch (error) {
        currentError = error instanceof Error ? error.message : String(error);
      }
      if (current !== null) {
        try {
          current.storageMeta = await readStorageMeta(store.database);
        } catch (error) {
          current.storageMetaError = error instanceof Error ? error.message : String(error);
        }
      }
      try {
        health = await inspectStorageHealth(store);
      } catch (error) {
        healthError = error instanceof Error ? error.message : String(error);
      }
    }
    return {
      extensionId,
      extensionVersion,
      databaseName: DATABASE_NAME,
      databaseVersion: DATABASE_VERSION,
      databaseOpen: store !== null,
      ...(startup?.databaseOpenError ? { databaseOpenError: startup.databaseOpenError } : {}),
      startup,
      current,
      ...(currentError ? { currentError } : {}),
      snapshot,
      ...(health === undefined ? {} : { health }),
      ...(healthError ? { healthError } : {}),
      capacity,
      history: state.history,
    };
  } catch (error) {
    return {
      extensionId,
      extensionVersion,
      databaseName: DATABASE_NAME,
      databaseVersion: DATABASE_VERSION,
      databaseOpen: store !== null,
      startup: null,
      current: null,
      currentError: error instanceof Error ? error.message : String(error),
      snapshot: { present: false },
      capacity,
      history: [],
    };
  }
}
