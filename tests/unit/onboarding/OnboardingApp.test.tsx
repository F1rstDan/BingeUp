import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OnboardingApp } from '@/ui/onboarding/OnboardingApp';

const mocks = vi.hoisted(() => ({
  completeOnboarding: vi.fn(),
  permissionsRequest: vi.fn(),
}));

vi.mock('@/messaging/message-client', () => ({
  messageClient: {
    completeOnboarding: mocks.completeOnboarding,
  },
}));

function installChromeStub() {
  const stub = {
    permissions: {
      request: mocks.permissionsRequest,
    },
  };
  vi.stubGlobal('chrome', stub);
  return stub;
}

describe('OnboardingApp — Issue #9 AC1', () => {
  beforeEach(() => {
    mocks.completeOnboarding.mockReset();
    mocks.permissionsRequest.mockReset();
    mocks.completeOnboarding.mockResolvedValue(undefined);
    mocks.permissionsRequest.mockResolvedValue(true);
    vi.spyOn(window, 'close').mockImplementation(() => undefined);
    installChromeStub();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('不选择任何网站也能完成引导（AC1）', async () => {
    render(<OnboardingApp />);

    fireEvent.click(screen.getByText('完成引导'));

    await waitFor(() => {
      expect(mocks.completeOnboarding).toHaveBeenCalledWith([]);
    });
    expect(screen.getByText('引导完成')).toBeInTheDocument();
  });

  it('未选择网站时不请求权限（AC1：仅在选择后请求）', async () => {
    render(<OnboardingApp />);

    fireEvent.click(screen.getByText('完成引导'));

    await waitFor(() => {
      expect(mocks.completeOnboarding).toHaveBeenCalled();
    });
    expect(mocks.permissionsRequest).not.toHaveBeenCalled();
  });

  it('选择哔哩哔哩后完成 → 请求权限并启用 bilibili.com', async () => {
    render(<OnboardingApp />);

    fireEvent.click(screen.getByText('哔哩哔哩'));
    fireEvent.click(screen.getByText('完成引导'));

    await waitFor(() => {
      expect(mocks.permissionsRequest).toHaveBeenCalledWith({
        origins: ['*://*.bilibili.com/*'],
      });
    });
    expect(mocks.completeOnboarding).toHaveBeenCalledWith(['bilibili.com']);
  });

  it('选择 YouTube 后完成 → 请求权限并启用 youtube.com', async () => {
    render(<OnboardingApp />);

    fireEvent.click(screen.getByText('YouTube'));
    fireEvent.click(screen.getByText('完成引导'));

    await waitFor(() => {
      expect(mocks.permissionsRequest).toHaveBeenCalledWith({
        origins: ['*://*.youtube.com/*'],
      });
    });
    expect(mocks.completeOnboarding).toHaveBeenCalledWith(['youtube.com']);
  });

  it('同时选择两个网站 → 请求两个 origin 并启用两个站点', async () => {
    render(<OnboardingApp />);

    fireEvent.click(screen.getByText('哔哩哔哩'));
    fireEvent.click(screen.getByText('YouTube'));
    fireEvent.click(screen.getByText('完成引导'));

    await waitFor(() => {
      expect(mocks.permissionsRequest).toHaveBeenCalledWith({
        origins: ['*://*.bilibili.com/*', '*://*.youtube.com/*'],
      });
    });
    expect(mocks.completeOnboarding).toHaveBeenCalledWith([
      'bilibili.com',
      'youtube.com',
    ]);
  });

  it('用户拒绝权限仍完成引导（AC1：不强制权限）', async () => {
    mocks.permissionsRequest.mockResolvedValue(false);

    render(<OnboardingApp />);

    fireEvent.click(screen.getByText('哔哩哔哩'));
    fireEvent.click(screen.getByText('完成引导'));

    await waitFor(() => {
      expect(screen.getByText('引导完成')).toBeInTheDocument();
    });
    // 仍调用 completeOnboarding 启用站点（host_permissions 已声明，权限拒绝不影响启用）
    expect(mocks.completeOnboarding).toHaveBeenCalledWith(['bilibili.com']);
  });

  it('完成引导后显示成功页', async () => {
    render(<OnboardingApp />);

    fireEvent.click(screen.getByText('完成引导'));

    await waitFor(() => {
      expect(screen.getByText('引导完成')).toBeInTheDocument();
      expect(screen.getByText(/未选择任何网站/)).toBeInTheDocument();
    });
  });

  it('选择网站后完成显示刷新提示', async () => {
    render(<OnboardingApp />);

    fireEvent.click(screen.getByText('哔哩哔哩'));
    fireEvent.click(screen.getByText('完成引导'));

    await waitFor(() => {
      expect(screen.getByText('引导完成')).toBeInTheDocument();
      expect(screen.getByText(/请访问对应视频页面/)).toBeInTheDocument();
    });
  });
});
