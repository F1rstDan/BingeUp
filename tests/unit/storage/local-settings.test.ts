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

  it('未存储任何数据时，受支持站点默认未启用（等待引导，Issue #9）', async () => {
    const reader = new LocalSettingsStore();
    const cooldown = await reader.getCooldown();
    const site = await reader.getSite('www.bilibili.com');

    expect(cooldown).toEqual({ nextAllowedAt: 0, consecutiveSkipCount: 0 });
    expect(site).toEqual({ enabled: false, mode: 'full-adaptation', firstQuestionPending: false });
  });

  it('未存储任何数据时，未知网站保持未启用', async () => {
    const reader = new LocalSettingsStore();

    await expect(reader.getSite('unknown.host')).resolves.toEqual({
      enabled: false,
      mode: 'unsupported',
      firstQuestionPending: false,
    });
  });

  it('自定义站点 full-adaptation 降级为 generic-video（Issue #11）', async () => {
    const writer = new LocalSettingsStore();
    await writer.setSite('unknown.host', {
      enabled: true,
      mode: 'full-adaptation',
      firstQuestionPending: true,
    });

    const reader = new LocalSettingsStore();

    await expect(reader.getSite('unknown.host')).resolves.toEqual({
      enabled: true,
      mode: 'generic-video',
      firstQuestionPending: true,
    });
  });

  it('enableSite 对自定义站点降级为 generic-video（Issue #11）', async () => {
    const writer = new LocalSettingsStore();
    await writer.enableSite('unknown.host');

    const reader = new LocalSettingsStore();

    await expect(reader.getSite('unknown.host')).resolves.toEqual({
      enabled: true,
      mode: 'generic-video',
      firstQuestionPending: true,
    });
  });

  it('已持久化的暂停状态不会被默认启用覆盖', async () => {
    const writer = new LocalSettingsStore();
    await writer.setSite('www.youtube.com', {
      enabled: false,
      mode: 'full-adaptation',
      firstQuestionPending: false,
    });

    const reader = new LocalSettingsStore();

    await expect(reader.getSite('www.youtube.com')).resolves.toEqual({
      enabled: false,
      mode: 'full-adaptation',
      firstQuestionPending: false,
    });
  });
});

describe('LocalSettingsStore — 规范站点键（Issue #9）', () => {
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

  it('启用 bilibili.com 后，任意子域名读取到相同启用状态', async () => {
    const writer = new LocalSettingsStore();
    await writer.enableSite('bilibili.com');

    const reader = new LocalSettingsStore();
    await expect(reader.getSite('www.bilibili.com')).resolves.toMatchObject({
      enabled: true,
      firstQuestionPending: true,
    });
    await expect(reader.getSite('m.bilibili.com')).resolves.toMatchObject({
      enabled: true,
      firstQuestionPending: true,
    });
    await expect(reader.getSite('bilibili.com')).resolves.toMatchObject({
      enabled: true,
    });
  });

  it('暂停当前网站（disableSite）后，子域名同样读取到未启用', async () => {
    const writer = new LocalSettingsStore();
    await writer.enableSite('youtube.com');
    await writer.disableSite('www.youtube.com');

    const reader = new LocalSettingsStore();
    const site = await reader.getSite('m.youtube.com');
    expect(site.enabled).toBe(false);
  });
});

describe('LocalSettingsStore — 引导状态（Issue #9 AC1）', () => {
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

  it('初始状态引导未完成', async () => {
    const reader = new LocalSettingsStore();
    await expect(reader.isOnboardingCompleted()).resolves.toBe(false);
  });

  it('标记引导完成后持久化', async () => {
    const writer = new LocalSettingsStore();
    await writer.markOnboardingCompleted();

    const reader = new LocalSettingsStore();
    await expect(reader.isOnboardingCompleted()).resolves.toBe(true);
  });
});

describe('LocalSettingsStore — 全局暂停（Issue #9 AC4）', () => {
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

  it('初始 globalPausedUntil=0', async () => {
    const reader = new LocalSettingsStore();
    await expect(reader.getGlobalPausedUntil()).resolves.toBe(0);
  });

  it('设置全局暂停后持久化', async () => {
    const writer = new LocalSettingsStore();
    await writer.setGlobalPausedUntil(5_000_000);

    const reader = new LocalSettingsStore();
    await expect(reader.getGlobalPausedUntil()).resolves.toBe(5_000_000);
  });
});

describe('LocalSettingsStore — 启用提示拒绝计数（Issue #9 AC2）', () => {
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

  it('记录一次拒绝后 promptDeclineCount=1，跨子域名一致', async () => {
    const writer = new LocalSettingsStore();
    await writer.recordPromptDecline('www.bilibili.com');

    const reader = new LocalSettingsStore();
    const site = await reader.getSite('m.bilibili.com');
    expect(site.promptDeclineCount).toBe(1);
    expect(site.enabled).toBe(false);
  });

  it('多次拒绝累计计数', async () => {
    const writer = new LocalSettingsStore();
    await writer.recordPromptDecline('bilibili.com');
    await writer.recordPromptDecline('www.bilibili.com');

    const reader = new LocalSettingsStore();
    const site = await reader.getSite('bilibili.com');
    expect(site.promptDeclineCount).toBe(2);
  });
});
