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
  const dbPromise = openDatabase('bingeup', MIGRATIONS).catch((err) => {
    console.error('[BingeUp] IDB 打开失败', err);
    return null;
  });

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
        ]);
        if (dataOpTypes.has(message?.type)) {
          const db = await dbPromise;
          const dataRouter = createMessageRouter(store, db);
          const response = await dataRouter.handle(message, sender);
          sendResponse(response);
        } else {
          const response = await router.handle(message, sender);
          sendResponse(response);
        }
      } catch (error) {
        console.error('[BingeUp] background message error', error);
        sendResponse(undefined);
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
