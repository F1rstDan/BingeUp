import { createRoot } from 'react-dom/client';
import type { StartLearningResponse } from '@/messaging/messages';
import type { CorrectionResult, SubmissionResult } from '@/types';
import { getIslandShadowStyleBundle, registerIslandFontFaces } from '@/ui/island/shadow-styles';
import { LearningFeedback } from '@/ui/overlay/LearningFeedback';
import { WORD_SUMMARY_CSS } from '@/ui/overlay/WordSummary';
import { SPEECH_CONTROLS_CSS } from '@/ui/speech/SpeechControls';

const NOTICE_ID = 'bingeup-learning-feedback-notice';

export interface LearningFeedbackNoticePort {
  show(
    result: SubmissionResult,
    options?: {
      onContinue?: () => Promise<StartLearningResponse>;
      onTooEasy?: () => Promise<CorrectionResult>;
      onTooHard?: () => Promise<CorrectionResult>;
    },
  ): void;
  close(): void;
}

/** 非模态纸片反馈；控件和颜色使用组件库及其令牌，样式仅注入 ShadowRoot。 */
export const LEARNING_FEEDBACK_CSS = `
  :host { all: initial; }
  .bingeup-learning-feedback__clip { position: absolute; width: 0; height: 0; }
  .bingeup-learning-feedback {
    position: relative; display: flex; flex-direction: column; width: 100%; min-width: 0;
    max-height: calc(100dvh - 32px); padding: 30px 24px 22px;
    background: color-mix(in srgb, var(--animal-bg-color) 90%, var(--animal-warning-color));
    color: var(--animal-text-color); font-family: var(--animal-font-family);
    clip-path: url(#bingeup-feedback-clip); pointer-events: auto;
    animation: bingeup-feedback-enter var(--animal-motion-duration-base) var(--animal-motion-ease);
  }
  .bingeup-learning-feedback__close {
    position: absolute; top: 30px; right: 34px; z-index: 1;
    width: 32px; height: 32px; min-width: 32px; padding: 0; border-radius: 50%;
  }
  .bingeup-learning-feedback__status {
    display: flex; flex: none; align-items: center; justify-content: center;
    gap: var(--animal-spacing-sm); width: 100%;
    margin-bottom: var(--animal-spacing-sm);
    font-size: 18px; font-weight: 800; line-height: 1.4;
  }
  .bingeup-learning-feedback__status[data-correct="true"] {
    color: color-mix(in srgb, var(--animal-success-color-active) 90%, var(--animal-text-color));
  }
  .bingeup-learning-feedback__status[data-correct="false"] { color: var(--animal-error-color-active); }
  .bingeup-learning-feedback__status svg { flex: none; }
  .bingeup-learning-feedback__content {
    width: 100%; min-width: 0; min-height: 0; color: var(--animal-text-color);
    text-align: center; overflow-wrap: anywhere; overflow-y: auto;
  }
  .bingeup-learning-feedback__word {
    margin: 0; color: var(--animal-text-color); font-size: 34px; font-weight: 900;
    line-height: 1.2; letter-spacing: 0.01em; overflow-wrap: anywhere;
  }
  .bingeup-learning-feedback__meaning {
    margin: var(--animal-spacing-sm) 0 0;
    color: var(--animal-text-color); font-size: 16px; font-weight: 600; line-height: 1.6;
  }
  .bingeup-learning-feedback .bingeup-speech-controls--word { align-items: center; text-align: center; }
  .bingeup-learning-feedback .bingeup-word-speech-row {
    justify-content: center; margin-top: 2px;
  }
  .bingeup-part-of-speech {
    display: flex; justify-content: center;
    margin-top: var(--animal-spacing-xs); margin-bottom: 2px;
  }
  .bingeup-learning-feedback .bingeup-example-panel {
    margin: var(--animal-spacing-md) 0 0;
  }
  .bingeup-secondary {
    display: flex; align-items: baseline; gap: 2px var(--animal-spacing-xs);
    font-size: var(--animal-font-size-sm); line-height: 1.5; text-align: left;
  }
  .bingeup-learning-feedback__secondary {
    flex-wrap: nowrap; justify-content: flex-start; overflow: hidden;
    margin: var(--animal-spacing-sm) 0 0; padding: 0 2px; white-space: nowrap;
  }
  .bingeup-learning-feedback__secondary .bingeup-secondary-label {
    flex: none; margin-right: var(--animal-spacing-xs);
    color: var(--animal-text-color-secondary); font-weight: 700; white-space: nowrap;
  }
  .bingeup-learning-feedback__secondary .bingeup-secondary-item {
    flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  }
  .bingeup-secondary-pos { margin-right: 3px; font-weight: 700; }
  .bingeup-secondary-separator {
    margin-left: var(--animal-spacing-xs); color: var(--animal-text-color-secondary);
  }
  .bingeup-learning-feedback__submitted-answer {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: center;
    gap: var(--animal-spacing-sm) var(--animal-spacing-md);
    margin-top: var(--animal-spacing-sm); padding-top: var(--animal-spacing-sm);
    border-top: 1px solid var(--animal-border-color);
  }
  .bingeup-learning-feedback__answer-label { font-size: 14px; font-weight: 600; }
  .bingeup-learning-feedback__wrong-value {
    display: inline-flex; align-items: center; gap: var(--animal-spacing-sm);
    min-width: 0; color: var(--animal-error-color-active);
    font-size: 20px; font-weight: 700; line-height: 1.4;
  }
  .bingeup-learning-feedback__wrong-value svg { flex: none; }
  .bingeup-learning-feedback__wrong-value > span { min-width: 0; overflow-wrap: anywhere; }
  .bingeup-learning-feedback__actions {
    display: flex; flex: none; flex-wrap: wrap; align-items: center; justify-content: space-between;
    gap: var(--animal-spacing-md); width: 100%; margin-top: var(--animal-spacing-md);
  }
  .bingeup-learning-feedback__rating-actions,
  .bingeup-learning-feedback__flow-actions {
    display: flex; flex-wrap: wrap; align-items: center; gap: var(--animal-spacing-sm);
  }
  .bingeup-learning-feedback__rating-actions { justify-content: flex-start; }
  .bingeup-learning-feedback__flow-actions { justify-content: flex-end; margin-left: auto; }
  .bingeup-learning-feedback__too-easy-success {
    color: var(--animal-text-color); font-size: 13px; font-weight: 600;
  }
  .bingeup-learning-feedback__failure {
    margin: var(--animal-spacing-md) 0 0;
    color: var(--animal-text-color); font-size: 14px; line-height: 1.5;
  }
  @media (max-width: 480px) {
    .bingeup-learning-feedback { padding: 28px 20px 20px; }
    .bingeup-learning-feedback__word { font-size: 30px; }
  }
  @keyframes bingeup-feedback-enter {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .bingeup-learning-feedback { animation: none; }
  }
`;

