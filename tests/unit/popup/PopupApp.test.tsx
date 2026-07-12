import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PopupApp } from '@/ui/popup/PopupApp';
import { endOfToday } from '@/pause/pause-rules';

const mocks = vi.hoisted(() => ({
  getPopupData: vi.fn(),
  enableSite: vi.fn(),
  pauseTenMinutes: vi.fn(),
  pauseToday: vi.fn(),
  resumeAll: vi.fn(),
  addCustomSite: vi.fn(),
}));

const { getPopupData, enableSite, pauseTenMinutes, pauseToday, resumeAll, addCustomSite } = mocks;

vi.mock('@/messaging/message-client', () => ({
  messageClient: {
    getPopupData: mocks.getPopupData,
    enableSite: mocks.enableSite,
    pauseTenMinutes: mocks.pauseTenMinutes,
    pauseToday: mocks.pauseToday,
    resumeAll: mocks.resumeAll,
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
      sendMessage: vi.fn(async () => undefined),
      create: vi.fn(async () => undefined),
    },
    permissions: {
      contains: vi.fn(async () => hasPermission),
      request: vi.fn(async () => true),
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
    enableSite.mockReset();
    pauseTenMinutes.mockReset();
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

  it('已启用站点显示域名、启用状态、兼容等级与今日学习统计（AC3）', async () => {
    installChromeStub({ url: 'https://www.bilibili.com/video/BV1', id: 1 });
    getPopupData.mockResolvedValue({
      site: { hostname: 'www.bilibili.com', enabled: true, mode: 'full-adaptation', firstQuestionPending: false },
      onboardingCompleted: true,
      globalPausedUntil: 0,
      stats: {
        today: { completedQuestions: 12 },
        cardStatus: { longTerm: 9 },
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
    enableSite.mockReset();
    pauseTenMinutes.mockReset();
    pauseToday.mockReset();
    resumeAll.mockReset();
    vi.spyOn(window, 'close').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('点击"暂停 10 分钟"后在原按钮显示倒计时', async () => {
    installChromeStub({ url: 'https://www.bilibili.com/', id: 1 });
    getPopupData.mockResolvedValue({
      site: { hostname: 'www.bilibili.com', enabled: true, mode: 'full-adaptation', firstQuestionPending: false },
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
    await waitFor(() => {
      expect(btn.textContent).not.toBe(initialLabel);
    }, { timeout: 2500 });
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

  it('暂停 10 分钟后显示倒计时，点击倒计时调用 resumeAll', async () => {
    installChromeStub({ url: 'https://www.bilibili.com/', id: 1 });
    getPopupData.mockResolvedValue({
      site: { hostname: 'www.bilibili.com', enabled: true, mode: 'full-adaptation', firstQuestionPending: false },
      onboardingCompleted: true,
      globalPausedUntil: Date.now() + 10 * 60 * 1000,
    });
    resumeAll.mockResolvedValue({ globalPausedUntil: 0 });

    render(<PopupApp />);

    const btn = await screen.findByRole('button', { name: /恢复 \d+:\d\d/ });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(resumeAll).toHaveBeenCalled();
    });
  });

  it('暂停今天后显示“今天恢复”，点击后调用 resumeAll', async () => {
    installChromeStub({ url: 'https://www.bilibili.com/', id: 1 });
    getPopupData.mockResolvedValue({
      site: { hostname: 'www.bilibili.com', enabled: true, mode: 'full-adaptation', firstQuestionPending: false },
      onboardingCompleted: true,
      globalPausedUntil: endOfToday(Date.now()),
    });
    resumeAll.mockResolvedValue({ globalPausedUntil: 0 });

    render(<PopupApp />);

    const btn = await screen.findByText('今天恢复');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(resumeAll).toHaveBeenCalled();
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

describe('PopupApp — 加入当前网站（Issue #11 AC1/AC5）', () => {
  beforeEach(() => {
    vi.resetModules();
    getPopupData.mockReset();
    addCustomSite.mockReset();
    vi.spyOn(window, 'close').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('非专属适配站点 + unsupported → 显示"加入当前网站"按钮（AC1）', async () => {
    installChromeStub({ url: 'https://example.com/', id: 1 }, false);
    getPopupData.mockResolvedValue({
      site: { hostname: 'example.com', enabled: false, mode: 'unsupported', firstQuestionPending: false },
      onboardingCompleted: true,
      globalPausedUntil: 0,
    });

    render(<PopupApp />);

    await screen.findByText('加入当前网站');
  });

  it('HTTP 页面不显示"加入当前网站"按钮（规范要求 HTTPS）', async () => {
    installChromeStub({ url: 'http://example.com/', id: 1 }, false);
    getPopupData.mockResolvedValue({
      site: { hostname: 'example.com', enabled: false, mode: 'unsupported', firstQuestionPending: false },
      onboardingCompleted: true,
      globalPausedUntil: 0,
    });

    render(<PopupApp />);

    await waitFor(() => {
      expect(screen.queryByText('加入当前网站')).not.toBeInTheDocument();
    });
  });

  it('用户拒绝授权 → 显示可理解提示而非静默失败（AC5 权限拒绝）', async () => {
    const stub = installChromeStub({ url: 'https://example.com/', id: 1 }, false);
    stub.permissions.request.mockResolvedValue(false);
    getPopupData.mockResolvedValue({
      site: { hostname: 'example.com', enabled: false, mode: 'unsupported', firstQuestionPending: false },
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
      site: { hostname: 'example.com', enabled: false, mode: 'unsupported', firstQuestionPending: false },
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
      expect(addCustomSite).toHaveBeenCalledWith('example.com');
      expect(screen.getByText(/已加入当前网站/)).toBeInTheDocument();
    });
  });

  it('addCustomSite 抛错 → 显示可理解错误提示（AC5）', async () => {
    const stub = installChromeStub({ url: 'https://example.com/', id: 1 }, false);
    stub.permissions.request.mockResolvedValue(true);
    getPopupData.mockResolvedValue({
      site: { hostname: 'example.com', enabled: false, mode: 'unsupported', firstQuestionPending: false },
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
