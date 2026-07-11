import { createRoot } from 'react-dom/client';
import { StatsApp } from '@/ui/stats/StatsApp';
import './stats.css';

/**
 * 统计页入口（WXT）。从 Popup "统计" 按钮打开。
 */
const container = document.getElementById('app');
if (container) {
  createRoot(container).render(<StatsApp />);
}
