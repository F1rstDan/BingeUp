import type {
  CardRecord,
  LegacyDisposition,
  LegacyRegistry,
  LegacyRegistryEntry,
  ReviewLogRecord,
} from '@/types';
import { STORES, idbGet } from '@/storage/database';

export const CONTENT_COMPAT_ID = 'content-compat-v1';

export interface OriginalCardSnapshot {
  card: CardRecord;
  /** 转换后的规范词 ID，用于历史统计关联。 */
  canonicalWordId: string;
  reviewLogIds: string[];
}

export interface CardMergeReference {
  fromCardId: string;
  toCardId: string;
  fromWordId: string;
  toWordId: string;
}

/** 与当前设置记录分开保存的兼容依据；不作为第二张可调度卡。 */
export interface ContentCompatibilityRecord {
  id: typeof CONTENT_COMPAT_ID;
  schemaVersion: 1;
  contentVersion: string;
  registryVersion: string;
  registryHash: string;
  completedAt: number;
  originals: OriginalCardSnapshot[];
  merges: CardMergeReference[];
  deactivatedCardIds: string[];
}

export interface CompatibilityPlan {
  cards: CardRecord[];
  logs: ReviewLogRecord[];
  record: ContentCompatibilityRecord;
}

function byteCompare(a: string, b: string): number {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  }
  return left.length - right.length;
}

function registryMap(registry: LegacyRegistry): Map<string, LegacyRegistryEntry> {
  return new Map(registry.entries.map((entry) => [entry.legacyId, entry]));
}

export interface ResolvedIdentity {
  canonicalId: string;
  disposition: LegacyDisposition;
}

/** 只解析注册表精确命中的身份；未知 ID 返回 null。 */
export function resolveIdentity(
  registry: LegacyRegistry,
  legacyId: string,
): ResolvedIdentity | null {
  const byId = registryMap(registry);
  let entry = byId.get(legacyId);
  if (!entry) return null;
  const seen = new Set<string>();
  while (entry.disposition === 'merge') {
    if (seen.has(entry.legacyId)) throw new Error(`身份注册表存在循环映射：${legacyId}`);
    seen.add(entry.legacyId);
    const next = byId.get(entry.canonicalId);
    if (!next) throw new Error(`身份注册表映射悬空：${entry.canonicalId}`);
    entry = next;
  }
  return { canonicalId: entry.canonicalId, disposition: entry.disposition };
}

function recentWrongAt(logs: ReviewLogRecord[]): number | undefined {
  return [...logs]
    .sort((a, b) => b.reviewedAt - a.reviewedAt || byteCompare(a.id, b.id))
    .slice(0, 3)
    .find((log) => !log.isCorrect)?.reviewedAt;
}

/**
 * 计算身份转换与合卡结果，不写数据库。
 *
 * 合卡身份：创建时间升序、卡 ID 字节序升序的首项。
 * 合卡进度：更新时间降序、卡 ID 字节序升序的首项。
 * 到期时间取组内已定义最早值；阶段和 FSRS 完整取进度卡，不逐字段拼接。
 */
