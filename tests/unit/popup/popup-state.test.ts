import { describe, expect, it } from 'vitest';
import { derivePopupState } from '@/popup/popup-state';
import type { SiteSettings } from '@/types';

const NOW = 1_000_000;

function site(overrides: Partial<SiteSettings> = {}): SiteSettings {
  return {
    enabled: true,
    mode: 'full-adaptation',
    firstQuestionPending: false,
    ...overrides,
  };
}

describe('popup-state — 受保护页面（AC5）', () => {
  it('chrome:// 页面标记为受保护，兼容等级为 protected', () => {
    const state = derivePopupState({
      hostname: '',
      url: 'chrome://extensions/',
      site: site({ mode: 'unsupported' }),
      onboardingCompleted: true,
      globalPausedUntil: 0,
      hasHostPermission: false,
      now: NOW,
    });
    expect(state.isProtectedPage).toBe(true);
    expect(state.compatibilityLevel).toBe('protected');
    expect(state.canControlVideo).toBe(false);
    expect(state.overlayMode).toBeNull();
  });

  it('edge:// 页面标记为受保护', () => {
    const state = derivePopupState({
      hostname: '',
      url: 'edge://extensions/',
      site: site({ mode: 'unsupported' }),
      onboardingCompleted: true,
      globalPausedUntil: 0,
      hasHostPermission: false,
      now: NOW,
    });
    expect(state.isProtectedPage).toBe(true);
  });

  it('about:blank 标记为受保护', () => {
    const state = derivePopupState({
      hostname: '',
      url: 'about:blank',
      site: site({ mode: 'unsupported' }),
      onboardingCompleted: true,
      globalPausedUntil: 0,
      hasHostPermission: false,
      now: NOW,
    });
    expect(state.isProtectedPage).toBe(true);
  });

  it('chrome-extension:// 页面标记为受保护', () => {
    const state = derivePopupState({
      hostname: '',
      url: 'chrome-extension://abc/options.html',
      site: site({ mode: 'unsupported' }),
      onboardingCompleted: true,
      globalPausedUntil: 0,
      hasHostPermission: false,
      now: NOW,
    });
    expect(state.isProtectedPage).toBe(true);
  });
});

describe('popup-state — 引导未完成（AC5：可理解状态）', () => {
  it('引导未完成时兼容等级为 not-onboarding，提示完成引导', () => {
    const state = derivePopupState({
      hostname: 'www.bilibili.com',
      url: 'https://www.bilibili.com/video/BV1',
      site: site({ enabled: false }),
      onboardingCompleted: false,
      globalPausedUntil: 0,
      hasHostPermission: true,
      now: NOW,
    });
    expect(state.compatibilityLevel).toBe('not-onboarding');
    expect(state.onboardingCompleted).toBe(false);
  });
});

describe('popup-state — 权限拒绝（AC5）', () => {
  it('支持站点缺少主机权限时兼容等级为 needs-permission', () => {
    const state = derivePopupState({
      hostname: 'www.bilibili.com',
      url: 'https://www.bilibili.com/',
      site: site({ enabled: false }),
      onboardingCompleted: true,
      globalPausedUntil: 0,
      hasHostPermission: false,
      now: NOW,
    });
    expect(state.compatibilityLevel).toBe('needs-permission');
    expect(state.canControlVideo).toBe(false);
    expect(state.overlayMode).toBeNull();
  });
});

describe('popup-state — 完整适配站点（AC3）', () => {
  it('Bilibili 已启用且已授权：显示完整适配、视频区域覆盖、可控制视频', () => {
    const state = derivePopupState({
      hostname: 'www.bilibili.com',
      url: 'https://www.bilibili.com/video/BV1',
      site: site({ enabled: true, mode: 'full-adaptation' }),
      onboardingCompleted: true,
      globalPausedUntil: 0,
      hasHostPermission: true,
      now: NOW,
    });
    expect(state.hostname).toBe('www.bilibili.com');
    expect(state.enabled).toBe(true);
    expect(state.compatibilityLevel).toBe('full-adaptation');
    expect(state.overlayMode).toBe('video-region');
    expect(state.canControlVideo).toBe(true);
    expect(state.globallyPaused).toBe(false);
  });

  it('YouTube Shorts 已启用：同样完整适配', () => {
    const state = derivePopupState({
      hostname: 'www.youtube.com',
      url: 'https://www.youtube.com/shorts/abc',
      site: site({ enabled: true, mode: 'full-adaptation' }),
      onboardingCompleted: true,
      globalPausedUntil: 0,
      hasHostPermission: true,
      now: NOW,
    });
    expect(state.compatibilityLevel).toBe('full-adaptation');
    expect(state.canControlVideo).toBe(true);
  });
});

