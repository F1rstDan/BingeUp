import type { CooldownState, SiteSettings } from '@/types';

/**
 * Background ↔ Content Script 消息协议（M1-02）。
 * 第一条纵向切片只用到冷却与站点状态相关消息。
 */
export type ExtensionMessage =
  | { type: 'COOLDOWN_GET_STATUS' }
  | { type: 'COOLDOWN_COMPLETE_QUESTION' }
  | { type: 'COOLDOWN_SKIP_QUESTION' }
  | { type: 'SITE_GET_STATE'; hostname: string }
  | { type: 'SITE_MARK_FIRST_QUESTION_HANDLED'; hostname: string };

/** Background 返回给 Content 的冷却状态。 */
export interface CooldownStatusResponse extends CooldownState {}

/** Background 返回给 Content 的站点状态。 */
export interface SiteStateResponse extends SiteSettings {
  hostname: string;
}
