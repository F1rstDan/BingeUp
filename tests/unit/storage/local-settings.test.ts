import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalSettingsStore } from '@/storage/local-settings';
import { openDatabase } from '@/storage/database';
import { MIGRATIONS } from '@/storage/migrations';

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
