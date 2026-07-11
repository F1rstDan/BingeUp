import { createRoot } from 'react-dom/client';
import { PopupApp } from '@/ui/popup/PopupApp';
import './popup.css';

/**
 * Popup 入口（WXT）。点击工具栏图标后展示当前网站状态与控制入口。
 */
const container = document.getElementById('app');
if (container) {
  createRoot(container).render(<PopupApp />);
}
