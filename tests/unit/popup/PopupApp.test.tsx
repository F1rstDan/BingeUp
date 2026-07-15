import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { PopupApp } from '@/ui/popup/PopupApp';
import { endOfToday } from '@/pause/pause-rules';

const mocks = vi.hoisted(() => ({
  getPopupData: vi.fn(),
  getSiteState: vi.fn(),
  enableSite: vi.fn(),
  disableSite: vi.fn(),
  pauseTenMinutes: vi.fn(),
  pauseToday: vi.fn(),
  resumeGlobalPause: vi.fn(),
  addCustomSite: vi.fn(),
}));

const {
  getPopupData,
  enableSite,
  disableSite,
  pauseTenMinutes,
  pauseToday,
  resumeGlobalPause,
  addCustomSite,
} = mocks;

vi.mock('@/messaging/message-client', () => ({
  messageClient: {
    getPopupData: mocks.getPopupData,
    getSiteState: mocks.getSiteState,
    enableSite: mocks.enableSite,
    disableSite: mocks.disableSite,
    pauseTenMinutes: mocks.pauseTenMinutes,
    pauseToday: mocks.pauseToday,
    resumeGlobalPause: mocks.resumeGlobalPause,
    addCustomSite: mocks.addCustomSite,
  },
}));

interface TabStub {
  url: string;
  id: number;
}

function installChromeStub(tab: TabStub | null, hasPermission = true) {
  const stub = {
    tabs: {
      query: vi.fn(async () => (tab ? [tab] : [])),
      sendMessage: vi.fn(async (_tabId: number, _message: unknown): Promise<unknown> => undefined),
      create: vi.fn(async () => undefined),
    },
    permissions: {
      contains: vi.fn(async () => hasPermission),
      request: vi.fn(async () => true),
      remove: vi.fn(async () => true),
    },
    runtime: {
      getURL: vi.fn((p: string) => `chrome-extension://test-id${p}`),
      openOptionsPage: vi.fn(async () => undefined),
    },
  };
  vi.stubGlobal('chrome', stub);
  return stub;
}

