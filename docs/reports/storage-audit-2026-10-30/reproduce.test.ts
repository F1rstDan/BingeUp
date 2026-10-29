import 'fake-indexeddb/auto';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BuiltInWordBank } from '@/dictionary/built-in-word-bank';
import { LearningService } from '@/learning/learning-service';
import { DEFAULT_SETTINGS } from '@/settings/defaults';
import { idbClear, idbDelete, idbGetAll, idbPut, openDatabase, STORES } from '@/storage/database';
import { LocalSettingsStore } from '@/storage/local-settings';
import { CardRepository } from '@/storage/repositories/card-repository';
import { ReviewLogRepository } from '@/storage/repositories/review-log-repository';
import {
  RECOVERY_SNAPSHOT_KEY,
  inspectStorageHealth,
  isStorageIsolationActive,
  restoreRecoverySnapshotIfNeeded,
  saveRecoverySnapshot,
  saveStartupRecoverySnapshot,
} from '@/storage/recovery-snapshot';
import { importLocalData, type ExportPayload } from '@/storage/data-transfer';
import type { CardRecord, DeckRecord, WordRecord } from '@/types';

// 独立诊断用例，不进入默认测试集。失败表示当前实现未满足该用例的保护要求。
const NAME = 'storage-audit-isolated-2026-10-30';
const WORDS: WordRecord[] = ['high', 'low'].map((word, index) => ({
  id: `w-${word}`,
  word,
  lemma: word,
  partOfSpeech: ['adj.'],
  coreMeaningZh: [index === 0 ? '高的' : '低的'],
  difficulty: 1,
  frequencyRank: index + 1,
  source: 'audit',
  license: 'audit',
}));
const DECK: DeckRecord = {
  id: 'deck-daily-high-frequency',
  name: '日常高频',
  source: 'audit',
  license: 'audit',
  wordIds: WORDS.map((word) => word.id),
};
let db: IDBDatabase;
let store: LocalSettingsStore;
let values: Record<string, unknown>;

function service(): LearningService {
  return new LearningService({
    cards: new CardRepository(db),
    logs: new ReviewLogRepository(db),
    words: new BuiltInWordBank(),
    clock: { now: () => 10_000 },
    random: () => 0,
    settings: { get: () => store.getAppSettings() },
  });
}

function snapshot() {
  return values[RECOVERY_SNAPSHOT_KEY] as { savedAt: number; payload: ExportPayload };
}

async function reopen(): Promise<void> {
  db.close();
  db = await openDatabase(NAME);
  store = new LocalSettingsStore(db);
}

async function wipe(): Promise<void> {
  db.close();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  db = await openDatabase(NAME);
  store = new LocalSettingsStore(db);
}

beforeEach(async () => {
  values = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          return structuredClone(Object.fromEntries(list.map((key) => [key, values[key]])));
        },
        set: async (entries: Record<string, unknown>) => {
          Object.assign(values, structuredClone(entries));
        },
      },
    },
  });
  vi.spyOn(BuiltInWordBank.prototype, 'listWords').mockResolvedValue(WORDS);
  vi.spyOn(BuiltInWordBank.prototype, 'getDefaultDeck').mockResolvedValue(DECK);
  vi.spyOn(BuiltInWordBank.prototype, 'getDeck').mockImplementation(async (id) =>
    id === DECK.id ? DECK : null,
  );
  vi.spyOn(BuiltInWordBank.prototype, 'sampleDeckWords').mockImplementation(async (params) =>
    WORDS.filter((word) => !params.excludeWordIds.includes(word.id)).slice(0, params.count),
  );
  db = await openDatabase(NAME);
  store = new LocalSettingsStore(db);
});