export function buildCompatibilityPlan(input: {
  cards: CardRecord[];
  logs: ReviewLogRecord[];
  registry: LegacyRegistry;
  contentVersion: string;
  now: number;
}): CompatibilityPlan {
  const { cards, logs, registry, contentVersion, now } = input;
  const groups = new Map<string, CardRecord[]>();
  const untouched: CardRecord[] = [];
  for (const card of cards) {
    const identity = resolveIdentity(registry, card.wordId);
    if (!identity) {
      untouched.push(card);
      continue;
    }
    const group = groups.get(identity.canonicalId) ?? [];
    group.push(card);
    groups.set(identity.canonicalId, group);
  }

  const finalCards: CardRecord[] = [...untouched];
  const finalLogs = logs.map((log) => ({ ...log }));
  const logsByCardId = new Map<string, ReviewLogRecord[]>();
  for (const log of finalLogs) {
    const list = logsByCardId.get(log.cardId) ?? [];
    list.push(log);
    logsByCardId.set(log.cardId, list);
  }
  const originals: OriginalCardSnapshot[] = [];
  const merges: CardMergeReference[] = [];
  const deactivatedCardIds: string[] = [];

  for (const [canonicalId, group] of groups) {
    const identity = resolveIdentity(registry, group[0]!.wordId);
    if (!identity) continue;
    const byIdentity = [...group].sort(
      (a, b) => a.createdAt - b.createdAt || byteCompare(a.id, b.id),
    );
    const retained = byIdentity[0]!;
    const byProgress = [...group].sort(
      (a, b) => b.updatedAt - a.updatedAt || byteCompare(a.id, b.id),
    );
    const progress = byProgress[0]!;
    const definedDue = group
      .map((card) => card.nextReviewAt)
      .filter((value): value is number => value !== undefined);
    const mergedLogs = finalLogs.filter((log) => group.some((card) => card.id === log.cardId));

    const merged: CardRecord = {
      ...progress,
      id: retained.id,
      wordId: canonicalId,
      deckId: retained.deckId,
      createdAt: retained.createdAt,
      origin: retained.origin,
      updatedAt: progress.updatedAt,
      nextReviewAt: definedDue.length > 0 ? Math.min(...definedDue) : undefined,
      schedulerState: progress.schedulerState,
      lastWrongAt: recentWrongAt(mergedLogs),
    };
    if (identity.disposition === 'deactivate' || group.some((card) => card.disabled)) {
      merged.disabled = true;
    } else delete merged.disabled;
    finalCards.push(merged);

    const changed =
      group.length > 1 || retained.wordId !== canonicalId || identity.disposition === 'deactivate';
    if (!changed) continue;

    for (const card of group) {
      originals.push({
        card: { ...card },
        canonicalWordId: canonicalId,
        reviewLogIds: finalLogs.filter((log) => log.cardId === card.id).map((log) => log.id),
      });
      if (card.id !== retained.id) {
        merges.push({
          fromCardId: card.id,
          toCardId: retained.id,
          fromWordId: card.wordId,
          toWordId: canonicalId,
        });
      }
    }
    if (identity.disposition === 'deactivate') deactivatedCardIds.push(merged.id);
  }

  const cardIdMap = new Map<string, string>();
  for (const merge of merges) cardIdMap.set(merge.fromCardId, merge.toCardId);
  const rebind = new Map<string, { cardId: string; wordId: string }>();
  for (const [canonicalId, group] of groups) {
    const retained = [...group].sort(
      (a, b) => a.createdAt - b.createdAt || byteCompare(a.id, b.id),
    )[0]!;
    for (const card of group) {
      rebind.set(card.id, { cardId: retained.id, wordId: canonicalId });
    }
  }
  const finalLogsMapped = finalLogs.map((log) => {
    const target = rebind.get(log.cardId);
    return target ? { ...log, ...target } : log;
  });

  return {
    cards: finalCards,
    logs: finalLogsMapped,
    record: {
      id: CONTENT_COMPAT_ID,
      schemaVersion: 1,
      contentVersion,
      registryVersion: registry.registryVersion,
      registryHash: registry.registryHash,
      completedAt: now,
      originals,
      merges,
      deactivatedCardIds,
    },
  };
}

export async function getContentCompatibility(
  db: IDBDatabase,
): Promise<ContentCompatibilityRecord | null> {
  return (
    (await idbGet<ContentCompatibilityRecord>(db, STORES.authoritativeState, CONTENT_COMPAT_ID)) ??
    null
  );
}

/** 在一个事务内替换卡、日志并写入完成标记；任一步失败全部回滚。 */
export function applyCompatibilityPlan(db: IDBDatabase, plan: CompatibilityPlan): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      [STORES.cards, STORES.reviewLogs, STORES.authoritativeState],
      'readwrite',
    );
    try {
      const cardsStore = tx.objectStore(STORES.cards);
      cardsStore.clear();
      for (const card of plan.cards) cardsStore.put(card);
      const logsStore = tx.objectStore(STORES.reviewLogs);
      logsStore.clear();
      for (const log of plan.logs) logsStore.put(log);
      tx.objectStore(STORES.authoritativeState).put(plan.record);
    } catch (error) {
      tx.abort();
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('内容兼容转换失败'));
    tx.onabort = () => reject(tx.error ?? new Error('内容兼容转换事务已中止'));
  });
}

