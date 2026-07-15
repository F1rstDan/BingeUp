import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalSettingsStore } from '@/storage/local-settings';
import { openDatabase } from '@/storage/database';
import { MIGRATIONS } from '@/storage/migrations';
import { DEFAULT_SETTINGS } from '@/settings/defaults';

const TEST_DB = 'test-authoritative-app-settings';

describe('LocalSettingsStore — 长期学习设置', () => {
  let db: IDBDatabase;
  beforeEach(async () => {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
        },
      },
    };
    db = await openDatabase(TEST_DB, MIGRATIONS);
  });
  afterEach(async () => {
    db.close();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(TEST_DB);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it('默认设置来自唯一默认值源', async () => {
    await expect(new LocalSettingsStore(db).getAppSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('保存时规范化并由 IndexedDB 跨实例读取', async () => {
    const writer = new LocalSettingsStore(db);
    await writer.setAppSettings({
      ...DEFAULT_SETTINGS,
      dailyNewWordLimit: 999,
      defaultCooldownMinutes: -1,
    });
    const saved = await new LocalSettingsStore(db).getAppSettings();
    expect(saved.dailyNewWordLimit).toBe(100);
    expect(saved.defaultCooldownMinutes).toBe(DEFAULT_SETTINGS.defaultCooldownMinutes);
  });

  it('恢复默认设置只改变长期学习设置', async () => {
    const store = new LocalSettingsStore(db);
    await store.setAppSettings({ ...DEFAULT_SETTINGS, dailyNewWordLimit: 20 });
    await store.disableSite('youtube.com');
    await store.markOnboardingCompleted();

    await store.resetAppSettings();

    await expect(store.getAppSettings()).resolves.toEqual(DEFAULT_SETTINGS);
    await expect(store.getSite('youtube.com')).resolves.toMatchObject({ enabled: false });
    await expect(store.isOnboardingCompleted()).resolves.toBe(true);
  });

  it('冷却配置实时派生自 IndexedDB 的长期学习设置', async () => {
    const store = new LocalSettingsStore(db);
    await store.setAppSettings({
      ...DEFAULT_SETTINGS,
      defaultCooldownMinutes: 9,
      consecutiveSkipCooldowns: [3, 30],
    });
    await expect(store.getCooldownConfig()).resolves.toEqual({
      defaultCooldownMinutes: 9,
      consecutiveSkipCooldowns: [3, 30],
    });
  });

  it('关闭连续跳过自动降频后，冷却配置不再提供递增档位', async () => {
    const store = new LocalSettingsStore(db);
    await store.setAppSettings({
      ...DEFAULT_SETTINGS,
      consecutiveSkipSlowdownEnabled: false,
    });

    await expect(store.getCooldownConfig()).resolves.toEqual({
      defaultCooldownMinutes: DEFAULT_SETTINGS.defaultCooldownMinutes,
      consecutiveSkipCooldowns: [],
    });
  });
});
