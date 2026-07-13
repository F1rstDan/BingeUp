import { describe, expect, it } from 'vitest';
import {
  MAX_PROMPT_DECLINES,
  canonicalHostnameFor,
  siteKeysToEnable,
  shouldShowEnablePrompt,
  recordPromptDecline,
} from '@/onboarding/onboarding-service';
import type { SiteSettings } from '@/types';

describe('onboarding-service — 规范主机名', () => {
  it('bilibili 映射到 bilibili.com', () => {
    expect(canonicalHostnameFor('bilibili')).toBe('bilibili.com');
  });

  it('youtube 映射到 youtube.com', () => {
    expect(canonicalHostnameFor('youtube')).toBe('youtube.com');
  });

  it('siteKeysToEnable 返回规范主机名列表', () => {
    expect(siteKeysToEnable(['bilibili', 'youtube'])).toEqual(['bilibili.com', 'youtube.com']);
  });

  it('siteKeysToEnable 空选择返回空列表', () => {
    expect(siteKeysToEnable([])).toEqual([]);
  });
});

describe('onboarding-service — 启用提示策略（AC2）', () => {
  const baseSite: SiteSettings = {
    enabled: false,
    mode: 'full-adaptation',
    firstQuestionPending: false,
  };

  it('引导已完成、站点未启用、拒绝次数未达上限：应显示提示', () => {
    expect(shouldShowEnablePrompt({ ...baseSite, promptDeclineCount: 0 }, true)).toBe(true);
    expect(shouldShowEnablePrompt({ ...baseSite, promptDeclineCount: 1 }, true)).toBe(true);
  });

  it('拒绝次数达到上限（2）后不再显示提示', () => {
    expect(
      shouldShowEnablePrompt({ ...baseSite, promptDeclineCount: MAX_PROMPT_DECLINES }, true),
    ).toBe(false);
  });

  it('站点已启用时不显示启用提示', () => {
    expect(
      shouldShowEnablePrompt({ ...baseSite, enabled: true, promptDeclineCount: 0 }, true),
    ).toBe(false);
  });

  it('引导未完成时不显示启用提示（等待用户先完成引导）', () => {
    expect(shouldShowEnablePrompt({ ...baseSite, promptDeclineCount: 0 }, false)).toBe(false);
  });

  it('未记录拒绝次数时按 0 处理', () => {
    expect(shouldShowEnablePrompt(baseSite, true)).toBe(true);
  });

  it('MAX_PROMPT_DECLINES 为 2', () => {
    expect(MAX_PROMPT_DECLINES).toBe(2);
  });
});

describe('onboarding-service — 记录拒绝', () => {
  const baseSite: SiteSettings = {
    enabled: false,
    mode: 'full-adaptation',
    firstQuestionPending: false,
  };

  it('记录一次拒绝：promptDeclineCount 从 0 变 1', () => {
    const updated = recordPromptDecline({ ...baseSite, promptDeclineCount: 0 });
    expect(updated.promptDeclineCount).toBe(1);
    expect(updated.enabled).toBe(false);
  });

  it('未记录拒绝次数时从 0 开始递增', () => {
    const updated = recordPromptDecline(baseSite);
    expect(updated.promptDeclineCount).toBe(1);
  });

  it('记录拒绝不改变其他字段', () => {
    const original = { ...baseSite, promptDeclineCount: 1, firstQuestionPending: true };
    const updated = recordPromptDecline(original);
    expect(updated.firstQuestionPending).toBe(true);
    expect(updated.mode).toBe('full-adaptation');
    expect(updated.promptDeclineCount).toBe(2);
  });

  it('达到上限后继续记录仍递增（上限判定由 shouldShowEnablePrompt 负责）', () => {
    const updated = recordPromptDecline({ ...baseSite, promptDeclineCount: MAX_PROMPT_DECLINES });
    expect(updated.promptDeclineCount).toBe(MAX_PROMPT_DECLINES + 1);
  });
});
