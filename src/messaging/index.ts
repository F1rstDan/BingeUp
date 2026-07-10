import type { ExtensionMessage } from '@/messaging/messages';

/** Background ↔ Content 之间的消息类型（M1-02）。 */
export type { ExtensionMessage };

/** 消息响应载荷。 */
export interface CooldownStatusMessage {
  nextAllowedAt: number;
  consecutiveSkipCount: number;
}

export interface SiteStateMessage {
  enabled: boolean;
  mode: import('@/types').SiteMode;
  firstQuestionPending: boolean;
}
