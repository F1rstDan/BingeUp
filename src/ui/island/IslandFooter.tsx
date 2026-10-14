import { Divider } from 'animal-island-ui';
import type { ReactNode } from 'react';

export interface IslandFooterProps {
  children: ReactNode;
  className?: string;
}

/**
 * island 页脚（工单 #39 基础模块）。
 *
 * 原版分隔线（Divider type="thin"）+ 居中内容，承载反馈入口等页脚链接；
 * 显式声明 contentinfo 角色，保证页脚在页面任意嵌套层级下都是可定位的地标。
 */
export function IslandFooter({ children, className }: IslandFooterProps): JSX.Element {
  return (
    <footer
      className={className === undefined ? 'island-footer' : `island-footer ${className}`}
      role="contentinfo"
    >
      <Divider type="thin" />
      <div className="island-footer-content">{children}</div>
    </footer>
  );
}
