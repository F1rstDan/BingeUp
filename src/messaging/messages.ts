import type { CooldownState, SiteSettings } from '@/types';

/**
 * Background ↔ Content Script / Popup 消息协议（M1-02 / Issue #9）。
 * Background 负责共享全局冷却、站点权限/状态、引导状态、全局暂停与消息分发。
 */

export type ExtensionMessage =
  | { type: 'COOLDOWN_GET_STATUS' }
  | { type: 'COOLDOWN_COMPLETE_QUESTION' }
  | { type: 'COOLDOWN_SKIP_QUESTION' }
  | { type: 'SITE_GET_STATE'; hostname: string }
  | { type: 'SITE_MARK_FIRST_QUESTION_HANDLED'; hostname: string }
  // ─── Issue #9：安装引导、可选权限与 Popup 控制 ──────────────
  /** 完成引导：标记 onboardingCompleted 并启用选定网站。 */
  | { type: 'ONBOARDING_COMPLETE'; hostnames: string[] }
  /** 启用当前网站（Popup / 启用提示）。 */
  | { type: 'SITE_ENABLE'; hostname: string }
  /** 暂停当前网站（AC4）。 */
  | { type: 'SITE_DISABLE'; hostname: string }
  /** 暂停全部网站（AC4）。 */
  | { type: 'PAUSE_ALL' }
  /** 暂停今天（AC4）。 */
  | { type: 'PAUSE_TODAY'; now: number }
  /** 恢复全部网站。 */
  | { type: 'RESUME_ALL' }
  /** 记录一次启用提示拒绝（AC2）。 */
  | { type: 'PROMPT_DECLINE'; hostname: string }
  /** 查询 Popup 需要的站点/引导/暂停数据（AC3）。 */
  | { type: 'GET_POPUP_DATA'; hostname: string };

/** Background 返回给 Content 的冷却状态。 */
export interface CooldownStatusResponse extends CooldownState {}

/** Background 返回给 Content 的站点状态。 */
export interface SiteStateResponse extends SiteSettings {
  hostname: string;
}

/** Background 返回给 Popup 的综合数据（AC3）。 */
export interface PopupDataResponse {
  site: SiteStateResponse;
  onboardingCompleted: boolean;
  globalPausedUntil: number;
}

/** 暂停操作返回新的全局暂停到期时间戳。 */
export interface PauseResponse {
  globalPausedUntil: number;
}

/**
 * Popup → Content Script 消息（通过 chrome.tabs.sendMessage 发送）。
 * 与 ExtensionMessage 分开，因为走不同的消息通道。
 */
export type ContentMessage =
  | { type: 'START_CONTINUOUS_LEARNING' };