describe('PopupApp — 状态显示（Issue #9 AC3/AC5）', () => {
  beforeEach(() => {
    vi.resetModules();
    getPopupData.mockReset();
    mocks.getSiteState.mockReset();
    enableSite.mockReset();
    disableSite.mockReset();
    pauseTenMinutes.mockReset();
    pauseToday.mockReset();
    resumeGlobalPause.mockReset();
    vi.spyOn(window, 'close').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('受保护页面显示可理解状态（AC5）', async () => {
    installChromeStub({ url: 'chrome://settings/', id: 1 });
    getPopupData.mockResolvedValue({
      site: { hostname: '', enabled: false, mode: 'unsupported', firstQuestionPending: false },
      onboardingCompleted: true,
      globalPausedUntil: 0,
    });

    render(<PopupApp />);

    await waitFor(() => {
      expect(screen.getByText(/受保护页面/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '开始学习' })).toBeDisabled();
    });
  });

  it('引导未完成 + 默认站点未启用：显示正常网站状态与开启入口（Issue #21 AC3/AC6）', async () => {
    installChromeStub({ url: 'https://www.bilibili.com/', id: 1 });
    getPopupData.mockResolvedValue({
      site: {
        hostname: 'www.bilibili.com',
        enabled: false,
        mode: 'full-adaptation',
        firstQuestionPending: false,
      },
      onboardingCompleted: false,
      globalPausedUntil: 0,
    });

    render(<PopupApp />);

    await waitFor(() => {
      expect(screen.getByText('www.bilibili.com')).toBeInTheDocument();
      expect(screen.getByText('未启用')).toBeInTheDocument();
      expect(screen.getByText('完整适配')).toBeInTheDocument();
      const status = screen.getByRole('region', { name: '当前网站状态' });
      expect(within(status).getByRole('button', { name: '开启当前网站' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '开始学习' })).toBeDisabled();
    });
  });

  it('当前网站状态区域可关闭已启用网站', async () => {
    installChromeStub({ url: 'https://www.bilibili.com/', id: 1 });
    getPopupData
      .mockResolvedValueOnce({
        site: {
          hostname: 'www.bilibili.com',
          enabled: true,
          mode: 'full-adaptation',
          firstQuestionPending: false,
        },
        onboardingCompleted: true,
        globalPausedUntil: 0,
      })
      .mockResolvedValueOnce({
        site: {
          hostname: 'www.bilibili.com',
          enabled: false,
          mode: 'full-adaptation',
          firstQuestionPending: false,
        },
        onboardingCompleted: true,
        globalPausedUntil: 0,
      });
    disableSite.mockResolvedValue({
      hostname: 'www.bilibili.com',
      enabled: false,
      mode: 'full-adaptation',
      firstQuestionPending: false,
    });

    render(<PopupApp />);
    const status = await screen.findByRole('region', { name: '当前网站状态' });
    fireEvent.click(within(status).getByRole('button', { name: '关闭当前网站' }));

    await waitFor(() => {
      expect(disableSite).toHaveBeenCalledWith('www.bilibili.com');
      expect(
        within(screen.getByRole('region', { name: '当前网站状态' })).getByRole('button', {
          name: '开启当前网站',
        }),
      ).toBeInTheDocument();
    });
  });

  it('今日摘要显示今日完成题目、今日复习词和今日新词', async () => {
    installChromeStub({ url: 'https://www.bilibili.com/', id: 1 });
    getPopupData.mockResolvedValue({
      site: {
        hostname: 'www.bilibili.com',
        enabled: true,
        mode: 'full-adaptation',
        firstQuestionPending: false,
      },
      onboardingCompleted: true,
      globalPausedUntil: 0,
      stats: {
        today: { completedQuestions: 3, reviewedWords: 2, newWords: 1 },
        dueReviewCount: 0,
      },
    });

    render(<PopupApp />);

    expect(await screen.findByText('今日完成题目')).toBeInTheDocument();
    expect(screen.getByText('今日复习词')).toBeInTheDocument();
    expect(screen.getByText('今日新词')).toBeInTheDocument();
  });

  it('引导未完成 + 默认站点已启用：显示正常状态且开始学习可用（Issue #21 AC3/AC6）', async () => {
    const stub = installChromeStub({ url: 'https://www.bilibili.com/', id: 1 });
    stub.tabs.sendMessage.mockResolvedValue({ ok: true });
    getPopupData.mockResolvedValue({
      site: {
        hostname: 'www.bilibili.com',
        enabled: true,
        mode: 'full-adaptation',
        firstQuestionPending: false,
      },
      onboardingCompleted: false,
      globalPausedUntil: 0,
    });

    render(<PopupApp />);

    await waitFor(() => {
      expect(screen.getByText('www.bilibili.com')).toBeInTheDocument();
      expect(screen.getByText('已启用')).toBeInTheDocument();
      expect(screen.getByText('视频区域覆盖 · 可控制视频')).toBeInTheDocument();
      expect(screen.getByText('完整适配')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '开始学习' })).toBeEnabled();
    });
  });

  it('缺少主机权限时保留禁用的开始学习入口', async () => {
    installChromeStub({ url: 'https://example.com/', id: 1 }, false);
    getPopupData.mockResolvedValue({
      site: {
        hostname: 'example.com',
        enabled: true,
        mode: 'basic-web',
        firstQuestionPending: false,
      },
      onboardingCompleted: true,
      globalPausedUntil: 0,
    });

    render(<PopupApp />);

    expect(await screen.findByText(/缺少主机权限/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始学习' })).toBeDisabled();
  });

  it('HTTP 页面即使 hostname 已启用也禁用开始学习并说明不支持', async () => {
    installChromeStub({ url: 'http://example.com/', id: 1 });
    getPopupData.mockResolvedValue({
      site: {
        hostname: 'example.com',
        enabled: true,
        mode: 'basic-web',
        firstQuestionPending: false,
      },
      onboardingCompleted: true,
      globalPausedUntil: 0,
    });

    render(<PopupApp />);

    expect(await screen.findByText('当前网站不支持学习。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始学习' })).toBeDisabled();
  });

  it('已启用站点显示域名、启用状态、兼容等级与今日学习统计（AC3）', async () => {
    const stub = installChromeStub({ url: 'https://www.bilibili.com/video/BV1', id: 1 });
    getPopupData.mockResolvedValue({
      site: {
        hostname: 'www.bilibili.com',
        enabled: true,
        mode: 'full-adaptation',
        firstQuestionPending: false,
      },
      onboardingCompleted: true,
      globalPausedUntil: 0,
      stats: {
        today: { completedQuestions: 12, reviewedWords: 9, newWords: 5 },
        dueReviewCount: 5,
      },
    });

    render(<PopupApp />);

    await waitFor(() => {
      expect(screen.getByText('www.bilibili.com')).toBeInTheDocument();
      expect(screen.getByText('已启用')).toBeInTheDocument();
      expect(screen.getByText('今日学习')).toBeInTheDocument();
      expect(screen.getByText('12')).toBeInTheDocument();
      expect(screen.getByText('9')).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument();
    });
    expect(stub.permissions.contains).toHaveBeenCalledWith({
      origins: ['https://www.bilibili.com/*'],
    });
  });

  it('未启用但可提示时显示"开启当前网站"按钮', async () => {
    installChromeStub({ url: 'https://www.youtube.com/watch?v=x', id: 1 });
    getPopupData.mockResolvedValue({
      site: {
        hostname: 'www.youtube.com',
        enabled: false,
        mode: 'full-adaptation',
        firstQuestionPending: false,
        promptDeclineCount: 0,
      },
      onboardingCompleted: true,
      globalPausedUntil: 0,
    });

    render(<PopupApp />);

    await waitFor(() => {
      expect(screen.getByText('开启当前网站')).toBeInTheDocument();
    });
  });
});

