import { createRoot, type Root } from 'react-dom/client';
import { OverlayApp } from '@/ui/overlay/OverlayApp';
import type { LearningItem, OverlayAction, OverlayMode } from '@/types';
import type { OverlayOpenOptions, OverlayPort } from '@/content/content-controller';

const OVERLAY_HOST_ID = 'bingeup-overlay-host';

const OVERLAY_CSS = `
  :host { all: initial; }
  .bingeup-overlay {
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.72);
    z-index: 2147483647;
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    color: #fff;
  }
  .bingeup-card {
    width: min(440px, 86%);
    background: #1f2937;
    border-radius: 14px;
    padding: 24px 22px 18px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.45);
  }
  .bingeup-prompt {
    font-size: 26px;
    font-weight: 600;
    text-align: center;
    margin-bottom: 18px;
    letter-spacing: 0.5px;
  }
  .bingeup-phonetic {
    font-size: 15px;
    color: #9ca3af;
    text-align: center;
    margin-bottom: 12px;
  }
  .bingeup-meaning {
    font-size: 17px;
    color: #e5e7eb;
    text-align: center;
    margin-bottom: 14px;
  }
  .bingeup-example {
    font-size: 14px;
    color: #9ca3af;
    font-style: italic;
    margin-bottom: 4px;
    line-height: 1.5;
  }
  .bingeup-example-translation {
    font-size: 13px;
    color: #6b7280;
    margin-bottom: 18px;
  }
  .bingeup-options { display: grid; gap: 10px; margin-bottom: 18px; }
  .bingeup-option {
    display: flex; align-items: center; gap: 12px;
    width: 100%;
    padding: 11px 14px;
    border-radius: 10px;
    border: 1px solid #374151;
    background: #111827;
    color: #e5e7eb;
    font-size: 15px;
    cursor: pointer;
    text-align: left;
    transition: border-color 0.12s, background 0.12s;
  }
  .bingeup-option.selected { border-color: #60a5fa; background: #1e3a8a; }
  .bingeup-option.correct { border-color: #34d399; background: #064e3b; }
  .bingeup-option.wrong { border-color: #f87171; background: #7f1d1d; }
  .bingeup-option:disabled { cursor: default; opacity: 0.7; }
  .bingeup-option-key {
    display: inline-flex; align-items: center; justify-content: center;
    width: 22px; height: 22px;
    border-radius: 6px;
    background: #374151;
    font-size: 12px; font-weight: 600;
    flex-shrink: 0;
  }
  .bingeup-option.selected .bingeup-option-key { background: #60a5fa; color: #0b1220; }
  .bingeup-actions { display: flex; gap: 10px; justify-content: flex-end; }
  .bingeup-actions-new-word { flex-direction: column; gap: 8px; }
  .bingeup-submit, .bingeup-skip, .bingeup-accept, .bingeup-self-report, .bingeup-continue {
    padding: 9px 18px;
    border-radius: 9px;
    border: none;
    font-size: 14px;
    cursor: pointer;
    font-weight: 500;
  }
  .bingeup-submit, .bingeup-accept, .bingeup-continue { background: #3b82f6; color: #fff; }
  .bingeup-submit:disabled, .bingeup-accept:disabled, .bingeup-continue:disabled { background: #1e40af; opacity: 0.6; cursor: default; }
  .bingeup-skip, .bingeup-self-report { background: #374151; color: #d1d5db; }
  .bingeup-skip:disabled, .bingeup-self-report:disabled { opacity: 0.6; cursor: default; }
  .bingeup-key-hint {
    display: inline-block;
    margin-left: 4px;
    padding: 1px 5px;
    border-radius: 4px;
    background: rgba(255,255,255,0.15);
    font-size: 11px;
    font-weight: 400;
  }
  .bingeup-feedback { margin-top: 14px; }
  .bingeup-feedback-result {
    font-size: 18px;
    font-weight: 600;
    text-align: center;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .bingeup-feedback-result.correct { color: #34d399; }
  .bingeup-feedback-result.wrong { color: #f87171; }
  .bingeup-feedback-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px; height: 24px;
    border-radius: 50%;
    font-size: 14px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .bingeup-feedback-icon.correct { background: #34d399; color: #064e3b; }
  .bingeup-feedback-icon.wrong { background: #f87171; color: #7f1d1d; }
  .bingeup-explanation-toggle {
    display: block;
    width: 100%;
    padding: 8px;
    border: 1px solid #374151;
    border-radius: 8px;
    background: transparent;
    color: #9ca3af;
    font-size: 13px;
    cursor: pointer;
    margin-bottom: 10px;
  }
  .bingeup-explanation {
    padding: 12px 14px;
    background: #111827;
    border-radius: 10px;
    margin-bottom: 14px;
    font-size: 14px;
    line-height: 1.6;
  }
  .bingeup-explanation-phonetic { color: #9ca3af; margin-bottom: 4px; }
  .bingeup-explanation-pos { color: #60a5fa; font-size: 13px; margin-bottom: 4px; }
  .bingeup-explanation-meanings { color: #e5e7eb; margin-bottom: 8px; }
  .bingeup-explanation-example { color: #9ca3af; font-style: italic; margin-bottom: 2px; }
  .bingeup-explanation-example-translation { color: #6b7280; font-size: 13px; }
  .bingeup-previous-feedback {
    padding: 12px 14px;
    background: #111827;
    border-radius: 10px;
    margin-bottom: 16px;
    border-left: 3px solid #374151;
  }
  .bingeup-previous-feedback.correct { border-left-color: #34d399; }
  .bingeup-previous-feedback.wrong { border-left-color: #f87171; }
  .bingeup-previous-feedback-title {
    font-size: 12px;
    color: #6b7280;
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .bingeup-previous-feedback-prompt {
    font-size: 13px;
    color: #9ca3af;
    margin-bottom: 6px;
    font-style: italic;
  }
  .bingeup-previous-feedback-result {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 4px;
  }
  .bingeup-previous-feedback-result.correct { color: #34d399; }
  .bingeup-previous-feedback-result.wrong { color: #f87171; }
  .bingeup-previous-feedback-answer {
    font-size: 13px;
    color: #9ca3af;
  }
  .bingeup-previous-feedback-answer .correct-answer {
    color: #e5e7eb;
    font-weight: 500;
  }
  .bingeup-spelling-input {
    width: 100%;
    padding: 12px 14px;
    border-radius: 10px;
    border: 1px solid #374151;
    background: #111827;
    color: #e5e7eb;
    font-size: 18px;
    text-align: center;
    margin-bottom: 18px;
    outline: none;
    transition: border-color 0.12s;
    font-family: inherit;
  }
  .bingeup-spelling-input:focus { border-color: #60a5fa; }
  .bingeup-spelling-input::placeholder { color: #6b7280; }
  .bingeup-exit {
    background: #4b5563;
    color: #d1d5db;
  }
  .bingeup-exit:disabled { opacity: 0.6; cursor: default; }
  .bingeup-continuous-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    background: rgba(96, 165, 250, 0.15);
    color: #60a5fa;
    font-size: 11px;
    font-weight: 500;
    margin-bottom: 12px;
  }
`;

