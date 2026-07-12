import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OnboardingApp } from '@/ui/onboarding/OnboardingApp';

const mocks = vi.hoisted(() => ({
  completeOnboarding: vi.fn(),
}));

vi.mock('@/messaging/message-client', () => ({
  messageClient: {
    completeOnboarding: mocks.completeOnboarding,
  },
}));

describe('OnboardingApp — Issue #9 AC1', () => {
  beforeEach(() => {
    mocks.completeOnboarding.mockReset();
    mocks.completeOnboarding.mockResolvedValue(undefined);
    vi.spyOn(window, 'close').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('欢迎标题中的品牌名使用品牌色样式', () => {
    render(<OnboardingApp />);

    expect(screen.getByText('刷刷升级')).toHaveClass('bingeup-onboarding-brand-name');
  });

  it('默认勾选所有受支持站点并在完成时启用它们', async () => {
    render(<OnboardingApp />);

    fireEvent.click(screen.getByText('完成引导'));

    await waitFor(() => {
      expect(mocks.completeOnboarding).toHaveBeenCalledWith(['bilibili.com', 'youtube.com']);
    });
    expect(screen.getByText('引导完成')).toBeInTheDocument();
  });

  it('取消所有网站后完成时提交空选择', async () => {
    render(<OnboardingApp />);
    fireEvent.click(screen.getByRole('checkbox', { name: /哔哩哔哩/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /YouTube/ }));

    fireEvent.click(screen.getByText('完成引导'));

    await waitFor(() => {
      expect(mocks.completeOnboarding).toHaveBeenCalledWith([]);
    });
  });

  it('取消 YouTube 后仅提交哔哩哔哩', async () => {
    render(<OnboardingApp />);
    fireEvent.click(screen.getByRole('checkbox', { name: /YouTube/ }));
    fireEvent.click(screen.getByText('完成引导'));

    await waitFor(() => expect(mocks.completeOnboarding).toHaveBeenCalledWith(['bilibili.com']));
  });

  it('取消哔哩哔哩后仅提交 YouTube', async () => {
    render(<OnboardingApp />);
    fireEvent.click(screen.getByRole('checkbox', { name: /哔哩哔哩/ }));
    fireEvent.click(screen.getByText('完成引导'));

    await waitFor(() => expect(mocks.completeOnboarding).toHaveBeenCalledWith(['youtube.com']));
  });

  it('完成引导后显示成功页', async () => {
    render(<OnboardingApp />);

    fireEvent.click(screen.getByText('完成引导'));

    await waitFor(() => {
      expect(screen.getByText('引导完成')).toBeInTheDocument();
      expect(screen.getByText(/已启用所选网站/)).toBeInTheDocument();
    });
  });

  it('选择网站后完成显示刷新提示', async () => {
    render(<OnboardingApp />);
    fireEvent.click(screen.getByText('完成引导'));

    await waitFor(() => {
      expect(screen.getByText('引导完成')).toBeInTheDocument();
      expect(screen.getByText(/请访问对应视频页面/)).toBeInTheDocument();
    });
  });
});