describe('PopupApp — 暂停控制（Issue #9 AC4）', () => {
  beforeEach(() => {
    vi.resetModules();
    getPopupData.mockReset();
    mocks.getSiteState.mockReset();
    enableSite.mockReset();
    pauseTenMinutes.mockReset();
    pauseToday.mockReset();
    resumeGlobalPause.mockReset();
    vi.spyOn(window, 'close').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('点击"暂停 10 分钟"后在原按钮显示倒计时', async () => {
    installChromeStub({ url: 'https://www.bilibili.com/', id: 1 });
    getPopupData.mockResolvedValue({
      site: {
        hostname: 'www.bilibili.com',
        enabled: true,
        mode: 'full-adaptation',
        firstQuestionPending: false,
      },
      onboardingCompleted: true,
      globalPausedUntil: 0,
    });
    pauseTenMinutes.mockImplementation(async () => {
      const globalPausedUntil = Date.now() + 10 * 60 * 1000;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { globalPausedUntil };
    });

    render(<PopupApp />);

    const btn = await screen.findByText('暂停 10 分钟');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(pauseTenMinutes).toHaveBeenCalled();
      const countdownButton = screen.getByRole('button', { name: /恢复 \d+:\d\d/ });
      expect(countdownButton).toBeInTheDocument();
      expect(countdownButton).toBe(btn);
    });

    const initialLabel = btn.textContent;
    await waitFor(
      () => {
        expect(btn.textContent).not.toBe(initialLabel);
      },
      { timeout: 2500 },
    );
  });

  it('点击"暂停今天"调用 pauseToday', async () => {
    installChromeStub({ url: 'https://www.bilibili.com/', id: 1 });
    getPopupData.mockResolvedValue({
      site: {
        hostname: 'www.bilibili.com',
        enabled: true,
        mode: 'full-adaptation',
        firstQuestionPending: false,
      },
      onboardingCompleted: true,
      globalPausedUntil: 0,
    });
    pauseToday.mockResolvedValue({ globalPausedUntil: 9999999999999 });

    render(<PopupApp />);

    const btn = await screen.findByText('暂停今天');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(pauseToday).toHaveBeenCalled();
    });
  });

  it('暂停 10 分钟后显示倒计时，点击倒计时恢复全局临时暂停', async () => {
    installChromeStub({ url: 'https://www.bilibili.com/', id: 1 });
    getPopupData.mockResolvedValue({
      site: {
        hostname: 'www.bilibili.com',
        enabled: true,
        mode: 'full-adaptation',
        firstQuestionPending: false,
      },
      onboardingCompleted: true,
      globalPausedUntil: Date.now() + 10 * 60 * 1000,
    });
    resumeGlobalPause.mockResolvedValue({ globalPausedUntil: 0 });

    render(<PopupApp />);

    const btn = await screen.findByRole('button', { name: /恢复 \d+:\d\d/ });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(resumeGlobalPause).toHaveBeenCalled();
    });
  });

  it('暂停今天后显示“今天恢复”，点击后恢复全局临时暂停', async () => {
    installChromeStub({ url: 'https://www.bilibili.com/', id: 1 });
    getPopupData.mockResolvedValue({
      site: {
        hostname: 'www.bilibili.com',
        enabled: true,
        mode: 'full-adaptation',
        firstQuestionPending: false,
      },
      onboardingCompleted: true,
      globalPausedUntil: endOfToday(Date.now()),
    });
    resumeGlobalPause.mockResolvedValue({ globalPausedUntil: 0 });

    render(<PopupApp />);

    const btn = await screen.findByText('今天恢复');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(resumeGlobalPause).toHaveBeenCalled();
    });
  });

  it('Popup 不提供“暂停全部网站”或“恢复全部”入口', async () => {
    installChromeStub({ url: 'https://www.bilibili.com/', id: 1 });
    getPopupData.mockResolvedValue({
      site: {
        hostname: 'www.bilibili.com',
        enabled: true,
        mode: 'full-adaptation',
        firstQuestionPending: false,
      },
      onboardingCompleted: true,
      globalPausedUntil: 0,
    });

    render(<PopupApp />);

    await screen.findByText('暂停今天');
    expect(screen.queryByText('暂停全部网站')).not.toBeInTheDocument();
    expect(screen.queryByText('恢复全部')).not.toBeInTheDocument();
  });

  it('点击"开始学习"向内容脚本发送消息', async () => {
    const stub = installChromeStub({ url: 'https://www.bilibili.com/', id: 42 });
    stub.tabs.sendMessage.mockResolvedValue({ ok: true });
    getPopupData.mockResolvedValue({
      site: {
        hostname: 'www.bilibili.com',
        enabled: true,
        mode: 'full-adaptation',
        firstQuestionPending: false,
      },
      onboardingCompleted: true,
      globalPausedUntil: 0,
    });

    render(<PopupApp />);

    const btn = await screen.findByText('开始学习');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(stub.tabs.sendMessage).toHaveBeenCalledWith(42, { type: 'START_CONTINUOUS_LEARNING' });
      expect(window.close).toHaveBeenCalled();
    });
  });

  it('没有学习内容时保留面板并显示具体原因', async () => {
    const stub = installChromeStub({ url: 'https://www.bilibili.com/', id: 42 });
    stub.tabs.sendMessage.mockResolvedValue({ ok: false, reason: 'no-learning-content' });
    getPopupData.mockResolvedValue({
      site: {
        hostname: 'www.bilibili.com',
        enabled: true,
        mode: 'full-adaptation',
        firstQuestionPending: false,
      },
      onboardingCompleted: true,
      globalPausedUntil: 0,
    });

    render(<PopupApp />);
    fireEvent.click(await screen.findByText('开始学习'));

    await waitFor(() => {
      expect(screen.getByText('暂无可学习内容。')).toBeInTheDocument();
    });
    expect(window.close).not.toHaveBeenCalled();
  });

  it('开始学习发送失败时显示可理解提示而非静默失败（AC5）', async () => {
    const stub = installChromeStub({ url: 'https://www.bilibili.com/', id: 42 });
    stub.tabs.sendMessage.mockRejectedValue(new Error('Receiving end does not exist'));
    getPopupData.mockResolvedValue({
      site: {
        hostname: 'www.bilibili.com',
        enabled: true,
        mode: 'full-adaptation',
        firstQuestionPending: false,
      },
      onboardingCompleted: true,
      globalPausedUntil: 0,
    });

    render(<PopupApp />);

    const btn = await screen.findByText('开始学习');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByText(/无法开始学习/)).toBeInTheDocument();
    });
  });

  it('全局暂停时"开始学习"按钮禁用', async () => {
    installChromeStub({ url: 'https://www.bilibili.com/', id: 1 });
    getPopupData.mockResolvedValue({
      site: {
        hostname: 'www.bilibili.com',
        enabled: true,
        mode: 'full-adaptation',
        firstQuestionPending: false,
      },
      onboardingCompleted: true,
      globalPausedUntil: endOfToday(Date.now()),
    });

    render(<PopupApp />);

    const btn = await screen.findByText('开始学习');
    expect(btn).toBeDisabled();
  });

  it('基础网页模式允许主动开始学习', async () => {
    const stub = installChromeStub({ url: 'https://example.com/article', id: 7 });
    stub.tabs.sendMessage.mockResolvedValue({ ok: true });
    getPopupData.mockResolvedValue({
      site: {
        hostname: 'example.com',
        enabled: true,
        mode: 'basic-web',
        firstQuestionPending: false,
      },
      onboardingCompleted: true,
      globalPausedUntil: 0,
    });

    render(<PopupApp />);

    const button = await screen.findByRole('button', { name: '开始学习' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => {
      expect(stub.tabs.sendMessage).toHaveBeenCalledWith(7, {
        type: 'START_CONTINUOUS_LEARNING',
      });
    });
  });
});

