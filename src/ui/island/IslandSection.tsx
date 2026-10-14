import { useId, type ReactNode } from 'react';

export interface IslandSectionProps {
  /** 区块标题（可见文本，同时作为区块的无障碍名称）。 */
  title: ReactNode;
  /** 标题行右侧的操作区，例如“统计”入口。 */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * island 区块容器（工单 #39 基础模块）。
 *
 * 渲染为 `<section aria-labelledby=\"…\">`：可见的二级标题 + 可选操作区 + 内容。
 * 只封装业务布局与语义，不重造库组件。
 */
export function IslandSection({
  title,
  actions,
  children,
  className,
}: IslandSectionProps): JSX.Element {
  const headingId = useId();
  return (
    <section
      className={className === undefined ? 'island-section' : `island-section ${className}`}
      aria-labelledby={headingId}
    >
      <div className="island-section-head">
        <h2 id={headingId} className="island-section-title">
          {title}
        </h2>
        {actions !== undefined && <div className="island-section-actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
