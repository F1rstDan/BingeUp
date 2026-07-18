import { createRoot } from 'react-dom/client';
import { DevToolsApp } from '@/ui/dev-tools/DevToolsApp';
import '@/ui/styles/design-tokens.css';
import './dev-tools.css';

const container = document.getElementById('app');
if (container) {
  createRoot(container).render(<DevToolsApp />);
}
