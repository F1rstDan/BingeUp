import {
  exportLocalDataForSnapshot,
  importLocalData,
  validateLocalData,
  type ExportPayload,
} from '@/storage/data-transfer';
import { STORES, acknowledgeStorageBackup, readStorageMeta } from '@/storage/database';
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
export const RECOVERY_PENDING_OPERATION_KEY = 'bingeup:recovery-pending-operation';

interface RecoverySnapshot {
  version: 1;
  generation: string;
  /** 生成 payload 时数据库的权威修订信息；与快照档案 generation 分开。 */
  storage: RecoveryStorageStamp | null;
  savedAt: number;
  mode: 'full' | 'compact';
  payload: ExportPayload;
}

interface RecoveryStorageStamp {
  generation: string;
  revision: number;
}

export type UserRecoveryOperation = 'import' | 'clear-learning-progress' | 'clear-all' | 'rebuild';

interface PendingRecoveryOperation {
  version: 1;
  id: string;
  operation: UserRecoveryOperation | 'unknown';
  startedAt: number;
}

interface RecoverySnapshotArchive extends Omit<RecoverySnapshot, 'version'> {
  version: 2;
  previous: RecoverySnapshot | null;
  tombstone: {
    generation: string;
    kind: Exclude<UserRecoveryOperation, 'import'>;
  } | null;
  operation: UserRecoveryOperation | 'automatic' | 'legacy';
  /** 用户明确替换无效快照时，同一条记录保留原值。 */
  invalidSnapshot?: unknown;
}

interface SnapshotWriteResult {
  saved: boolean;
  snapshot: RecoverySnapshot | null;
}

interface SnapshotWriteContext {
  previous: RecoverySnapshot | null;
  operation: RecoverySnapshotArchive['operation'];
  tombstoneKind: Exclude<UserRecoveryOperation, 'import'> | null;
  invalidSnapshot?: unknown;
}

interface RecoveryHealthState {
  version: 1;
  restoreFailure?: {
    message: string;
    failedAt: number;
  };
  isolation?: {
    detectedAt: number;
    issues: StorageHealthIssue[];
  };
}

interface PendingSnapshotWrite {
  database: IDBDatabase;
  operation: 'save' | 'reset' | 'retry-pending';
  resetKind?: UserRecoveryOperation;
  retainIsolation?: boolean;
  promise: Promise<SnapshotWriteResult>;
}

export interface StartupRecoverySnapshotResult {
  saved: boolean;
  snapshot: StorageSnapshotDiagnostic;
}

