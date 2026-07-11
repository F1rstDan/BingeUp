import { applyComplete, applySkip } from '@/cooldown/cooldown-rules';
import { LocalSettingsStore } from '@/storage/local-settings';
import { pauseAll, pauseToday, resumeAll } from '@/pause/pause-rules';
import {
  clearAllLocalData,
  clearLearningProgress,
  exportLocalData,
  importLocalData,
} from '@/storage/data-transfer';
import { isSupportedHostname } from '@/sites/supported-sites';
import type { ExtensionMessage } from '@/messaging/messages';

/**
 * Background 消息路由（M1-02 / Issue #9 / #10 / #11）。只负责共享全局冷却、站点权限/状态、
 * 引导状态、全局暂停、应用设置与本地数据管理，以及消息分发。不维护全局题目锁，
 * 不常驻计时器（规格 Implementation Decisions）。
 *
 * 冷却配置从持久化的应用设置实时派生（Issue #10 AC3），不再在构造时缓存。
 *
 * @param db IDB 数据库句柄，用于导出/导入/清除操作（Issue #10 AC4）。
 *           background 在启动时打开并传入；测试中可传 null 跳过数据操作。
 */
export function createMessageRouter(store: LocalSettingsStore, db: IDBDatabase | null = null) {

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
        const config = await store.getCooldownConfig();
        const next = applyComplete(Date.now(), config);
        await store.setCooldown(next);
        return next;
      }
      case 'COOLDOWN_SKIP_QUESTION': {
        const config = await store.getCooldownConfig();
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

      // ─── Issue #10：设置页与本地数据管理 ───────────────────
      case 'GET_APP_SETTINGS': {
        return store.getAppSettings();
      }
      case 'SET_APP_SETTINGS': {
        await store.setAppSettings(message.settings);
        return store.getAppSettings();
      }
      case 'RESET_APP_SETTINGS': {
        await store.resetAppSettings();
        return store.getAppSettings();
      }
      case 'LIST_SITES': {
        const sites = await store.listSites();
        return { sites };
      }
      case 'REMOVE_SITE': {
        await store.removeSite(message.hostname);
        // AC5：受支持站点（bilibili/youtube）使用必需 host_permissions，不可释放；
        // 自定义站点使用可选权限，尝试释放。
        let released = false;
        if (!isSupportedHostname(message.hostname) && chrome.permissions?.remove) {
          try {
            released = await chrome.permissions.remove({
              origins: [`*://${message.hostname}/*`, `*://*.${message.hostname}/*`],
            });
          } catch {
            released = false;
          }
        }
        return { released };
      }
      case 'EXPORT_DATA': {
        if (!db) return undefined;
        return exportLocalData(store, db);
      }
      case 'IMPORT_DATA': {
        if (!db) return { ok: false, errors: ['数据库不可用'] };
        return importLocalData(store, db, message.payload);
      }
      case 'CLEAR_LEARNING_PROGRESS': {
        if (!db) return undefined;
        await clearLearningProgress(db);
        return undefined;
      }
      case 'CLEAR_ALL_DATA': {
        if (!db) return undefined;
        await clearAllLocalData(store, db);
        return undefined;
      }
      default: {
        return undefined;
      }
    }
  }

  return { handle };
}
