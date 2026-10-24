import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * BingeUp 界面预览站点配置（开发调试用；独立于扩展构建）。
 *
 * - root 指向 preview/：预览页只服务人工查看与批注，不进入 WXT 产物（WXT 从 src/ 构建）；
 * - @ -> src：预览页直接复用真实组件、真实样式与真实类型；
 * - @/messaging/message-client -> preview/mock-message-client.ts：精确替换消息客户端，
 *   src/ 其余模块保持原样；
 * - @island-fonts：animal-island-ui 的字体目录，供 preview 以 import.meta.glob + ?url
 *   解析字体地址，把 Shadow DOM 注入样式里的相对字体 URL 重写为可访问的 URL；
 * - 端口 5174；构建输出 preview/dist（已被 .gitignore 的 dist/ 规则忽略）。
 */
export default defineConfig({
  root: fileURLToPath(new URL('./preview/', import.meta.url)),
  publicDir: fileURLToPath(new URL('./public/', import.meta.url)),
  cacheDir: fileURLToPath(new URL('./node_modules/.vite-preview', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^@\/messaging\/message-client$/,
        replacement: fileURLToPath(new URL('./preview/mock-message-client.ts', import.meta.url)),
      },
      {
        find: '@island-fonts',
        replacement: fileURLToPath(
          new URL('./node_modules/animal-island-ui/dist/files/', import.meta.url),
        ),
      },
      { find: '@', replacement: fileURLToPath(new URL('./src/', import.meta.url)) },
    ],
  },
  server: {
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
