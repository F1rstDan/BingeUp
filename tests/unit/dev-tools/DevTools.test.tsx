import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DevTools } from '@/ui/popup/DevTools';

const mocks = vi.hoisted(() => ({
  getDevDeckSummary: vi.fn(),
  clearLearningProgress: vi.fn(),
}));

vi.mock('@/dev-tools/message-client', () => ({
  getDevDeckSummary: mocks.getDevDeckSummary,
}));

vi.mock('@/messaging/message-client', () => ({
  messageClient: {
    clearLearningProgress: mocks.clearLearningProgress,
  },
}));

function installChromeStub(pingResponse: unknown = { ok: true }) {
  const stub = {
    tabs: {
      query: vi.fn(async () => [{ id: 7, url: 'https://example.com/' }]),
      sendMessage: vi.fn(async (_tabId: number, message: unknown) => {
        if ((message as { type?: string }).type === 'DEV_PING') return pingResponse;
        return { ok: true };
      }),
      create: vi.fn(async () => undefined),
    },
    runtime: {
      getURL: vi.fn((path: string) => `chrome-extension://test${path}`),
    },
  };
  vi.stubGlobal('chrome', stub);
  return stub;
}

describe('Popup 开发工具', () => {
  beforeEach(() => {
    getDevDeckSummaryMock().mockResolvedValue({
      deck: { id: 'deck-1', name: '测试词库' },
      wordCount: 42,
      learningCardCount: 3,
      stageCounts: { new: 0, 'short-term': 1, 'long-term': 1, 'self-reported-known': 1 },
    });
    mocks.clearLearningProgress.mockResolvedValue(undefined);
    vi.spyOn(window, 'close').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    mocks.getDevDeckSummary.mockReset();
    mocks.clearLearningProgress.mockReset();
  });

  it('默认展开开发工具面板', () => {
    installChromeStub({ ok: true });
    render(<DevTools />);

    expect(screen.getByText('开发工具').closest('details')).toHaveAttribute('open');
  });

  it('显示当前词库摘要，并在内容脚本就绪时启用五个按钮', async () => {
    installChromeStub({ ok: true });
    render(<DevTools />);
    openDevTools();

    expect(await screen.findByText('测试词库')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新词' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '英选中' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '中选英' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '语境' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '拼写' })).toBeEnabled();
  });

  it('内容脚本未就绪时禁用题卡按钮', async () => {
    installChromeStub(null);
    render(<DevTools />);
    openDevTools();

    const button = await screen.findByRole('button', { name: '新词' });
    await waitFor(() => expect(button).toBeDisabled());
    expect(screen.getByText(/未连接内容脚本/)).toBeInTheDocument();
  });

  it('点击题型向当前标签页发送精确题型并关闭 Popup', async () => {
    const stub = installChromeStub({ ok: true });
    render(<DevTools />);
    openDevTools();
    const button = await screen.findByRole('button', { name: '拼写' });

    fireEvent.click(button);

    await waitFor(() => {
      expect(stub.tabs.sendMessage).toHaveBeenCalledWith(7, {
        type: 'DEV_SHOW_CARD',
        cardType: 'spelling',
      });
      expect(window.close).toHaveBeenCalled();
    });
  });

  it('清除按钮需要确认并重新加载摘要', async () => {
    installChromeStub({ ok: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<DevTools />);
    openDevTools();
    await screen.findByText('测试词库');

    fireEvent.click(screen.getByRole('button', { name: '清除全部学习进度' }));

    await waitFor(() => expect(mocks.clearLearningProgress).toHaveBeenCalledTimes(1));
    expect(window.confirm).toHaveBeenCalled();
    expect(mocks.getDevDeckSummary).toHaveBeenCalledTimes(2);
  });

  it('取消清除确认不会发送清除消息', async () => {
    installChromeStub({ ok: true });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<DevTools />);
    openDevTools();
    await screen.findByText('测试词库');

    fireEvent.click(screen.getByRole('button', { name: '清除全部学习进度' }));

    expect(mocks.clearLearningProgress).not.toHaveBeenCalled();
  });

  it('清除失败时保留摘要并显示错误', async () => {
    installChromeStub({ ok: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.clearLearningProgress.mockRejectedValueOnce(new Error('清除事务失败'));
    render(<DevTools />);
    openDevTools();
    await screen.findByText('测试词库');

    fireEvent.click(screen.getByRole('button', { name: '清除全部学习进度' }));

    await waitFor(() => expect(screen.getByText('清除失败：清除事务失败')).toBeInTheDocument());
    expect(screen.getByText('测试词库')).toBeInTheDocument();
  });
});

function getDevDeckSummaryMock() {
  return mocks.getDevDeckSummary;
}

function openDevTools() {
  const heading = screen.getByText('开发工具');
  const details = heading.closest('details');
  if (details?.open === false) fireEvent.click(heading);
}
