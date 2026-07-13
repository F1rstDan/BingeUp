import { bootstrapContent } from '@/content/bootstrap';

/**
 * 内容脚本入口（WXT）。
 *
 * 默认支持网站静态注入；自定义网站在用户授权后由 background 动态注册：
 * - 官方站点（Bilibili/YouTube）：manifest 中声明 host_permissions，安装后即注入。
 * - 自定义站点：只匹配用户授权的精确 HTTPS origin。
 * - 未授权站点：不注入内容脚本，不运行学习交互（AC1）。
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
