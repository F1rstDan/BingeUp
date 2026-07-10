import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalSettingsStore } from '@/storage/local-settings';
import type { CooldownState, SiteSettings } from '@/types';

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
  return {
    chromeStub,
    rawStore: store,
  };
}

describe('LocalSettingsStore — 重启持久化', () => {
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    const mock = installChromeStorageMock();
    cleanup = () => {
      delete (globalThis as { chrome?: unknown }).chrome;
    };
    void mock;
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it('写入冷却与站点设置后，新实例读取仍能拿到相同状态（模拟重启）', async () => {
    const writer = new LocalSettingsStore();
    const cooldown: CooldownState = {
      nextAllowedAt: 5_000_000,
      consecutiveSkipCount: 2,
    };
    const site: SiteSettings = {
      enabled: true,
      mode: 'full-adaptation',
      firstQuestionPending: false,
    };

    await writer.setCooldown(cooldown);
    await writer.setSite('www.bilibili.com', site);

    // 模拟浏览器重启：丢弃旧实例，用新实例从 chrome.storage.local 重新读取。
    const reader = new LocalSettingsStore();
    const restoredCooldown = await reader.getCooldown();
    const restoredSite = await reader.getSite('www.bilibili.com');

    expect(restoredCooldown).toEqual(cooldown);
    expect(restoredSite).toEqual(site);
  });

  it('首次触发标记处理后，新实例读取到 firstQuestionPending=false', async () => {
    const writer = new LocalSettingsStore();
    await writer.enableSite('www.bilibili.com');
    await writer.markFirstQuestionHandled('www.bilibili.com');

    const reader = new LocalSettingsStore();
    const site = await reader.getSite('www.bilibili.com');

    expect(site.enabled).toBe(true);
    expect(site.firstQuestionPending).toBe(false);
  });

  it('未存储任何数据时，新实例返回默认空状态', async () => {
    const reader = new LocalSettingsStore();
    const cooldown = await reader.getCooldown();
    const site = await reader.getSite('unknown.host');

    expect(cooldown).toEqual({ nextAllowedAt: 0, consecutiveSkipCount: 0 });
    expect(site).toEqual({ enabled: false, mode: 'full-adaptation', firstQuestionPending: false });
  });
});
