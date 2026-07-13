import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';

const getSiteState = vi.fn();
const getPopupData = vi.fn();
const enableSite = vi.fn();
const recordPromptDecline = vi.fn();
const getAppSettings = vi.fn();
const updateSiteMode = vi.fn();
const getGlobalPauseStatus = vi.fn();
const showEnablePrompt = vi.fn();

vi.mock('@/messaging/message-client', () => ({
  messageClient: {
    getSiteState,
    getPopupData,
    enableSite,
    recordPromptDecline,
    getAppSettings,
    updateSiteMode,
    getGlobalPauseStatus,
  },
}));

vi.mock('@/content/enable-prompt', () => ({
  showEnablePrompt,
}));

describe('bootstrapContent — 启动诊断', () => {
  beforeEach(() => {
    vi.resetModules();
    getSiteState.mockReset();
    getPopupData.mockReset();
    enableSite.mockReset();
    recordPromptDecline.mockReset();
    getAppSettings.mockReset();
    updateSiteMode.mockReset();
    getGlobalPauseStatus.mockReset();
    getGlobalPauseStatus.mockResolvedValue({ globalPausedUntil: 0 });
    getAppSettings.mockResolvedValue({
      defaultCooldownMinutes: 2,
      consecutiveSkipCooldowns: [5, 15, 60],
      dailyNewWordLimit: 5,
      selectedDeckId: 'deck-default',
      selfRatedLevel: 'intermediate',
      spellingEnabled: true,
      longVideoTimedLearningEnabled: false,
      longVideoIntervalMinutes: 10,
    });
    showEnablePrompt.mockReset();
    vi.stubGlobal('chrome', {
      runtime: { onMessage: { addListener: vi.fn() } },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('站点被暂停且引导未完成时不显示启用提示', async () => {
    getSiteState.mockResolvedValue({
      hostname: 'www.bilibili.com',
      enabled: false,
      mode: 'full-adaptation',
      firstQuestionPending: false,
      promptDeclineCount: 0,
    });
    getPopupData.mockResolvedValue({
      site: { hostname: 'www.bilibili.com', enabled: false, mode: 'full-adaptation', firstQuestionPending: false, promptDeclineCount: 0 },
      onboardingCompleted: false,
      globalPausedUntil: 0,
    });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { bootstrapContent } = await import('@/content/bootstrap');

    await bootstrapContent();

    expect(info).toHaveBeenCalledWith(
      '[BingeUp] 内容脚本未启动：网站已暂停',
      'www.bilibili.com',
    );
    expect(showEnablePrompt).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it('受支持站点启动时报告适配器', async () => {
    getSiteState.mockResolvedValue({
      hostname: 'www.bilibili.com',
      enabled: true,
      mode: 'full-adaptation',
      firstQuestionPending: true,
    });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { bootstrapContent } = await import('@/content/bootstrap');

    await bootstrapContent();

    expect(info).toHaveBeenCalledWith('[BingeUp] 内容脚本已启动，等待有效主视频', {
      hostname: 'www.bilibili.com',
      adapter: 'bilibili',
    });
    expect(showEnablePrompt).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it('不支持的页面报告未启动原因', async () => {
    vi.stubGlobal('location', { hostname: 'music.youtube.com' });
    getSiteState.mockResolvedValue({
      hostname: 'music.youtube.com',
      enabled: false,
      mode: 'unsupported',
      firstQuestionPending: false,
    });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { bootstrapContent } = await import('@/content/bootstrap');

    await bootstrapContent();

    expect(info).toHaveBeenCalledWith(
      '[BingeUp] 内容脚本未启动：自定义站点未启用或不支持',
      'music.youtube.com',
    );
    info.mockRestore();
  });

  it('基础网页收到主动学习消息后以全网页上下文启动', async () => {
    vi.stubGlobal('location', {
      hostname: 'example.com',
      protocol: 'https:',
      href: 'https://example.com/article',
    });
    getSiteState.mockResolvedValue({
      hostname: 'example.com',
      enabled: true,
      mode: 'basic-web',
      firstQuestionPending: false,
      pageLoadTrigger: false,
      scrollTrigger: false,
    });
    const addListener = vi.fn();
    vi.stubGlobal('chrome', { runtime: { onMessage: { addListener }, getURL: vi.fn((path: string) => `chrome-extension://test/${path}`) } });
    // Mock fetch 为 BuiltInWordBank 提供空词库（避免加载失败阻断启动）
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('words.json')) {
        return { ok: true, json: async () => [{ id: 'w-test', word: 'test', lemma: 'test', partOfSpeech: ['v.'], coreMeaningZh: ['测试'], exampleSentence: 'Test sentence.', exampleTranslation: '测试翻译。', surfaceFormInExample: 'Test', difficulty: 2, source: 'test', license: 'CC0' }] };
      }
      if (url.includes('decks.json')) {
        return { ok: true, json: async () => [{ id: 'deck-test', name: '测试', source: 'test', license: 'CC0', wordIds: ['w-test'] }] };
      }
      return { ok: false };
    }));
    const { bootstrapContent } = await import('@/content/bootstrap');

    await bootstrapContent();

    const listener = addListener.mock.calls[0]?.[0] as (
      message: unknown,
      sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => boolean;
    const response = new Promise<unknown>((resolve) => {
      expect(listener({ type: 'START_CONTINUOUS_LEARNING' }, {}, resolve)).toBe(true);
    });

    await expect(response).resolves.toEqual({ ok: true });
  });
});

describe('bootstrapContent — 有限启用提示（Issue #9 AC2）', () => {
  beforeEach(() => {
    vi.resetModules();
    getSiteState.mockReset();
    getPopupData.mockReset();
    enableSite.mockReset();
    recordPromptDecline.mockReset();
    getAppSettings.mockReset();
    getGlobalPauseStatus.mockReset();
    getGlobalPauseStatus.mockResolvedValue({ globalPausedUntil: 0 });
    getAppSettings.mockResolvedValue({
      defaultCooldownMinutes: 2,
      consecutiveSkipCooldowns: [5, 15, 60],
      dailyNewWordLimit: 5,
      selectedDeckId: 'deck-default',
      selfRatedLevel: 'intermediate',
      spellingEnabled: true,
      longVideoTimedLearningEnabled: false,
      longVideoIntervalMinutes: 10,
    });
    showEnablePrompt.mockReset();
    vi.stubGlobal('chrome', {
      runtime: { onMessage: { addListener: vi.fn() } },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('引导完成 + 未启用 + 拒绝次数未达上限 → 显示启用提示', async () => {
    getSiteState.mockResolvedValue({
      hostname: 'www.bilibili.com',
      enabled: false,
      mode: 'full-adaptation',
      firstQuestionPending: false,
      promptDeclineCount: 0,
    });
    getPopupData.mockResolvedValue({
      site: { hostname: 'www.bilibili.com', enabled: false, mode: 'full-adaptation', firstQuestionPending: false, promptDeclineCount: 0 },
      onboardingCompleted: true,
      globalPausedUntil: 0,
    });
    const { bootstrapContent } = await import('@/content/bootstrap');

    await bootstrapContent();

    expect(showEnablePrompt).toHaveBeenCalledTimes(1);
    expect(showEnablePrompt.mock.calls[0][0]).toBe('www.bilibili.com');
  });

  it('拒绝次数已达上限（2 次）→ 不显示启用提示', async () => {
    getSiteState.mockResolvedValue({
      hostname: 'www.bilibili.com',
      enabled: false,
      mode: 'full-adaptation',
      firstQuestionPending: false,
      promptDeclineCount: 2,
    });
    getPopupData.mockResolvedValue({
      site: { hostname: 'www.bilibili.com', enabled: false, mode: 'full-adaptation', firstQuestionPending: false, promptDeclineCount: 2 },
      onboardingCompleted: true,
      globalPausedUntil: 0,
    });
    const { bootstrapContent } = await import('@/content/bootstrap');

    await bootstrapContent();

    expect(showEnablePrompt).not.toHaveBeenCalled();
  });

  it('引导未完成 → 不显示启用提示', async () => {
    getSiteState.mockResolvedValue({
      hostname: 'www.bilibili.com',
      enabled: false,
      mode: 'full-adaptation',
      firstQuestionPending: false,
      promptDeclineCount: 0,
    });
    getPopupData.mockResolvedValue({
      site: { hostname: 'www.bilibili.com', enabled: false, mode: 'full-adaptation', firstQuestionPending: false, promptDeclineCount: 0 },
      onboardingCompleted: false,
      globalPausedUntil: 0,
    });
    const { bootstrapContent } = await import('@/content/bootstrap');

    await bootstrapContent();

    expect(showEnablePrompt).not.toHaveBeenCalled();
  });

  it('站点已启用 → 不显示启用提示', async () => {
    getSiteState.mockResolvedValue({
      hostname: 'www.bilibili.com',
      enabled: true,
      mode: 'full-adaptation',
      firstQuestionPending: true,
    });
    const { bootstrapContent } = await import('@/content/bootstrap');

    await bootstrapContent();

    expect(showEnablePrompt).not.toHaveBeenCalled();
  });

  it('启用回调调用 enableSite', async () => {
    vi.stubGlobal('location', { hostname: 'www.youtube.com' });
    getSiteState.mockResolvedValue({
      hostname: 'www.youtube.com',
      enabled: false,
      mode: 'full-adaptation',
      firstQuestionPending: false,
      promptDeclineCount: 1,
    });
    getPopupData.mockResolvedValue({
      site: { hostname: 'www.youtube.com', enabled: false, mode: 'full-adaptation', firstQuestionPending: false, promptDeclineCount: 1 },
      onboardingCompleted: true,
      globalPausedUntil: 0,
    });
    enableSite.mockResolvedValue(undefined);
    const { bootstrapContent } = await import('@/content/bootstrap');

    await bootstrapContent();

    expect(showEnablePrompt).toHaveBeenCalledTimes(1);
    const callbacks = showEnablePrompt.mock.calls[0][1] as {
      onEnable: () => Promise<void>;
      onDismiss: () => Promise<void>;
    };
    await callbacks.onEnable();
    expect(enableSite).toHaveBeenCalledWith('www.youtube.com');
  });

  it('拒绝回调调用 recordPromptDecline', async () => {
    vi.stubGlobal('location', { hostname: 'www.youtube.com' });
    getSiteState.mockResolvedValue({
      hostname: 'www.youtube.com',
      enabled: false,
      mode: 'full-adaptation',
      firstQuestionPending: false,
      promptDeclineCount: 0,
    });
    getPopupData.mockResolvedValue({
      site: { hostname: 'www.youtube.com', enabled: false, mode: 'full-adaptation', firstQuestionPending: false, promptDeclineCount: 0 },
      onboardingCompleted: true,
      globalPausedUntil: 0,
    });
    recordPromptDecline.mockResolvedValue(undefined);
    const { bootstrapContent } = await import('@/content/bootstrap');

    await bootstrapContent();

    expect(showEnablePrompt).toHaveBeenCalledTimes(1);
    const callbacks = showEnablePrompt.mock.calls[0][1] as {
      onEnable: () => Promise<void>;
      onDismiss: () => Promise<void>;
    };
    await callbacks.onDismiss();
    expect(recordPromptDecline).toHaveBeenCalledWith('www.youtube.com');
  });
});