/**
 * 学习遮罩控制器（M6-01 / overlay-controller.ts）。在 Shadow DOM 中挂载 React，
 * 隔离宿主页面与插件样式，跟踪目标区域定位，关闭时清理监听与 React root。
 * 实现 OverlayPort，供 ContentController 调用。
 */
export class OverlayController implements OverlayPort {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private root: Root | null = null;
  private actionHandler: ((action: OverlayAction) => void) | null = null;
  private target: HTMLElement | DOMRect | null = null;
  private mode: OverlayMode = 'video-region';
  private resizeObserver: ResizeObserver | null = null;
  private rafId: number | null = null;

  onAction(handler: (action: OverlayAction) => void): void {
    this.actionHandler = handler;
  }

  open(
    item: LearningItem,
    target: HTMLElement | DOMRect,
    mode: OverlayMode,
    options?: OverlayOpenOptions,
  ): void {
    // 防止重复挂载（不应出现，但保证不会产生重复 React root）。
    if (this.host !== null) {
      this.close();
    }
    this.target = target;
    this.mode = mode;

    const host = document.createElement('div');
    host.id = OVERLAY_HOST_ID;
    host.style.position = 'fixed';
    host.style.zIndex = '2147483647';
    host.style.pointerEvents = 'auto';
    document.documentElement.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = OVERLAY_CSS;
    shadow.appendChild(style);

    const mountPoint = document.createElement('div');
    shadow.appendChild(mountPoint);

    this.host = host;
    this.shadow = shadow;
    this.root = createRoot(mountPoint);
    this.root.render(
      <OverlayApp
        item={item}
        onAction={(action) => this.actionHandler?.(action)}
        previousFeedback={options?.previousFeedback}
        previousQuestion={options?.previousQuestion}
        isContinuous={options?.isContinuous}
      />,
    );

    this.updatePosition();
    this.startTracking();
  }

  close(): void {
    this.stopTracking();
    if (this.root !== null) {
      this.root.unmount();
      this.root = null;
    }
    if (this.host !== null && this.host.parentNode !== null) {
      this.host.parentNode.removeChild(this.host);
    }
    this.host = null;
    this.shadow = null;
    this.target = null;
  }

  private startTracking(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => this.scheduleUpdate());
    this.resizeObserver.observe(document.body);
    if (this.target instanceof HTMLElement) {
      this.resizeObserver.observe(this.target);
    }
    window.addEventListener('scroll', this.scheduleUpdate, { passive: true, capture: true });
    window.addEventListener('resize', this.scheduleUpdate);
  }

  private stopTracking(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    window.removeEventListener('scroll', this.scheduleUpdate, { capture: true } as EventListenerOptions);
    window.removeEventListener('resize', this.scheduleUpdate);
  }

  private scheduleUpdate = (): void => {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.updatePosition();
    });
  };

  private updatePosition(): void {
    if (this.host === null || this.target === null) return;
    const rect =
      this.target instanceof DOMRect
        ? this.target
        : this.target.getBoundingClientRect();

    if (this.mode === 'full-page') {
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