let activeNoticeDispose: (() => void) | null = null;

export class LearningFeedbackNotice implements LearningFeedbackNoticePort {
  private dispose: (() => void) | null = null;

  show(
    result: SubmissionResult,
    options: {
      onContinue?: () => Promise<StartLearningResponse>;
      onTooEasy?: () => Promise<CorrectionResult>;
      onTooHard?: () => Promise<CorrectionResult>;
    } = {},
  ): void {
    this.close();
    activeNoticeDispose?.();
    document.getElementById(NOTICE_ID)?.remove();

    const bundle = getIslandShadowStyleBundle();
    registerIslandFontFaces(bundle.fontFaces);

    const host = document.createElement('div');
    host.id = NOTICE_ID;
    Object.assign(host.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      width: 'min(400px, calc(100vw - 32px))',
      zIndex: '2147483647',
      pointerEvents: 'none',
    });
    const shadow = host.attachShadow({ mode: 'open' });
    const mount = document.createElement('div');

    const style = document.createElement('style');
    style.id = 'bingeup-learning-feedback-style';
    style.textContent =
      bundle.css +
      '\n' +
      SPEECH_CONTROLS_CSS +
      '\n' +
      WORD_SUMMARY_CSS +
      '\n' +
      LEARNING_FEEDBACK_CSS;
    shadow.append(style, mount);
    const root = createRoot(mount);

    let disposed = false;
    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      if (activeNoticeDispose === dispose) activeNoticeDispose = null;
      if (this.dispose === dispose) this.dispose = null;
      root.unmount();
      host.remove();
    };
    this.dispose = dispose;
    activeNoticeDispose = dispose;

    document.documentElement.appendChild(host);
    root.render(
      <LearningFeedback
        result={result}
        onContinue={options.onContinue}
        onTooEasy={options.onTooEasy}
        onTooHard={options.onTooHard}
        onClose={dispose}
      />,
    );
  }

  close(): void {
    this.dispose?.();
  }
}
