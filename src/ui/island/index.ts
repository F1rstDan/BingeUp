/**
 * island — 扩展独立页面的共享基础模块（工单 #39）。
 *
 * 只封装业务布局与语义（页面外壳、区块容器、页脚、与 var(--animal-*) 的主题衔接），
 * 不重造 animal-island-ui 的组件；Onboarding / Options / Stats 等页面可直接复用。
 * 从本入口导入时会一并引入 island-theme.css 与 island-layout.css。
 */
import './island-theme.css';
import './island-layout.css';

export { IslandFooter } from './IslandFooter';
export type { IslandFooterProps } from './IslandFooter';
export { IslandPage } from './IslandPage';
export type { IslandPageProps } from './IslandPage';
export { IslandSection } from './IslandSection';
export type { IslandSectionProps } from './IslandSection';
