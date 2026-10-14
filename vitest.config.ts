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
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    server: {
      deps: {
        // animal-island-ui 的 dist/es 组件以 .module.css 副作用导入样式；
        // 默认外置会让 Node 直接加载 .css 而报未知扩展名，故在测试中内联该包。
        inline: ['animal-island-ui'],
      },
    },
  },
});
