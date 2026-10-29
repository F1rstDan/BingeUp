import { Component, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Button, Card } from 'animal-island-ui';
import { AlertCircleIcon } from 'naive-icons';
import { getIslandShadowStyleBundle, registerIslandFontFaces } from '@/ui/island/shadow-styles';
import { OverlayApp } from '@/ui/overlay/OverlayApp';
import { OVERLAY_VIEWPORT_FALLBACK_MAX_HEIGHT } from '@/ui/overlay/layout';
import { WORD_SUMMARY_CSS } from '@/ui/overlay/WordSummary';
import { SPEECH_CONTROLS_CSS } from '@/ui/speech/SpeechControls';
import type { LearningItem, OverlayAction, OverlayMode } from '@/types';
import type { OverlayOpenOptions, OverlayPort } from '@/content/content-controller';

const OVERLAY_HOST_ID = 'bingeup-overlay-host';

/**
 * 遮罩 ShadowRoot 样式（M5 工单 #44）分三段注入：
 * 1. reset：宿主与页面样式隔离（与 M4 相同的 :host { all: initial } 策略）；
 * 2. 库发布 CSS：shadow-styles 装载模块提供（:root 令牌映射为 :host、字体 URL 重写）；
 * 3. shell：遮罩外壳布局与自定义元素的令牌着色；不覆盖库组件的颜色、圆角或阴影。
 *
 * 令牌（--animal-*）由第 2 段注入，因此自定义元素在第 3 段中始终可用。
 */
export const OVERLAY_RESET_CSS = `
  :host { all: initial; }
`;

