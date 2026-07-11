import { createRoot } from 'react-dom/client';
import { OnboardingApp } from '@/ui/onboarding/OnboardingApp';
import './onboarding.css';

/**
 * Onboarding 入口（WXT）。安装后或从 Popup 引导入口打开。
 */
const container = document.getElementById('app');
if (container) {
  createRoot(container).render(<OnboardingApp />);
}
