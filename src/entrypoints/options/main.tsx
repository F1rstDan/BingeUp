import { createRoot } from 'react-dom/client';
// 原版样式入口（animal-island-ui 2.2.1）：整个设置页入口恰好导入一次。
import 'animal-island-ui/style';
import { OptionsApp } from '@/ui/options/OptionsApp';
import '@/ui/styles/base.css';
import './options.css';

/**
 * Options 入口（WXT）。扩展设置页，从 Popup "设置" 按钮或扩展管理页打开。
 */
const container = document.getElementById('app');
if (container) {
  createRoot(container).render(<OptionsApp />);
}
