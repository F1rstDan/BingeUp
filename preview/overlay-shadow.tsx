import { createRoot } from 'react-dom/client';
import islandCss from 'animal-island-ui/dist/index.css?raw';
import { transformIslandShadowCss } from '@/ui/island/shadow-styles';
import { OverlayApp } from '@/ui/overlay/OverlayApp';
import type { LearningItem, OverlayAction, Question, SubmissionResult } from '@/types';

import { previewAssetUrl } from './font-assets';
import { deferRootUnmount } from './shadow-frame';

/**
 * 视频遮罩预览的 Shadow DOM 挂载（复刻 src/content/overlay-controller.tsx 的 mountShadow）。
 *
 * 三步与真实控制器一致：创建宿主元素 → attachShadow → 注入两段由 controller 定义的
 * 外壳样式 + transformIslandShadowCss(库 CSS ?raw, 路径重写) 的库样式；随后渲染
 * OverlayApp。字体走文档级 @font-face（预览页全局引入 animal-island-ui/style），
 * 不需要 FontFace 注册。
 *
 * 下面两段 CSS 原样复制自 src/content/overlay-controller.tsx（M5 工单 #44）；
 * 预览不修改 src/，因此在本目录保留同一份最小副本。若上游样式变化，此副本需同步。
 */

const OVERLAY_RESET_CSS = `
  :host { all: initial; }
`;

const OVERLAY_SHELL_CSS = `
  .bingeup-overlay {
    position: absolute; inset: 0; display: grid; width: 100%; height: 100%;
    box-sizing: border-box; place-items: center; overflow: hidden; padding: 15px;
    color: var(--animal-text-color); background: var(--animal-mask-bg);
    font-family: var(--animal-font-family); font-size: var(--animal-font-size-base);
    line-height: var(--animal-line-height-base);
  }
  .bingeup-overlay .bingeup-card {
    width: min(470px, 100%); max-height: 100%; overflow-y: auto; overflow-x: auto;
    overscroll-behavior: contain;
  }
  .bingeup-continuous-badge {
    display: flex; justify-content: flex-start; margin-bottom: var(--animal-spacing-md);
  }
  .bingeup-prompt {
    margin-bottom: var(--animal-spacing-md); font-size: 27px; font-weight: 800;
    letter-spacing: 0.01em; text-align: center;
  }
  .bingeup-phonetic {
    margin-bottom: var(--animal-spacing-sm); color: var(--animal-text-color-secondary);
    font-size: var(--animal-font-size-base); text-align: center;
  }
  .bingeup-meaning { margin-bottom: var(--animal-spacing-sm); font-size: 17px; font-weight: 700; text-align: center; }
  .bingeup-example {
    margin-bottom: var(--animal-spacing-xs); font-size: var(--animal-font-size-base);
    font-style: italic; line-height: 1.5;
  }
  .bingeup-example-translation {
    margin-bottom: var(--animal-spacing-lg); color: var(--animal-text-color-secondary);
    font-size: var(--animal-font-size-sm);
  }
  .bingeup-options { display: grid; gap: var(--animal-spacing-sm); margin-bottom: var(--animal-spacing-lg); }
  .bingeup-option {
    display: flex; align-items: center; gap: var(--animal-spacing-md); width: 100%;
    min-height: var(--animal-height-lg); padding: var(--animal-spacing-sm) var(--animal-spacing-md);
    border: var(--animal-border-width) solid var(--animal-border-color);
    border-radius: var(--animal-border-radius-sm); background: var(--animal-bg-color);
    color: var(--animal-text-color); font-family: var(--animal-font-family);
    font-size: var(--animal-font-size-base); font-weight: 600; text-align: left; cursor: pointer;
    transition: all var(--animal-motion-duration-fast) var(--animal-motion-ease);
  }
  .bingeup-option:not(:disabled):hover {
    border-color: var(--animal-primary-color); color: var(--animal-primary-color-active);
  }
  .bingeup-option:focus-visible { outline: 2px solid var(--animal-primary-color); outline-offset: 2px; }
  .bingeup-option:disabled { cursor: default; opacity: 1; }
  .bingeup-option--selected { border-color: var(--animal-primary-color); background: var(--animal-primary-color-bg); }
  .bingeup-option--correct { border-color: var(--animal-success-color); }
  .bingeup-option--wrong { border-color: var(--animal-error-color); }
  .bingeup-option-key {
    display: inline-flex; flex-shrink: 0; width: 28px; height: 28px; align-items: center;
    justify-content: center; border-radius: 8px; background: var(--animal-bg-color-secondary);
    color: var(--animal-text-color); font-size: var(--animal-font-size-sm); font-weight: 700;
  }
  .bingeup-option-icon { flex-shrink: 0; margin-left: auto; }
  .bingeup-actions { display: flex; flex-wrap: wrap; gap: var(--animal-spacing-sm); }
  .bingeup-actions-new-word { flex-direction: column; }
  .bingeup-actions-new-word > button { width: 100%; }
  .bingeup-question-actions { width: 100%; }
  .bingeup-question-actions > button { flex: 1 1 auto; }
  .bingeup-key-hint {
    display: inline-block; padding: 1px 5px; border: 1px solid var(--animal-border-color);
    border-radius: 8px; background: var(--animal-bg-color-secondary); color: inherit;
    font-size: 11px; font-weight: 600;
  }
  .bingeup-feedback {
    margin-top: var(--animal-spacing-lg); padding: var(--animal-spacing-md);
    border: 1px solid var(--animal-border-color); border-radius: var(--animal-border-radius-base);
    background: var(--animal-bg-color);
  }
  .bingeup-feedback-result {
    display: flex; align-items: center; justify-content: center; gap: var(--animal-spacing-sm);
    margin-bottom: var(--animal-spacing-md); font-size: 18px; font-weight: 800;
  }
  .bingeup-feedback-result.is-correct { color: var(--animal-success-color-active); }
  .bingeup-feedback-result.is-wrong { color: var(--animal-error-color-active); }
  .bingeup-feedback-answer {
    margin-bottom: var(--animal-spacing-md); color: var(--animal-text-color-secondary);
    font-size: var(--animal-font-size-sm); text-align: center;
  }
  .bingeup-feedback-answer strong { color: var(--animal-text-color); font-weight: 700; }
  .bingeup-explanation {
    margin-bottom: var(--animal-spacing-md); padding: var(--animal-spacing-md);
    border: 1px dashed var(--animal-border-color); border-radius: var(--animal-border-radius-sm);
    background: var(--animal-bg-color-secondary);
    font-size: var(--animal-font-size-base); line-height: 1.6;
  }
  .bingeup-explanation-phonetic { color: var(--animal-text-color-secondary); font-size: var(--animal-font-size-sm); }
  .bingeup-explanation-pos {
    margin-bottom: var(--animal-spacing-xs); color: var(--animal-primary-color-active);
    font-size: var(--animal-font-size-sm); font-weight: 700;
  }
  .bingeup-explanation-meanings { margin-bottom: var(--animal-spacing-sm); font-weight: 700; }
  .bingeup-explanation-example { margin-bottom: 2px; font-style: italic; }
  .bingeup-explanation-example-translation { color: var(--animal-text-color-secondary); }
  .bingeup-previous-feedback {
    margin-bottom: var(--animal-spacing-lg); padding: var(--animal-spacing-md);
    border: 1px solid var(--animal-border-color); border-left: 4px solid var(--animal-border-color);
    border-radius: var(--animal-border-radius-sm); background: var(--animal-bg-color);
  }
  .bingeup-previous-feedback.is-correct { border-left-color: var(--animal-success-color); }
  .bingeup-previous-feedback.is-wrong { border-left-color: var(--animal-error-color); }
  .bingeup-previous-feedback-title {
    margin-bottom: var(--animal-spacing-sm); color: var(--animal-text-color-secondary);
    font-size: var(--animal-font-size-sm); font-weight: 700;
  }
  .bingeup-previous-feedback-prompt {
    margin-bottom: var(--animal-spacing-sm); color: var(--animal-text-color-secondary);
    font-size: var(--animal-font-size-sm); font-style: italic;
  }
  .bingeup-previous-feedback-answer {
    margin-bottom: var(--animal-spacing-sm); color: var(--animal-text-color-secondary);
    font-size: var(--animal-font-size-sm);
  }
  .bingeup-previous-feedback-answer strong { color: var(--animal-text-color); font-weight: 700; }
  .bingeup-rating-correction {
    display: grid; grid-template-columns: 1fr 1fr; gap: var(--animal-spacing-sm);
    margin: var(--animal-spacing-sm) 0;
  }
  .bingeup-rating-result {
    grid-column: 1 / -1; color: var(--animal-primary-color-active);
    font-size: var(--animal-font-size-sm); font-weight: 700; text-align: center;
  }
  .bingeup-spelling-field { width: 100%; margin-bottom: var(--animal-spacing-lg); }
  .bingeup-error-card { text-align: center; }
  .bingeup-error-icon { display: block; margin: 0 auto var(--animal-spacing-md); }
  .bingeup-error-card p {
    margin: 0 0 var(--animal-spacing-lg); color: var(--animal-error-color-active);
    line-height: 1.5;
  }
  @media (prefers-reduced-motion: reduce) {
    .bingeup-option { transition-duration: 0.01ms; }
  }
`;

