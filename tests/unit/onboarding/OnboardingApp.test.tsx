import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OnboardingApp } from '@/ui/onboarding/OnboardingApp';
import { getDefaultDeck } from '@/dictionary/built-in/decks';
import { DEFAULT_SETTINGS } from '@/settings/defaults';

const mocks = vi.hoisted(() => ({
  completeOnboarding: vi.fn(),
}));

vi.mock('@/messaging/message-client', () => ({
  messageClient: {
    completeOnboarding: mocks.completeOnboarding,
  },
}));

describe('OnboardingApp — Issue #9 AC1 / Issue #21', () => {
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
      expect(mocks.completeOnboarding).toHaveBeenCalledWith({
        hostnames: ['bilibili.com', 'youtube.com'],
        deckId: getDefaultDeck().id,
        selfRatedLevel: DEFAULT_SETTINGS.selfRatedLevel,
      });
    });
    expect(screen.getByText('引导完成')).toBeInTheDocument();
  });

  it('取消所有网站后完成时提交空选择', async () => {
    render(<OnboardingApp />);
    fireEvent.click(screen.getByRole('checkbox', { name: /哔哩哔哩/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /YouTube/ }));

    fireEvent.click(screen.getByText('完成引导'));

    await waitFor(() => {
      expect(mocks.completeOnboarding).toHaveBeenCalledWith({
        hostnames: [],
        deckId: getDefaultDeck().id,
        selfRatedLevel: DEFAULT_SETTINGS.selfRatedLevel,
      });
    });
  });

  it('取消 YouTube 后仅提交哔哩哔哩', async () => {
    render(<OnboardingApp />);
    fireEvent.click(screen.getByRole('checkbox', { name: /YouTube/ }));
    fireEvent.click(screen.getByText('完成引导'));

    await waitFor(() =>
      expect(mocks.completeOnboarding).toHaveBeenCalledWith({
        hostnames: ['bilibili.com'],
        deckId: getDefaultDeck().id,
        selfRatedLevel: DEFAULT_SETTINGS.selfRatedLevel,
      }),
    );
  });

  it('取消哔哩哔哩后仅提交 YouTube', async () => {
    render(<OnboardingApp />);
    fireEvent.click(screen.getByRole('checkbox', { name: /哔哩哔哩/ }));
    fireEvent.click(screen.getByText('完成引导'));

    await waitFor(() =>
      expect(mocks.completeOnboarding).toHaveBeenCalledWith({
        hostnames: ['youtube.com'],
        deckId: getDefaultDeck().id,
        selfRatedLevel: DEFAULT_SETTINGS.selfRatedLevel,
      }),
    );
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

describe('OnboardingApp — Issue #21 学习设置', () => {
  beforeEach(() => {
    mocks.completeOnboarding.mockReset();
    mocks.completeOnboarding.mockResolvedValue(undefined);
    vi.spyOn(window, 'close').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('默认选择默认词库与默认学习水平（一般）', () => {
    render(<OnboardingApp />);

    const levelGroup = screen.getByRole('radiogroup', { name: '学习水平' });
    const defaultLevelRadio = levelGroup.querySelector(
      `input[value="${DEFAULT_SETTINGS.selfRatedLevel}"]`,
    ) as HTMLInputElement;
    expect(defaultLevelRadio.checked).toBe(true);

    const deckGroup = screen.getByRole('radiogroup', { name: '词库' });
    const defaultDeckRadio = deckGroup.querySelector(
      `input[value="${getDefaultDeck().id}"]`,
    ) as HTMLInputElement;
    expect(defaultDeckRadio.checked).toBe(true);
  });

  it('切换学习水平后完成时提交新水平', async () => {
    render(<OnboardingApp />);

    fireEvent.click(screen.getByRole('radio', { name: /进阶/ }));
    fireEvent.click(screen.getByText('完成引导'));

    await waitFor(() => {
      expect(mocks.completeOnboarding).toHaveBeenCalledWith({
        hostnames: ['bilibili.com', 'youtube.com'],
        deckId: getDefaultDeck().id,
        selfRatedLevel: 'advanced',
      });
    });
  });

  it('切换词库后完成时提交新词库', async () => {
    render(<OnboardingApp />);

    fireEvent.click(screen.getByRole('radio', { name: /六级/ }));
    fireEvent.click(screen.getByText('完成引导'));

    await waitFor(() => {
      expect(mocks.completeOnboarding).toHaveBeenCalledWith({
        hostnames: ['bilibili.com', 'youtube.com'],
        deckId: 'deck-cet6',
        selfRatedLevel: DEFAULT_SETTINGS.selfRatedLevel,
      });
    });
  });

  it('同时切换学习水平与词库后完成时提交新组合', async () => {
    render(<OnboardingApp />);

    fireEvent.click(screen.getByRole('radio', { name: /初学/ }));
    fireEvent.click(screen.getByRole('radio', { name: /四级/ }));
    fireEvent.click(screen.getByText('完成引导'));

    await waitFor(() => {
      expect(mocks.completeOnboarding).toHaveBeenCalledWith({
        hostnames: ['bilibili.com', 'youtube.com'],
        deckId: 'deck-cet4',
        selfRatedLevel: 'beginner',
      });
    });
  });

  it('同时调整网站、水平与词库后提交完整选择', async () => {
    render(<OnboardingApp />);

    fireEvent.click(screen.getByRole('checkbox', { name: /哔哩哔哩/ }));
    fireEvent.click(screen.getByRole('radio', { name: /进阶/ }));
    fireEvent.click(screen.getByRole('radio', { name: /六级/ }));
    fireEvent.click(screen.getByText('完成引导'));

    await waitFor(() => {
      expect(mocks.completeOnboarding).toHaveBeenCalledWith({
        hostnames: ['youtube.com'],
        deckId: 'deck-cet6',
        selfRatedLevel: 'advanced',
      });
    });
  });
});