export interface RecoveryRestoreResult {
  restored: boolean;
  error?: string;
  beforeCounts?: StorageCounts;
  afterCounts?: StorageCounts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseHealthIssue(value: unknown): StorageHealthIssue | null {
  if (!isRecord(value)) return null;
  if (
    value.code === 'card-count-decreased' &&
    typeof value.message === 'string' &&
    typeof value.currentCards === 'number' &&
    typeof value.healthyCards === 'number'
  ) {
    return {
      code: value.code,
      message: value.message,
      currentCards: value.currentCards,
      healthyCards: value.healthyCards,
    };
  }
  if (
    value.code === 'storage-count-decreased' &&
    typeof value.message === 'string' &&
    typeof value.collection === 'string' &&
    value.collection in
      {
        cards: true,
        reviewLogs: true,
        sessionLogs: true,
        behaviorEvents: true,
        words: true,
        decks: true,
      } &&
    typeof value.currentCount === 'number' &&
    typeof value.healthyCount === 'number'
  ) {
    return {
      code: value.code,
      message: value.message,
      collection: value.collection as keyof StorageCounts,
      currentCount: value.currentCount,
      healthyCount: value.healthyCount,
    };
  }
  if (
    value.code === 'card-identities-changed' &&
    typeof value.message === 'string' &&
    Array.isArray(value.missingCardIds) &&
    value.missingCardIds.every((id) => typeof id === 'string') &&
    Array.isArray(value.addedCardIds) &&
    value.addedCardIds.every((id) => typeof id === 'string')
  ) {
    return {
      code: value.code,
      message: value.message,
      missingCardIds: value.missingCardIds,
      addedCardIds: value.addedCardIds,
    };
  }
  if (
    value.code === 'orphan-review-logs' &&
    typeof value.message === 'string' &&
    typeof value.count === 'number'
  ) {
    return { code: value.code, message: value.message, count: value.count };
  }
  if (
    value.code === 'restore-failed' &&
    typeof value.message === 'string' &&
    typeof value.failedAt === 'number'
  ) {
    return { code: value.code, message: value.message, failedAt: value.failedAt };
  }
  if (value.code === 'snapshot-invalid' && typeof value.message === 'string') {
    return { code: value.code, message: value.message };
  }
  if (
    value.code === 'snapshot-validation-failed' &&
    typeof value.message === 'string' &&
    Array.isArray(value.errors) &&
    value.errors.every((error) => typeof error === 'string')
  ) {
    return { code: value.code, message: value.message, errors: value.errors };
  }
  if (
    value.code === 'pending-operation' &&
    typeof value.message === 'string' &&
    typeof value.operation === 'string' &&
    typeof value.startedAt === 'number'
  ) {
    return {
      code: value.code,
      message: value.message,
      operation: value.operation,
      startedAt: value.startedAt,
    };
  }
  return null;
}

function parseRecoveryHealthState(value: unknown): RecoveryHealthState {
  if (!isRecord(value) || value.version !== 1) return { version: 1 };
  const failure =
    isRecord(value.restoreFailure) &&
    typeof value.restoreFailure.message === 'string' &&
    typeof value.restoreFailure.failedAt === 'number'
      ? { message: value.restoreFailure.message, failedAt: value.restoreFailure.failedAt }
      : undefined;
  const isolation =
    isRecord(value.isolation) && Array.isArray(value.isolation.issues)
      ? {
          detectedAt:
            typeof value.isolation.detectedAt === 'number' ? value.isolation.detectedAt : 0,
          issues: value.isolation.issues
            .map(parseHealthIssue)
            .filter((issue): issue is StorageHealthIssue => issue !== null),
        }
      : undefined;
  return {
    version: 1,
    ...(failure ? { restoreFailure: failure } : {}),
    ...(isolation ? { isolation } : {}),
  };
}

function parseSnapshotEntity(value: unknown): RecoverySnapshot | null {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.savedAt !== 'number' ||
    !Number.isFinite(value.savedAt) ||
    (value.mode !== 'full' && value.mode !== 'compact')
  )
    return null;
  const payload = value.payload;
  if (!isRecord(payload) || payload.version !== 1) return null;
  if (!isRecord(payload.authoritativeState) || !isRecord(payload.data)) return null;
  const data = payload.data;
  if (
    !['cards', 'reviewLogs', 'sessionLogs', 'behaviorEvents', 'words', 'decks'].every((name) =>
      Array.isArray(data[name]),
    )
  )
    return null;
  if (value.storage != null && parseRecoveryStorageStamp(value.storage) === null) return null;
  return {
    version: 1,
    generation: typeof value.generation === 'string' ? value.generation : 'legacy',
    storage: parseRecoveryStorageStamp(value.storage),
    savedAt: value.savedAt,
    mode: value.mode === 'compact' ? 'compact' : 'full',
    payload: payload as unknown as ExportPayload,
  };
}

function parseRecoveryStorageStamp(value: unknown): RecoveryStorageStamp | null {
  if (
    !isRecord(value) ||
    typeof value.generation !== 'string' ||
    value.generation.length === 0 ||
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0
  ) {
    return null;
  }
  return { generation: value.generation, revision: value.revision };
}

const RECOVERY_OPERATIONS: ReadonlySet<string> = new Set([
  'automatic',
  'legacy',
  'import',
  'clear-learning-progress',
  'clear-all',
  'rebuild',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isTombstone(
  value: unknown,
  generation: string,
): value is RecoverySnapshotArchive['tombstone'] {
  if (value === null) return true;
  if (!isRecord(value) || value.generation !== generation) return false;
  return (
    value.kind === 'clear-learning-progress' ||
    value.kind === 'clear-all' ||
    value.kind === 'rebuild'
  );
}

function parseRecoveryArchive(value: unknown): RecoverySnapshotArchive | null {
  if (!isRecord(value)) return null;
  if (value.version === 1) {
    const legacy = parseSnapshotEntity(value);
    if (legacy === null) return null;
    return {
      ...legacy,
      version: 2,
      previous: null,
      tombstone: null,
      operation: 'legacy',
    };
  }
  if (value.version !== 2) return null;
  if (typeof value.generation !== 'string' || !UUID_PATTERN.test(value.generation)) return null;
  const current = parseSnapshotEntity({ ...value, version: 1 });
  if (current === null) return null;
  const previous =
    value.previous === null
      ? null
      : value.previous === undefined
        ? null
        : parseSnapshotEntity(value.previous);
  if (previous === null && value.previous !== null && value.previous !== undefined) return null;
  if (typeof value.operation !== 'string' || !RECOVERY_OPERATIONS.has(value.operation)) {
    return null;
  }
  if (!isTombstone(value.tombstone ?? null, value.generation)) return null;
  return {
    ...current,
    version: 2,
    generation: value.generation,
    previous,
    tombstone: (value.tombstone ?? null) as RecoverySnapshotArchive['tombstone'],
    operation: value.operation as RecoverySnapshotArchive['operation'],
    ...('invalidSnapshot' in value ? { invalidSnapshot: value.invalidSnapshot } : {}),
  };
}

function parseSnapshot(value: unknown): RecoverySnapshot | null {
  const archive = parseRecoveryArchive(value);
  return archive === null ? null : snapshotEntityFromArchive(archive);
}

function snapshotEntityFromArchive(archive: RecoverySnapshotArchive): RecoverySnapshot {
  return {
    version: 1,
    generation: archive.generation,
    storage: archive.storage,
    savedAt: archive.savedAt,
    mode: archive.mode,
    payload: archive.payload,
  };
}

function createGeneration(): string {
  return crypto.randomUUID();
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

async function readStorageHealthData(database: IDBDatabase): Promise<{
  currentCounts: StorageCounts;
  cards: CardRecord[];
  reviewLogs: ReviewLogRecord[];
}> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      [
        STORES.cards,
        STORES.reviewLogs,
        STORES.sessionLogs,
        STORES.behaviorEvents,
        STORES.words,
        STORES.decks,
      ],
      'readonly',
    );
    const cardsRequest = transaction.objectStore(STORES.cards).getAll();
    const reviewLogsRequest = transaction.objectStore(STORES.reviewLogs).getAll();
    const sessionLogsCount = transaction.objectStore(STORES.sessionLogs).count();
    const behaviorEventsCount = transaction.objectStore(STORES.behaviorEvents).count();
    const wordsCount = transaction.objectStore(STORES.words).count();
    const decksCount = transaction.objectStore(STORES.decks).count();
    transaction.oncomplete = () => {
      const cards = cardsRequest.result as CardRecord[];
      const reviewLogs = reviewLogsRequest.result as ReviewLogRecord[];
      resolve({
        cards,
        reviewLogs,
        currentCounts: {
          cards: cards.length,
          reviewLogs: reviewLogs.length,
          sessionLogs: sessionLogsCount.result,
          behaviorEvents: behaviorEventsCount.result,
          words: wordsCount.result,
          decks: decksCount.result,
        },
      });
    };
    transaction.onerror = () => reject(transaction.error ?? new Error('读取存档健康数据事务失败'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('读取存档健康数据事务已中止'));
  });
}

