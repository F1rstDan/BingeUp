import { applyComplete, applySkip } from '@/cooldown/cooldown-rules';
import { LocalSettingsStore } from '@/storage/local-settings';
import { pauseAll, pauseForTenMinutes, pauseToday, resumeAll } from '@/pause/pause-rules';
import { StatsService } from '@/stats/stats-service';
import { CardRepository } from '@/storage/repositories/card-repository';
import { ReviewLogRepository } from '@/storage/repositories/review-log-repository';
import { SessionLogRepository } from '@/storage/repositories/session-log-repository';
import {
  clearAllLocalData,
  clearLearningProgress,
  exportLocalData,
  importLocalData,
} from '@/storage/data-transfer';
import { isSupportedHostname } from '@/sites/supported-sites';
import { exactHttpsOriginPattern, legacyBroadOriginPatterns } from '@/sites/site-origin';
import {
  ONBOARDING_HOSTNAMES,
  selectedOnboardingHostnames,
} from '@/onboarding/onboarding-service';
import type { ExtensionMessage, PopupLearningStats } from '@/messaging/messages';

async function computePopupStats(db: IDBDatabase): Promise<PopupLearningStats> {
  const [cards, logs, sessions] = await Promise.all([
    new CardRepository(db).getAll(),
    new ReviewLogRepository(db).getAll(),
    new SessionLogRepository(db).getAll(),
  ]);
  const stats = new StatsService({ clock: { now: () => Date.now() } }).computeStats(
    cards,
    logs,
    sessions,
  );
  return {
    today: { completedQuestions: stats.today.completedQuestions },
    cardStatus: { longTerm: stats.cardStatus.longTerm },
    dueReviewCount: stats.dueReviewCount,
  };
}

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
        const selectedHostnames = selectedOnboardingHostnames(message.hostnames);
        for (const hostname of selectedHostnames) {
          await store.enableSite(hostname);
        }
        for (const hostname of ONBOARDING_HOSTNAMES) {
          if (!selectedHostnames.includes(hostname)) {
            await store.disableSite(hostname);
          }
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
      case 'PAUSE_TEN_MINUTES': {
        const until = pauseForTenMinutes(Date.now());
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
      case 'GET_GLOBAL_PAUSE_STATUS': {
        return { globalPausedUntil: await store.getGlobalPausedUntil() };
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
        let stats: PopupLearningStats | undefined;
        if (db) {
          try {
            stats = await computePopupStats(db);
          } catch (error) {
            // 统计是面板的补充信息；读取失败不应遮蔽站点状态与暂停控制。
            console.error('[BingeUp] Popup 学习统计读取失败', error);
          }
        }
        return {
          site: { ...site, hostname: message.hostname },
          onboardingCompleted,
          globalPausedUntil,
          stats,
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
          let exactReleased = false;
          let legacyReleased = false;
          try {
            exactReleased = await chrome.permissions.remove({
              origins: [exactHttpsOriginPattern(message.hostname)],
            });
          } catch {
            // 继续尝试清理旧版权限，避免单次 API 失败阻断迁移。
          }
          try {
            legacyReleased = await chrome.permissions.remove({
              origins: legacyBroadOriginPatterns(message.hostname),
            });
          } catch {
            // 删除站点本身已完成；权限释放失败通过 released=false 返回。
          }
          released = exactReleased || legacyReleased;
        }
        return { released };
      }
      case 'EXPORT_DATA': {
        if (!db) throw new Error('数据库不可用，请先导出已有备份或在设置页重建数据');
        return exportLocalData(store, db);
      }
      case 'IMPORT_DATA': {
        if (!db) throw new Error('数据库不可用，请先导出已有备份或在设置页重建数据');
        return importLocalData(store, db, message.payload);
      }
      case 'CLEAR_LEARNING_PROGRESS': {
        if (!db) throw new Error('数据库不可用，请先导出已有备份或在设置页重建数据');
        await clearLearningProgress(db);
        return undefined;
      }
      case 'CLEAR_ALL_DATA': {
        if (!db) throw new Error('数据库不可用，请先导出已有备份或在设置页重建数据');
        await clearAllLocalData(store, db);
        return undefined;
      }

      // ─── Issue #11：自定义网站兼容模式 ───────────────────
      case 'ADD_CUSTOM_SITE': {
        // 加入自定义站点：以基础网页模式启用，内容脚本加载后按能力检测更新。
        await store.enableSite(message.hostname, 'basic-web');
        const site = await store.getSite(message.hostname);
        return { ...site, hostname: message.hostname };
      }
      case 'UPDATE_SITE_MODE': {
        await store.updateSiteMode(message.hostname, message.mode);
        return undefined;
      }
      default: {
        return undefined;
      }
    }
  }

  return { handle };
}
