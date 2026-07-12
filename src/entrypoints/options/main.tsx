import { createRoot } from 'react-dom/client';
import { OptionsApp } from '@/ui/options/OptionsApp';
import '@/ui/styles/design-tokens.css';
import './options.css';

/**
 * Options 入口（WXT）。扩展设置页，从 Popup "设置" 按钮或扩展管理页打开。
 */
const container = document.getElementById('app');
if (container) {
  createRoot(container).render(<OptionsApp />);
}