let cachedOverlayCss: string | null = null;

function overlayShadowCss(): string {
  cachedOverlayCss ??=
    OVERLAY_RESET_CSS +
    '\n' +
    transformIslandShadowCss(islandCss, previewAssetUrl) +
    '\n' +
    OVERLAY_SHELL_CSS;
  return cachedOverlayCss;
}

export interface OverlayShadowOptions {
  item: LearningItem;
  onAction?: (action: OverlayAction) => void;
  previousFeedback?: SubmissionResult;
  previousQuestion?: Question;
  isContinuous?: boolean;
}

export interface OverlayShadowMount {
  shadowRoot: ShadowRoot;
  dispose(): void;
}

/** 在容器内挂载一份遮罩预览；容器需为定位上下文（position: relative 等）。 */
export function mountOverlayShadow(
  container: HTMLElement,
  options: OverlayShadowOptions,
): OverlayShadowMount {
  const host = document.createElement('div');
  host.className = 'preview-overlay-host';
  Object.assign(host.style, {
    position: 'absolute',
    display: 'block',
    boxSizing: 'border-box',
    zIndex: '1',
    inset: '0',
    pointerEvents: 'auto',
  });
  container.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = overlayShadowCss();
  shadow.appendChild(style);
  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);

  const root = createRoot(mountPoint);
  root.render(
    <OverlayApp
      item={options.item}
      onAction={(action) => options.onAction?.(action)}
      previousFeedback={options.previousFeedback}
      previousQuestion={options.previousQuestion}
      isContinuous={options.isContinuous}
    />,
  );

  return {
    shadowRoot: shadow,
    dispose() {
      deferRootUnmount(root);
      host.remove();
    },
  };
}