/** 预加载注册表后执行转换；同版本重复启动直接跳过。 */
export async function prepareContentCompatibility(
  db: IDBDatabase,
  registry: LegacyRegistry,
  contentVersion: string,
  now: number,
): Promise<ContentCompatibilityRecord> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      [STORES.cards, STORES.reviewLogs, STORES.authoritativeState],
      'readwrite',
    );
    const cardsStore = tx.objectStore(STORES.cards);
    const logsStore = tx.objectStore(STORES.reviewLogs);
    const stateStore = tx.objectStore(STORES.authoritativeState);
    const cardsRequest = cardsStore.getAll();
    const logsRequest = logsStore.getAll();
    const compatibilityRequest = stateStore.get(CONTENT_COMPAT_ID);
    let cards: CardRecord[] | null = null;
    let logs: ReviewLogRecord[] | null = null;
    let existing: ContentCompatibilityRecord | null | undefined;
    let result: ContentCompatibilityRecord | null = null;

    const finish = (): void => {
      if (cards === null || logs === null || existing === undefined) return;
      if (
        existing &&
        existing.contentVersion === contentVersion &&
        existing.registryHash === registry.registryHash
      ) {
        result = existing;
        return;
      }
      try {
        const plan = buildCompatibilityPlan({ cards, logs, registry, contentVersion, now });
        result = plan.record;
        cardsStore.clear();
        for (const card of plan.cards) cardsStore.put(card);
        logsStore.clear();
        for (const log of plan.logs) logsStore.put(log);
        stateStore.put(plan.record);
      } catch (error) {
        tx.abort();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };

    cardsRequest.onsuccess = () => {
      cards = cardsRequest.result as CardRecord[];
      finish();
    };
    logsRequest.onsuccess = () => {
      logs = logsRequest.result as ReviewLogRecord[];
      finish();
    };
    compatibilityRequest.onsuccess = () => {
      existing = (compatibilityRequest.result as ContentCompatibilityRecord | undefined) ?? null;
      finish();
    };
    tx.oncomplete = () => {
      if (result) resolve(result);
      else reject(new Error('内容兼容转换未产生完成标记'));
    };
    tx.onerror = () => reject(tx.error ?? new Error('内容兼容转换失败'));
    tx.onabort = () => reject(tx.error ?? new Error('内容兼容转换事务已中止'));
  });
}

/** 冻结的旧成员关系，用于 v1 备份先校验原引用。 */
export function legacyMembership(registry: LegacyRegistry): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const entry of registry.entries) {
    for (const membership of entry.original.decks) {
      const set = result.get(membership.deckId) ?? new Set<string>();
      set.add(entry.legacyId);
      result.set(membership.deckId, set);
    }
  }
  return result;
}

export interface AcceptanceEvent {
  cardId: string;
  createdAt: number;
}

/** 合并当前卡与兼容记录中的原接受事实；按卡 ID 去重，不重复发放额度。 */
export function acceptanceEvents(
  cards: CardRecord[],
  compatibility: ContentCompatibilityRecord | null,
): AcceptanceEvent[] {
  const events = new Map<string, AcceptanceEvent>();
  for (const card of cards) {
    if ((card.origin ?? 'accepted-new') === 'accepted-new') {
      events.set(card.id, { cardId: card.id, createdAt: card.createdAt });
    }
  }
  for (const original of compatibility?.originals ?? []) {
    const card = original.card;
    if ((card.origin ?? 'accepted-new') === 'accepted-new') {
      events.set(card.id, { cardId: card.id, createdAt: card.createdAt });
    }
  }
  return [...events.values()];
}
