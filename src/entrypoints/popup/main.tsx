import { createRoot } from 'react-dom/client';
// 原版样式入口（animal-island-ui 2.3.0）：整个 Popup 入口恰好导入一次。
import 'animal-island-ui/style';
import { PopupApp } from '@/ui/popup/PopupApp';
import '@/ui/styles/base.css';
import './popup.css';

/**
 * Popup 入口（WXT）。点击工具栏图标后展示当前网站状态与控制入口。
 */
const container = document.getElementById('app');
if (container) {
  createRoot(container).render(<PopupApp />);
}
