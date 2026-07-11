import { applyComplete, applySkip } from '@/cooldown/cooldown-rules';
import { LocalSettingsStore, defaultCooldownConfig } from '@/storage/local-settings';
import { pauseAll, pauseToday, resumeAll } from '@/pause/pause-rules';
import type { ExtensionMessage } from '@/messaging/messages';

/**
 * Background 消息路由（M1-02 / Issue #9）。只负责共享全局冷却、站点权限/状态、
 * 引导状态、全局暂停与消息分发。不维护全局题目锁，不常驻计时器（规格 Implementation Decisions）。
 */
export function createMessageRouter(store: LocalSettingsStore) {
  const config = defaultCooldownConfig();

  async function handle(message: ExtensionMessage, _sender: chrome.runtime.MessageSender) {
    switch (message.type) {
      case 'COOLDOWN_GET_STATUS': {
        // 全局暂停期间，有效冷却截止时间取 max(cooldown, pauseUntil)，
        // 使内容控制器的 isReady 判定自然尊重 AC4 暂停控制。
        const [cooldown, pausedUntil] = await Promise.all([
          store.getCooldown(),
          store.getGlobalPausedUntil(),
        ]);
        return {
          nextAllowedAt: Math.max(cooldown.nextAllowedAt, pausedUntil),
          consecutiveSkipCount: cooldown.consecutiveSkipCount,
        };
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

      // ─── Issue #9 ───────────────────────────────────────────
      case 'ONBOARDING_COMPLETE': {
        await store.markOnboardingCompleted();
        for (const hostname of message.hostnames) {
          await store.enableSite(hostname);
        }
        return undefined;
      }
      case 'SITE_ENABLE': {
        await store.enableSite(message.hostname);
        const site = await store.getSite(message.hostname);
        return { ...site, hostname: message.hostname };
      }
      case 'SITE_DISABLE': {
        await store.disableSite(message.hostname);
        const site = await store.getSite(message.hostname);
        return { ...site, hostname: message.hostname };
      }
      case 'PAUSE_ALL': {
        const until = pauseAll(Date.now());
        await store.setGlobalPausedUntil(until);
        return { globalPausedUntil: until };
      }
      case 'PAUSE_TODAY': {
        const until = pauseToday(message.now);
        await store.setGlobalPausedUntil(until);
        return { globalPausedUntil: until };
      }
      case 'RESUME_ALL': {
        const until = resumeAll();
        await store.setGlobalPausedUntil(until);
        return { globalPausedUntil: until };
      }
      case 'PROMPT_DECLINE': {
        await store.recordPromptDecline(message.hostname);
        return undefined;
      }
      case 'GET_POPUP_DATA': {
        const site = await store.getSite(message.hostname);
        const [onboardingCompleted, globalPausedUntil] = await Promise.all([
          store.isOnboardingCompleted(),
          store.getGlobalPausedUntil(),
        ]);
        return {
          site: { ...site, hostname: message.hostname },
          onboardingCompleted,
          globalPausedUntil,
        };
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
