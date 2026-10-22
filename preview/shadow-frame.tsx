import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import islandCss from 'animal-island-ui/style?raw';
import baseCss from '@/ui/styles/base.css?raw';
import themeCss from '@/ui/island/island-theme.css?raw';
import layoutCss from '@/ui/island/island-layout.css?raw';
import { transformIslandShadowCss } from '@/ui/island/shadow-styles';

import { previewAssetUrl } from './font-assets';

/**
 * 扩展页面预览的 Shadow DOM 画框。
 *
 * 四个页面（Popup / Options / Stats / Onboarding）的关键类名互有重名（例如各自的
 * .bingeup-actions / .bingeup-hint 布局不同），因此每个预览都在独立 ShadowRoot 内
 * 渲染：注入顺序与遮罩管线一致——重置 → 库发布 CSS（:root 令牌映射为 :host、
 * 字体 URL 重写）→ base/主题/布局 → 该页面的入口 CSS → 画布规则。
 *
 * 各页面入口 CSS 的 html/body 规则在 ShadowRoot 内不会命中任何元素，画布规则
 * （.preview-canvas*）在预览侧补齐底色、文字色与字号；其余布局类名原样生效。
 * 字体走文档级 @font-face（预览页全局引入 animal-island-ui/style）。
 */

const FRAME_CANVAS_CSS = `
  .preview-canvas {
    min-height: 100%;
    color: var(--island-text-color);
    background: var(--island-bg-color);
    font-family: var(--island-font-family);
    -webkit-font-smoothing: antialiased;
  }
  .preview-canvas-popup { font-size: 13px; }
  .preview-canvas-page { font-size: 14px; }
`;

const frameCssCache = new Map<string, string>();

/**
 * 延后卸载内嵌 root。
 *
 * 预览页在同一个外层 React 树里挂载内嵌 root；若在外层提交/渲染过程中同步调用
 * root.unmount()，React 会告警“Attempted to synchronously unmount a root while
 * React was already rendering”。放到下一个宏任务卸载即可避免（DOM 清理同样完成）。
 */
export function deferRootUnmount(root: Root): void {
  window.setTimeout(() => {
    root.unmount();
  }, 0);
}

/** 组装某个页面预览的 ShadowRoot 样式串（结果按页面 CSS 缓存）。 */
export function buildFrameCss(pageCss: string): string {
  const cached = frameCssCache.get(pageCss);
  if (cached !== undefined) return cached;
  const css = [
    ':host { all: initial; }\n:host { display: block; }',
    transformIslandShadowCss(islandCss, previewAssetUrl),
    transformIslandShadowCss(baseCss, previewAssetUrl),
    transformIslandShadowCss(themeCss, previewAssetUrl),
    transformIslandShadowCss(layoutCss, previewAssetUrl),
    transformIslandShadowCss(pageCss, previewAssetUrl),
    FRAME_CANVAS_CSS,
  ].join('\n');
  frameCssCache.set(pageCss, css);
  return css;
}

export interface ShadowFrameProps {
  /** 页面入口 CSS 原文（?raw 导入），在 ShadowRoot 内注入。 */
  pageCss: string;
  /** 画布容器类名；默认 .preview-canvas（Popup 传 preview-canvas-popup 等）。 */
  canvasClassName?: string;
  /** 宿主元素内联样式（尺寸、外边距等；切换场景时由调用方以 key 重挂载）。 */
  style?: CSSProperties;
  /** 挂载完成回调，用于脚本化演示（如自动点击「完成引导」）。 */
  onMounted?: (shadow: ShadowRoot) => void;
  children: ReactNode;
}

export function ShadowFrame({
  pageCss,
  canvasClassName = 'preview-canvas',
  style,
  onMounted,
  children,
}: ShadowFrameProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const childrenRef = useRef(children);
  childrenRef.current = children;
  const mountedRef = useRef(onMounted);
  mountedRef.current = onMounted;

  // 一次性挂载：页面切换由调用方以 key 重挂载，避免同页多份样式互相污染。
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return undefined;
    const shadow = host.attachShadow({ mode: 'open' });
    const styleElement = document.createElement('style');
    styleElement.textContent = buildFrameCss(pageCss);
    shadow.appendChild(styleElement);
    const mountPoint = document.createElement('div');
    shadow.appendChild(mountPoint);
    const root = createRoot(mountPoint);
    root.render(<div className={canvasClassName}>{childrenRef.current}</div>);
    mountedRef.current?.(shadow);
    return () => {
      deferRootUnmount(root);
    };
  }, []);

  return <div ref={hostRef} className="preview-shadow-frame" style={style} />;
}
