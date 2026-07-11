import { createMessageRouter } from '@/background/message-router';
import { LocalSettingsStore } from '@/storage/local-settings';

/**
 * Background service worker 入口（WXT）。
 * 窄职责：共享全局冷却、站点权限/状态、消息分发。无常驻计时器。
 */
export default defineBackground(() => {
  const store = new LocalSettingsStore();
  const router = createMessageRouter(store);
  router.attach();

  // Issue #9 AC1：首次安装时打开引导页。
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      chrome.tabs.create({ url: chrome.runtime.getURL('/onboarding.html') });
    }
  });
});
