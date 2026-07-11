import { bootstrapContent } from '@/content/bootstrap';

/**
 * 内容脚本入口（WXT）。刷新已启用的 Bilibili / YouTube 页面后运行核心闭环。
 */
export default defineContentScript({
  // WXT 在构建时静态读取入口配置，不能在这里引用导入变量。
  matches: ['*://*.bilibili.com/*', '*://*.youtube.com/*'],
  runAt: 'document_idle',
  async main() {
    try {
      await bootstrapContent();
    } catch (error) {
      console.error('[BingeUp] content bootstrap failed', error);
    }
  },
});
