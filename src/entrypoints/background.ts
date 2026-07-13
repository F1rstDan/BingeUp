import { createMessageRouter } from '@/background/message-router';
import { LocalSettingsStore } from '@/storage/local-settings';
import { openDatabase, rebuildDatabase } from '@/storage/database';
import { DATABASE_NAME, MIGRATIONS } from '@/storage/migrations';
import { syncCustomContentScripts } from '@/sites/custom-content-script';

/**
 * Background service worker 入口（WXT）。
 * 窄职责：共享全局冷却、站点权限/状态、消息分发、应用设置与本地数据管理。无常驻计时器。
 */
export default defineBackground(() => {
  // Issue #10 AC4：打开 IDB 供导出/导入/清除操作使用。
  // 立即发起打开请求；数据操作消息到达时 await 该 Promise。
  let dbPromise: Promise<IDBDatabase> | null = null;
  const getDatabase = (): Promise<IDBDatabase> => {
    if (dbPromise === null) {
      dbPromise = openDatabase(DATABASE_NAME, MIGRATIONS)
        .then((db) => {
          db.onversionchange = () => {
            db.close();
            dbPromise = null;
          };
          return db;
        })
        .catch((error) => {
          // 失败不删除数据库，并清除缓存以允许用户关闭旧页面后再次尝试。
          dbPromise = null;
          throw new Error(
            `数据库打开失败，现有数据未被更改。请关闭其他刷刷升级页面后重试：${error instanceof Error ? error.message : String(error)}`,
          );
        });
    }
    return dbPromise;
  };

  // 扩展升级后动态注册表可能为空；根据权威网站设置恢复精确 origin 注册。
  const customScriptsReady = getDatabase()
    .then(async (db) => {
      const store = new LocalSettingsStore(db);
      await syncCustomContentScripts(await store.listSites());
    })
    .catch((error) => {
      console.error('[BingeUp] 自定义网站内容脚本恢复失败', error);
    });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      try {
        await customScriptsReady;
        if (message?.type === 'REBUILD_DATABASE') {
          const rebuilt = await rebuildDatabase(DATABASE_NAME, MIGRATIONS);
          dbPromise = Promise.resolve(rebuilt);
          const rebuiltStore = new LocalSettingsStore(rebuilt);
          const warnings: string[] = [];
          try {
            await rebuiltStore.resetRuntimeState();
          } catch (error) {
            warnings.push(
              `本地用户数据已重建，但临时运行状态重置失败：${error instanceof Error ? error.message : String(error)}`,
            );
          }
          try {
            await syncCustomContentScripts(await rebuiltStore.listSites());
          } catch (error) {
            warnings.push(
              `本地用户数据已重建，但内容脚本同步失败；浏览器下次启动时将重试：${error instanceof Error ? error.message : String(error)}`,
            );
          }
          sendResponse({ ok: true, errors: [], warnings });
          return;
        }
        const db = await getDatabase();
        const router = createMessageRouter(new LocalSettingsStore(db), db);
        sendResponse(await router.handle(message, sender));
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
