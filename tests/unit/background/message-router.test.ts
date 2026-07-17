import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMessageRouter } from '@/background/message-router';
import { LocalSettingsStore } from '@/storage/local-settings';
import { openDatabase, idbPut, idbGetAll, STORES } from '@/storage/database';
import { MIGRATIONS } from '@/storage/migrations';
import { DEFAULT_SETTINGS } from '@/settings/defaults';
import { CardRepository } from '@/storage/repositories/card-repository';
import type { AppSettings, BehaviorEventRecord, CardRecord, ReviewLogRecord } from '@/types';
import type { ExportPayload } from '@/storage/data-transfer';

/** 内存态 chrome.storage.local + permissions，模拟浏览器持久化。 */
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
    permissions: {
      contains: vi.fn().mockResolvedValue(true),
      remove: vi.fn().mockResolvedValue(true),
    },
    scripting: {
      getRegisteredContentScripts: vi.fn(
        async (): Promise<chrome.scripting.RegisteredContentScript[]> => [],
      ),
      registerContentScripts: vi.fn().mockResolvedValue(undefined),
      updateContentScripts: vi.fn().mockResolvedValue(undefined),
      unregisterContentScripts: vi.fn().mockResolvedValue(undefined),
    },
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
    },
  };
  (globalThis as unknown as { chrome: typeof chromeStub }).chrome = chromeStub;
  return { rawStore: store };
}

const NOW = 5_000_000;
const TEST_DB = 'test-router';

