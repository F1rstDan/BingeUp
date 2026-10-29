import {
  exportLocalData,
  importLocalData,
  validateLocalData,
  type ExportPayload,
} from '@/storage/data-transfer';
import { STORES, idbCount } from '@/storage/database';
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
  generation: string;
  savedAt: number;
  mode: 'full' | 'compact';
  payload: ExportPayload;
}

type UserRecoveryOperation = 'import' | 'clear-learning-progress' | 'clear-all' | 'rebuild';

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
  operation: 'save' | 'reset';
  resetKind?: UserRecoveryOperation;
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
  if (!isRecord(value) || value.version !== 1 || typeof value.savedAt !== 'number') return null;
  const payload = value.payload;
  if (!isRecord(payload) || payload.version !== 1) return null;
  if (!isRecord(payload.authoritativeState) || !isRecord(payload.data)) return null;
  if (!Array.isArray(payload.data.cards)) return null;
  return {
    version: 1,
    generation: typeof value.generation === 'string' ? value.generation : 'legacy',
    savedAt: value.savedAt,
    mode: value.mode === 'compact' ? 'compact' : 'full',
    payload: payload as unknown as ExportPayload,
  };
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
  };
}

async function writeSnapshotArchive(archive: RecoverySnapshotArchive): Promise<void> {
  await chrome.storage.local.set({ [RECOVERY_SNAPSHOT_KEY]: archive });
}

async function validateSnapshot(snapshot: RecoverySnapshot): Promise<string[]> {
  const result = await validateLocalData(snapshot.payload);
  return result.ok ? [] : result.errors;
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
  return updateRecoveryHealthState((state) => ({
    ...state,
    isolation: state.isolation ?? { detectedAt: Date.now(), issues },
  }));
}

async function recordRecoveryFailure(message: string): Promise<void> {
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
  return updateRecoveryHealthState(() => ({ version: 1 }));
}

/** 学习入口使用该轻量状态；需要问题明细时调用健康检查。 */
export async function isStorageIsolationActive(): Promise<boolean> {
  try {
    const stored = await chrome.storage.local.get(RECOVERY_HEALTH_KEY);
    return parseRecoveryHealthState(stored[RECOVERY_HEALTH_KEY]).isolation !== undefined;
  } catch (error) {
    console.error('[BingeUp] 读取存档隔离状态失败', error);
    return true;
  }
}

/** 快照串行写入，避免并发消息把较旧的导出结果覆盖到较新的快照上。 */
let snapshotWriteQueue: Promise<void> = Promise.resolve();
let pendingSnapshotWrite: PendingSnapshotWrite | null = null;

function enqueueSnapshotWrite(
  store: LocalSettingsStore,
  operation: PendingSnapshotWrite['operation'],
  resetKind?: UserRecoveryOperation,
): Promise<SnapshotWriteResult> {
  const tail = pendingSnapshotWrite;
  if (operation === 'save' && tail?.operation === 'save' && tail.database === store.database) {
    return tail.promise;
  }

  const task = { database: store.database, operation, resetKind } as PendingSnapshotWrite;
  task.promise = snapshotWriteQueue.then(() => {
    if (pendingSnapshotWrite === task) pendingSnapshotWrite = null;
    return operation === 'reset'
      ? resetRecoverySnapshotNow(store, resetKind ?? 'clear-all')
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

async function writeProtectedRecoverySnapshot(
  store: LocalSettingsStore,
): Promise<SnapshotWriteResult> {
  const health = await inspectStorageHealth(store);
  if (health.status === 'attention') await activateRecoveryIsolation(health.issues);
  if (health.status !== 'healthy') return { saved: false, snapshot: null };
  const stored = await chrome.storage.local.get(RECOVERY_SNAPSHOT_KEY);
  const archive = parseRecoveryArchive(stored[RECOVERY_SNAPSHOT_KEY]);
  if (archive?.operation === 'legacy') {
    const errors = await validateSnapshot(snapshotEntityFromArchive(archive));
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
    const payload = await exportLocalData(store);
    const generation = createGeneration();
    let snapshot: RecoverySnapshot = {
      version: 1,
      generation,
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
  const stored = await chrome.storage.local.get([RECOVERY_SNAPSHOT_KEY, RECOVERY_HEALTH_KEY]);
  const storedSnapshot = stored[RECOVERY_SNAPSHOT_KEY];
  const archive = parseRecoveryArchive(storedSnapshot);
  const snapshot = archive === null ? null : snapshotEntityFromArchive(archive);
  const healthState = parseRecoveryHealthState(stored[RECOVERY_HEALTH_KEY]);
  const { currentCounts, cards, reviewLogs } = await readStorageHealthData(store.database);
  const snapshotCounts = snapshot === null ? undefined : countsFromPayload(snapshot.payload);
  if (storedSnapshot !== undefined && snapshot === null) {
    issues.push({
      code: 'snapshot-invalid',
      message: '恢复快照格式无效；原快照已保留。',
    });
  }
  if (snapshotCounts !== undefined && currentCounts.cards < snapshotCounts.cards) {
    issues.push({
      code: 'card-count-decreased',
      message: '当前学习卡数量少于健康快照的学习卡数量。',
      currentCards: currentCounts.cards,
      healthyCards: snapshotCounts.cards,
    });
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
      healthState.isolation === undefined
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
): Promise<SnapshotWriteResult> {
  let previous: RecoverySnapshot | null = null;
  if (operation === 'import') {
    const stored = await chrome.storage.local.get(RECOVERY_SNAPSHOT_KEY);
    const archive = parseRecoveryArchive(stored[RECOVERY_SNAPSHOT_KEY]);
    if (archive !== null && archive.operation !== 'legacy') {
      previous = snapshotEntityFromArchive(archive);
    } else if (archive !== null) {
      const errors = await validateSnapshot(snapshotEntityFromArchive(archive));
      if (errors.length === 0) previous = snapshotEntityFromArchive(archive);
    }
  }
  const result = await writeRecoverySnapshot(store, {
    previous,
    operation,
    tombstoneKind: operation === 'import' ? null : operation,
  });
  if (result.saved) await clearRecoveryHealth();
  return result;
}

export async function resetRecoverySnapshot(
  store: LocalSettingsStore,
  operation: UserRecoveryOperation = 'clear-all',
): Promise<boolean> {
  return (await enqueueSnapshotWrite(store, 'reset', operation)).saved;
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
    if (cards > 0 || logs > 0 || sessions > 0 || events > 0) {
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
      return { restored: false, error };
    }
    if (archive === null || archive.payload.data.cards.length === 0) {
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
      return { restored: false, error };
    }
    await clearRecoveryHealth();
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
    const health = await inspectStorageHealth(store);
    if (health.status === 'attention') await activateRecoveryIsolation(health.issues);
    if (health.status !== 'healthy') return { saved: false, snapshot: existing };
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
