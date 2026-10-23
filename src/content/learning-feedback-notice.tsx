import { createRoot } from 'react-dom/client';
import type { StartLearningResponse } from '@/messaging/messages';
import type { CorrectionResult, SubmissionResult } from '@/types';
import { getIslandShadowStyleBundle, registerIslandFontFaces } from '@/ui/island/shadow-styles';
import { LearningFeedback } from '@/ui/overlay/LearningFeedback';

const NOTICE_ID = 'bingeup-learning-feedback-notice';

export interface LearningFeedbackNoticePort {
  show(
    result: SubmissionResult,
    options?: {
      onContinue?: () => Promise<StartLearningResponse>;
      onTooEasy?: () => Promise<CorrectionResult>;
    },
  ): void;
  close(): void;
}

/** 非模态纸片反馈；控件和颜色使用组件库及其令牌，样式仅注入 ShadowRoot。 */
export const LEARNING_FEEDBACK_CSS = `
  :host { all: initial; }
  .bingeup-learning-feedback__clip { position: absolute; width: 0; height: 0; }
  .bingeup-learning-feedback {
    display: flex; flex-direction: column; width: 100%; min-width: 0;
    max-height: calc(100dvh - 32px); padding: 32px 32px 28px;
    background: color-mix(in srgb, var(--animal-bg-color) 90%, var(--animal-warning-color));
    color: var(--animal-text-color); font-family: var(--animal-font-family);
    clip-path: url(#bingeup-feedback-clip); pointer-events: auto;
    animation: bingeup-feedback-enter var(--animal-motion-duration-base) var(--animal-motion-ease);
  }
  .bingeup-learning-feedback__status {
    display: flex; align-items: center; justify-content: center;
    gap: var(--animal-spacing-sm); width: 100%;
    margin-bottom: var(--animal-spacing-md);
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
    margin: 0; color: var(--animal-text-color); font-size: 36px; font-weight: 900;
    line-height: 1.2; letter-spacing: 0.01em; overflow-wrap: anywhere;
  }
  .bingeup-learning-feedback__meaning {
    margin: var(--animal-spacing-md) 0 0;
    color: var(--animal-text-color); font-size: 16px; font-weight: 600; line-height: 1.6;
  }
  .bingeup-feedback-details-toggle {
    margin-top: var(--animal-spacing-sm); padding: 5px 10px;
    border: var(--animal-border-width) solid var(--animal-border-color); border-radius: 10px;
    background: var(--animal-bg-color); color: var(--animal-text-color);
    font-family: var(--animal-font-family); font-size: 13px; font-weight: 700; cursor: pointer;
  }
  .bingeup-feedback-details-toggle:hover { border-color: var(--animal-primary-color); }
  .bingeup-feedback-details-toggle:focus-visible { outline: 2px solid var(--animal-primary-color); outline-offset: 2px; }
  .bingeup-feedback-details { margin-top: var(--animal-spacing-md); text-align: left; }
  .bingeup-feedback-details__phonetic { margin: 4px 0; color: var(--animal-text-color-secondary); text-align: center; }
  .bingeup-feedback-details__example { margin: var(--animal-spacing-sm) 0 4px; font-style: italic; line-height: 1.5; }
  .bingeup-feedback-details__translation { margin: 0 0 var(--animal-spacing-sm); color: var(--animal-text-color-secondary); font-size: 13px; line-height: 1.5; }
  .bingeup-feedback-details__secondary { margin: 0 0 var(--animal-spacing-sm); padding-left: 20px; font-size: 13px; line-height: 1.6; }
  .bingeup-part-of-speech { display: flex; justify-content: center; margin-bottom: 4px; }
  .bingeup-secondary-pos { display: inline-block; margin-right: 6px; color: var(--animal-text-color-secondary); font-size: 12px; font-weight: 700; }
  .bingeup-speech-controls { margin-top: var(--animal-spacing-sm); text-align: center; }
  .bingeup-speech-buttons { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--animal-spacing-sm); }
  .bingeup-speech-button, .bingeup-speech-retry {
    padding: 5px 10px; border: var(--animal-border-width) solid var(--animal-border-color);
    border-radius: 10px; background: var(--animal-bg-color); color: var(--animal-text-color);
    font-family: var(--animal-font-family); font-size: 12px; font-weight: 700; cursor: pointer;
  }
  .bingeup-speech-button:hover, .bingeup-speech-retry:hover { border-color: var(--animal-primary-color); }
  .bingeup-speech-button:focus-visible, .bingeup-speech-retry:focus-visible { outline: 2px solid var(--animal-primary-color); outline-offset: 2px; }
  .bingeup-speech-status { margin: 6px 0 0; font-size: 12px; }
  .bingeup-speech-note { margin: 6px 0 0; color: var(--animal-text-color-secondary); font-size: 11px; line-height: 1.4; }
  .bingeup-learning-feedback__submitted-answer {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: center;
    gap: var(--animal-spacing-sm) var(--animal-spacing-md);
    margin-top: var(--animal-spacing-lg); padding-top: var(--animal-spacing-md);
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
    display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end;
    gap: var(--animal-spacing-md); width: 100%; margin-top: var(--animal-spacing-lg);
  }
  .bingeup-learning-feedback__too-easy-success {
    color: var(--animal-text-color); font-size: 13px; font-weight: 600;
  }
  .bingeup-learning-feedback__failure {
    margin: var(--animal-spacing-md) 0 0;
    color: var(--animal-text-color); font-size: 14px; line-height: 1.5;
  }
  @media (max-width: 480px) {
    .bingeup-learning-feedback { padding: 28px 24px 24px; }
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
    style.textContent = bundle.css + '\n' + LEARNING_FEEDBACK_CSS;
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
        onClose={dispose}
      />,
    );
  }

  close(): void {
    this.dispose?.();
  }
}
