import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OnboardingApp } from '@/ui/onboarding/OnboardingApp';
import { getDefaultDeck } from '@/dictionary/built-in/decks';
import { DEFAULT_SETTINGS } from '@/settings/defaults';
import type { SelfRatedLevel } from '@/types';

const mocks = vi.hoisted(() => ({
  completeOnboarding: vi.fn(),
}));

vi.mock('@/messaging/message-client', () => ({
  messageClient: {
    completeOnboarding: mocks.completeOnboarding,
  },
}));

/** 学习水平取值到可见文案的映射（断言默认选中项时与 DEFAULT_SETTINGS 联动）。 */
const LEVEL_LABELS: Record<SelfRatedLevel, string> = {
  beginner: '初学',
  intermediate: '一般',
  advanced: '进阶',
};

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

  it('欢迎标题渲染为一级标题并包含品牌名', () => {
    render(<OnboardingApp />);

    expect(
      screen.getByRole('heading', { level: 1, name: /欢迎使用.*刷刷升级/ }),
    ).toBeInTheDocument();
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

    expect(
      screen.getByRole('radio', { name: new RegExp(LEVEL_LABELS[DEFAULT_SETTINGS.selfRatedLevel]) }),
    ).toBeChecked();
    expect(screen.getByRole('radio', { name: new RegExp(getDefaultDeck().name) })).toBeChecked();
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

describe('OnboardingApp — 工单 #40 原版视觉迁移的结构语义', () => {
  beforeEach(() => {
    mocks.completeOnboarding.mockReset();
    mocks.completeOnboarding.mockResolvedValue(undefined);
    vi.spyOn(window, 'close').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('使用 island 页面外壳（main 地标）与命名区块组织引导内容', () => {
    render(<OnboardingApp />);

    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '学习设置' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '默认支持网站' })).toBeInTheDocument();
  });

  it('完成页同样使用 island 页面外壳', async () => {
    render(<OnboardingApp />);

    fireEvent.click(screen.getByText('完成引导'));

    await waitFor(() => {
      expect(screen.getByText('引导完成')).toBeInTheDocument();
    });
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
  });
});
