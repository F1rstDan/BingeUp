import type { OverlayMode, SiteMode, SiteSettings } from '@/types';
import { isGloballyPaused } from '@/pause/pause-rules';
import { MAX_PROMPT_DECLINES } from '@/onboarding/onboarding-service';
import { isSupportedHostname } from '@/sites/supported-sites';

/**
 * Popup 显示状态派生（Issue #9 AC3 / AC5 / Issue #21 AC3/AC6）。纯函数。
 *
 * AC3：Popup 显示当前域名、启用状态、兼容等级、覆盖方式和是否能控制视频。
 * AC5：权限拒绝与受保护页面提供可理解的状态，而不是静默失败。
 * Issue #21 AC3/AC6：未完成安装引导不阻止 Popup 显示正常网站状态、
 * 暂停控制和主动学习入口；onboardingCompleted 不参与可用性判断。
 */

/** 受保护页面协议前缀（内容脚本无法注入）。 */
const PROTECTED_PROTOCOLS = ['chrome:', 'edge:', 'about:', 'chrome-extension:', 'moz-extension:'];

/** Popup 兼容等级展示类型（比 SiteMode 多出 protected/needs-permission）。 */
export type PopupCompatibilityLevel = SiteMode | 'protected' | 'needs-permission';

/** Popup 显示状态。 */
export interface PopupDisplayState {
  /** 当前标签页域名（受保护页面为空字符串）。 */
  hostname: string;
  /** 是否为受保护页面（chrome://、edge://、about:、扩展页）。 */
  isProtectedPage: boolean;
  /**
   * 引导是否已完成（仅用于显示，不参与可用性判断；Issue #21 AC6）。
   * 启用提示等需要区分"用户明确关闭"与"尚未配置"的 UX 逻辑仍可读取此字段。
   */
  onboardingCompleted: boolean;
  /** 当前网站是否启用（站点 enabled 标志）。 */
  enabled: boolean;
  /** 是否处于全局暂停。 */
  globallyPaused: boolean;
  /** 全局暂停到期时间戳；用于 Popup 显示十分钟倒计时或“今天恢复”。 */
  globalPausedUntil: number;
  /** 兼容等级。 */
  compatibilityLevel: PopupCompatibilityLevel;
  /** 覆盖方式；受保护/无权限/不支持时为 null。 */
  overlayMode: OverlayMode | null;
  /** 是否能控制视频。 */
  canControlVideo: boolean;
  /** 是否应在 Popup 显示"开启当前网站"提示（AC2）。 */
  showEnablePrompt: boolean;
  /** 是否可加入当前网站为自定义站点（Issue #11 AC1）。 */
  canAddCustomSite: boolean;
}

export interface DerivePopupStateInput {
  /** 当前标签页 hostname（受保护页面可为空）。 */
  hostname: string;
  /** 当前标签页 URL（用于受保护页面判定）。 */
  url: string;
  /** 当前站点的设置。 */
  site: SiteSettings;
  /** 引导是否已完成。 */
  onboardingCompleted: boolean;
  /** 全局暂停到期时间戳（ms）；0 表示未暂停。 */
  globalPausedUntil: number;
  /** 当前站点是否已获得浏览器主机权限。 */
  hasHostPermission: boolean;
  /** 当前时间戳（ms）。 */
  now: number;
}

/** 判定 URL 是否属于受保护页面。 */
export function isProtectedUrl(url: string): boolean {
  try {
    const proto = new URL(url).protocol;
    return PROTECTED_PROTOCOLS.includes(proto);
  } catch {
    // 无法解析的 URL 视为受保护
    return true;
  }
}

function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** 根据兼容等级推导覆盖方式。 */
function overlayModeFor(level: PopupCompatibilityLevel): OverlayMode | null {
  if (level === 'full-adaptation') return 'video-region';
  if (level === 'generic-video' || level === 'basic-web') return 'full-page';
  return null;
}

/** 根据兼容等级推导是否能控制视频。 */
function canControlVideoFor(level: PopupCompatibilityLevel): boolean {
  return level === 'full-adaptation' || level === 'generic-video';
}

/** 派生 Popup 显示状态。 */
export function derivePopupState(input: DerivePopupStateInput): PopupDisplayState {
  const protectedPage = isProtectedUrl(input.url);

  // AC5：受保护页面优先判定，提供可理解状态而非静默失败。
  if (protectedPage) {
    return {
      hostname: input.hostname,
      isProtectedPage: true,
      onboardingCompleted: input.onboardingCompleted,
      enabled: false,
      globallyPaused: isGloballyPaused(input.globalPausedUntil, input.now),
      globalPausedUntil: input.globalPausedUntil,
      compatibilityLevel: 'protected',
      overlayMode: null,
      canControlVideo: false,
      showEnablePrompt: false,
      canAddCustomSite: false,
    };
  }

  // Issue #21 AC3/AC6：未完成安装引导不再阻止 Popup 显示正常网站状态。
  // 默认支持网站在引导未完成时仍按默认启用状态展示，用户可立即开始学习。

  // Issue #16：内容脚本只运行在 HTTPS 页面。即使相同 hostname 已持久化启用，
  // HTTP 等页面也必须按不支持处理，不能向内容脚本发送主动学习请求。
  const isHttps = isHttpsUrl(input.url);
  if (!isHttps) {
    return {
      hostname: input.hostname,
      isProtectedPage: false,
      onboardingCompleted: input.onboardingCompleted,
      enabled: false,
      globallyPaused: isGloballyPaused(input.globalPausedUntil, input.now),
      globalPausedUntil: input.globalPausedUntil,
      compatibilityLevel: 'unsupported',
      overlayMode: null,
      canControlVideo: false,
      showEnablePrompt: false,
      canAddCustomSite: false,
    };
  }

  // AC5：支持站点缺少主机权限时显示"需要权限"状态。
  if (!input.hasHostPermission && input.site.mode !== 'unsupported') {
    return {
      hostname: input.hostname,
      isProtectedPage: false,
      onboardingCompleted: input.onboardingCompleted,
      enabled: input.site.enabled,
      globallyPaused: isGloballyPaused(input.globalPausedUntil, input.now),
      globalPausedUntil: input.globalPausedUntil,
      compatibilityLevel: 'needs-permission',
      overlayMode: null,
      canControlVideo: false,
      showEnablePrompt: false,
      canAddCustomSite: false,
    };
  }

  const level: PopupCompatibilityLevel = input.site.mode;
  // Issue #11 AC1：非专属适配站点且未加入（unsupported）时，允许用户主动加入。
  // 规范要求 HTTPS：内容脚本仅匹配 https://*/*，HTTP 站点加入后无法注入。
  const canAddCustomSite =
    isHttps && !isSupportedHostname(input.hostname) && input.site.mode === 'unsupported';
  return {
    hostname: input.hostname,
    isProtectedPage: false,
    onboardingCompleted: input.onboardingCompleted,
    enabled: input.site.enabled,
    globallyPaused: isGloballyPaused(input.globalPausedUntil, input.now),
    globalPausedUntil: input.globalPausedUntil,
    compatibilityLevel: level,
    overlayMode: overlayModeFor(level),
    canControlVideo: canControlVideoFor(level),
    showEnablePrompt:
      !input.site.enabled && (input.site.promptDeclineCount ?? 0) < MAX_PROMPT_DECLINES,
    canAddCustomSite,
  };
}
