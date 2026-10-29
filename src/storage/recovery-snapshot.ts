import { exportLocalData, importLocalData, type ExportPayload } from '@/storage/data-transfer';
import { STORES, idbCount, idbGetAll } from '@/storage/database';
import type { LocalSettingsStore } from '@/storage/local-settings';
import type {
  CardRecord,
  ReviewLogRecord,
  StorageCounts,
  StorageHealth,
  StorageHealthIssue,
  StorageSnapshotDiagnostic,
} from '@/types';

/**
 * IndexedDB 的自动恢复快照。
 *
 * 权威数据仍然只以 IndexedDB 为准；本快照只解决浏览器重建扩展数据目录、
 * 数据库被外部清空或旧版本换库名后无法读取等整体丢失场景。
 */
export const RECOVERY_SNAPSHOT_KEY = 'bingeup:recovery-snapshot';
export const RECOVERY_CLEARED_AT_KEY = 'bingeup:recovery-cleared-at';
export const RECOVERY_HEALTH_KEY = 'bingeup:recovery-health';

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

interface RecoveryHealthState {
  version: 1;
  restoreFailure?: {
    message: string;
    failedAt: number;
  };
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

function parseRecoveryHealthState(value: unknown): RecoveryHealthState {
  if (!isRecord(value) || value.version !== 1) return { version: 1 };
  const failure = value.restoreFailure;
  if (
    !isRecord(failure) ||
    typeof failure.message !== 'string' ||
    typeof failure.failedAt !== 'number'
  ) {
    return { version: 1 };
  }
  return { version: 1, restoreFailure: { message: failure.message, failedAt: failure.failedAt } };
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

async function recordRecoveryFailure(message: string): Promise<void> {
  try {
    await chrome.storage.local.set({
      [RECOVERY_HEALTH_KEY]: {
        version: 1,
        restoreFailure: { message, failedAt: Date.now() },
      } satisfies RecoveryHealthState,
    });
  } catch (error) {
    console.error('[BingeUp] 写入存档恢复失败状态失败', error);
  }
}

async function clearRecoveryFailure(): Promise<void> {
  try {
    await chrome.storage.local.set({ [RECOVERY_HEALTH_KEY]: { version: 1 } });
  } catch (error) {
    console.error('[BingeUp] 清除存档恢复失败状态失败', error);
  }
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

/** 检测当前权威数据相对恢复快照的异常减少、孤立日志和恢复失败。 */
export async function inspectStorageHealth(store: LocalSettingsStore): Promise<StorageHealth> {
  const issues: StorageHealthIssue[] = [];
  const counts = await Promise.all([
    idbCount(store.database, STORES.cards),
    idbCount(store.database, STORES.reviewLogs),
    idbCount(store.database, STORES.sessionLogs),
    idbCount(store.database, STORES.behaviorEvents),
    idbCount(store.database, STORES.words),
    idbCount(store.database, STORES.decks),
  ]);
  const currentCounts: StorageCounts = {
    cards: counts[0] ?? 0,
    reviewLogs: counts[1] ?? 0,
    sessionLogs: counts[2] ?? 0,
    behaviorEvents: counts[3] ?? 0,
    words: counts[4] ?? 0,
    decks: counts[5] ?? 0,
  };

  const stored = await chrome.storage.local.get([RECOVERY_SNAPSHOT_KEY, RECOVERY_HEALTH_KEY]);
  const snapshot = parseSnapshot(stored[RECOVERY_SNAPSHOT_KEY]);
  const snapshotCounts = snapshot === null ? undefined : countsFromPayload(snapshot.payload);
  if (snapshotCounts !== undefined && currentCounts.cards < snapshotCounts.cards) {
    issues.push({
      code: 'card-count-decreased',
      message: '当前学习卡数量少于健康快照的学习卡数量。',
      currentCards: currentCounts.cards,
      healthyCards: snapshotCounts.cards,
    });
  }

  const [cards, reviewLogs] = await Promise.all([
    idbGetAll<CardRecord>(store.database, STORES.cards),
    idbGetAll<ReviewLogRecord>(store.database, STORES.reviewLogs),
  ]);
  const cardIds = new Set(cards.map((card) => card.id));
  const orphanCount = reviewLogs.filter((log) => !cardIds.has(log.cardId)).length;
  if (orphanCount > 0) {
    issues.push({
      code: 'orphan-review-logs',
      message: '部分复习日志引用不存在的学习卡。',
      count: orphanCount,
    });
  }

  const healthState = parseRecoveryHealthState(stored[RECOVERY_HEALTH_KEY]);
  if (healthState.restoreFailure !== undefined) {
    issues.push({
      code: 'restore-failed',
      message: healthState.restoreFailure.message,
      failedAt: healthState.restoreFailure.failedAt,
    });
  }

  return {
    status: issues.length === 0 ? 'healthy' : 'attention',
    checkedAt: Date.now(),
    currentCounts,
    ...(snapshotCounts === undefined ? {} : { snapshotCounts }),
    issues,
  };
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
      const error = result.errors.join('；');
      console.error('[BingeUp] 自动存档恢复失败，快照仍保留', result.errors);
      await recordRecoveryFailure(error);
      return { restored: false, error };
    }
    await clearRecoveryFailure();
    return { restored: true };
  } catch (error) {
    console.error('[BingeUp] 自动存档恢复失败', error);
    const message = error instanceof Error ? error.message : String(error);
    await recordRecoveryFailure(message);
    return { restored: false, error: message };
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
