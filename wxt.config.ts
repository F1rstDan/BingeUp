import { defineConfig } from 'wxt';
import { SUPPORTED_CONTENT_SCRIPT_MATCHES } from './src/sites/supported-sites';

export default defineConfig({
  manifest: {
    name: '刷刷升级',
    description: '在视频间隙轻量学习英语单词',
    version: '0.1.0',
    permissions: ['storage'],
    host_permissions: [...SUPPORTED_CONTENT_SCRIPT_MATCHES],
    // Issue #11：自定义网站通过可选权限按需授权，用户从 Popup 主动加入时请求。
    // webextension-polyfill 类型未包含此 MV3 有效键，用 @ts-expect-error 绕过。
    // @ts-expect-error optional_host_permissions is a valid MV3 key not yet in webextension-polyfill types
    optional_host_permissions: ['https://*/*'],
    action: {
      default_title: '刷刷升级 — 点击查看状态与控制',
    },
  },
  srcDir: 'src',
  hooks: {
    // Vite 5.4+ 在检测到 Origin 头时要求 HMR WebSocket URL 携带 token 查询参数，
    // 否则 ws 库的 shouldHandle 返回 false 并返回 400。Chrome 扩展的 Service Worker
    // 创建 WebSocket 时始终发送 Origin 头，而 WXT 0.18.x 的 dev client 不含 token，
    // 导致 dev server 连接失败。跳过 token 校验以恢复连接。
    // `legacy` 是 Vite 未公开文档的内部字段，类型定义中不存在，故用 as 断言。
    'vite:devServer:extendConfig': (config) => {
      (config as Record<string, unknown>).legacy = {
        ...((config as Record<string, unknown>).legacy ?? {}),
        skipWebSocketTokenCheck: true,
      };
    },
  },
});
