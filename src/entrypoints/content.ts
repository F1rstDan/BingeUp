import { bootstrapContent } from '@/content/bootstrap';

/**
 * 内容脚本入口（WXT）。刷新已启用的 Bilibili 页面后运行核心闭环。
 */
export default defineContentScript({
  matches: ['*://*.bilibili.com/*'],
  runAt: 'document_idle',
  async main() {
    try {
      await bootstrapContent();
    } catch (error) {
      console.error('[BingeUp] content bootstrap failed', error);
    }
  },
});