describe('popup-state — 通用视频与基础网页模式（AC3）', () => {
  it('通用视频模式：全页覆盖、可控制视频', () => {
    const state = derivePopupState({
      hostname: 'example.com',
      url: 'https://example.com/',
      site: site({ enabled: true, mode: 'generic-video' }),
      onboardingCompleted: true,
      globalPausedUntil: 0,
      hasHostPermission: true,
      now: NOW,
    });
    expect(state.compatibilityLevel).toBe('generic-video');
    expect(state.overlayMode).toBe('full-page');
    expect(state.canControlVideo).toBe(true);
  });

  it('基础网页模式：全页覆盖、不可控制视频', () => {
    const state = derivePopupState({
      hostname: 'example.com',
      url: 'https://example.com/',
      site: site({ enabled: true, mode: 'basic-web' }),
      onboardingCompleted: true,
      globalPausedUntil: 0,
      hasHostPermission: true,
      now: NOW,
    });
    expect(state.compatibilityLevel).toBe('basic-web');
    expect(state.overlayMode).toBe('full-page');
    expect(state.canControlVideo).toBe(false);
  });

  it('不支持模式：无覆盖、不可控制视频', () => {
    const state = derivePopupState({
      hostname: 'example.com',
      url: 'https://example.com/',
      site: site({ enabled: false, mode: 'unsupported' }),
      onboardingCompleted: true,
      globalPausedUntil: 0,
      hasHostPermission: false,
      now: NOW,
    });
    expect(state.compatibilityLevel).toBe('unsupported');
    expect(state.overlayMode).toBeNull();
    expect(state.canControlVideo).toBe(false);
  });
});

describe('popup-state — 启用状态与全局暂停', () => {
  it('站点 enabled=false 时 enabled 为 false', () => {
    const state = derivePopupState({
      hostname: 'www.bilibili.com',
      url: 'https://www.bilibili.com/',
      site: site({ enabled: false }),
      onboardingCompleted: true,
      globalPausedUntil: 0,
      hasHostPermission: true,
      now: NOW,
    });
    expect(state.enabled).toBe(false);
  });

  it('全局暂停期间 globallyPaused=true', () => {
    const state = derivePopupState({
      hostname: 'www.bilibili.com',
      url: 'https://www.bilibili.com/',
      site: site({ enabled: true }),
      onboardingCompleted: true,
      globalPausedUntil: NOW + 60_000,
      hasHostPermission: true,
      now: NOW,
    });
    expect(state.globallyPaused).toBe(true);
  });

  it('全局暂停已过期 globallyPaused=false', () => {
    const state = derivePopupState({
      hostname: 'www.bilibili.com',
      url: 'https://www.bilibili.com/',
      site: site({ enabled: true }),
      onboardingCompleted: true,
      globalPausedUntil: NOW - 1_000,
      hasHostPermission: true,
      now: NOW,
    });
    expect(state.globallyPaused).toBe(false);
  });
});

describe('popup-state — 启用提示（AC2）', () => {
  it('引导完成、未启用、拒绝次数未达上限：showEnablePrompt=true', () => {
    const state = derivePopupState({
      hostname: 'www.bilibili.com',
      url: 'https://www.bilibili.com/',
      site: site({ enabled: false, promptDeclineCount: 1 }),
      onboardingCompleted: true,
      globalPausedUntil: 0,
      hasHostPermission: true,
      now: NOW,
    });
    expect(state.showEnablePrompt).toBe(true);
  });

  it('拒绝次数达到上限：showEnablePrompt=false', () => {
    const state = derivePopupState({
      hostname: 'www.bilibili.com',
      url: 'https://www.bilibili.com/',
      site: site({ enabled: false, promptDeclineCount: 2 }),
      onboardingCompleted: true,
      globalPausedUntil: 0,
      hasHostPermission: true,
      now: NOW,
    });
    expect(state.showEnablePrompt).toBe(false);
  });
});
