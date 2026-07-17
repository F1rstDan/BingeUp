import { defineConfig } from 'wxt';
import { SUPPORTED_CONTENT_SCRIPT_MATCHES } from './src/sites/supported-sites';

export default defineConfig({
  manifest: {
    name: '刷刷升级',
    description: '在视频间隙轻量学习英语单词',
    version: '0.0.1',
    permissions: ['storage', 'scripting'],
    host_permissions: [...SUPPORTED_CONTENT_SCRIPT_MATCHES],
    // Issue #11：自定义网站通过可选权限按需授权，用户从 Popup 主动加入时请求。
    optional_host_permissions: ['https://*/*'],
    // 内容脚本运行在宿主页 CSP 上下文里，必须显式声明 dictionaries/*.json 可被任意页面 fetch；
    // 否则 chrome.runtime.getURL 返回的 URL 在 fetch 时被 Chrome 屏蔽为 chrome-extension://invalid/。
    web_accessible_resources: [
      {
        resources: ['dictionaries/*.json'],
        matches: ['*://*/*'],
      },
    ],
    // 图标由 scripts/generate-icons.mjs 预渲染并提交到 public/icon/；
    // 显式声明四档尺寸，避免 WXT 依赖自动探测（不引入 sharp 等图像依赖）。
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    action: {
      default_title: '刷刷升级 — 点击查看状态与控制',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
    },
  },
  srcDir: 'src',
  // WXT 0.20+ 将 publicDir 解析为相对项目根目录的路径。
  // public/ 存放构建流水线生成的 dictionaries/*.json。
  publicDir: 'public',
  dev: {
    // 保留 reload command，确保生成 commands manifest、避免启动时 API 缺失。
    reloadCommand: 'Alt+R',
  },
  hooks: {
    // Vite 在检测到 Origin 头时要求 HMR WebSocket URL 携带 token 查询参数，
    // WXT 的扩展 dev client 可能未携带该 token。仅在本机开发服务器中跳过校验。
    'vite:devServer:extendConfig': (config) => {
      (config as Record<string, unknown>).legacy = {
        ...((config as Record<string, unknown>).legacy ?? {}),
        skipWebSocketTokenCheck: true,
      };
    },
  },
});