describe('message-router — Issue #9 新增消息', () => {
  let cleanup: (() => void) | null = null;
  let store: LocalSettingsStore;
  let router: ReturnType<typeof createMessageRouter>;
  let db: IDBDatabase;

  beforeEach(async () => {
    installChromeStorageMock();
    cleanup = () => {
      delete (globalThis as { chrome?: unknown }).chrome;
    };
    db = await openDatabase(TEST_DB, MIGRATIONS);
    store = new LocalSettingsStore(db);
    router = createMessageRouter(store, db);
  });

  afterEach(async () => {
    db.close();
    await deleteDatabase(TEST_DB);
    cleanup?.();
    cleanup = null;
  });

  it('ONBOARDING_COMPLETE：标记引导完成并启用选定网站', async () => {
    await router.handle(
      {
        type: 'ONBOARDING_COMPLETE',
        hostnames: ['bilibili.com', 'youtube.com'],
        deckId: DEFAULT_SETTINGS.selectedDeckId,
        selfRatedLevel: DEFAULT_SETTINGS.selfRatedLevel,
      },
      {} as chrome.runtime.MessageSender,
    );

    expect(await store.isOnboardingCompleted()).toBe(true);
    const bilibili = await store.getSite('www.bilibili.com');
    expect(bilibili.enabled).toBe(true);
    expect(bilibili.firstQuestionPending).toBe(true);
    const youtube = await store.getSite('www.youtube.com');
    expect(youtube.enabled).toBe(true);
  });

  it('Issue #22：两个网站通过 background 共享同一扩展源学习卡', async () => {
    const words = [
      {
        id: 'w-shared-a',
        word: 'alpha',
        lemma: 'alpha',
        partOfSpeech: ['n.'],
        coreMeaningZh: ['阿尔法'],
        difficulty: 2,
        frequencyRank: 1,
        source: 'test',
        license: 'test',
      },
      {
        id: 'w-shared-b',
        word: 'beta',
        lemma: 'beta',
        partOfSpeech: ['n.'],
        coreMeaningZh: ['贝塔'],
        difficulty: 2,
        frequencyRank: 1,
        source: 'test',
        license: 'test',
      },
    ];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      const data = url.endsWith('/words.json')
        ? words
        : [
            {
              id: DEFAULT_SETTINGS.selectedDeckId,
              name: '测试词库',
              description: '测试',
              wordIds: words.map((word) => word.id),
            },
          ];
      return new Response(JSON.stringify(data), { status: 200 });
    });
    try {
      const first = (await router.handle({ type: 'LEARNING_GET_NEXT' }, {
        url: 'https://site-a.example/',
      } as chrome.runtime.MessageSender)) as {
        kind: 'new-word-presentation';
        presentation: { word: { id: string } };
      };
      await router.handle(
        { type: 'LEARNING_ACCEPT_NEW_WORD', wordId: first.presentation.word.id },
        { url: 'https://site-a.example/' } as chrome.runtime.MessageSender,
      );

      const second = (await router.handle({ type: 'LEARNING_GET_NEXT' }, {
        url: 'https://site-b.example/',
      } as chrome.runtime.MessageSender)) as {
        kind: 'new-word-presentation';
        presentation: { word: { id: string } };
      };

      expect(second.presentation.word.id).not.toBe(first.presentation.word.id);
      expect(await new CardRepository(db).getAll()).toHaveLength(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('ONBOARDING_COMPLETE：取消的网站会持久化为未启用', async () => {
    await router.handle(
      {
        type: 'ONBOARDING_COMPLETE',
        hostnames: ['bilibili.com'],
        deckId: DEFAULT_SETTINGS.selectedDeckId,
        selfRatedLevel: DEFAULT_SETTINGS.selfRatedLevel,
      },
      {} as chrome.runtime.MessageSender,
    );

    expect((await store.getSite('www.bilibili.com')).enabled).toBe(true);
    expect((await store.getSite('www.youtube.com')).enabled).toBe(false);
  });

  it('ONBOARDING_COMPLETE：忽略非受支持站点', async () => {
    await router.handle(
      {
        type: 'ONBOARDING_COMPLETE',
        hostnames: ['bilibili.com', 'example.com'],
        deckId: DEFAULT_SETTINGS.selectedDeckId,
        selfRatedLevel: DEFAULT_SETTINGS.selfRatedLevel,
      },
      {} as chrome.runtime.MessageSender,
    );

    expect((await store.getSite('www.bilibili.com')).enabled).toBe(true);
    expect((await store.getSite('example.com')).enabled).toBe(false);
  });

  it('ONBOARDING_COMPLETE：空网站列表也标记引导完成（AC1：不选择也能完成）', async () => {
    await router.handle(
      {
        type: 'ONBOARDING_COMPLETE',
        hostnames: [],
        deckId: DEFAULT_SETTINGS.selectedDeckId,
        selfRatedLevel: DEFAULT_SETTINGS.selfRatedLevel,
      },
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

  it('自定义网站禁用后重新启用时恢复精确内容脚本注册', async () => {
    await store.enableSite('example.com', 'basic-web');
    (chrome.scripting.getRegisteredContentScripts as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ id: 'bingeup_custom_ZXhhbXBsZS5jb20' }])
      .mockResolvedValueOnce([]);

    await router.handle(
      { type: 'SITE_DISABLE', hostname: 'example.com' },
      {} as chrome.runtime.MessageSender,
    );
    await router.handle(
      { type: 'SITE_ENABLE', hostname: 'example.com' },
      {} as chrome.runtime.MessageSender,
    );

    expect(chrome.scripting.unregisterContentScripts).toHaveBeenCalledWith({
      ids: ['bingeup_custom_ZXhhbXBsZS5jb20'],
    });
    expect(chrome.scripting.registerContentScripts).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'bingeup_custom_ZXhhbXBsZS5jb20',
        matches: ['https://example.com/*'],
      }),
    ]);
    expect(await store.getSite('example.com')).toMatchObject({
      enabled: true,
      mode: 'basic-web',
    });
  });

  it('PAUSE_TEN_MINUTES：设置十分钟全局暂停（Popup 倒计时）', async () => {
    const before = Date.now();
    const res = (await router.handle(
      { type: 'PAUSE_TEN_MINUTES' },
      {} as chrome.runtime.MessageSender,
    )) as { globalPausedUntil: number };

    expect(res.globalPausedUntil).toBeGreaterThanOrEqual(before + 10 * 60 * 1000);
    expect(res.globalPausedUntil).toBeLessThanOrEqual(Date.now() + 10 * 60 * 1000);
    expect(await idbGetAll<BehaviorEventRecord>(db, STORES.behaviorEvents)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'global-pause', action: 'started' }),
      ]),
    );
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

  it('RESUME_GLOBAL_PAUSE：清零全局临时暂停', async () => {
    await store.setGlobalPausedUntil(Number.MAX_SAFE_INTEGER);
    const res = (await router.handle(
      { type: 'RESUME_GLOBAL_PAUSE' },
      {} as chrome.runtime.MessageSender,
    )) as { globalPausedUntil: number };

    expect(res.globalPausedUntil).toBe(0);
    expect(await store.getGlobalPausedUntil()).toBe(0);
  });

  it('GET_GLOBAL_PAUSE_STATUS：返回当前全局暂停状态', async () => {
    await store.setGlobalPausedUntil(7_000_000);

    const res = (await router.handle(
      { type: 'GET_GLOBAL_PAUSE_STATUS' },
      {} as chrome.runtime.MessageSender,
    )) as { globalPausedUntil: number };

    expect(res).toEqual({ globalPausedUntil: 7_000_000 });
  });

  it('PLAYBACK_RECOVERY_NOTICE_CLAIM：跨消息全局限制当日三次', async () => {
    const claim = () =>
      router.handle(
        { type: 'PLAYBACK_RECOVERY_NOTICE_CLAIM', now: NOW },
        {} as chrome.runtime.MessageSender,
      );

    await expect(claim()).resolves.toBe(true);
    await expect(claim()).resolves.toBe(true);
    await expect(claim()).resolves.toBe(true);
    await expect(claim()).resolves.toBe(false);
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

// ─── Issue #21：安装引导与默认启用语义一致 ─────────────────────────

describe('message-router — Issue #21 默认启用与引导一致性', () => {
  let cleanup: (() => void) | null = null;
  let store: LocalSettingsStore;
  let router: ReturnType<typeof createMessageRouter>;
  let db: IDBDatabase;

  beforeEach(async () => {
    installChromeStorageMock();
    cleanup = () => {
      delete (globalThis as { chrome?: unknown }).chrome;
    };
    db = await openDatabase(TEST_DB, MIGRATIONS);
    store = new LocalSettingsStore(db);
    router = createMessageRouter(store, db);
  });

  afterEach(async () => {
    db.close();
    await deleteDatabase(TEST_DB);
    cleanup?.();
    cleanup = null;
  });

  it('AC1/AC2：未完成引导时默认支持网站仍为启用状态（首次安装直接可用）', async () => {
    // 不发送 ONBOARDING_COMPLETE，模拟用户关闭/跳过引导标签页
    expect(await store.isOnboardingCompleted()).toBe(false);
    const bilibili = await store.getSite('www.bilibili.com');
    expect(bilibili.enabled).toBe(true);
    expect(bilibili.mode).toBe('full-adaptation');
    expect(bilibili.firstQuestionPending).toBe(true);
    const youtube = await store.getSite('www.youtube.com');
    expect(youtube.enabled).toBe(true);
  });

  it('AC4：完成引导时持久化用户选择的词库与自评水平', async () => {
    await router.handle(
      {
        type: 'ONBOARDING_COMPLETE',
        hostnames: ['bilibili.com', 'youtube.com'],
        deckId: 'deck-cet4',
        selfRatedLevel: 'advanced',
      },
      {} as chrome.runtime.MessageSender,
    );

    const settings = await store.getAppSettings();
    expect(settings.selectedDeckId).toBe('deck-cet4');
    expect(settings.selfRatedLevel).toBe('advanced');
  });

  it('AC4：完成引导时取消的网站持久化为未启用，保留的网站保持启用', async () => {
    await router.handle(
      {
        type: 'ONBOARDING_COMPLETE',
        hostnames: ['bilibili.com'],
        deckId: DEFAULT_SETTINGS.selectedDeckId,
        selfRatedLevel: DEFAULT_SETTINGS.selfRatedLevel,
      },
      {} as chrome.runtime.MessageSender,
    );

    expect((await store.getSite('www.bilibili.com')).enabled).toBe(true);
    expect((await store.getSite('www.youtube.com')).enabled).toBe(false);
  });

  it('AC5：完成引导关闭全部默认网站后可通过 SITE_ENABLE 重新启用', async () => {
    // 完成引导时不选择任何网站
    await router.handle(
      {
        type: 'ONBOARDING_COMPLETE',
        hostnames: [],
        deckId: DEFAULT_SETTINGS.selectedDeckId,
        selfRatedLevel: DEFAULT_SETTINGS.selfRatedLevel,
      },
      {} as chrome.runtime.MessageSender,
    );

    expect((await store.getSite('www.bilibili.com')).enabled).toBe(false);
    expect((await store.getSite('www.youtube.com')).enabled).toBe(false);

    // 用户从 Popup/设置页重新启用
    const res = (await router.handle(
      { type: 'SITE_ENABLE', hostname: 'www.bilibili.com' },
      {} as chrome.runtime.MessageSender,
    )) as { enabled: boolean; firstQuestionPending: boolean };

    expect(res.enabled).toBe(true);
    expect(res.firstQuestionPending).toBe(true);
    expect((await store.getSite('www.youtube.com')).enabled).toBe(false);
  });

  it('AC8：完整流程 — 首次安装可用 → 跳过引导保持启用 → 完成引导关闭全部 → 重新启用', async () => {
    // 1. 首次安装：默认网站已启用，引导未完成
    expect(await store.isOnboardingCompleted()).toBe(false);
    expect((await store.getSite('www.bilibili.com')).enabled).toBe(true);

    // 2. 跳过引导（不发消息）：默认网站仍启用
    expect((await store.getSite('www.bilibili.com')).enabled).toBe(true);
    expect((await store.getSite('www.youtube.com')).enabled).toBe(true);

    // 3. 用户后来完成引导，关闭全部默认网站，选择六级词库与初级水平
    await router.handle(
      {
        type: 'ONBOARDING_COMPLETE',
        hostnames: [],
        deckId: 'deck-cet6',
        selfRatedLevel: 'beginner',
      },
      {} as chrome.runtime.MessageSender,
    );
    expect(await store.isOnboardingCompleted()).toBe(true);
    expect((await store.getSite('www.bilibili.com')).enabled).toBe(false);
    expect((await store.getSite('www.youtube.com')).enabled).toBe(false);
    const settings = await store.getAppSettings();
    expect(settings.selectedDeckId).toBe('deck-cet6');
    expect(settings.selfRatedLevel).toBe('beginner');

    // 4. 用户从 Popup 重新启用 YouTube
    await router.handle(
      { type: 'SITE_ENABLE', hostname: 'www.youtube.com' },
      {} as chrome.runtime.MessageSender,
    );
    expect((await store.getSite('www.youtube.com')).enabled).toBe(true);
    expect((await store.getSite('www.youtube.com')).firstQuestionPending).toBe(true);
    // Bilibili 仍保持关闭
    expect((await store.getSite('www.bilibili.com')).enabled).toBe(false);
  });
});

// ─── Issue #10：设置页与本地数据管理 ─────────────────────────────

async function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

describe('message-router — Issue #10 新增消息', () => {
  let cleanup: (() => void) | null = null;
  let store: LocalSettingsStore;
  let router: ReturnType<typeof createMessageRouter>;
  let db: IDBDatabase;
  let permissionsRemove: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    installChromeStorageMock();
    permissionsRemove = (
      globalThis as unknown as { chrome: { permissions: { remove: ReturnType<typeof vi.fn> } } }
    ).chrome.permissions.remove;
    cleanup = () => {
      delete (globalThis as { chrome?: unknown }).chrome;
    };
    db = await openDatabase(TEST_DB, MIGRATIONS);
    store = new LocalSettingsStore(db);
    router = createMessageRouter(store, db);
  });

  afterEach(async () => {
    db?.close();
    await deleteDatabase(TEST_DB);
    cleanup?.();
    cleanup = null;
  });

  it('GET_POPUP_DATA：数据库可用时附带今日学习统计', async () => {
    const now = Date.now();
    await idbPut(db, STORES.cards, {
      id: 'card-long',
      wordId: 'word-long',
      deckId: 'deck-1',
      stage: 'long-term',
      createdAt: now - 86_400_000,
      updatedAt: now,
      nextReviewAt: now - 1,
    } satisfies CardRecord);
    await idbPut(db, STORES.reviewLogs, {
      id: 'review-today',
      cardId: 'card-long',
      wordId: 'word-long',
      questionType: 'en-to-zh',
      selectedAnswer: 'a',
      correctAnswer: 'a',
      isCorrect: true,
      source: 'natural',
      responseTimeMs: 500,
      reviewedAt: now,
    } satisfies ReviewLogRecord);

    const res = (await router.handle(
      { type: 'GET_POPUP_DATA', hostname: 'www.bilibili.com' },
      {} as chrome.runtime.MessageSender,
    )) as {
      stats?: {
        today: { completedQuestions: number; reviewedWords: number; newWords: number };
        dueReviewCount: number;
      };
    };

    expect(res.stats).toEqual({
      today: {
        completedQuestions: 1,
        reviewedWords: 1,
        newWords: 0,
        continuousSessions: 0,
        continuousQuestions: 0,
        longTermCompleted: 0,
        longTermAccuracy: 0,
      },
      dueReviewCount: 1,
    });
  });

  // ── AC1：应用设置读写 ──────────────────────────────────

  it('GET_APP_SETTINGS：无持久化设置时返回默认值', async () => {
    const res = (await router.handle(
      { type: 'GET_APP_SETTINGS' },
      {} as chrome.runtime.MessageSender,
    )) as AppSettings;

    expect(res).toEqual(DEFAULT_SETTINGS);
  });

  it('SET_APP_SETTINGS：持久化并返回自动修正后的设置', async () => {
    const input: AppSettings = {
      ...DEFAULT_SETTINGS,
      defaultCooldownMinutes: 7,
      dailyNewWordLimit: 20,
    };
    const res = (await router.handle(
      { type: 'SET_APP_SETTINGS', settings: input },
      {} as chrome.runtime.MessageSender,
    )) as AppSettings;

    expect(res.defaultCooldownMinutes).toBe(7);
    expect(res.dailyNewWordLimit).toBe(20);

    // 验证已持久化
    const persisted = await store.getAppSettings();
    expect(persisted.defaultCooldownMinutes).toBe(7);
  });

  it('SET_APP_SETTINGS：非法值被自动修正（AC3）', async () => {
    const input = {
      ...DEFAULT_SETTINGS,
      dailyNewWordLimit: -5,
      defaultCooldownMinutes: 'not-a-number' as unknown as number,
    };
    const res = (await router.handle(
      { type: 'SET_APP_SETTINGS', settings: input as AppSettings },
      {} as chrome.runtime.MessageSender,
    )) as AppSettings;

    expect(res.dailyNewWordLimit).toBe(0);
    expect(res.defaultCooldownMinutes).toBe(DEFAULT_SETTINGS.defaultCooldownMinutes);
  });

  it('RESET_APP_SETTINGS：恢复默认值', async () => {
    await store.setAppSettings({ ...DEFAULT_SETTINGS, defaultCooldownMinutes: 99 });
    const res = (await router.handle(
      { type: 'RESET_APP_SETTINGS' },
      {} as chrome.runtime.MessageSender,
    )) as AppSettings;

    expect(res).toEqual(DEFAULT_SETTINGS);
  });

  // ── AC3：冷却配置实时读取 ────────────────────────────────

  it('COOLDOWN_COMPLETE_QUESTION：使用持久化的应用设置实时计算冷却（AC3）', async () => {
    await store.setAppSettings({ ...DEFAULT_SETTINGS, defaultCooldownMinutes: 10 });

    const before = Date.now();
    const res = (await router.handle(
      { type: 'COOLDOWN_COMPLETE_QUESTION' },
      {} as chrome.runtime.MessageSender,
    )) as { nextAllowedAt: number; consecutiveSkipCount: number };
    const after = Date.now();

    // 10 分钟冷却：nextAllowedAt ≈ now + 10 * 60_000
    expect(res.nextAllowedAt).toBeGreaterThanOrEqual(before + 10 * 60_000);
    expect(res.nextAllowedAt).toBeLessThanOrEqual(after + 10 * 60_000);
    expect(res.consecutiveSkipCount).toBe(0);
  });

  it('COOLDOWN_SKIP_QUESTION：使用持久化的降频冷却实时计算（AC3）', async () => {
    await store.setAppSettings({
      ...DEFAULT_SETTINGS,
      consecutiveSkipCooldowns: [3, 9, 30],
    });

    const before = Date.now();
    const res = (await router.handle(
      { type: 'COOLDOWN_SKIP_QUESTION' },
      {} as chrome.runtime.MessageSender,
    )) as { nextAllowedAt: number; consecutiveSkipCount: number };
    const after = Date.now();

    // 第一次跳过：3 分钟冷却
    expect(res.nextAllowedAt).toBeGreaterThanOrEqual(before + 3 * 60_000);
    expect(res.nextAllowedAt).toBeLessThanOrEqual(after + 3 * 60_000);
    expect(res.consecutiveSkipCount).toBe(1);
  });

  // ── AC2：站点管理 ────────────────────────────────────────

  it('LIST_SITES：返回所有已持久化的站点', async () => {
    await store.enableSite('bilibili.com');
    await store.enableSite('youtube.com');

    const res = (await router.handle(
      { type: 'LIST_SITES' },
      {} as chrome.runtime.MessageSender,
    )) as { sites: { hostname: string; settings: { enabled: boolean } }[] };

    expect(res.sites).toHaveLength(2);
    const hostnames = res.sites.map((s) => s.hostname).sort();
    expect(hostnames).toEqual(['bilibili.com', 'youtube.com']);
    expect(res.sites.every((s) => s.settings.enabled)).toBe(true);
  });

  it('REMOVE_SITE：从存储中删除站点（AC5）', async () => {
    await store.enableSite('bilibili.com');

    await router.handle(
      { type: 'REMOVE_SITE', hostname: 'bilibili.com' },
      {} as chrome.runtime.MessageSender,
    );

    const sites = await store.listSites();
    expect(sites.find((s) => s.hostname === 'bilibili.com')).toBeUndefined();
  });

  it('REMOVE_SITE：受支持站点不尝试释放权限（AC5）', async () => {
    await store.enableSite('bilibili.com');

    const res = (await router.handle(
      { type: 'REMOVE_SITE', hostname: 'bilibili.com' },
      {} as chrome.runtime.MessageSender,
    )) as { released: boolean };

    expect(res.released).toBe(false);
    expect(permissionsRemove).not.toHaveBeenCalled();
  });

  it('REMOVE_SITE：自定义站点尝试释放当前与旧版可选权限（AC5）', async () => {
    // 直接写入一个自定义站点（绕过 enableSite 的受支持检查）
    await store.setSite('example.com', {
      enabled: true,
      mode: 'basic-web',
      firstQuestionPending: false,
    });
    (
      chrome.scripting.getRegisteredContentScripts as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue([
      {
        id: 'bingeup_custom_ZXhhbXBsZS5jb20',
      },
    ]);

    const res = (await router.handle(
      { type: 'REMOVE_SITE', hostname: 'example.com' },
      {} as chrome.runtime.MessageSender,
    )) as { released: boolean };

    expect(res.released).toBe(true);
    expect(permissionsRemove).toHaveBeenNthCalledWith(1, {
      origins: ['https://example.com/*'],
    });
    expect(permissionsRemove).toHaveBeenNthCalledWith(2, {
      origins: ['*://example.com/*', '*://*.example.com/*'],
    });
    expect(chrome.scripting.unregisterContentScripts).toHaveBeenCalledWith({
      ids: ['bingeup_custom_ZXhhbXBsZS5jb20'],
    });
  });

  it('REMOVE_SITE：仅存在旧版宽泛权限时仍报告已释放', async () => {
    permissionsRemove.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await store.setSite('example.com', {
      enabled: true,
      mode: 'basic-web',
      firstQuestionPending: false,
    });

    const res = (await router.handle(
      { type: 'REMOVE_SITE', hostname: 'example.com' },
      {} as chrome.runtime.MessageSender,
    )) as { released: boolean };

    expect(res.released).toBe(true);
    expect(permissionsRemove).toHaveBeenNthCalledWith(1, {
      origins: ['https://example.com/*'],
    });
    expect(permissionsRemove).toHaveBeenNthCalledWith(2, {
      origins: ['*://example.com/*', '*://*.example.com/*'],
    });
  });

  // ── AC4：数据导出/导入/清除 ──────────────────────────────

  it('EXPORT_DATA：返回包含设置与全部 IDB 数据的 payload', async () => {
    await store.setAppSettings({ ...DEFAULT_SETTINGS, dailyNewWordLimit: 15 });
    await store.enableSite('bilibili.com');
    await idbPut(db, STORES.cards, {
      id: 'card-1',
      wordId: 'w-1',
      deckId: 'd-1',
      stage: 'short-term',
      createdAt: 1000,
      updatedAt: 1000,
    } satisfies CardRecord);
    await idbPut(db, STORES.reviewLogs, {
      id: 'log-1',
      cardId: 'card-1',
      wordId: 'w-1',
      questionType: 'en-to-zh',
      selectedAnswer: 'a',
      correctAnswer: 'b',
      isCorrect: false,
      responseTimeMs: 500,
      reviewedAt: 2000,
    } satisfies ReviewLogRecord);

    const res = (await router.handle(
      { type: 'EXPORT_DATA' },
      {} as chrome.runtime.MessageSender,
    )) as ExportPayload;

    expect(res.version).toBe(1);
    expect(res.authoritativeState.appSettings.dailyNewWordLimit).toBe(15);
    expect(res.data.cards).toHaveLength(1);
    expect(res.data.reviewLogs).toHaveLength(1);
    expect(res.data.sessionLogs).toEqual([]);
    expect(res.data.words).toEqual([]);
    expect(res.data.decks).toEqual([]);
  });

  it('IMPORT_DATA：校验通过后写入数据（AC4）', async () => {
    const payload: ExportPayload = {
      version: 1,
      exportedAt: 9000,
      authoritativeState: {
        appSettings: { ...DEFAULT_SETTINGS, dailyNewWordLimit: 42 },
        sites: {
          'bilibili.com': { enabled: true, mode: 'full-adaptation', firstQuestionPending: false },
        },
        onboardingCompleted: true,
      },
      data: {
        cards: [
          {
            id: 'c1',
            wordId: 'w-abandon',
            deckId: 'deck-daily-high-frequency',
            stage: 'new',
            createdAt: 1,
            updatedAt: 1,
          } satisfies CardRecord,
        ],
        reviewLogs: [],
        sessionLogs: [],
        behaviorEvents: [],
        words: [],
        decks: [],
      },
    };

    const res = (await router.handle(
      { type: 'IMPORT_DATA', payload },
      {} as chrome.runtime.MessageSender,
    )) as { ok: boolean; errors: string[] };

    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);

    // 验证写入
    const appSettings = await store.getAppSettings();
    expect(appSettings.dailyNewWordLimit).toBe(42);
    const cards = await idbGetAll<CardRecord>(db, STORES.cards);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.id).toBe('c1');
  });

  it('IMPORT_DATA：非法 payload 被拒绝，不写入（AC4 先校验再写入）', async () => {
    const beforeCards = await idbGetAll<CardRecord>(db, STORES.cards);
    expect(beforeCards).toHaveLength(0);

    const res = (await router.handle(
      { type: 'IMPORT_DATA', payload: { version: 999 } },
      {} as chrome.runtime.MessageSender,
    )) as { ok: boolean; errors: string[] };

    expect(res.ok).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
    // 确保未写入
    const afterCards = await idbGetAll<CardRecord>(db, STORES.cards);
    expect(afterCards).toHaveLength(0);
  });

  it('CLEAR_LEARNING_PROGRESS：只清空 cards 和 reviewLogs（AC4）', async () => {
    await idbPut(db, STORES.cards, {
      id: 'c1',
      wordId: 'w1',
      deckId: 'd1',
      stage: 'new',
      createdAt: 1,
      updatedAt: 1,
    });
    await idbPut(db, STORES.reviewLogs, {
      id: 'l1',
      cardId: 'c1',
      wordId: 'w1',
      questionType: 'en-to-zh',
      selectedAnswer: '',
      correctAnswer: '',
      isCorrect: true,
      responseTimeMs: 0,
      reviewedAt: 0,
    });
    await idbPut(db, STORES.words, {
      id: 'w1',
      word: 'test',
      lemma: 'test',
      partOfSpeech: ['n.'],
      coreMeaningZh: ['测试'],
      exampleSentence: '',
      exampleTranslation: '',
      difficulty: 1,
      frequencyRank: 1,
      source: '',
      license: '',
    });
    await idbPut(db, STORES.decks, {
      id: 'd1',
      name: 'deck',
      source: '',
      license: '',
      wordIds: [],
    });

    await router.handle({ type: 'CLEAR_LEARNING_PROGRESS' }, {} as chrome.runtime.MessageSender);

    expect(await idbGetAll(db, STORES.cards)).toHaveLength(0);
    expect(await idbGetAll(db, STORES.reviewLogs)).toHaveLength(0);
    // 词库与单词保留
    expect(await idbGetAll(db, STORES.words)).toHaveLength(1);
    expect(await idbGetAll(db, STORES.decks)).toHaveLength(1);
  });

  it('CLEAR_ALL_DATA：清空全部 IDB 仓库与持久化状态（AC4）', async () => {
    await idbPut(db, STORES.cards, {
      id: 'c1',
      wordId: 'w1',
      deckId: 'd1',
      stage: 'new',
      createdAt: 1,
      updatedAt: 1,
    });
    await idbPut(db, STORES.words, {
      id: 'w1',
      word: 'test',
      lemma: 'test',
      partOfSpeech: ['n.'],
      coreMeaningZh: ['测试'],
      exampleSentence: '',
      exampleTranslation: '',
      difficulty: 1,
      frequencyRank: 1,
      source: '',
      license: '',
    });
    await store.enableSite('bilibili.com');
    await store.markOnboardingCompleted();
    (
      chrome.scripting.getRegisteredContentScripts as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue([
      {
        id: 'bingeup_custom_ZXhhbXBsZS5jb20',
      },
    ]);

    await router.handle({ type: 'CLEAR_ALL_DATA' }, {} as chrome.runtime.MessageSender);

    expect(await idbGetAll(db, STORES.cards)).toHaveLength(0);
    expect(await idbGetAll(db, STORES.words)).toHaveLength(0);
    expect(await store.isOnboardingCompleted()).toBe(false);
    expect(await store.listSites()).toHaveLength(0);
    expect(chrome.scripting.unregisterContentScripts).toHaveBeenCalledWith({
      ids: ['bingeup_custom_ZXhhbXBsZS5jb20'],
    });
  });

  it('CLEAR_ALL_DATA：数据已清空但脚本同步失败时返回成功与明确告警', async () => {
    await store.setSite('example.com', {
      enabled: true,
      mode: 'basic-web',
      firstQuestionPending: false,
    });
    (
      chrome.scripting.getRegisteredContentScripts as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue([
      {
        id: 'bingeup_custom_ZXhhbXBsZS5jb20',
      },
    ]);
    (
      chrome.scripting.unregisterContentScripts as unknown as ReturnType<typeof vi.fn>
    ).mockRejectedValue(new Error('scripting 不可用'));

    const result = (await router.handle(
      { type: 'CLEAR_ALL_DATA' },
      {} as chrome.runtime.MessageSender,
    )) as { ok: boolean; warnings: string[] };

    expect(result.ok).toBe(true);
    expect(result.warnings[0]).toContain('内容脚本同步失败');
    expect(await store.listSites()).toHaveLength(0);
  });
});

describe('message-router — Issue #13 数据库不可用', () => {
  it('数据操作明确失败，不把不可用数据库伪装成成功', async () => {
    installChromeStorageMock();
    const db = await openDatabase(TEST_DB, MIGRATIONS);
    const store = new LocalSettingsStore(db);
    const router = createMessageRouter(store, null);

    await expect(
      router.handle({ type: 'EXPORT_DATA' }, {} as chrome.runtime.MessageSender),
    ).rejects.toThrow('数据库不可用');

    db.close();
    await deleteDatabase(TEST_DB);
    delete (globalThis as { chrome?: unknown }).chrome;
  });
});

// ─── Issue #11：自定义网站兼容模式 ───────────────────────────────

describe('message-router — Issue #11 新增消息', () => {
  let cleanup: (() => void) | null = null;
  let store: LocalSettingsStore;
  let router: ReturnType<typeof createMessageRouter>;
  let db: IDBDatabase;

  beforeEach(async () => {
    installChromeStorageMock();
    cleanup = () => {
      delete (globalThis as { chrome?: unknown }).chrome;
    };
    db = await openDatabase(TEST_DB, MIGRATIONS);
    store = new LocalSettingsStore(db);
    router = createMessageRouter(store, db);
  });

  afterEach(async () => {
    db.close();
    await deleteDatabase(TEST_DB);
    cleanup?.();
    cleanup = null;
  });

  it('ADD_CUSTOM_SITE：以 basic-web 模式启用自定义站点', async () => {
    const res = (await router.handle(
      { type: 'ADD_CUSTOM_SITE', hostname: 'example.com' },
      {} as chrome.runtime.MessageSender,
    )) as { enabled: boolean; mode: string; hostname: string; firstQuestionPending: boolean };

    expect(res.enabled).toBe(true);
    expect(res.mode).toBe('basic-web');
    expect(res.hostname).toBe('example.com');
    expect(res.firstQuestionPending).toBe(true);

    // 验证持久化
    const site = await store.getSite('example.com');
    expect(site.enabled).toBe(true);
    expect(site.mode).toBe('basic-web');
    expect(chrome.scripting.registerContentScripts).toHaveBeenCalledWith([
      {
        id: 'bingeup_custom_ZXhhbXBsZS5jb20',
        matches: ['https://example.com/*'],
        js: ['content-scripts/content.js'],
        runAt: 'document_idle',
        persistAcrossSessions: true,
      },
    ]);
  });

  it('ADD_CUSTOM_SITE：full-adaptation 被降级为 generic-video（保护官方适配器边界）', async () => {
    // 先手动设置 full-adaptation，验证 normalize 逻辑
    await store.enableSite('example.com', 'full-adaptation');
    const site = await store.getSite('example.com');
    // enableSite 直接写入，getSite 会通过 normalizeSiteSettings 规范化
    expect(site.mode).toBe('generic-video');
  });

  it('ADD_CUSTOM_SITE：重复注册时更新既有精确匹配而不创建重复脚本', async () => {
    (
      chrome.scripting.getRegisteredContentScripts as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue([
      {
        id: 'bingeup_custom_ZXhhbXBsZS5jb20',
      },
    ]);

    await router.handle(
      { type: 'ADD_CUSTOM_SITE', hostname: 'example.com' },
      {} as chrome.runtime.MessageSender,
    );

    expect(chrome.scripting.registerContentScripts).not.toHaveBeenCalled();
    expect(chrome.scripting.updateContentScripts).toHaveBeenCalledWith([
      {
        id: 'bingeup_custom_ZXhhbXBsZS5jb20',
        matches: ['https://example.com/*'],
        js: ['content-scripts/content.js'],
        runAt: 'document_idle',
        persistAcrossSessions: true,
      },
    ]);
  });

  it('UPDATE_SITE_MODE：更新站点兼容模式（AC4 能力检测回写）', async () => {
    // 先加入站点（默认 basic-web）
    await store.enableSite('example.com', 'basic-web');

    // 内容脚本检测到视频后回写为 generic-video
    await router.handle(
      { type: 'UPDATE_SITE_MODE', hostname: 'example.com', mode: 'generic-video' },
      {} as chrome.runtime.MessageSender,
    );

    const site = await store.getSite('example.com');
    expect(site.mode).toBe('generic-video');
    // enabled 等其他字段保留
    expect(site.enabled).toBe(true);
  });

  it('UPDATE_SITE_MODE：basic-web → basic-web（无变化也正常）', async () => {
    await store.enableSite('example.com', 'basic-web');
    await router.handle(
      { type: 'UPDATE_SITE_MODE', hostname: 'example.com', mode: 'basic-web' },
      {} as chrome.runtime.MessageSender,
    );
    const site = await store.getSite('example.com');
    expect(site.mode).toBe('basic-web');
  });
});