afterEach(async () => {
  await wipe();
  db.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('CONTROL: 自报认识卡在连接关闭重开后仍存在，下一张新词不会重复', async () => {
  await service().selfReportKnown('w-high');
  await reopen();
  expect(await new CardRepository(db).getByWordId('w-high')).toMatchObject({
    stage: 'self-reported-known',
  });
  expect(await service().getNextItem()).toMatchObject({
    kind: 'new-word-presentation',
    presentation: { word: { id: 'w-low' } },
  });
});

it('CONTROL: 整库为空时能够从快照恢复自报认识卡', async () => {
  await service().selfReportKnown('w-high');
  expect(await saveRecoverySnapshot(store)).toBe(true);
  await wipe();
  expect((await restoreRecoverySnapshotIfNeeded(store)).restored).toBe(true);
  expect(await new CardRepository(db).getByWordId('w-high')).toBeDefined();
});

it('F1: 卡片丢失但行为事件尚在时，应隔离并保留健康快照', async () => {
  await service().selfReportKnown('w-high');
  await idbPut(db, STORES.behaviorEvents, {
    id: 'site-baseline', kind: 'site-enabled', occurredAt: 1, hostname: 'youtube.com', enabled: true,
  });
  await saveRecoverySnapshot(store);
  const healthySnapshot = structuredClone(snapshot());
  await idbClear(db, STORES.cards); // 故障注入，不代表已找到浏览器删卡原因。
  await reopen();
  expect((await restoreRecoverySnapshotIfNeeded(store)).restored).toBe(false);
  expect(await isStorageIsolationActive()).toBe(true);
  expect((await inspectStorageHealth(store)).status).toBe('isolated');
  expect(await idbGetAll(db, STORES.cards)).toEqual([]);
  expect(snapshot()).toEqual(healthySnapshot);
});

it('F2: 部分卡片丢失时，启动检查应保留原有较完整快照', async () => {
  await service().selfReportKnown('w-high');
  await service().selfReportKnown('w-low');
  await saveRecoverySnapshot(store);
  expect(snapshot().payload.data.cards).toHaveLength(2);
  const healthySnapshot = structuredClone(snapshot());
  const missing = await new CardRepository(db).getByWordId('w-high');
  await idbDelete(db, STORES.cards, missing!.id);
  await reopen();
  expect((await restoreRecoverySnapshotIfNeeded(store)).restored).toBe(false);
  expect((await saveStartupRecoverySnapshot(store)).saved).toBe(false);
  expect(await isStorageIsolationActive()).toBe(true);
  expect((await inspectStorageHealth(store)).status).toBe('isolated');
  expect(await idbGetAll(db, STORES.cards)).toHaveLength(1);
  expect(snapshot()).toEqual(healthySnapshot);
  expect(snapshot().payload.data.cards).toHaveLength(2);
});

it('F3: 同卡数但内容更新后快照失败，下一次启动应补齐最新状态', async () => {
  await service().selfReportKnown('w-high');
  await saveRecoverySnapshot(store);
  const card = (await new CardRepository(db).getByWordId('w-high'))!;
  await idbPut(db, STORES.cards, { ...card, updatedAt: 20_000, nextReviewAt: 99_000 });
  const storageWrite = vi.spyOn(chrome.storage.local, 'set').mockRejectedValue(new Error('quota'));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  expect(await saveRecoverySnapshot(store)).toBe(false);
  storageWrite.mockRestore();
  await reopen();
  await saveStartupRecoverySnapshot(store);
  expect(snapshot().payload.data.cards[0]!.updatedAt).toBe(20_000);
});

it('F4: 只有设置、没有学习卡的完整快照，也应能恢复设置', async () => {
  await store.setAppSettings({ ...DEFAULT_SETTINGS, dailyNewWordLimit: 8 });
  await saveRecoverySnapshot(store);
  await wipe();
  await restoreRecoverySnapshotIfNeeded(store);
  expect((await store.getAppSettings()).dailyNewWordLimit).toBe(8);
});

it('F5: 恢复因词库校验失败后，应隔离并保留故障前快照', async () => {
  await service().selfReportKnown('w-high');
  await saveRecoverySnapshot(store);
  const healthySnapshot = structuredClone(snapshot());
  await wipe();
  vi.mocked(BuiltInWordBank.prototype.listWords).mockResolvedValue([]);
  vi.mocked(BuiltInWordBank.prototype.getDeck).mockResolvedValue(null);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const recovery = await restoreRecoverySnapshotIfNeeded(store);
  expect(recovery.error).toBeDefined();
  expect((await saveStartupRecoverySnapshot(store)).saved).toBe(false);
  expect(await saveRecoverySnapshot(store)).toBe(false); // 对应继续操作并触发后台常规快照。
  expect(await isStorageIsolationActive()).toBe(true);
  expect((await inspectStorageHealth(store)).status).toBe('isolated');
  expect(snapshot()).toEqual(healthySnapshot);
  expect(snapshot().payload.data.cards).toHaveLength(1);
});

it('CONTROL: 原子提交的卡和日志写入在失败时一起回滚', async () => {
  await service().selfReportKnown('w-high');
  const card = (await new CardRepository(db).getByWordId('w-high'))!;
  await expect(new CardRepository(db).saveCardAndLog(
    { ...card, updatedAt: 20_000 },
    { cardId: card.id } as never, // 无日志主键，故意触发 DataError。
  )).rejects.toThrow();
  expect((await idbGetAll<CardRecord>(db, STORES.cards))[0]!.updatedAt).toBe(10_000);
  expect(await idbGetAll(db, STORES.reviewLogs)).toEqual([]);
});

// 可选：校验本机已有备份。只导入隔离数据库，不修改备份文件。
for (const path of (process.env.BINGEUP_AUDIT_BACKUPS ?? '').split(';').filter(Boolean)) {
  it(`BACKUP: ${path}`, async () => {
    const [words, decks, payload] = await Promise.all([
      readFile('public/dictionaries/words.json', 'utf8').then(JSON.parse),
      readFile('public/dictionaries/decks.json', 'utf8').then(JSON.parse),
      readFile(path, 'utf8').then(JSON.parse),
    ]);
    vi.mocked(BuiltInWordBank.prototype.listWords).mockResolvedValue(words);
    vi.mocked(BuiltInWordBank.prototype.getDeck).mockImplementation(async (id) =>
      (decks as DeckRecord[]).find((deck) => deck.id === id) ?? null,
    );
    const result = await importLocalData(store, payload);
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, errors: [] });
    expect(await idbGetAll(db, STORES.cards)).toHaveLength(payload.data.cards.length);
  });
}