function diagnosticFromSnapshot(snapshot: RecoverySnapshot | null): StorageSnapshotDiagnostic {
  if (snapshot === null) return { present: false };
  return {
    present: true,
    savedAt: snapshot.savedAt,
    mode: snapshot.mode,
    counts: countsFromPayload(snapshot.payload),
    ...(snapshot.storage === null ? {} : { storage: snapshot.storage }),
  };
}

async function writeSnapshotArchive(archive: RecoverySnapshotArchive): Promise<void> {
  await chrome.storage.local.set({ [RECOVERY_SNAPSHOT_KEY]: archive });
}

async function validateSnapshot(snapshot: RecoverySnapshot): Promise<string[]> {
  const result = await validateLocalData(snapshot.payload);
  return result.ok ? [] : result.errors;
}

const snapshotValidationCache = new Map<string, string[]>();

async function validateSnapshotOnce(snapshot: RecoverySnapshot): Promise<string[]> {
  // 数据变化必须重新校验。仅缓存当前和上一代，避免后台长时间运行时持续占用内存。
  const key = JSON.stringify(snapshot);
  const cached = snapshotValidationCache.get(key);
  if (cached !== undefined) return cached;
  const errors = await validateSnapshot(snapshot);
  snapshotValidationCache.set(key, errors);
  while (snapshotValidationCache.size > 2) {
    snapshotValidationCache.delete(snapshotValidationCache.keys().next().value!);
  }
  return errors;
}

async function activateInvalidSnapshotIsolation(errors: string[]): Promise<void> {
  await activateRecoveryIsolation([
    {
      code: 'snapshot-validation-failed',
      message: '恢复快照未通过完整性校验；原快照已保留。',
      errors,
    },
  ]);
}

let healthStateQueue: Promise<void> = Promise.resolve();
let memoryIsolationActive = false;
let activeRecoveryOperation: { id: string; operation: UserRecoveryOperation } | null = null;

function updateRecoveryHealthState(
  update: (state: RecoveryHealthState) => RecoveryHealthState,
): Promise<boolean> {
  const task = healthStateQueue.then(async () => {
    const stored = await chrome.storage.local.get(RECOVERY_HEALTH_KEY);
    const current = parseRecoveryHealthState(stored[RECOVERY_HEALTH_KEY]);
    await chrome.storage.local.set({ [RECOVERY_HEALTH_KEY]: update(current) });
    return true;
  });
  healthStateQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task.catch((error) => {
    console.error('[BingeUp] 更新存档健康状态失败', error);
    return false;
  });
}

async function activateRecoveryIsolation(issues: StorageHealthIssue[]): Promise<boolean> {
  if (issues.length === 0) return false;
  memoryIsolationActive = true;
  const persisted = await updateRecoveryHealthState((state) => ({
    ...state,
    isolation: state.isolation ?? { detectedAt: Date.now(), issues },
  }));
  return persisted;
}

