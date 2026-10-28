import { DATABASE_NAME, DATABASE_VERSION, STORES, idbCount } from '@/storage/database';
import { inspectRecoverySnapshot } from '@/storage/recovery-snapshot';
import type { LocalSettingsStore } from '@/storage/local-settings';
import type { StorageCounts, StorageDiagnostics, StorageStartupRecord } from '@/types';

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
  restoredFromSnapshot: boolean;
  restoreError?: string;
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
      databaseOpenError: undefined,
      restoredFromSnapshot: input.restoredFromSnapshot,
      ...(input.restoreError ? { restoreError: input.restoreError } : {}),
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

/** 读取 IndexedDB 当前各仓库的记录数。 */
export async function readStorageCounts(store: LocalSettingsStore): Promise<StorageCounts> {
  const [cards, reviewLogs, sessionLogs, behaviorEvents, words, decks] = await Promise.all([
    idbCount(store.database, STORES.cards),
    idbCount(store.database, STORES.reviewLogs),
    idbCount(store.database, STORES.sessionLogs),
    idbCount(store.database, STORES.behaviorEvents),
    idbCount(store.database, STORES.words),
    idbCount(store.database, STORES.decks),
  ]);
  return { cards, reviewLogs, sessionLogs, behaviorEvents, words, decks };
}

/** 汇总启动记录、当前数据与快照信息，供设置页展示。 */
export async function getStorageDiagnostics(
  store: LocalSettingsStore | null,
): Promise<StorageDiagnostics> {
  const extensionId = chrome.runtime?.id ?? '—';
  const extensionVersion = chrome.runtime?.getManifest?.().version ?? '—';
  try {
    await diagnosticsQueue;
    const state = await readState();
    const snapshot = await inspectRecoverySnapshot();
    const startup = state.history[0] ?? null;
    let current: StorageDiagnostics['current'] = null;
    let currentError: string | undefined;
    if (store !== null) {
      try {
        current = { readAt: Date.now(), counts: await readStorageCounts(store) };
      } catch (error) {
        currentError = error instanceof Error ? error.message : String(error);
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
      history: [],
    };
  }
}
