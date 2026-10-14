import { createRoot } from 'react-dom/client';
// 原版样式入口（animal-island-ui 2.2.1）：整个 Onboarding 入口恰好导入一次。
import 'animal-island-ui/style';
import { OnboardingApp } from '@/ui/onboarding/OnboardingApp';
import '@/ui/styles/design-tokens.css';
import './onboarding.css';

/**
 * Onboarding 入口（WXT）。安装后或从 Popup 引导入口打开。
 */
const container = document.getElementById('app');
if (container) {
  createRoot(container).render(<OnboardingApp />);
}
