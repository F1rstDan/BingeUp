import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMessageRouter } from '@/background/message-router';
import { LocalSettingsStore } from '@/storage/local-settings';

/** 内存态 chrome.storage.local，模拟浏览器持久化。 */
function installChromeStorageMock() {
  const store: Record<string, unknown> = {};
  const chromeStub = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (entries: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(entries)) {
            store[k] = v;
          }
        },
      },
    },
  };
  (globalThis as unknown as { chrome: typeof chromeStub }).chrome = chromeStub;
  return { rawStore: store };
}

const NOW = 5_000_000;

describe('message-router — Issue #9 新增消息', () => {
  let cleanup: (() => void) | null = null;
  let store: LocalSettingsStore;
  let router: ReturnType<typeof createMessageRouter>;

  beforeEach(() => {
    installChromeStorageMock();
    cleanup = () => {
      delete (globalThis as { chrome?: unknown }).chrome;
    };
    store = new LocalSettingsStore();
    router = createMessageRouter(store);
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it('ONBOARDING_COMPLETE：标记引导完成并启用选定网站', async () => {
    await router.handle(
      { type: 'ONBOARDING_COMPLETE', hostnames: ['bilibili.com', 'youtube.com'] },
      {} as chrome.runtime.MessageSender,
    );

    expect(await store.isOnboardingCompleted()).toBe(true);
    const bilibili = await store.getSite('www.bilibili.com');
    expect(bilibili.enabled).toBe(true);
    expect(bilibili.firstQuestionPending).toBe(true);
    const youtube = await store.getSite('www.youtube.com');
    expect(youtube.enabled).toBe(true);
  });

  it('ONBOARDING_COMPLETE：空网站列表也标记引导完成（AC1：不选择也能完成）', async () => {
    await router.handle(
      { type: 'ONBOARDING_COMPLETE', hostnames: [] },
      {} as chrome.runtime.MessageSender,
    );

    expect(await store.isOnboardingCompleted()).toBe(true);
    const bilibili = await store.getSite('www.bilibili.com');
    expect(bilibili.enabled).toBe(false);
  });

  it('SITE_ENABLE：启用指定网站并返回站点状态', async () => {
    const res = (await router.handle(
      { type: 'SITE_ENABLE', hostname: 'www.bilibili.com' },
      {} as chrome.runtime.MessageSender,
    )) as { enabled: boolean; hostname: string; firstQuestionPending: boolean };

    expect(res.enabled).toBe(true);
    expect(res.hostname).toBe('www.bilibili.com');
    expect(res.firstQuestionPending).toBe(true);
  });

  it('SITE_DISABLE：暂停当前网站（AC4）', async () => {
    await store.enableSite('bilibili.com');
    const res = (await router.handle(
      { type: 'SITE_DISABLE', hostname: 'www.bilibili.com' },
      {} as chrome.runtime.MessageSender,
    )) as { enabled: boolean };

    expect(res.enabled).toBe(false);
    const site = await store.getSite('www.bilibili.com');
    expect(site.enabled).toBe(false);
  });

  it('PAUSE_ALL：设置远期全局暂停（AC4）', async () => {
    const res = (await router.handle(
      { type: 'PAUSE_ALL' },
      {} as chrome.runtime.MessageSender,
    )) as { globalPausedUntil: number };

    expect(res.globalPausedUntil).toBeGreaterThan(NOW);
    expect(await store.getGlobalPausedUntil()).toBe(res.globalPausedUntil);
  });

  it('PAUSE_TODAY：设置当日结束时间戳（AC4）', async () => {
    const res = (await router.handle(
      { type: 'PAUSE_TODAY', now: NOW },
      {} as chrome.runtime.MessageSender,
    )) as { globalPausedUntil: number };

    expect(res.globalPausedUntil).toBeGreaterThan(NOW);
    const d = new Date(res.globalPausedUntil);
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
  });

  it('RESUME_ALL：清零全局暂停', async () => {
    await store.setGlobalPausedUntil(Number.MAX_SAFE_INTEGER);
    const res = (await router.handle(
      { type: 'RESUME_ALL' },
      {} as chrome.runtime.MessageSender,
    )) as { globalPausedUntil: number };

    expect(res.globalPausedUntil).toBe(0);
    expect(await store.getGlobalPausedUntil()).toBe(0);
  });

  it('PROMPT_DECLINE：记录一次拒绝（AC2）', async () => {
    await router.handle(
      { type: 'PROMPT_DECLINE', hostname: 'www.bilibili.com' },
      {} as chrome.runtime.MessageSender,
    );

    const site = await store.getSite('m.bilibili.com');
    expect(site.promptDeclineCount).toBe(1);
  });

  it('GET_POPUP_DATA：返回站点/引导/暂停综合数据（AC3）', async () => {
    await store.markOnboardingCompleted();
    await store.enableSite('bilibili.com');
    await store.setGlobalPausedUntil(7_000_000);

    const res = (await router.handle(
      { type: 'GET_POPUP_DATA', hostname: 'www.bilibili.com' },
      {} as chrome.runtime.MessageSender,
    )) as {
      site: { enabled: boolean; hostname: string };
      onboardingCompleted: boolean;
      globalPausedUntil: number;
    };

    expect(res.site.enabled).toBe(true);
    expect(res.site.hostname).toBe('www.bilibili.com');
    expect(res.onboardingCompleted).toBe(true);
    expect(res.globalPausedUntil).toBe(7_000_000);
  });
});
