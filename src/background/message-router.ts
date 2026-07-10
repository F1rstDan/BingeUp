import { applyComplete, applySkip } from '@/cooldown/cooldown-rules';
import { LocalSettingsStore, defaultCooldownConfig } from '@/storage/local-settings';
import type { ExtensionMessage } from '@/messaging/messages';

/**
 * Background 消息路由（M1-02）。只负责共享全局冷却、站点权限/状态与消息分发。
 * 不维护全局题目锁，不常驻计时器（规格 Implementation Decisions）。
 */
export function createMessageRouter(store: LocalSettingsStore) {
  const config = defaultCooldownConfig();

  async function handle(message: ExtensionMessage, _sender: chrome.runtime.MessageSender) {
    switch (message.type) {
      case 'COOLDOWN_GET_STATUS': {
        return store.getCooldown();
      }
      case 'COOLDOWN_COMPLETE_QUESTION': {
        const next = applyComplete(Date.now(), config);
        await store.setCooldown(next);
        return next;
      }
      case 'COOLDOWN_SKIP_QUESTION': {
        const before = await store.getCooldown();
        const next = applySkip(before, Date.now(), config);
        await store.setCooldown(next);
        return next;
      }
      case 'SITE_GET_STATE': {
        const site = await store.getSite(message.hostname);
        return { ...site, hostname: message.hostname };
      }
      case 'SITE_MARK_FIRST_QUESTION_HANDLED': {
        await store.markFirstQuestionHandled(message.hostname);
        const site = await store.getSite(message.hostname);
        return { ...site, hostname: message.hostname };
      }
      default: {
        return undefined;
      }
    }
  }

  return {
    handle,
    attach(): void {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        handle(message as ExtensionMessage, sender)
          .then((response) => sendResponse(response))
          .catch((error) => {
            console.error('[BingeUp] background message error', error);
            sendResponse(undefined);
          });
        return true; // 异步响应
      });
    },
  };
}
