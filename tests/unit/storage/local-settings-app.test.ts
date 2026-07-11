import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalSettingsStore } from '@/storage/local-settings';
import { DEFAULT_SETTINGS } from '@/settings/defaults';
import type { AppSettings, SiteSettings } from '@/types';

/** 内存态 chrome.storage.local，模拟浏览器持久化。 */
function installChromeStorageMock() {
  const store: Record<string, unknown> = {};
  const chromeStub = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: store[key] })),
        set: vi.fn(async (entries: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(entries)) {
            store[k] = v;
          }
        }),
      },
    },
  };
  (globalThis as unknown as { chrome: typeof chromeStub }).chrome = chromeStub;
  return { rawStore: store };
}

describe('LocalSettingsStore — 应用设置（Issue #10 AC1/AC3）', () => {
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    installChromeStorageMock();
    cleanup = () => {
      delete (globalThis as { chrome?: unknown }).chrome;
    };
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it('初始返回默认应用设置', async () => {
    const store = new LocalSettingsStore();
    await expect(store.getAppSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('保存应用设置后新实例读取到相同值（持久化 + 自动修正）', async () => {
    const writer = new LocalSettingsStore();
    const next: AppSettings = {
      ...DEFAULT_SETTINGS,
      defaultCooldownMinutes: 7,
      dailyNewWordLimit: 12,
      spellingEnabled: false,
      longVideoTimedLearningEnabled: true,
      longVideoIntervalMinutes: 20,
    };
    await writer.setAppSettings(next);

    const reader = new LocalSettingsStore();
    await expect(reader.getAppSettings()).resolves.toEqual(next);
  });

  it('保存非法设置时自动修正后再持久化（AC3）', async () => {
    const writer = new LocalSettingsStore();
    const bad = {
      ...DEFAULT_SETTINGS,
      defaultCooldownMinutes: -1,
      dailyNewWordLimit: 999,
    };
    await writer.setAppSettings(bad);

    const reader = new LocalSettingsStore();
    const out = await reader.getAppSettings();
    expect(out.defaultCooldownMinutes).toBe(DEFAULT_SETTINGS.defaultCooldownMinutes);
    expect(out.dailyNewWordLimit).toBe(100);
  });

  it('resetAppSettings 恢复默认设置', async () => {
    const writer = new LocalSettingsStore();
    await writer.setAppSettings({ ...DEFAULT_SETTINGS, dailyNewWordLimit: 20 });
    await writer.resetAppSettings();

    const reader = new LocalSettingsStore();
    await expect(reader.getAppSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('冷却配置从持久化的应用设置派生（AC3 实时生效）', async () => {
    const writer = new LocalSettingsStore();
    await writer.setAppSettings({
      ...DEFAULT_SETTINGS,
      defaultCooldownMinutes: 9,
      consecutiveSkipCooldowns: [3, 30],
    });

    const reader = new LocalSettingsStore();
    const config = await reader.getCooldownConfig();
    expect(config.defaultCooldownMinutes).toBe(9);
    expect(config.consecutiveSkipCooldowns).toEqual([3, 30]);
  });
});

describe('LocalSettingsStore — 站点列表与删除（Issue #10 AC2/AC5）', () => {
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    installChromeStorageMock();
    cleanup = () => {
      delete (globalThis as { chrome?: unknown }).chrome;
    };
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it('listSites 返回所有已持久化的站点设置', async () => {
    const writer = new LocalSettingsStore();
    await writer.enableSite('bilibili.com');
    await writer.enableSite('youtube.com');

    const reader = new LocalSettingsStore();
    const sites = await reader.listSites();
    const keys = sites.map((s) => s.hostname).sort();
    expect(keys).toEqual(['bilibili.com', 'youtube.com']);
    const bilibili = sites.find((s) => s.hostname === 'bilibili.com')!;
    expect(bilibili.settings.enabled).toBe(true);
  });

  it('removeSite 删除站点后列表不再包含它', async () => {
    const writer = new LocalSettingsStore();
    await writer.enableSite('bilibili.com');
    await writer.enableSite('youtube.com');
    await writer.removeSite('youtube.com');

    const reader = new LocalSettingsStore();
    const sites = await reader.listSites();
    expect(sites.map((s) => s.hostname)).toEqual(['bilibili.com']);
  });

  it('removeSite 删除不存在的站点不报错', async () => {
    const writer = new LocalSettingsStore();
    await expect(writer.removeSite('not.exist')).resolves.toBeUndefined();
  });

  it('setSite 在受支持站点上保留基础网页模式触发开关（AC2）', async () => {
    const writer = new LocalSettingsStore();
    // 用户把 bilibili 显式降级为基础网页模式并关闭滚动触发。
    const downgraded: SiteSettings = {
      enabled: true,
      mode: 'basic-web',
      firstQuestionPending: false,
      pageLoadTrigger: false,
      scrollTrigger: true,
    };
    await writer.setSite('bilibili.com', downgraded);

    const reader = new LocalSettingsStore();
    const site = await reader.getSite('bilibili.com');
    expect(site.mode).toBe('basic-web');
    expect(site.pageLoadTrigger).toBe(false);
    expect(site.scrollTrigger).toBe(true);
  });

  it('setSite 在非基础网页模式下不保留触发开关（AC2）', async () => {
    const writer = new LocalSettingsStore();
    await writer.setSite('bilibili.com', {
      enabled: true,
      mode: 'full-adaptation',
      firstQuestionPending: false,
      pageLoadTrigger: true,
      scrollTrigger: true,
    });

    const reader = new LocalSettingsStore();
    const site = await reader.getSite('bilibili.com');
    expect(site.mode).toBe('full-adaptation');
    expect(site.pageLoadTrigger).toBeUndefined();
    expect(site.scrollTrigger).toBeUndefined();
  });
});