async function recordRecoveryFailure(message: string): Promise<void> {
  memoryIsolationActive = true;
  await updateRecoveryHealthState((state) => {
    const failedAt = Date.now();
    const issue: StorageHealthIssue = { code: 'restore-failed', message, failedAt };
    return {
      ...state,
      restoreFailure: { message, failedAt },
      isolation: state.isolation ?? { detectedAt: failedAt, issues: [issue] },
    };
  });
}

async function clearRecoveryHealth(): Promise<boolean> {
  const cleared = await updateRecoveryHealthState(() => ({ version: 1 }));
  if (cleared) memoryIsolationActive = false;
  return cleared;
}

export async function clearStorageIsolation(): Promise<boolean> {
  snapshotValidationCache.clear();
  activeRecoveryOperation = null;
  try {
    await chrome.storage.local.set({
      [RECOVERY_HEALTH_KEY]: { version: 1 },
      [RECOVERY_PENDING_OPERATION_KEY]: null,
    });
    memoryIsolationActive = false;
    return true;
  } catch (error) {
    console.error('[BingeUp] 清除存档隔离状态失败', error);
    return false;
  }
}

/** 学习入口使用该轻量状态；需要问题明细时调用健康检查。 */
export async function isStorageIsolationActive(): Promise<boolean> {
  if (memoryIsolationActive) return true;
  try {
    const stored = await chrome.storage.local.get([
      RECOVERY_HEALTH_KEY,
      RECOVERY_PENDING_OPERATION_KEY,
    ]);
    return (
      parseRecoveryHealthState(stored[RECOVERY_HEALTH_KEY]).isolation !== undefined ||
      (stored[RECOVERY_PENDING_OPERATION_KEY] !== undefined &&
        stored[RECOVERY_PENDING_OPERATION_KEY] !== null)
    );
  } catch (error) {
    console.error('[BingeUp] 读取存档隔离状态失败', error);
    return true;
  }
}

