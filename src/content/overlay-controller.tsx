import { Component, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { OverlayApp } from '@/ui/overlay/OverlayApp';
import { SHADOW_DESIGN_TOKENS } from '@/ui/styles/shadow-design';
import type { LearningItem, OverlayAction, OverlayMode } from '@/types';
import type { OverlayOpenOptions, OverlayPort } from '@/content/content-controller';

const OVERLAY_HOST_ID = 'bingeup-overlay-host';

const OVERLAY_CSS = `
  ${SHADOW_DESIGN_TOKENS}
  .bingeup-overlay {
    display: grid; width: 100%; height: 100%; place-items: center; overflow: visible;
    color: var(--bingeup-ink); background: rgba(31, 41, 55, .72); font-family: var(--bingeup-font);
  }
  .bingeup-card {
    box-sizing: border-box; width: min(470px, calc(100% - 30px));
    padding: 24px 22px 20px; border: 1px solid var(--bingeup-line);
    border-radius: var(--bingeup-radius-lg); background: rgba(255, 255, 255, .9); box-shadow: var(--bingeup-shadow);
  }
  .bingeup-prompt { margin-bottom: 18px; color: var(--bingeup-ink); font-size: 27px; font-weight: 900; text-align: center; letter-spacing: -.06em; }
  .bingeup-phonetic { margin-bottom: 12px; color: var(--bingeup-muted); font-size: 15px; text-align: center; }
  .bingeup-meaning { margin-bottom: 14px; color: #4e6072; font-size: 17px; font-weight: 800; text-align: center; }
  .bingeup-example { margin-bottom: 4px; color: #637589; font-size: 14px; font-style: italic; line-height: 1.5; }
  .bingeup-example-translation { margin-bottom: 18px; color: var(--bingeup-muted); font-size: 13px; }
  .bingeup-options { display: grid; gap: 9px; margin-bottom: 18px; }
  .bingeup-option {
    display: flex; align-items: center; gap: 12px; width: 100%; min-height: 48px; padding: 8px 10px;
    border: 1.5px solid #e4ebf1; border-radius: 12px; background: #fff; color: var(--bingeup-ink);
    font-size: 15px; font-weight: 800; text-align: left; cursor: pointer; transition: 140ms ease;
  }
  .bingeup-option:not(:disabled):hover { border-color: #9bd4f8; background: #f8fcff; transform: translateX(2px); }
  .bingeup-option.selected { border-color: var(--bingeup-blue); background: var(--bingeup-blue-soft); box-shadow: 0 3px 0 #b9def6; }
  .bingeup-option.correct { border-color: var(--bingeup-green); background: var(--bingeup-green-soft); box-shadow: 0 3px 0 #b4edcf; }
  .bingeup-option.wrong { border-color: var(--bingeup-pink); background: var(--bingeup-pink-soft); box-shadow: 0 3px 0 #ffc8d3; }
  .bingeup-option:disabled { cursor: default; opacity: 1; }
  .bingeup-option-key { display: inline-flex; flex-shrink: 0; width: 28px; height: 28px; align-items: center; justify-content: center; border-radius: 8px; color: #526274; background: #f0f3f6; font-size: 12px; font-weight: 900; }
  .bingeup-option.selected .bingeup-option-key { color: #fff; background: var(--bingeup-blue); }
  .bingeup-option.correct .bingeup-option-key { color: #fff; background: var(--bingeup-green); }
  .bingeup-option.wrong .bingeup-option-key { color: #fff; background: var(--bingeup-pink); }
  .bingeup-actions { display: flex; flex-wrap: wrap; gap: 9px; justify-content: flex-end; }
  .bingeup-question-actions { display: grid; grid-template-columns: minmax(0, .75fr) minmax(0, 1.55fr) minmax(0, 1.7fr); width: 100%; align-items: stretch; }
  .bingeup-question-actions > button { box-sizing: border-box; width: 100%; min-width: 0; padding-right: 6px; padding-left: 6px; font-size: 13px; white-space: nowrap; }
  .bingeup-question-actions > button .bingeup-key-hint { margin-left: 2px; padding-right: 3px; padding-left: 3px; font-size: 10px; }
  .bingeup-actions-new-word { flex-direction: column; }
  .bingeup-submit, .bingeup-skip, .bingeup-accept, .bingeup-self-report, .bingeup-continue, .bingeup-exit, .bingeup-explanation-toggle {
    min-height: 40px; padding: 8px 14px; border: 0; border-radius: 12px; font-family: var(--bingeup-font); font-size: 14px; font-weight: 900; cursor: pointer; transition: 140ms ease;
  }
  .bingeup-submit, .bingeup-accept, .bingeup-continue { color: #fff; background: var(--bingeup-blue); box-shadow: 0 3px 0 var(--bingeup-blue-dark); }
  .bingeup-skip, .bingeup-self-report, .bingeup-exit { color: #536476; background: #eef2f5; box-shadow: 0 3px 0 #dbe2e8; }
  .bingeup-explanation-toggle { width: 100%; margin-bottom: 10px; border: 1px solid #dce5ec; background: #fff; color: #637589; }
  .bingeup-submit:not(:disabled):hover, .bingeup-accept:not(:disabled):hover, .bingeup-continue:not(:disabled):hover { background: #2198ee; }
  .bingeup-submit:not(:disabled):hover, .bingeup-skip:not(:disabled):hover, .bingeup-accept:not(:disabled):hover, .bingeup-self-report:not(:disabled):hover, .bingeup-continue:not(:disabled):hover, .bingeup-exit:not(:disabled):hover, .bingeup-explanation-toggle:hover { transform: translateY(-2px); }
  .bingeup-submit:not(:disabled):active, .bingeup-skip:not(:disabled):active, .bingeup-accept:not(:disabled):active, .bingeup-self-report:not(:disabled):active, .bingeup-continue:not(:disabled):active, .bingeup-exit:not(:disabled):active, .bingeup-explanation-toggle:active { transform: translateY(1px); }
  .bingeup-submit:disabled, .bingeup-accept:disabled, .bingeup-continue:disabled, .bingeup-skip:disabled, .bingeup-self-report:disabled, .bingeup-exit:disabled { cursor: default; opacity: .5; }
  .bingeup-key-hint { display: inline-block; margin-left: 4px; padding: 1px 5px; border: 1px solid rgba(82, 98, 116, .18); border-radius: 4px; background: rgba(255, 255, 255, .42); color: inherit; font-size: 11px; font-weight: 800; }
  .bingeup-feedback { margin-top: 16px; padding: 15px; border: 1px solid var(--bingeup-line); border-radius: var(--bingeup-radius-md); background: #fbfdff; }
  .bingeup-feedback-result { display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 11px; font-size: 18px; font-weight: 900; }
  .bingeup-feedback-answer { margin-bottom: 12px; color: var(--bingeup-muted); font-size: 13px; text-align: center; }
  .bingeup-feedback-answer .correct-answer { color: var(--bingeup-ink); font-weight: 800; }
  .bingeup-feedback-result.correct { color: var(--bingeup-green-dark); }
  .bingeup-feedback-result.wrong { color: var(--bingeup-pink-dark); }
  .bingeup-feedback-icon { display: inline-flex; flex-shrink: 0; width: 24px; height: 24px; align-items: center; justify-content: center; border-radius: 50%; color: #fff; font-size: 14px; font-weight: 700; }
  .bingeup-feedback-icon.correct { background: var(--bingeup-green); }
  .bingeup-feedback-icon.wrong { background: var(--bingeup-pink); }
  .bingeup-explanation { margin-bottom: 14px; padding: 12px 14px; border: 1px solid var(--bingeup-line); border-radius: 10px; background: var(--bingeup-blue-soft); color: #4e6072; font-size: 14px; line-height: 1.6; }
  .bingeup-explanation-phonetic, .bingeup-explanation-example, .bingeup-explanation-example-translation { color: var(--bingeup-muted); }
  .bingeup-explanation-pos { margin-bottom: 4px; color: var(--bingeup-blue-dark); font-size: 13px; font-weight: 800; }
  .bingeup-explanation-meanings { margin-bottom: 8px; color: var(--bingeup-ink); font-weight: 800; }
  .bingeup-explanation-example { margin-bottom: 2px; font-style: italic; }
  .bingeup-previous-feedback { margin-bottom: 16px; padding: 12px 14px; border: 1px solid var(--bingeup-line); border-left: 5px solid #dce5ec; border-radius: 10px; background: #fbfdff; }
  .bingeup-previous-feedback.correct { border-left-color: var(--bingeup-green); background: linear-gradient(135deg, var(--bingeup-green-soft), #fff); }
  .bingeup-previous-feedback.wrong { border-left-color: var(--bingeup-pink); background: linear-gradient(135deg, var(--bingeup-pink-soft), #fff); }
  .bingeup-previous-feedback-title { margin-bottom: 6px; color: var(--bingeup-muted); font-size: 12px; letter-spacing: .5px; text-transform: uppercase; }
  .bingeup-previous-feedback-prompt { margin-bottom: 6px; color: var(--bingeup-muted); font-size: 13px; font-style: italic; }
  .bingeup-previous-feedback-result { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; font-size: 14px; font-weight: 900; }
  .bingeup-previous-feedback-result.correct { color: var(--bingeup-green-dark); }
  .bingeup-previous-feedback-result.wrong { color: var(--bingeup-pink-dark); }
  .bingeup-previous-feedback-answer { color: var(--bingeup-muted); font-size: 13px; }
  .bingeup-previous-feedback-answer .correct-answer { color: var(--bingeup-ink); font-weight: 800; }
  .bingeup-spelling-input { width: 100%; margin-bottom: 18px; padding: 12px 14px; border: 1.5px solid #dce5ec; border-radius: 10px; background: #fff; color: var(--bingeup-ink); font-size: 18px; text-align: center; outline: none; transition: border-color 140ms ease, box-shadow 140ms ease; }
  .bingeup-spelling-input:focus { border-color: var(--bingeup-blue); box-shadow: 0 0 0 3px rgba(10, 134, 230, .14); }
  .bingeup-spelling-input::placeholder { color: #a9b4bd; }
  .bingeup-continuous-badge { display: inline-block; margin-bottom: 12px; padding: 3px 9px; border-radius: 999px; color: var(--bingeup-blue-dark); background: var(--bingeup-blue-soft); font-size: 11px; font-weight: 900; }
  .bingeup-error-card { text-align: center; }
  .bingeup-error-card p { color: var(--bingeup-pink-dark); line-height: 1.5; }
`;

class OverlayErrorBoundary extends Component<{ children: ReactNode; onRecover: () => void }, { hasError: boolean }> {
  override state = { hasError: false };
  static getDerivedStateFromError(): { hasError: boolean } { return { hasError: true }; }
  override componentDidCatch(error: Error): void { console.error('[BingeUp] 遮罩渲染失败', error); }
  override render(): ReactNode {
    if (this.state.hasError) return <div className="bingeup-overlay" role="alert"><div className="bingeup-card bingeup-error-card"><p>学习界面出现错误，视频仍可安全恢复。</p><button className="bingeup-submit" type="button" onClick={this.props.onRecover}>返回视频</button></div></div>;
    return this.props.children;
  }
}

/** Learning overlay controller mounted in an isolated Shadow DOM root. */
export class OverlayController implements OverlayPort {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private root: Root | null = null;
  private actionHandler: ((action: OverlayAction) => void) | null = null;
  private target: HTMLElement | DOMRect | null = null;
  private mode: OverlayMode = 'video-region';
  private resizeObserver: ResizeObserver | null = null;
  private hostObserver: MutationObserver | null = null;
  private rafId: number | null = null;
  private recoveryRequested = false;

  onAction(handler: (action: OverlayAction) => void): void { this.actionHandler = handler; }
  open(item: LearningItem, target: HTMLElement | DOMRect, mode: OverlayMode, options?: OverlayOpenOptions): void {
    if (this.host !== null) this.close();
    this.target = target; this.mode = mode; this.recoveryRequested = false;
    const host = document.createElement('div');
    host.id = OVERLAY_HOST_ID; host.style.position = 'fixed'; host.style.zIndex = '2147483647'; host.style.pointerEvents = 'auto';
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = OVERLAY_CSS; shadow.appendChild(style);
    const mountPoint = document.createElement('div'); shadow.appendChild(mountPoint);
    this.host = host; this.shadow = shadow;
    this.hostObserver = new MutationObserver(() => {
      if (this.host !== null && !this.host.isConnected && !this.recoveryRequested) { this.recoveryRequested = true; this.actionHandler?.({ type: 'recover' }); }
    });
    this.hostObserver.observe(document.documentElement, { childList: true, subtree: true });
    this.root = createRoot(mountPoint);
    this.root.render(<OverlayErrorBoundary onRecover={() => this.actionHandler?.({ type: 'recover' })}><OverlayApp item={item} onAction={(action) => this.actionHandler?.(action)} previousFeedback={options?.previousFeedback} previousQuestion={options?.previousQuestion} isContinuous={options?.isContinuous} /></OverlayErrorBoundary>);
    this.updatePosition(); this.startTracking();
  }
  close(): void {
    this.hostObserver?.disconnect(); this.hostObserver = null; this.recoveryRequested = false; this.stopTracking();
    if (this.root !== null) { this.root.unmount(); this.root = null; }
    if (this.host !== null && this.host.parentNode !== null) this.host.parentNode.removeChild(this.host);
    this.host = null; this.shadow = null; this.target = null;
  }
  private startTracking(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => this.scheduleUpdate()); this.resizeObserver.observe(document.body);
    if (this.target instanceof HTMLElement) this.resizeObserver.observe(this.target);
    window.addEventListener('scroll', this.scheduleUpdate, { passive: true, capture: true }); window.addEventListener('resize', this.scheduleUpdate); document.addEventListener('visibilitychange', this.scheduleUpdate);
  }
  private stopTracking(): void {
    this.resizeObserver?.disconnect(); this.resizeObserver = null;
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    window.removeEventListener('scroll', this.scheduleUpdate, { capture: true } as EventListenerOptions); window.removeEventListener('resize', this.scheduleUpdate); document.removeEventListener('visibilitychange', this.scheduleUpdate);
  }
  private scheduleUpdate = (): void => {
    if (document.visibilityState === 'hidden' || this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => { this.rafId = null; this.updatePosition(); });
  };
  private updatePosition(): void {
    if (this.host === null || this.target === null) return;
    const rect = this.target instanceof DOMRect ? this.target : this.target.getBoundingClientRect();
    if (this.mode === 'full-page') { this.host.style.left = '0px'; this.host.style.top = '0px'; this.host.style.width = `${document.documentElement.clientWidth}px`; this.host.style.height = `${document.documentElement.clientHeight}px`; }
    else { this.host.style.left = `${rect.left}px`; this.host.style.top = `${rect.top}px`; this.host.style.width = `${rect.width}px`; this.host.style.height = `${rect.height}px`; }
  }
}
