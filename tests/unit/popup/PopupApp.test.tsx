import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PopupApp } from '@/ui/popup/PopupApp';

const mocks = vi.hoisted(() => ({
  getPopupData: vi.fn(),
  disableSite: vi.fn(),
  enableSite: vi.fn(),
  pauseAll: vi.fn(),
  pauseToday: vi.fn(),
  resumeAll: vi.fn(),
}));

const { getPopupData, disableSite, enableSite, pauseAll, pauseToday, resumeAll } = mocks;

vi.mock('@/messaging/message-client', () => ({
  messageClient: {
    getPopupData: mocks.getPopupData,
    disableSite: mocks.disableSite,
    enableSite: mocks.enableSite,
    pauseAll: mocks.pauseAll,
    pauseToday: mocks.pauseToday,
    resumeAll: mocks.resumeAll,
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
      sendMessage: vi.fn(async () => undefined),
      create: vi.fn(async () => undefined),
    },
    permissions: {
      contains: vi.fn(async () => hasPermission),
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
    disableSite.mockReset();
    enableSite.mockReset();
    pauseAll.mockReset();
    pauseToday.mockReset();
    resumeAll.mockReset();
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
    });
  });

  it('未完成引导时显示"开始引导"入口（AC5）', async () => {
    installChromeStub({ url: 'https://www.bilibili.com/', id: 1 });
    getPopupData.mockResolvedValue({
      site: { hostname: 'www.bilibili.com', enabled: false, mode: 'full-adaptation', firstQuestionPending: false },
      onboardingCompleted: false,
      globalPausedUntil: 0,
    });

    render(<PopupApp />);

    await waitFor(() => {
      expect(screen.getByText('尚未完成安装引导。')).toBeInTheDocument();
      expect(screen.getByText('开始引导')).toBeInTheDocument();
    });
  });

  it('已启用站点显示域名、启用状态、兼容等级、覆盖方式、可控制视频（AC3）', async () => {
    installChromeStub({ url: 'https://www.bilibili.com/video/BV1', id: 1 });
    getPopupData.mockResolvedValue({
      site: { hostname: 'www.bilibili.com', enabled: true, mode: 'full-adaptation', firstQuestionPending: false },
      onboardingCompleted: true,
      globalPausedUntil: 0,
    });

    render(<PopupApp />);

    await waitFor(() => {
      expect(screen.getByText('www.bilibili.com')).toBeInTheDocument();
      expect(screen.getByText('已启用')).toBeInTheDocument();
      expect(screen.getByText('完整适配')).toBeInTheDocument();
      expect(screen.getByText('视频区域')).toBeInTheDocument();
      expect(screen.getByText('是')).toBeInTheDocument();
    });
  });

  it('未启用但可提示时显示"开启当前网站"按钮', async () => {
    installChromeStub({ url: 'https://www.youtube.com/watch?v=x', id: 1 });
    getPopupData.mockResolvedValue({
      site: { hostname: 'www.youtube.com', enabled: false, mode: 'full-adaptation', firstQuestionPending: false, promptDeclineCount: 0 },
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
    disableSite.mockReset();
    enableSite.mockReset();
    pauseAll.mockReset();
    pauseToday.mockReset();
    resumeAll.mockReset();
    vi.spyOn(window, 'close').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('点击"暂停当前网站"调用 disableSite', async () => {
    installChromeStub({ url: 'https://www.bilibili.com/', id: 1 });
    getPopupData.mockResolvedValue({
      site: { hostname: 'www.bilibili.com', enabled: true, mode: 'full-adaptation', firstQuestionPending: false },
      onboardingCompleted: true,
      globalPausedUntil: 0,
    });
    disableSite.mockResolvedValue({ hostname: 'www.bilibili.com', enabled: false, mode: 'full-adaptation', firstQuestionPending: false });

    render(<PopupApp />);

    const btn = await screen.findByText('暂停当前网站');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(disableSite).toHaveBeenCalledWith('www.bilibili.com');
    });
  });

  it('点击"暂停全部"调用 pauseAll', async () => {
    installChromeStub({ url: 'https://www.bilibili.com/', id: 1 });
    getPopupData.mockResolvedValue({
      site: { hostname: 'www.bilibili.com', enabled: true, mode: 'full-adaptation', firstQuestionPending: false },
      onboardingCompleted: true,
      globalPausedUntil: 0,
    });
    pauseAll.mockResolvedValue({ globalPausedUntil: 9999999999999 });

    render(<PopupApp />);

    const btn = await screen.findByText('暂停全部');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(pauseAll).toHaveBeenCalled();
    });
  });

  it('点击"暂停今天"调用 pauseToday', async () => {
    installChromeStub({ url: 'https://www.bilibili.com/', id: 1 });
    getPopupData.mockResolvedValue({
      site: { hostname: 'www.bilibili.com', enabled: true, mode: 'full-adaptation', firstQuestionPending: false },
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

  it('全局暂停时显示"恢复全部"并调用 resumeAll', async () => {
    installChromeStub({ url: 'https://www.bilibili.com/', id: 1 });
    const farFuture = Date.now() + 100 * 365 * 24 * 60 * 60 * 1000;
    getPopupData.mockResolvedValue({
      site: { hostname: 'www.bilibili.com', enabled: true, mode: 'full-adaptation', firstQuestionPending: false },
      onboardingCompleted: true,
      globalPausedUntil: farFuture,
    });
    resumeAll.mockResolvedValue({ globalPausedUntil: 0 });

    render(<PopupApp />);

    const btn = await screen.findByText('恢复全部');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(resumeAll).toHaveBeenCalled();
    });
  });

  it('点击"开始连续学习"向内容脚本发送消息', async () => {
    const stub = installChromeStub({ url: 'https://www.bilibili.com/', id: 42 });
    getPopupData.mockResolvedValue({
      site: { hostname: 'www.bilibili.com', enabled: true, mode: 'full-adaptation', firstQuestionPending: false },
      onboardingCompleted: true,
      globalPausedUntil: 0,
    });

    render(<PopupApp />);

    const btn = await screen.findByText('开始连续学习');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(stub.tabs.sendMessage).toHaveBeenCalledWith(42, { type: 'START_CONTINUOUS_LEARNING' });
    });
  });

  it('连续学习发送失败时显示可理解提示而非静默失败（AC5）', async () => {
    const stub = installChromeStub({ url: 'https://www.bilibili.com/', id: 42 });
    stub.tabs.sendMessage.mockRejectedValue(new Error('Receiving end does not exist'));
    getPopupData.mockResolvedValue({
      site: { hostname: 'www.bilibili.com', enabled: true, mode: 'full-adaptation', firstQuestionPending: false },
      onboardingCompleted: true,
      globalPausedUntil: 0,
    });

    render(<PopupApp />);

    const btn = await screen.findByText('开始连续学习');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByText(/无法开始连续学习/)).toBeInTheDocument();
    });
  });

  it('全局暂停时"开始连续学习"按钮禁用', async () => {
    installChromeStub({ url: 'https://www.bilibili.com/', id: 1 });
    const farFuture = Date.now() + 100 * 365 * 24 * 60 * 60 * 1000;
    getPopupData.mockResolvedValue({
      site: { hostname: 'www.bilibili.com', enabled: true, mode: 'full-adaptation', firstQuestionPending: false },
      onboardingCompleted: true,
      globalPausedUntil: farFuture,
    });

    render(<PopupApp />);

    const btn = await screen.findByText('开始连续学习');
    expect(btn).toBeDisabled();
  });
});
