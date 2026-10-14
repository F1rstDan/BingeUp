import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: { url: 'https://www.bilibili.com/' },
    },
    globals: true,
    // animal-island-ui 的 ES 产物按组件导入 .module.css；内容脚本测试渲染原版组件时
    // 必须让 Vite 处理该包，否则 Node 直接加载 .css 会报 UNKNOWN_EXTENSION。
    server: { deps: { inline: ['animal-island-ui'] } },
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
