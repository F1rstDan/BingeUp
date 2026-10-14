import { createRoot } from 'react-dom/client';
// 原版样式入口（animal-island-ui 2.2.1）：开发数据页恰好导入一次。
// 该页面仅存在于开发构建（生产构建被 wxt.config.ts 排除），视觉与扩展页面一致。
import 'animal-island-ui/style';
import { DevToolsApp } from '@/ui/dev-tools/DevToolsApp';
import '@/ui/island/island-theme.css';
import '@/ui/styles/base.css';
import './dev-tools.css';

const container = document.getElementById('app');
if (container) {
  createRoot(container).render(<DevToolsApp />);
}
