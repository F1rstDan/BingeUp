import { exportLocalData, importLocalData, type ExportPayload } from '@/storage/data-transfer';
import { STORES, idbCount } from '@/storage/database';
import type { LocalSettingsStore } from '@/storage/local-settings';
import type { StorageCounts, StorageSnapshotDiagnostic } from '@/types';

/**
 * IndexedDB 的自动恢复快照。
 *
 * 权威数据仍然只以 IndexedDB 为准；本快照只解决浏览器重建扩展数据目录、
 * 数据库被外部清空或旧版本换库名后无法读取等整体丢失场景。
 */
export const RECOVERY_SNAPSHOT_KEY = 'bingeup:recovery-snapshot';
export const RECOVERY_CLEARED_AT_KEY = 'bingeup:recovery-cleared-at';

interface RecoverySnapshot {
  version: 1;
  savedAt: number;
  mode: 'full' | 'compact';
  payload: ExportPayload;
}

interface SnapshotWriteResult {
  saved: boolean;
  snapshot: RecoverySnapshot | null;
}

interface PendingSnapshotWrite {
  database: IDBDatabase;
  operation: 'save' | 'reset';
  promise: Promise<SnapshotWriteResult>;
}

export interface StartupRecoverySnapshotResult {
  saved: boolean;
  snapshot: StorageSnapshotDiagnostic;
}

