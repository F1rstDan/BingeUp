import { createMessageRouter } from '@/background/message-router';
import { LocalSettingsStore } from '@/storage/local-settings';
import { openDatabase, rebuildDatabase } from '@/storage/database';
import {
  resetRecoverySnapshot,
  restoreRecoverySnapshotIfNeeded,
  saveRecoverySnapshot,
  saveStartupRecoverySnapshot,
} from '@/storage/recovery-snapshot';
import {
  getStorageDiagnostics,
  readStorageCounts,
  recordDatabaseOpenError,
  recordDatabaseOpened,
  recordSnapshotSaveError,
  recordStartupRead,
  startStorageDiagnosticSession,
} from '@/storage/storage-diagnostics';
import { syncCustomContentScripts } from '@/sites/custom-content-script';

/** 这些消息成功后会改变需要备份的权威数据。 */
const SNAPSHOT_MESSAGE_TYPES = new Set<string>([
  'LEARNING_ACCEPT_NEW_WORD',
  'LEARNING_SELF_REPORT_KNOWN',
  'LEARNING_SUBMIT_ANSWER',
  'LEARNING_SUBMIT_SPELLING',
  'LEARNING_CORRECT_RATING',
  'LEARNING_SAVE_SESSION',
  'SITE_MARK_FIRST_QUESTION_HANDLED',
  'ONBOARDING_COMPLETE',
  'SITE_ENABLE',
  'SITE_DISABLE',
  'PROMPT_DECLINE',
  'SET_APP_SETTINGS',
  'RESET_APP_SETTINGS',
  'UPDATE_SITE_TRIGGERS',
  'REMOVE_SITE',
  'IMPORT_DATA',
  'ADD_CUSTOM_SITE',
  'UPDATE_SITE_MODE',
]);

/**
 * Background service worker 入口（WXT）。
 * 窄职责：共享全局冷却、站点权限/状态、消息分发、应用设置与本地数据管理。无常驻计时器。
 */
export default defineBackground(() => {
  void startStorageDiagnosticSession();
  // Issue #10 AC4：打开 IDB 供导出/导入/清除操作使用。
  // 立即发起打开请求；数据操作消息到达时 await 该 Promise。
  let dbPromise: Promise<IDBDatabase> | null = null;
  let router: ReturnType<typeof createMessageRouter> | null = null;
  let settingsStore: LocalSettingsStore | null = null;
  const prepareDatabase = (db: IDBDatabase): IDBDatabase => {
    db.onversionchange = () => {
      db.close();
      dbPromise = null;
      router = null;
      settingsStore = null;
    };
    return db;
  };
  const getDatabase = (): Promise<IDBDatabase> => {
    if (dbPromise === null) {
      dbPromise = openDatabase()
        .then((db) => {
          void recordDatabaseOpened(db.version);
          return prepareDatabase(db);
        })
        .catch((error) => {
          // 连接失败后清除缓存，允许再次尝试。
          dbPromise = null;
          const detail = error instanceof Error ? error.message : String(error);
          void recordDatabaseOpenError(detail);
          throw new Error(
            `数据库打开失败，现有数据未被更改。请关闭其他刷刷升级页面后重试：${detail}`,
          );
        });
    }
    return dbPromise;
  };

  // 根据已保存的网站设置注册内容脚本。
  const customScriptsReady = getDatabase()
    .then(async (db) => {
      const store = new LocalSettingsStore(db);
      // 旧版本换库名或浏览器清掉 IndexedDB 后，先用本地恢复快照救回学习进度。
      const restoreResult = await restoreRecoverySnapshotIfNeeded(store);
      // 备份独立于诊断读取；快照摘要由本次启动检查直接返回。
      const { snapshot } = await saveStartupRecoverySnapshot(store);
      try {
        const counts = await readStorageCounts(store);
        await recordStartupRead({
          counts,
          restoredFromSnapshot: restoreResult.restored,
          ...(restoreResult.error ? { restoreError: restoreResult.error } : {}),
          snapshotPresent: snapshot.present,
          ...(snapshot.savedAt === undefined ? {} : { snapshotSavedAt: snapshot.savedAt }),
          ...(snapshot.mode === undefined ? {} : { snapshotMode: snapshot.mode }),
          ...(snapshot.counts === undefined ? {} : { snapshotCards: snapshot.counts.cards }),
        });
      } catch (error) {
        console.error('[BingeUp] 存档诊断读取失败', error);
      }
      await syncCustomContentScripts(await store.listSites());
    })
    .catch((error) => {
      console.error('[BingeUp] 自定义网站内容脚本恢复失败', error);
    });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      try {
        await customScriptsReady;
        if (message?.type === 'GET_STORAGE_DIAGNOSTICS') {
          let diagnosticsStore: LocalSettingsStore | null = settingsStore;
          if (diagnosticsStore === null) {
            try {
              diagnosticsStore = new LocalSettingsStore(await getDatabase());
            } catch (error) {
              // 数据库打不开时仍然返回启动记录和快照信息，便于定位问题。
              console.error('[BingeUp] 诊断读取无法打开数据库', error);
            }
          }
          sendResponse(await getStorageDiagnostics(diagnosticsStore));
          return;
        }
        if (import.meta.env.DEV) {
          const { handleDevExtensionMessage, isDevExtensionMessage } =
            await import('@/dev-tools/background-handler');
          if (isDevExtensionMessage(message)) {
            const db = await getDatabase();
            const store = new LocalSettingsStore(db);
            sendResponse(await handleDevExtensionMessage(message, { db, store }));
            return;
          }
        }
        if (message?.type === 'REBUILD_DATABASE') {
          const rebuilt = await rebuildDatabase();
          dbPromise = Promise.resolve(prepareDatabase(rebuilt));
          router = null;
          settingsStore = null;
          const rebuiltStore = new LocalSettingsStore(rebuilt);
          const warnings: string[] = [];
          if (!(await resetRecoverySnapshot(rebuiltStore))) {
            warnings.push('本地用户数据已重建，但自动存档清理失败；下次启动可能恢复旧数据。');
          }
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
        // 同一后台与数据库共享实例，保留提交去重、运行状态写入锁和基线初始化状态。
        settingsStore ??= new LocalSettingsStore(db);
        router ??= createMessageRouter(settingsStore, db);
        const result = await router.handle(message, sender);
        if (message?.type === 'CLEAR_LEARNING_PROGRESS') {
          await resetRecoverySnapshot(settingsStore);
        } else if (message?.type === 'CLEAR_ALL_DATA') {
          const clearResult = result as { ok?: boolean; warnings?: string[] } | undefined;
          if (clearResult?.ok !== false) {
            if (!(await resetRecoverySnapshot(settingsStore)) && clearResult?.warnings) {
              clearResult.warnings.push('自动存档清理失败；下次启动可能恢复旧数据。');
            }
          }
        } else if (typeof message?.type === 'string' && SNAPSHOT_MESSAGE_TYPES.has(message.type)) {
          if (!(await saveRecoverySnapshot(settingsStore))) {
            void recordSnapshotSaveError('自动快照写入失败');
          }
        }
        sendResponse(result);
      } catch (error) {
        console.error('[BingeUp] background message error', error);
        const code =
          typeof (error as { code?: unknown })?.code === 'string'
            ? (error as { code: string }).code
            : undefined;
        sendResponse({
          __bingeupError: error instanceof Error ? error.message : String(error),
          ...(code ? { __bingeupErrorCode: code } : {}),
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
