import { createRoot } from 'react-dom/client';
// 原版样式入口（animal-island-ui 2.2.1）：整个统计页入口恰好导入一次。
import 'animal-island-ui/style';
import { StatsApp } from '@/ui/stats/StatsApp';
import '@/ui/styles/design-tokens.css';
import './stats.css';

/**
 * 统计页入口（WXT）。从 Popup "统计" 按钮打开。
 */
const container = document.getElementById('app');
if (container) {
  createRoot(container).render(<StatsApp />);
}
