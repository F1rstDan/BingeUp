// 必须最先导入：安装 window.chrome 垫片（tabs/permissions/runtime 等）。
import './chrome-shim';
// 文档级原版样式：预览页外壳、Portal（Modal）与 @font-face 字体都来自这里。
import 'animal-island-ui/style';
import { createRoot } from 'react-dom/client';
import '@/ui/styles/base.css';
import './preview.css';
import { ReviewApp } from './review-app';

/**
 * 预览站入口（vite.preview.config.ts，root = preview/）。
 * 与扩展入口一致：先原版样式，再 base.css，最后渲染 App。
 */
const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<ReviewApp />);
}