describe('PopupApp — 加入当前网站（Issue #11 AC1/AC5）', () => {
  beforeEach(() => {
    vi.resetModules();
    getPopupData.mockReset();
    mocks.getSiteState.mockReset();
    mocks.getSiteState.mockResolvedValue({
      hostname: 'example.com',
      enabled: false,
      mode: 'unsupported',
      firstQuestionPending: false,
    });
    addCustomSite.mockReset();
    vi.spyOn(window, 'close').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('未加入 HTTPS 网站在顶部状态区显示唯一加入按钮，并保留禁用的开始学习入口', async () => {
    installChromeStub({ url: 'https://example.com/', id: 1 }, false);
    getPopupData.mockResolvedValue({
      site: {
        hostname: 'example.com',
        enabled: false,
        mode: 'unsupported',
        firstQuestionPending: false,
      },
      onboardingCompleted: true,
      globalPausedUntil: 0,
    });

    render(<PopupApp />);

    const status = await screen.findByRole('region', { name: '当前网站状态' });
    expect(within(status).getByRole('button', { name: '加入当前网站' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '加入当前网站' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: '开始学习' })).toBeDisabled();
    expect(screen.getByText('请先加入当前网站。')).toBeInTheDocument();
  });

  it('HTTP 页面不显示"加入当前网站"按钮（规范要求 HTTPS）', async () => {
    installChromeStub({ url: 'http://example.com/', id: 1 }, false);
    getPopupData.mockResolvedValue({
      site: {
        hostname: 'example.com',
        enabled: false,
        mode: 'unsupported',
        firstQuestionPending: false,
      },
      onboardingCompleted: true,
      globalPausedUntil: 0,
    });

    render(<PopupApp />);

    await waitFor(() => {
      expect(screen.queryByText('加入当前网站')).not.toBeInTheDocument();
      expect(screen.getByText('当前网站不支持学习。')).toBeInTheDocument();
    });
  });

  it('用户拒绝授权 → 显示可理解提示而非静默失败（AC5 权限拒绝）', async () => {
    const stub = installChromeStub({ url: 'https://example.com/', id: 1 }, false);
    stub.permissions.request.mockResolvedValue(false);
    getPopupData.mockResolvedValue({
      site: {
        hostname: 'example.com',
        enabled: false,
        mode: 'unsupported',
        firstQuestionPending: false,
      },
      onboardingCompleted: true,
      globalPausedUntil: 0,
    });

    render(<PopupApp />);

    const btn = await screen.findByText('加入当前网站');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByText(/未授予访问权限/)).toBeInTheDocument();
    });
    expect(addCustomSite).not.toHaveBeenCalled();
  });

  it('用户授权成功 → 调用 addCustomSite 并提示刷新（AC1）', async () => {
    const stub = installChromeStub({ url: 'https://example.com/', id: 1 }, false);
    stub.permissions.request.mockResolvedValue(true);
    getPopupData.mockResolvedValue({
      site: {
        hostname: 'example.com',
        enabled: false,
        mode: 'unsupported',
        firstQuestionPending: false,
      },
      onboardingCompleted: true,
      globalPausedUntil: 0,
    });
    addCustomSite.mockResolvedValue({
      hostname: 'example.com',
      enabled: true,
      mode: 'basic-web',
      firstQuestionPending: false,
    });

    render(<PopupApp />);

    const btn = await screen.findByText('加入当前网站');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(stub.permissions.request).toHaveBeenCalledWith({
        origins: ['https://example.com/*'],
      });
      expect(addCustomSite).toHaveBeenCalledWith('example.com');
      expect(screen.getByText(/已加入当前网站/)).toBeInTheDocument();
    });
  });

  it('addCustomSite 抛错 → 显示可理解错误提示（AC5）', async () => {
    const stub = installChromeStub({ url: 'https://example.com/', id: 1 }, false);
    stub.permissions.request.mockResolvedValue(true);
    getPopupData.mockResolvedValue({
      site: {
        hostname: 'example.com',
        enabled: false,
        mode: 'unsupported',
        firstQuestionPending: false,
      },
      onboardingCompleted: true,
      globalPausedUntil: 0,
    });
    addCustomSite.mockRejectedValue(new Error('storage 不可用'));

    render(<PopupApp />);

    const btn = await screen.findByText('加入当前网站');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByText(/加入失败/)).toBeInTheDocument();
    });
  });
});