export const OVERLAY_SHELL_CSS = `
  .bingeup-overlay {
    position: absolute; inset: 0; display: grid; width: 100%; height: 100%;
    box-sizing: border-box; place-items: center; overflow: clip; padding: 15px;
    color: var(--animal-text-color); background: var(--animal-mask-bg);
    font-family: var(--animal-font-family); font-size: var(--animal-font-size-base);
    line-height: var(--animal-line-height-base);
  }
  .bingeup-overlay .bingeup-card {
    width: min(470px, 100%); min-width: 0; max-height: 100%; overflow-y: auto; overflow-x: hidden;
    scrollbar-width: none;
  }
  .bingeup-overlay .bingeup-card::-webkit-scrollbar { display: none; }
  .bingeup-continuous-badge {
    display: flex; justify-content: flex-start; margin-bottom: var(--animal-spacing-md);
  }
  .bingeup-previous-result {
    display: grid; justify-items: center; gap: 5px;
    width: 100%; margin: 0 0 var(--animal-spacing-sm); padding: 6px 10px;
    border-radius: var(--animal-border-radius-sm); background: var(--animal-bg-color-secondary);
    color: var(--animal-text-color-secondary);
    font-size: var(--animal-font-size-sm); font-weight: 700; line-height: 1.4;
  }
  .bingeup-previous-result[data-correct="true"] {
    color: var(--animal-success-color-active);
  }
  .bingeup-previous-result[data-correct="false"] {
    color: var(--animal-error-color-active);
  }
  .bingeup-previous-result__icon {
    display: inline-flex; flex: none; width: 22px; height: 22px;
    align-items: center; justify-content: center; border-radius: 50%; color: #fff;
  }
  .bingeup-previous-result__icon[data-correct="true"] {
    background: var(--animal-success-color-active);
  }
  .bingeup-previous-result__icon[data-correct="false"] {
    background: var(--animal-error-color-active);
  }
  .bingeup-previous-result__heading {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  }
  .bingeup-previous-result__comparison {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: center;
    gap: 4px var(--animal-spacing-sm); max-width: 100%;
  }
  .bingeup-previous-result__answer {
    display: inline-flex; align-items: baseline; gap: 4px; min-width: 0;
    padding: 2px 8px; border-radius: 999px;
    background: color-mix(in srgb, var(--animal-error-color) 10%, transparent);
    color: var(--animal-error-color-active); font-size: 12px; font-weight: 600;
    overflow-wrap: anywhere;
  }
  .bingeup-previous-result__answer[data-answer="correct"] {
    background: color-mix(in srgb, var(--animal-success-color) 12%, transparent);
    color: var(--animal-success-color-active);
  }
  .bingeup-previous-result__answer-label {
    color: var(--animal-text-color-secondary); font-weight: 600; white-space: nowrap;
  }
  .bingeup-previous-result__answer strong { font-weight: 800; }
  .bingeup-prompt {
    margin-bottom: var(--animal-spacing-md); font-size: 27px; font-weight: 800;
    letter-spacing: 0.01em; text-align: center;
  }
  .bingeup-prompt--context {
    font-size: 19px; font-weight: 700; line-height: 1.55;
  }
  .bingeup-new-word { min-width: 0; }
  .bingeup-new-word .bingeup-prompt { margin-bottom: var(--animal-spacing-xs); }
  .bingeup-new-word-badge {
    display: flex; justify-content: flex-end; margin-bottom: var(--animal-spacing-xs);
  }
  .bingeup-phonetic {
    margin-bottom: var(--animal-spacing-sm); color: var(--animal-text-color-secondary);
    font-size: var(--animal-font-size-base); text-align: center;
  }
  .bingeup-part-of-speech { display: flex; justify-content: center; margin-bottom: var(--animal-spacing-sm); }
  .bingeup-question-pronunciation {
    display: flex; justify-content: center; margin-bottom: var(--animal-spacing-md);
  }
  .bingeup-new-word-meaning {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: center;
    gap: var(--animal-spacing-xs) var(--animal-spacing-sm); margin-bottom: var(--animal-spacing-md);
    font-size: 17px; font-weight: 700; line-height: 1.45; text-align: center; overflow-wrap: anywhere;
  }
  .bingeup-new-word-meaning > span { min-width: 0; }
  .bingeup-secondary {
    display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px var(--animal-spacing-xs);
    margin: var(--animal-spacing-sm) 0 var(--animal-spacing-md);
    justify-content: center; font-size: var(--animal-font-size-sm); line-height: 1.6;
    text-align: center;
  }
  .bingeup-secondary-label {
    margin-right: var(--animal-spacing-xs);
    color: color-mix(in srgb, var(--animal-text-color-secondary) 70%, transparent);
    font-weight: 600; white-space: nowrap;
  }
  .bingeup-secondary-item { min-width: 0; overflow-wrap: anywhere; }
  .bingeup-secondary-pos { margin-right: 3px; font-weight: 700; }
  .bingeup-secondary-separator { margin-left: var(--animal-spacing-xs); color: var(--animal-text-color-secondary); }
  .bingeup-spelling-hint { margin: 0 0 var(--animal-spacing-md); padding: var(--animal-spacing-sm) var(--animal-spacing-md); border: 1px dashed var(--animal-border-color); border-radius: 12px; text-align: left; }
  .bingeup-spelling-example { margin: 0 0 4px; font-size: 14px; font-style: italic; line-height: 1.5; }
  .bingeup-spelling-meta { margin: 0; color: var(--animal-text-color-secondary); font-size: 13px; }
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
  .bingeup-option-radio {
    display: inline-flex; flex-shrink: 0; margin-left: auto; pointer-events: none;
  }
  .bingeup-option-radio [role='radiogroup'] { display: block; gap: 0; }
  .bingeup-option-radio label { gap: 0; cursor: default; }
  .bingeup-option-radio label > span:last-child { display: none; }
  .bingeup-actions { display: flex; flex-wrap: wrap; gap: var(--animal-spacing-sm); }
  .bingeup-actions-new-word { flex-direction: column; }
  .bingeup-actions-new-word > button { width: 100%; }
  .bingeup-question-actions { width: 100%; }
  .bingeup-question-actions > button { flex: 1 1 auto; }
  .bingeup-key-hint {
    display: inline-block; padding: 1px 5px; border: 1px solid var(--animal-border-color);
    border-radius: 8px; background: var(--animal-bg-color-secondary); color: var(--animal-text-color);
    font-size: 12px; font-weight: 700; white-space: nowrap;
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

/** 遮罩渲染失败时的回退界面（原版 Card/Button 与 naive-icons 图标）。 */
export function OverlayErrorFallback({ onRecover }: { onRecover: () => void }) {
  return (
    <div className="bingeup-overlay" role="alert">
      <Card className="bingeup-card bingeup-error-card">
        <AlertCircleIcon className="bingeup-error-icon" size={40} />
        <p>学习界面出现错误，视频仍可安全恢复。</p>
        <Button type="primary" onClick={onRecover}>
          返回视频
        </Button>
      </Card>
    </div>
  );
}

class OverlayErrorBoundary extends Component<
  { children: ReactNode; onRecover: () => void },
  { hasError: boolean }
> {
  override state = { hasError: false };
  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }
  override componentDidCatch(error: Error): void {
    console.error('[BingeUp] 遮罩渲染失败', error);
  }
  override render(): ReactNode {
    if (this.state.hasError) return <OverlayErrorFallback onRecover={this.props.onRecover} />;
    return this.props.children;
  }
}

/** Learning overlay controller mounted in an isolated Shadow DOM root. */
export class OverlayController implements OverlayPort {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private root: Root | null = null;
  private actionHandler: ((action: OverlayAction) => unknown | Promise<unknown>) | null = null;
  private target: HTMLElement | DOMRect | null = null;
  private mode: OverlayMode = 'video-region';
  private resizeObserver: ResizeObserver | null = null;
  private hostObserver: MutationObserver | null = null;
  private rafId: number | null = null;
  private recoveryRequested = false;

  onAction(handler: (action: OverlayAction) => unknown | Promise<unknown>): void {
    this.actionHandler = handler;
  }
  open(
    item: LearningItem,
    target: HTMLElement | DOMRect,
    mode: OverlayMode,
    options?: OverlayOpenOptions,
  ): void {
    const bundle = getIslandShadowStyleBundle();
    // Chromium 不加载 ShadowRoot 内声明的 @font-face：把库字体注册到 document.fonts
    // （按文档幂等），shadow 内文字才能使用 Nunito / Noto Sans SC。
    registerIslandFontFaces(bundle.fontFaces);
    this.mountShadow({
      hostId: OVERLAY_HOST_ID,
      css:
        OVERLAY_RESET_CSS +
        '\n' +
        bundle.css +
        '\n' +
        OVERLAY_SHELL_CSS +
        SPEECH_CONTROLS_CSS +
        WORD_SUMMARY_CSS,
      target,
      mode,
      render: () => (
        <OverlayErrorBoundary onRecover={() => this.actionHandler?.({ type: 'recover' })}>
          <OverlayApp
            item={item}
            onAction={(action) => this.actionHandler?.(action)}
            isContinuous={options?.isContinuous}
            previousResult={options?.previousResult}
          />
        </OverlayErrorBoundary>
      ),
    });
  }
  private mountShadow(options: {
    hostId: string;
    css: string;
    target: HTMLElement | DOMRect;
    mode: OverlayMode;
    render: () => ReactNode;
  }): void {
    if (this.host !== null) this.close();
    this.target = options.target;
    this.mode = options.mode;
    this.recoveryRequested = false;
    const host = document.createElement('div');
    host.id = options.hostId;
    host.style.position = 'fixed';
    host.style.display = 'block';
    host.style.boxSizing = 'border-box';
    host.style.zIndex = '2147483646';
    host.style.pointerEvents = 'auto';
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = options.css;
    shadow.appendChild(style);
    const mountPoint = document.createElement('div');
    shadow.appendChild(mountPoint);
    this.host = host;
    this.shadow = shadow;
    this.hostObserver = new MutationObserver(() => {
      if (this.host !== null && !this.host.isConnected && !this.recoveryRequested) {
        this.recoveryRequested = true;
        this.actionHandler?.({ type: 'recover' });
      }
    });
    this.hostObserver.observe(document.documentElement, { childList: true });
    this.root = createRoot(mountPoint);
    this.root.render(options.render());
    this.updatePosition();
    this.startTracking();
  }
  close(): void {
    this.hostObserver?.disconnect();
    this.hostObserver = null;
    this.recoveryRequested = false;
    this.stopTracking();
    if (this.root !== null) {
      this.root.unmount();
      this.root = null;
    }
    if (this.host !== null && this.host.parentNode !== null)
      this.host.parentNode.removeChild(this.host);
    this.host = null;
    this.shadow = null;
    this.target = null;
  }
  private startTracking(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => this.scheduleUpdate());
    this.resizeObserver.observe(document.body);
    if (this.target instanceof HTMLElement) this.resizeObserver.observe(this.target);
    window.addEventListener('scroll', this.scheduleUpdate, { passive: true, capture: true });
    window.addEventListener('resize', this.scheduleUpdate);
    document.addEventListener('visibilitychange', this.scheduleUpdate);
  }
  private stopTracking(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    window.removeEventListener('scroll', this.scheduleUpdate, {
      capture: true,
    } as EventListenerOptions);
    window.removeEventListener('resize', this.scheduleUpdate);
    document.removeEventListener('visibilitychange', this.scheduleUpdate);
  }
  private scheduleUpdate = (): void => {
    if (document.visibilityState === 'hidden' || this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.updatePosition();
    });
  };
  private updatePosition(): void {
    if (this.host === null || this.target === null) return;
    const rect = this.target instanceof DOMRect ? this.target : this.target.getBoundingClientRect();
    const useViewportFallback =
      this.mode === 'video-region' &&
      rect.height > 0 &&
      rect.height < OVERLAY_VIEWPORT_FALLBACK_MAX_HEIGHT;
    if (this.mode === 'full-page' || useViewportFallback) {
      this.host.style.left = '0px';
      this.host.style.top = '0px';
      this.host.style.width = `${document.documentElement.clientWidth}px`;
      this.host.style.height = `${document.documentElement.clientHeight}px`;
    } else {
      this.host.style.left = `${rect.left}px`;
      this.host.style.top = `${rect.top}px`;
      this.host.style.width = `${rect.width}px`;
      this.host.style.height = `${rect.height}px`;
    }
  }
}
