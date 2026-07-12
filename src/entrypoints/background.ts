import { createMessageRouter } from '@/background/message-router';
import { LocalSettingsStore } from '@/storage/local-settings';
import { openDatabase } from '@/storage/database';
import { MIGRATIONS } from '@/storage/migrations';

/**
 * Background service worker 入口（WXT）。
 * 窄职责：共享全局冷却、站点权限/状态、消息分发、应用设置与本地数据管理。无常驻计时器。
 */
export default defineBackground(() => {
  const store = new LocalSettingsStore();

  // Issue #10 AC4：打开 IDB 供导出/导入/清除操作使用。
  // 立即发起打开请求；数据操作消息到达时 await 该 Promise。
  let dbPromise: Promise<IDBDatabase> | null = null;
  const getDatabase = (): Promise<IDBDatabase> => {
    if (dbPromise === null) {
      dbPromise = openDatabase('bingeup', MIGRATIONS).catch((error) => {
        // 失败不删除数据库，并清除缓存以允许用户关闭旧页面后再次尝试。
        dbPromise = null;
        throw new Error(
          `数据库打开失败，现有数据未被更改。请关闭其他刷刷升级页面后重试：${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
    return dbPromise;
  };

  const router = createMessageRouter(store, null);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      try {
        // 数据操作消息需要 IDB 句柄；其他消息不需要。
        const dataOpTypes = new Set([
          'EXPORT_DATA',
          'IMPORT_DATA',
          'CLEAR_LEARNING_PROGRESS',
          'CLEAR_ALL_DATA',
          'GET_POPUP_DATA',
        ]);
        if (dataOpTypes.has(message?.type)) {
          const db = await getDatabase();
          const dataRouter = createMessageRouter(store, db);
          const response = await dataRouter.handle(message, sender);
          sendResponse(response);
        } else {
          const response = await router.handle(message, sender);
          sendResponse(response);
        }
      } catch (error) {
        console.error('[BingeUp] background message error', error);
        sendResponse({
          __bingeupError: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return true; // 异步响应
  });

  // Issue #9 AC1：首次安装时打开引导页。
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      chrome.tabs.create({ url: chrome.runtime.getURL('/onboarding.html') });
    }
  });
});
