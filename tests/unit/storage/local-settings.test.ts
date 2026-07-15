import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalSettingsStore } from '@/storage/local-settings';
import { openDatabase } from '@/storage/database';
import { MIGRATIONS } from '@/storage/migrations';
import { applyComplete, applySkip } from '@/cooldown/cooldown-rules';
import { DEFAULT_SETTINGS } from '@/settings/defaults';

const TEST_DB = 'test-authoritative-local-settings';

function installRuntimeStorageMock() {
  const values: Record<string, unknown> = {};
  const chromeStub = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: values[key] })),
        set: vi.fn(async (entries: Record<string, unknown>) => Object.assign(values, entries)),
      },
    },
  };
  (globalThis as unknown as { chrome: typeof chromeStub }).chrome = chromeStub;
  return { values, chromeStub };
}

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(TEST_DB);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
  });
}

describe('LocalSettingsStore — ADR-0003 存储边界', () => {
  let db: IDBDatabase;
  let runtime: ReturnType<typeof installRuntimeStorageMock>;

  beforeEach(async () => {
    runtime = installRuntimeStorageMock();
    db = await openDatabase(TEST_DB, MIGRATIONS);
  });
  afterEach(async () => {
    db.close();
    await deleteDatabase();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it('长期网站设置和安装引导状态由 IndexedDB 跨实例持久化', async () => {
    const writer = new LocalSettingsStore(db);
    await writer.disableSite('www.youtube.com');
    await writer.markOnboardingCompleted();

    const reader = new LocalSettingsStore(db);
    await expect(reader.getSite('m.youtube.com')).resolves.toMatchObject({ enabled: false });
    await expect(reader.isOnboardingCompleted()).resolves.toBe(true);
    expect(runtime.chromeStub.storage.local.set).not.toHaveBeenCalled();
  });

  it('冷却和临时暂停只写入 chrome.storage.local', async () => {
    const store = new LocalSettingsStore(db);
    await store.setCooldown({ nextAllowedAt: 5_000, consecutiveSkipCount: 2 });
    await store.setGlobalPausedUntil(9_000);

    expect(runtime.chromeStub.storage.local.set).toHaveBeenCalled();
    await expect(store.getCooldown()).resolves.toEqual({
      nextAllowedAt: 5_000,
      consecutiveSkipCount: 2,
    });
    await expect(store.getGlobalPausedUntil()).resolves.toBe(9_000);
    await expect(store.getAuthoritativeState()).resolves.toMatchObject({
      sites: {},
      onboardingCompleted: false,
    });
  });

  it('播放恢复失败提示按本地自然日全局最多领取三次', async () => {
    const store = new LocalSettingsStore(db);
    const dayOne = new Date(2026, 6, 15, 10).getTime();
    const dayTwo = new Date(2026, 6, 16, 1).getTime();

    await expect(store.claimPlaybackRecoveryNotice(dayOne)).resolves.toBe(true);
    await expect(store.claimPlaybackRecoveryNotice(dayOne + 1)).resolves.toBe(true);
    await expect(store.claimPlaybackRecoveryNotice(dayOne + 2)).resolves.toBe(true);
    await expect(store.claimPlaybackRecoveryNotice(dayOne + 3)).resolves.toBe(false);
    await expect(store.claimPlaybackRecoveryNotice(dayTwo)).resolves.toBe(true);
  });

  it('默认支持网站保持启用，自定义网站按领域规则规范化', async () => {
    const store = new LocalSettingsStore(db);
    await expect(store.getSite('www.bilibili.com')).resolves.toMatchObject({
      enabled: true,
      mode: 'full-adaptation',
    });
    await store.enableSite('example.com');
    await expect(store.getSite('example.com')).resolves.toMatchObject({
      enabled: true,
      mode: 'generic-video',
    });
  });

  it('首次触发、拒绝计数和站点删除保持原有业务语义', async () => {
    const store = new LocalSettingsStore(db);
    await store.enableSite('bilibili.com');
    await store.markFirstQuestionHandled('www.bilibili.com');
    await store.recordPromptDecline('m.bilibili.com');
    await expect(store.getSite('bilibili.com')).resolves.toMatchObject({
      firstQuestionPending: false,
      promptDeclineCount: 1,
    });
    await store.removeSite('bilibili.com');
    await expect(store.listSites()).resolves.toEqual([]);
  });
});

// ─── Issue #19 AC6/AC7：并发冷却更新串行化 ────────────────────────

describe('LocalSettingsStore — 并发冷却更新串行化（Issue #19 AC6/AC7）', () => {
  let db: IDBDatabase;

  beforeEach(async () => {
    installRuntimeStorageMock();
    db = await openDatabase(TEST_DB, MIGRATIONS);
  });
  afterEach(async () => {
    db.close();
    await deleteDatabase();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  async function applyKnownConfig(store: LocalSettingsStore) {
    await store.setAppSettings({
      ...DEFAULT_SETTINGS,
      defaultCooldownMinutes: 5,
      consecutiveSkipCooldowns: [1, 2, 3],
    });
    return store.getCooldownConfig();
  }

  it('AC6：并发 setCooldown 与 setGlobalPausedUntil 不丢失更新', async () => {
    const store = new LocalSettingsStore(db);
    // 两类运行时状态并发写回：冷却与全局暂停。无锁时会互相覆盖丢失。
    await Promise.all([
      store.setCooldown({ nextAllowedAt: 5_000, consecutiveSkipCount: 2 }),
      store.setGlobalPausedUntil(9_000),
    ]);

    const state = await store.getRuntimeState();
    expect(state.cooldown).toEqual({ nextAllowedAt: 5_000, consecutiveSkipCount: 2 });
    expect(state.globalPausedUntil).toBe(9_000);
  });

  it('AC6：并发跳过更新连续跳过计数不丢失（三调用方各跳一次→计数为 3）', async () => {
    const store = new LocalSettingsStore(db);
    const config = await applyKnownConfig(store);

    // 三个调用方并发跳过：无串行化时三方都读到 count=0，最终只 +1。
    await Promise.all([
      store.updateCooldown((before) => applySkip(before, 1000, config)),
      store.updateCooldown((before) => applySkip(before, 1000, config)),
      store.updateCooldown((before) => applySkip(before, 1000, config)),
    ]);

    const after = await store.getCooldown();
    expect(after.consecutiveSkipCount).toBe(3);
  });

  it('AC7：完成在前、跳过在后并发时最终状态确定（count=1）', async () => {
    const store = new LocalSettingsStore(db);
    const config = await applyKnownConfig(store);
    // 预置非零连续跳过计数
    await store.setCooldown({ nextAllowedAt: 0, consecutiveSkipCount: 2 });

    // 数组中完成调用先于跳过调用：按到达顺序，完成先应用（count→0），跳过后应用（count→1）
    await Promise.all([
      store.updateCooldown(() => applyComplete(2000, config)),
      store.updateCooldown((before) => applySkip(before, 2000, config)),
    ]);

    const after = await store.getCooldown();
    expect(after.consecutiveSkipCount).toBe(1);
  });

  it('AC7：跳过在前、完成在后并发时最终状态确定（count=0）', async () => {
    const store = new LocalSettingsStore(db);
    const config = await applyKnownConfig(store);
    await store.setCooldown({ nextAllowedAt: 0, consecutiveSkipCount: 2 });

    // 跳过调用先于完成调用：跳过先应用（count→3），完成后应用（count→0）
    await Promise.all([
      store.updateCooldown((before) => applySkip(before, 2000, config)),
      store.updateCooldown(() => applyComplete(2000, config)),
    ]);

    const after = await store.getCooldown();
    expect(after.consecutiveSkipCount).toBe(0);
  });

  it('AC7：并发完成与跳过后冷却截止时间反映最后一次应用', async () => {
    const store = new LocalSettingsStore(db);
    const config = await applyKnownConfig(store);

    // 完成先（5 分钟冷却，截止 = 2000 + 5*60000 = 302000）
    // 跳过后（第 1 次跳过 = 1 分钟冷却，截止 = 2000 + 1*60000 = 62000）
    await Promise.all([
      store.updateCooldown(() => applyComplete(2000, config)),
      store.updateCooldown((before) => applySkip(before, 2000, config)),
    ]);

    const after = await store.getCooldown();
    // 最后应用的是跳过：截止时间应为 1 分钟档
    expect(after.nextAllowedAt).toBe(2000 + 1 * 60_000);
  });
});
