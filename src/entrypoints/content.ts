import { bootstrapContent } from '@/content/bootstrap';

/**
 * 内容脚本入口（WXT）。
 *
 * 匹配所有 HTTPS 页面；实际注入由 host_permissions 控制（Issue #11）：
 * - 官方站点（Bilibili/YouTube）：manifest 中声明 host_permissions，安装后即注入。
 * - 自定义站点：用户从 Popup 主动加入后通过 optional_host_permissions 授权，刷新后注入。
 * - 未授权站点：不注入内容脚本，不运行学习交互（AC1）。
 */
export default defineContentScript({
  // WXT 在构建时静态读取入口配置，不能在这里引用导入变量。
  matches: ['https://*/*'],
  runAt: 'document_idle',
  async main() {
    try {
      await bootstrapContent();
    } catch (error) {
      console.error('[BingeUp] content bootstrap failed', error);
    }
  },
});
