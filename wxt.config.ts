import { defineConfig } from 'wxt';
import { SUPPORTED_CONTENT_SCRIPT_MATCHES } from './src/sites/supported-sites';

export default defineConfig({
  manifest: {
    name: '刷刷升级',
    description: '在视频间隙轻量学习英语单词',
    version: '0.1.0',
    permissions: ['storage'],
    host_permissions: [...SUPPORTED_CONTENT_SCRIPT_MATCHES],
  },
  srcDir: 'src',
});
