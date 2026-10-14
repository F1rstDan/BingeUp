import type { ReactNode } from 'react';

export interface IslandPageProps {
  children: ReactNode;
  /** 可访问名称；传入后主区域在无障碍树中带名称（例如“刷刷升级面板”）。 */
  label?: string;
  className?: string;
}

/**
 * island 页面外壳（工单 #39 基础模块）。
 *
 * 提供扩展独立页面的整体排布与主区域语义（<main>），不封装任何库组件；
 * 卡片、按钮等仍由页面直接使用 animal-island-ui 原版组件。
 * 样式来自 island-layout.css / island-theme.css（随 @/ui/island 入口一并引入）。
 */
export function IslandPage({ children, label, className }: IslandPageProps): JSX.Element {
  return (
    <main
      className={className === undefined ? 'island-page' : `island-page ${className}`}
      aria-label={label}
    >
      {children}
    </main>
  );
}