function storageOperationError(message: string, code: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

async function readPendingRecoveryOperation(): Promise<PendingRecoveryOperation | null> {
  try {
    const stored = await chrome.storage.local.get(RECOVERY_PENDING_OPERATION_KEY);
    const raw = stored[RECOVERY_PENDING_OPERATION_KEY];
    if (raw === undefined || raw === null) return null;
    if (
      isRecord(raw) &&
      raw.version === 1 &&
      typeof raw.id === 'string' &&
      typeof raw.startedAt === 'number' &&
      (raw.operation === 'import' ||
        raw.operation === 'clear-learning-progress' ||
        raw.operation === 'clear-all' ||
        raw.operation === 'rebuild')
    ) {
      return {
        version: 1,
        id: raw.id,
        operation: raw.operation,
        startedAt: raw.startedAt,
      };
    }
    return { version: 1, id: 'invalid-marker', operation: 'unknown', startedAt: 0 };
  } catch (error) {
    console.error('[BingeUp] 读取存档操作标记失败', error);
    return { version: 1, id: 'unreadable-marker', operation: 'unknown', startedAt: 0 };
  }
}

async function activatePendingOperationIsolation(pending: PendingRecoveryOperation): Promise<void> {
  await activateRecoveryIsolation([
    {
      code: 'pending-operation',
      message: '检测到未完成的存档替换操作；已停止自动恢复。',
      operation: pending.operation,
      startedAt: pending.startedAt,
    },
  ]);
}

export async function getPendingRecoveryOperation(): Promise<PendingRecoveryOperation | null> {
  return readPendingRecoveryOperation();
}

let pendingOperationLock: Promise<void> = Promise.resolve();

function withPendingOperationLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = pendingOperationLock.then(operation);
  pendingOperationLock = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** 破坏数据库与快照的一致性前，必须先持久化该标记。 */
export function beginRecoveryOperation(
  operation: UserRecoveryOperation,
): Promise<{ token: string; replacedPending: boolean }> {
  return withPendingOperationLock(async () => {
    if (activeRecoveryOperation !== null) {
      throw storageOperationError(
        '已有未完成的存档操作；本次操作未执行。',
        'STORAGE_OPERATION_IN_PROGRESS',
      );
    }
    const previousPending = await readPendingRecoveryOperation();
    if (previousPending !== null) {
      console.warn('[BingeUp] 替换未完成的存档操作标记', previousPending.operation);
    }
    const pending: PendingRecoveryOperation = {
      version: 1,
      id: crypto.randomUUID(),
      operation,
      startedAt: Date.now(),
    };
    try {
      await chrome.storage.local.set({ [RECOVERY_PENDING_OPERATION_KEY]: pending });
      memoryIsolationActive = true;
      activeRecoveryOperation = { id: pending.id, operation };
      return { token: pending.id, replacedPending: previousPending !== null };
    } catch (error) {
      memoryIsolationActive = true;
      throw storageOperationError(
        `无法写入存档操作标记，操作未执行：${error instanceof Error ? error.message : String(error)}`,
        'STORAGE_PENDING_WRITE_FAILED',
      );
    }
  });
}

async function readPendingOperationForToken(token: string): Promise<PendingRecoveryOperation> {
  const pending = await readPendingRecoveryOperation();
  if (pending === null) return { version: 1, id: token, operation: 'unknown', startedAt: 0 };
  if (pending.id !== token) {
    throw storageOperationError(
      `存档操作标记已被替换，拒绝清除较新的操作状态。expected=${token} actual=${pending.id}`,
      'STORAGE_PENDING_TOKEN_MISMATCH',
    );
  }
  return pending;
}

/** 数据库或快照步骤失败时结束本 SW 的 active，但保留磁盘 pending 和隔离。 */
export async function suspendRecoveryOperation(token: string): Promise<void> {
  await withPendingOperationLock(async () => {
    if (activeRecoveryOperation?.id === token) activeRecoveryOperation = null;
  });
}

/** 明确失败且数据库确定未变时，只清除本次 pending，不解除既有隔离。 */
export async function abandonRecoveryOperation(
  token: string,
  options: { clearIsolation?: boolean } = {},
): Promise<void> {
  await withPendingOperationLock(async () => {
    await readPendingOperationForToken(token);
    try {
      await chrome.storage.local.set({
        [RECOVERY_PENDING_OPERATION_KEY]: null,
        ...(options.clearIsolation ? { [RECOVERY_HEALTH_KEY]: { version: 1 } } : {}),
      });
      if (options.clearIsolation) memoryIsolationActive = false;
      if (activeRecoveryOperation?.id === token) activeRecoveryOperation = null;
    } catch (error) {
      memoryIsolationActive = true;
      throw error;
    }
  });
}

/** 新档案已成功落盘后，同时清除 pending 和隔离。 */
export async function completeRecoveryOperation(token: string): Promise<void> {
  await withPendingOperationLock(async () => {
    await readPendingOperationForToken(token);
    try {
      await chrome.storage.local.set({
        [RECOVERY_PENDING_OPERATION_KEY]: null,
        [RECOVERY_HEALTH_KEY]: { version: 1 },
      });
      memoryIsolationActive = false;
      if (activeRecoveryOperation?.id === token) activeRecoveryOperation = null;
    } catch (error) {
      memoryIsolationActive = true;
      throw error;
    }
  });
}

/** 快照串行写入，避免并发消息把较旧的导出结果覆盖到较新的快照上。 */
let snapshotWriteQueue: Promise<void> = Promise.resolve();
let pendingSnapshotWrite: PendingSnapshotWrite | null = null;

function enqueueSnapshotWrite(
  store: LocalSettingsStore,
  operation: PendingSnapshotWrite['operation'],
  resetKind?: UserRecoveryOperation,
  retainIsolation = false,
): Promise<SnapshotWriteResult> {
  const tail = pendingSnapshotWrite;
  if (operation === 'save' && tail?.operation === 'save' && tail.database === store.database) {
    return tail.promise;
  }

  const task = {
    database: store.database,
    operation,
    resetKind,
    retainIsolation,
  } as PendingSnapshotWrite;
  task.promise = snapshotWriteQueue.then(() => {
    if (pendingSnapshotWrite === task) pendingSnapshotWrite = null;
    if (operation === 'reset') {
      return resetRecoverySnapshotNow(store, resetKind ?? 'clear-all', retainIsolation);
    }
    return operation === 'retry-pending'
      ? retryPendingRecoverySnapshotNow(store)
      : writeProtectedRecoverySnapshot(store);
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

/** 由数据库事务留下的标记决定是否备份，不依赖消息类型清单。 */
export async function savePendingRecoverySnapshot(store: LocalSettingsStore): Promise<boolean> {
  try {
    if (!(await readStorageMeta(store.database)).pendingBackup) return true;
    return await saveRecoverySnapshot(store);
  } catch (error) {
    console.error('[BingeUp] 待备份存档写入失败', error);
    return false;
  }
}

async function retryPendingRecoverySnapshotNow(
  store: LocalSettingsStore,
): Promise<SnapshotWriteResult> {
  const pending = await getPendingRecoveryOperation();
  if (pending === null) return writeProtectedRecoverySnapshot(store);
  if (activeRecoveryOperation !== null) return { saved: false, snapshot: null };
  if (pending.operation === 'unknown') {
    memoryIsolationActive = true;
    return { saved: false, snapshot: null };
  }
  const stored = await chrome.storage.local.get(RECOVERY_SNAPSHOT_KEY);
  const archive = parseRecoveryArchive(stored[RECOVERY_SNAPSHOT_KEY]);
  const result = await writeRecoverySnapshot(store, {
    previous:
      pending.operation === 'import' && archive !== null
        ? snapshotEntityFromArchive(archive)
        : null,
    operation: pending.operation,
    tombstoneKind: pending.operation === 'import' ? null : pending.operation,
  });
  if (result.saved) {
    try {
      await completeRecoveryOperation(pending.id);
    } catch (error) {
      console.error('[BingeUp] 清除存档恢复标记失败', error);
      return { saved: false, snapshot: null };
    }
  }
  return result;
}

/** 用户明确重试时，若有 pending，则以当前 DB 建立新档案后再解除隔离。 */
export function retryRecoverySnapshot(store: LocalSettingsStore): Promise<boolean> {
  return enqueueSnapshotWrite(store, 'retry-pending').then((result) => result.saved);
}

async function writeProtectedRecoverySnapshot(
  store: LocalSettingsStore,
): Promise<SnapshotWriteResult> {
  const health = await inspectStorageHealth(store);
  if (health.status === 'attention') await activateRecoveryIsolation(health.issues);
  if (health.status !== 'healthy') return { saved: false, snapshot: null };
  const stored = await chrome.storage.local.get(RECOVERY_SNAPSHOT_KEY);
  const archive = parseRecoveryArchive(stored[RECOVERY_SNAPSHOT_KEY]);
  if (archive?.operation === 'legacy') {
    const errors = await validateSnapshotOnce(snapshotEntityFromArchive(archive));
    if (errors.length > 0) {
      await activateInvalidSnapshotIsolation(errors);
      return { saved: false, snapshot: null };
    }
  }
  return writeRecoverySnapshot(store, {
    previous: archive === null ? null : snapshotEntityFromArchive(archive),
    operation: 'automatic',
    tombstoneKind: null,
  });
}

async function writeRecoverySnapshot(
  store: LocalSettingsStore,
  context: SnapshotWriteContext,
): Promise<SnapshotWriteResult> {
  try {
    const { payload, storageMeta } = await exportLocalDataForSnapshot(store);
    const generation = createGeneration();
    let snapshot: RecoverySnapshot = {
      version: 1,
      generation,
      storage: {
        generation: storageMeta.generation,
        revision: storageMeta.revision,
      },
      savedAt: Date.now(),
      mode: 'full',
      payload,
    };
    const fullErrors = await validateSnapshot(snapshot);
    if (fullErrors.length > 0) {
      await activateInvalidSnapshotIsolation(fullErrors);
      return { saved: false, snapshot: null };
    }
    let archive: RecoverySnapshotArchive = {
      ...snapshot,
      version: 2,
      previous: context.previous,
      operation: context.operation,
      tombstone:
        context.tombstoneKind === null ? null : { generation, kind: context.tombstoneKind },
      ...(context.invalidSnapshot === undefined
        ? {}
        : { invalidSnapshot: context.invalidSnapshot }),
    };
    try {
      await writeSnapshotArchive(archive);
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
      const compactErrors = await validateSnapshot(snapshot);
      if (compactErrors.length > 0) {
        await activateInvalidSnapshotIsolation(compactErrors);
        return { saved: false, snapshot: null };
      }
      archive = {
        ...snapshot,
        version: 2,
        previous: context.previous,
        operation: context.operation,
        tombstone:
          context.tombstoneKind === null ? null : { generation, kind: context.tombstoneKind },
        ...(context.invalidSnapshot === undefined
          ? {}
          : { invalidSnapshot: context.invalidSnapshot }),
      };
      await writeSnapshotArchive(archive);
    }
    await acknowledgeStorageBackup(store.database, storageMeta);
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

/** 只读导出自动快照，使用公共 v1 格式；不改变数据库或解除隔离。 */
export async function exportRecoverySnapshot(
  which: 'current' | 'previous',
): Promise<ExportPayload> {
  const stored = await chrome.storage.local.get(RECOVERY_SNAPSHOT_KEY);
  const raw = stored[RECOVERY_SNAPSHOT_KEY];
  if (!isRecord(raw) || (raw.version !== 1 && raw.version !== 2)) {
    throw new Error('没有可导出的自动快照');
  }
  const entity =
    which === 'previous' ? (raw.version === 2 ? raw.previous : null) : { ...raw, version: 1 };
  const snapshot = parseSnapshotEntity(entity);
  if (snapshot === null) throw new Error('所选自动快照不存在或格式无效');
  const errors = await validateSnapshot(snapshot);
  if (errors.length > 0) throw new Error(`自动快照校验失败：${errors.join('；')}`);
  return snapshot.payload;
}

/** 检测当前权威数据相对恢复快照的异常减少、孤立日志和恢复失败。 */
export async function inspectStorageHealth(store: LocalSettingsStore): Promise<StorageHealth> {
  const issues: StorageHealthIssue[] = [];
  const pendingOperation = await getPendingRecoveryOperation();
  const stored = await chrome.storage.local.get([RECOVERY_SNAPSHOT_KEY, RECOVERY_HEALTH_KEY]);
  const storedSnapshot = stored[RECOVERY_SNAPSHOT_KEY];
  const archive = parseRecoveryArchive(storedSnapshot);
  const snapshot = archive === null ? null : snapshotEntityFromArchive(archive);
  const snapshotValidationErrors =
    snapshot === null ? [] : [...(await validateSnapshotOnce(snapshot))];
  if (archive?.previous) {
    snapshotValidationErrors.push(
      ...(await validateSnapshotOnce(archive.previous)).map((error) => `上一代：${error}`),
    );
  }
  const healthState = parseRecoveryHealthState(stored[RECOVERY_HEALTH_KEY]);
  const { currentCounts, cards, reviewLogs } = await readStorageHealthData(store.database);
  const snapshotCounts = snapshot === null ? undefined : countsFromPayload(snapshot.payload);
  if (storedSnapshot !== undefined && snapshot === null) {
    issues.push({
      code: 'snapshot-invalid',
      message: '恢复快照格式无效；原快照已保留。',
    });
  }
  if (snapshotValidationErrors.length > 0) {
    issues.push({
      code: 'snapshot-validation-failed',
      message: '恢复快照未通过完整性校验；原快照已保留。',
      errors: snapshotValidationErrors,
    });
  }
  if (pendingOperation !== null) {
    issues.push({
      code: 'pending-operation',
      message: '检测到未完成的存档替换操作；已停止自动恢复。',
      operation: pendingOperation.operation,
      startedAt: pendingOperation.startedAt,
    });
  }
  if (snapshotCounts !== undefined) {
    for (const collection of [
      'cards',
      'reviewLogs',
      'sessionLogs',
      'behaviorEvents',
      'words',
      'decks',
    ] as const) {
      if (currentCounts[collection] >= snapshotCounts[collection]) continue;
      issues.push({
        code: 'storage-count-decreased',
        message: `${collection} 当前记录数少于健康快照。`,
        collection,
        currentCount: currentCounts[collection],
        healthyCount: snapshotCounts[collection],
      });
    }
    if (currentCounts.cards === snapshotCounts.cards && archive !== null) {
      const currentCardIds = new Set(cards.map((card) => card.id));
      const healthyCardIds = new Set(archive.payload.data.cards.map((card) => card.id));
      const missingCardIds = [...healthyCardIds].filter((id) => !currentCardIds.has(id));
      const addedCardIds = [...currentCardIds].filter((id) => !healthyCardIds.has(id));
      if (missingCardIds.length > 0 || addedCardIds.length > 0) {
        issues.push({
          code: 'card-identities-changed',
          message: '学习卡数量相同，但卡片身份与健康快照不同。',
          missingCardIds,
          addedCardIds,
        });
      }
    }
  }

  const cardIds = new Set(cards.map((card) => card.id));
  const orphanCount = reviewLogs.filter((log) => !cardIds.has(log.cardId)).length;
  if (orphanCount > 0) {
    issues.push({
      code: 'orphan-review-logs',
      message: '部分复习日志引用不存在的学习卡。',
      count: orphanCount,
    });
  }

  if (healthState.restoreFailure !== undefined) {
    issues.push({
      code: 'restore-failed',
      message: healthState.restoreFailure.message,
      failedAt: healthState.restoreFailure.failedAt,
    });
  }

  for (const issue of healthState.isolation?.issues ?? []) {
    if (!issues.some((current) => current.code === issue.code)) issues.push(issue);
  }

  return {
    status:
      healthState.isolation === undefined && pendingOperation === null
        ? issues.length === 0
          ? 'healthy'
          : 'attention'
        : 'isolated',
    checkedAt: Date.now(),
    currentCounts,
    ...(snapshotCounts === undefined ? {} : { snapshotCounts }),
    ...(archive === null ? {} : { snapshotGeneration: archive.generation }),
    ...(archive?.previous === null || archive?.previous === undefined
      ? {}
      : {
          previousSnapshot: {
            generation: archive.previous.generation,
            savedAt: archive.previous.savedAt,
            counts: countsFromPayload(archive.previous.payload),
          },
        }),
    issues,
  };
}

/** 用户明确替换数据后写入新代次，并在同一条档案中保留上一代。 */
async function resetRecoverySnapshotNow(
  store: LocalSettingsStore,
  operation: UserRecoveryOperation,
  retainIsolation: boolean,
): Promise<SnapshotWriteResult> {
  let previous: RecoverySnapshot | null = null;
  if (operation === 'import') {
    const stored = await chrome.storage.local.get(RECOVERY_SNAPSHOT_KEY);
    const archive = parseRecoveryArchive(stored[RECOVERY_SNAPSHOT_KEY]);
    if (archive !== null && archive.operation !== 'legacy') {
      previous = snapshotEntityFromArchive(archive);
    } else if (archive !== null) {
      const errors = await validateSnapshotOnce(snapshotEntityFromArchive(archive));
      if (errors.length === 0) previous = snapshotEntityFromArchive(archive);
    }
  }
  const result = await writeRecoverySnapshot(store, {
    previous,
    operation,
    tombstoneKind: operation === 'import' ? null : operation,
  });
  if (result.saved && !retainIsolation) await clearRecoveryHealth();
  return result;
}

export async function resetRecoverySnapshot(
  store: LocalSettingsStore,
  operation: UserRecoveryOperation = 'clear-all',
  options: { retainIsolation?: boolean } = {},
): Promise<boolean> {
  return (await enqueueSnapshotWrite(store, 'reset', operation, options.retainIsolation)).saved;
}

/**
 * 仅在 IndexedDB 的全部权威仓库为空时自动恢复快照。
 *
 * 只要还有任意学习记录，就不覆盖当前数据；部分丢失需通过手动导入处理。
 */
export async function restoreRecoverySnapshotIfNeeded(
  store: LocalSettingsStore,
): Promise<RecoveryRestoreResult> {
  let beforeCounts: StorageCounts | undefined;
  try {
    const pending = await getPendingRecoveryOperation();
    if (pending !== null) {
      await activatePendingOperationIsolation(pending);
      return { restored: false };
    }
    const names = Object.values(STORES).filter((name) => name !== STORES.storageMeta);
    const tx = store.database.transaction(names, 'readonly');
    const completed = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('恢复检查失败'));
      tx.onabort = () => reject(tx.error ?? new Error('恢复检查已中止'));
    });
    const counts = await Promise.all([
      ...names.map(
        (name) =>
          new Promise<number>((resolve, reject) => {
            const request = tx.objectStore(name).count();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          }),
      ),
      completed.then(() => 0),
    ]);
    beforeCounts = Object.fromEntries(
      names
        .filter((name) => name !== STORES.authoritativeState)
        .map((name) => [name, counts[names.indexOf(name)]]),
    ) as unknown as StorageCounts;
    if (counts.some((count) => count > 0)) {
      const health = await inspectStorageHealth(store);
      if (health.status === 'attention') await activateRecoveryIsolation(health.issues);
      return { restored: false };
    }

    const stored = await chrome.storage.local.get([RECOVERY_SNAPSHOT_KEY, RECOVERY_CLEARED_AT_KEY]);
    const raw = stored[RECOVERY_SNAPSHOT_KEY];
    const archive = parseRecoveryArchive(raw);
    if (raw !== undefined && archive === null) {
      const error = '自动恢复快照格式无效；原快照已保留。';
      await recordRecoveryFailure(error);
      return { restored: false, error, beforeCounts, afterCounts: beforeCounts };
    }
    if (archive === null) {
      return { restored: false };
    }
    if (archive.tombstone?.generation === archive.generation) return { restored: false };

    const clearedAt = stored[RECOVERY_CLEARED_AT_KEY];
    if (
      archive.operation === 'legacy' &&
      typeof clearedAt === 'number' &&
      clearedAt > archive.savedAt
    ) {
      return { restored: false };
    }

    const result = await importLocalData(store, archive.payload);
    if (!result.ok) {
      const error = result.errors.join('；');
      console.error('[BingeUp] 自动存档恢复失败，快照仍保留', result.errors);
      await recordRecoveryFailure(error);
      return { restored: false, error, beforeCounts, afterCounts: beforeCounts };
    }
    await clearRecoveryHealth();
    return {
      restored: true,
      beforeCounts,
      afterCounts: (await readStorageHealthData(store.database)).currentCounts,
    };
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
 * 日常写入已经同步更新快照；这里按数据库 generation/revision 判断同步状态，
 * 避免 service worker 每次启动都完整读取一遍大数据。
 */
export async function saveStartupRecoverySnapshot(
  store: LocalSettingsStore,
): Promise<StartupRecoverySnapshotResult> {
  try {
    const currentMeta = await readStorageMeta(store.database);
    const stored = await chrome.storage.local.get(RECOVERY_SNAPSHOT_KEY);
    const snapshot = parseSnapshot(stored[RECOVERY_SNAPSHOT_KEY]);
    const existing = diagnosticFromSnapshot(snapshot);
    const health = await inspectStorageHealth(store);
    if (health.status === 'attention') await activateRecoveryIsolation(health.issues);
    if (health.status !== 'healthy') return { saved: false, snapshot: existing };
    const archive = parseRecoveryArchive(stored[RECOVERY_SNAPSHOT_KEY]);
    if (archive !== null) {
      const errors = await validateSnapshotOnce(snapshotEntityFromArchive(archive));
      if (errors.length > 0) {
        await activateInvalidSnapshotIsolation(errors);
        return { saved: false, snapshot: existing };
      }
    }
    if (
      snapshot?.storage?.generation === currentMeta.generation &&
      snapshot.storage.revision === currentMeta.revision
    ) {
      if (currentMeta.pendingBackup) {
        await acknowledgeStorageBackup(store.database, currentMeta);
      }
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