export interface RecoveryRestoreResult {
  restored: boolean;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSnapshot(value: unknown): RecoverySnapshot | null {
  if (!isRecord(value) || value.version !== 1 || typeof value.savedAt !== 'number') return null;
  const payload = value.payload;
  if (!isRecord(payload) || payload.version !== 1) return null;
  if (!isRecord(payload.authoritativeState) || !isRecord(payload.data)) return null;
  if (!Array.isArray(payload.data.cards)) return null;
  return {
    version: 1,
    savedAt: value.savedAt,
    mode: value.mode === 'compact' ? 'compact' : 'full',
    payload: payload as unknown as ExportPayload,
  };
}

function countsFromPayload(payload: ExportPayload): StorageCounts {
  return {
    cards: payload.data.cards.length,
    reviewLogs: payload.data.reviewLogs.length,
    sessionLogs: payload.data.sessionLogs.length,
    behaviorEvents: payload.data.behaviorEvents.length,
    words: payload.data.words.length,
    decks: payload.data.decks.length,
  };
}

function diagnosticFromSnapshot(snapshot: RecoverySnapshot | null): StorageSnapshotDiagnostic {
  if (snapshot === null) return { present: false };
  return {
    present: true,
    savedAt: snapshot.savedAt,
    mode: snapshot.mode,
    counts: countsFromPayload(snapshot.payload),
  };
}

async function writeSnapshot(snapshot: RecoverySnapshot): Promise<void> {
  await chrome.storage.local.set({ [RECOVERY_SNAPSHOT_KEY]: snapshot });
}

/** 快照串行写入，避免并发消息把较旧的导出结果覆盖到较新的快照上。 */
let snapshotWriteQueue: Promise<void> = Promise.resolve();
let pendingSnapshotWrite: PendingSnapshotWrite | null = null;

function enqueueSnapshotWrite(
  store: LocalSettingsStore,
  operation: PendingSnapshotWrite['operation'],
): Promise<SnapshotWriteResult> {
  const tail = pendingSnapshotWrite;
  if (operation === 'save' && tail?.operation === 'save' && tail.database === store.database) {
    return tail.promise;
  }

  const task = { database: store.database, operation } as PendingSnapshotWrite;
  task.promise = snapshotWriteQueue.then(() => {
    if (pendingSnapshotWrite === task) pendingSnapshotWrite = null;
    return operation === 'reset' ? resetRecoverySnapshotNow(store) : writeRecoverySnapshot(store);
  });
  pendingSnapshotWrite = task;
  snapshotWriteQueue = task.promise.then(
    () => undefined,
    () => undefined,
  );
  return task.promise;
}

/**
 * 把当前权威数据写入自动恢复快照。
 *
 * 快照写入失败不会影响已完成的 IndexedDB 写入；配额不足时退化为只保留
 * 学习卡与长期设置，避免明细日志挤掉最关键的进度。
 */
export function saveRecoverySnapshot(store: LocalSettingsStore): Promise<boolean> {
  return enqueueSnapshotWrite(store, 'save').then((result) => result.saved);
}

async function writeRecoverySnapshot(store: LocalSettingsStore): Promise<SnapshotWriteResult> {
  try {
    const payload = await exportLocalData(store);
    let snapshot: RecoverySnapshot = {
      version: 1,
      savedAt: Date.now(),
      mode: 'full',
      payload,
    };
    try {
      await writeSnapshot(snapshot);
    } catch {
      snapshot = {
        ...snapshot,
        mode: 'compact',
        payload: {
          ...payload,
          data: {
            ...payload.data,
            reviewLogs: [],
            sessionLogs: [],
            behaviorEvents: [],
          },
        },
      };
      await writeSnapshot(snapshot);
    }
    return { saved: true, snapshot };
  } catch (error) {
    console.error('[BingeUp] 自动存档备份失败', error);
    return { saved: false, snapshot: null };
  }
}

/** 读取恢复快照的元数据，不触发恢复。 */
export async function inspectRecoverySnapshot(): Promise<StorageSnapshotDiagnostic> {
  try {
    const stored = await chrome.storage.local.get(RECOVERY_SNAPSHOT_KEY);
    const snapshot = parseSnapshot(stored[RECOVERY_SNAPSHOT_KEY]);
    return diagnosticFromSnapshot(snapshot);
  } catch (error) {
    console.error('[BingeUp] 读取自动存档快照信息失败', error);
    return { present: false };
  }
}

/** 记录用户明确清除数据的时刻，阻止旧快照在下次启动时复活。 */
async function markRecoveryDataCleared(): Promise<boolean> {
  try {
    await chrome.storage.local.set({ [RECOVERY_CLEARED_AT_KEY]: Date.now() });
    return true;
  } catch (error) {
    console.error('[BingeUp] 自动存档清除标记写入失败', error);
    return false;
  }
}

/** 用户明确清除或重建数据后，写入空快照并留下清除标记。 */
async function resetRecoverySnapshotNow(store: LocalSettingsStore): Promise<SnapshotWriteResult> {
  const marked = await markRecoveryDataCleared();
  const result = await writeRecoverySnapshot(store);
  return { ...result, saved: marked || result.saved };
}

export async function resetRecoverySnapshot(store: LocalSettingsStore): Promise<boolean> {
  return (await enqueueSnapshotWrite(store, 'reset')).saved;
}

/**
 * 仅在 IndexedDB 中没有任何学习数据时自动恢复快照。
 *
 * 只要还有任意学习记录，就不覆盖当前数据；部分丢失需通过手动导入处理。
 */
export async function restoreRecoverySnapshotIfNeeded(
  store: LocalSettingsStore,
): Promise<RecoveryRestoreResult> {
  try {
    const [cards, logs, sessions, events] = await Promise.all([
      idbCount(store.database, STORES.cards),
      idbCount(store.database, STORES.reviewLogs),
      idbCount(store.database, STORES.sessionLogs),
      idbCount(store.database, STORES.behaviorEvents),
    ]);
    if (cards > 0 || logs > 0 || sessions > 0 || events > 0) return { restored: false };

    const stored = await chrome.storage.local.get([RECOVERY_SNAPSHOT_KEY, RECOVERY_CLEARED_AT_KEY]);
    const snapshot = parseSnapshot(stored[RECOVERY_SNAPSHOT_KEY]);
    if (snapshot === null || snapshot.payload.data.cards.length === 0) {
      return { restored: false };
    }

    const clearedAt = stored[RECOVERY_CLEARED_AT_KEY];
    if (typeof clearedAt === 'number' && clearedAt > snapshot.savedAt) {
      return { restored: false };
    }

    const result = await importLocalData(store, snapshot.payload);
    if (!result.ok) {
      console.error('[BingeUp] 自动存档恢复失败，快照仍保留', result.errors);
      return { restored: false, error: result.errors.join('；') };
    }
    return { restored: true };
  } catch (error) {
    console.error('[BingeUp] 自动存档恢复失败', error);
    return { restored: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 启动时只为已有学习数据补齐缺失的快照。
 *
 * 日常写入已经同步更新快照；这里仅在空库或学习卡数量与快照不一致时重建，
 * 避免 service worker 每次启动都完整读取一遍大数据。
 */
export async function saveStartupRecoverySnapshot(
  store: LocalSettingsStore,
): Promise<StartupRecoverySnapshotResult> {
  try {
    const cardCount = await idbCount(store.database, STORES.cards);
    const stored = await chrome.storage.local.get(RECOVERY_SNAPSHOT_KEY);
    const snapshot = parseSnapshot(stored[RECOVERY_SNAPSHOT_KEY]);
    const existing = diagnosticFromSnapshot(snapshot);
    if (cardCount === 0) return { saved: false, snapshot: existing };
    if (snapshot !== null && snapshot.payload.data.cards.length === cardCount) {
      return { saved: false, snapshot: existing };
    }
    const result = await enqueueSnapshotWrite(store, 'save');
    return {
      saved: result.saved,
      snapshot: result.snapshot === null ? existing : diagnosticFromSnapshot(result.snapshot),
    };
  } catch (error) {
    console.error('[BingeUp] 启动自动存档备份失败', error);
    return { saved: false, snapshot: await inspectRecoverySnapshot() };
  }
}
