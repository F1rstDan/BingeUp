import { defineConfig } from 'wxt';
import { SUPPORTED_CONTENT_SCRIPT_MATCHES } from './src/sites/supported-sites';

export default defineConfig({
  manifest: {
    name: '刷刷升级',
    description: '在视频间隙轻量学习英语单词',
    version: '0.1.0',
    permissions: ['storage', 'scripting'],
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
});
