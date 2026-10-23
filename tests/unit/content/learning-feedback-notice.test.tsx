import { act, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEARNING_FEEDBACK_CSS, LearningFeedbackNotice } from '@/content/learning-feedback-notice';
import {
  LEARNING_FEEDBACK_DURATION_MS,
  LEARNING_FEEDBACK_EXIT_DURATION_MS,
} from '@/ui/overlay/LearningFeedback';
import { getIslandShadowStyleBundle } from '@/ui/island/shadow-styles';
import type { StartLearningFailureReason, StartLearningResponse } from '@/messaging/messages';
import type { CorrectionResult, SubmissionResult } from '@/types';

vi.mock('animal-island-ui/style?raw', () => ({
  default:
    ':root{--animal-primary-color:#19c8b9;--animal-font-family:Nunito,sans-serif}' +
    '@font-face{font-family:Nunito;src:url(/assets/nunito.woff2) format("woff2")}',
}));

const NOTICE_ID = 'bingeup-learning-feedback-notice';
const STYLE_ID = 'bingeup-learning-feedback-style';
const FEEDBACK_SELECTOR = '.bingeup-learning-feedback';
const CLIP_PATH_ID = 'bingeup-feedback-clip';
const RESULT: SubmissionResult = {
  isCorrect: true,
  correctAnswer: '吸收',
  cardId: 'card-1',
  reviewLogId: 'review-1',
  explanation: {
    word: 'absorb',
    phonetic: '/əbˈzɔːrb/',
    partOfSpeech: ['v.'],
    meanings: ['吸收', '理解'],
    secondaryMeanings: [{ partOfSpeech: 'v.', meaningZh: '使专心' }],
    exampleSentence: 'Plants absorb sunlight.',
    exampleTranslation: '植物吸收阳光。',
  },
  rating: 'good',
  nextReviewAt: 123_456,
};

const CORRECTION_RESULT: CorrectionResult = {
  cardId: RESULT.cardId,
  reviewLogId: RESULT.reviewLogId,
  rating: 'easy',
  nextReviewAt: 456_789,
};

type NoticeOptions = NonNullable<Parameters<LearningFeedbackNotice['show']>[1]>;

let notice: LearningFeedbackNotice;

function queryFeedback(): HTMLElement | null {
  return (
    document.getElementById(NOTICE_ID)?.shadowRoot?.querySelector<HTMLElement>(FEEDBACK_SELECTOR) ??
    null
  );
}

function shownNotice() {
  const host = document.getElementById(NOTICE_ID);
  const shadowRoot = host?.shadowRoot;
  const feedback = shadowRoot?.querySelector<HTMLElement>(FEEDBACK_SELECTOR);
  const style = shadowRoot?.querySelector<HTMLStyleElement>('#' + STYLE_ID);
  if (!host || !shadowRoot || !feedback || !style) {
    throw new Error('Expected the Shadow feedback notice to be visible');
  }
  return {
    host,
    shadowRoot,
    feedback,
    style,
    queries: within(shadowRoot as unknown as HTMLElement),
  };
}

function advanceTime(ms: number): void {
  act(() => vi.advanceTimersByTime(ms));
}

function showNotice(
  result: SubmissionResult = RESULT,
  options: NoticeOptions = {},
): ReturnType<typeof shownNotice> {
  act(() => notice.show(result, options));
  advanceTime(0);
  return shownNotice();
}

function finishExit(): void {
  advanceTime(LEARNING_FEEDBACK_EXIT_DURATION_MS);
}

function buttonNames(feedback: HTMLElement): string[] {
  return within(feedback)
    .getAllByRole('button')
    .map((button) => button.textContent?.trim() ?? '');
}

function expectNonModalSurface(
  host: HTMLElement,
  shadowRoot: ShadowRoot,
  feedback: HTMLElement,
): void {
  expect(host.parentElement).toBe(document.documentElement);
  expect(document.body.contains(host)).toBe(false);
  expect(feedback).not.toHaveAttribute('role', 'dialog');
  expect(feedback).not.toHaveAttribute('aria-modal');
  expect(shadowRoot.querySelector('dialog, [role="dialog"], [aria-modal]')).toBeNull();
  expect(shadowRoot.querySelector('[class*="mask"], [class*="animal-modal"]')).toBeNull();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('chrome', {
    runtime: { getURL: (path: string) => 'chrome-extension://test-id/' + path },
  });
  notice = new LearningFeedbackNotice();
});

afterEach(() => {
  act(() => notice.close());
  document.getElementById(NOTICE_ID)?.remove();
  document.head.querySelector('#' + STYLE_ID)?.remove();
  document.body.replaceChildren();
  document.body.removeAttribute('style');
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('LearningFeedbackNotice', () => {
  it.each([true, false])('用右下角 Shadow 通知报告正误 %s，并保留正确词形与释义', (isCorrect) => {
    const { host, shadowRoot, feedback, queries } = showNotice({ ...RESULT, isCorrect });

    expect(host.shadowRoot).toBe(shadowRoot);
    expect(feedback.tagName).toBe('SECTION');
    expect(feedback).toHaveClass('bingeup-learning-feedback');
    expect(feedback).toHaveAttribute('role', 'region');
    const liveSummary = feedback.querySelector('[role="status"]');
    expect(liveSummary).toHaveAttribute('aria-live', 'polite');
    expect(liveSummary).toHaveAttribute('aria-atomic', 'true');
    expect(feedback).toHaveTextContent(isCorrect ? '答对了' : '答错了');
    expect(queries.getByRole('heading', { level: 2, name: 'absorb' })).toBeInTheDocument();
    expect(feedback).toHaveTextContent('吸收；理解');
    expect(feedback).not.toHaveTextContent('/əbˈzɔːrb/');
    expect(feedback).not.toHaveTextContent('Plants absorb sunlight.');
    expect(feedback).not.toHaveTextContent('学习信息');
    expect(feedback).not.toHaveTextContent('good');
    expect(feedback).not.toHaveTextContent('undefined');

    const status = feedback.querySelector('.bingeup-learning-feedback__status');
    const content = feedback.querySelector('.bingeup-learning-feedback__content');
    expect(status).toHaveTextContent(isCorrect ? '答对了' : '答错了');
    expect(status?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(content).toHaveTextContent('absorb');
    expect(content).toHaveTextContent('吸收；理解');
    expect(content).not.toHaveTextContent(isCorrect ? '答对了' : '答错了');
    expect(shadowRoot.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(feedback.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it('使用非模态纸片通知和纯文字 h2，并在同 ShadowRoot 保留原 SVG blob', () => {
    const { shadowRoot, feedback, queries } = showNotice(RESULT);
    const heading = queries.getByRole('heading', { level: 2, name: 'absorb' });
    const clip = shadowRoot.querySelector<SVGClipPathElement>('clipPath#' + CLIP_PATH_ID);
    const path = clip?.querySelector('path');

    expect(heading.textContent).toBe('absorb');
    expect(heading.children).toHaveLength(0);
    expect(shadowRoot.querySelector('.bingeup-learning-feedback__clip')).toContainElement(clip);
    expect(path).toHaveAttribute('d', expect.stringMatching(/^M0\.501,0\.005/));
    expect(feedback.querySelector('#' + CLIP_PATH_ID)).toBeNull();
    expect(shadowRoot.querySelector('[class*="animal-modalGame"]')).toBeNull();
    expect(shadowRoot.querySelector('[class*="animal-ribbon"]')).toBeNull();
    expect(LEARNING_FEEDBACK_CSS).toContain('font-size: 36px');
    expect(LEARNING_FEEDBACK_CSS).toContain('overflow-wrap: anywhere');
  });

  it('答错时显示可见标签、实际拼写和错误图标，同时保留正确答案', () => {
    const { feedback, queries } = showNotice({
      ...RESULT,
      isCorrect: false,
      submittedAnswer: 'felt',
    });
    const label = queries.getByText('你的答案');
    const submitted = feedback.querySelector('.bingeup-learning-feedback__submitted-answer');
    const wrongValue = feedback.querySelector('.bingeup-learning-feedback__wrong-value');

    expect(label).toHaveClass('bingeup-learning-feedback__answer-label');
    expect(label).not.toHaveClass('bingeup-learning-feedback__sr-only');
    expect(submitted).toHaveTextContent('你的答案felt');
    expect(wrongValue).toHaveTextContent('felt');
    expect(wrongValue?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(queries.getByRole('heading', { level: 2, name: 'absorb' })).toBeInTheDocument();
    expect(feedback).toHaveTextContent('吸收；理解');
  });

  it('答对时不展示提交答案，答错且无旧字段时也不出现 undefined', () => {
    const correct = showNotice({ ...RESULT, submittedAnswer: 'absorb' });
    expect(correct.feedback).not.toHaveTextContent('你的答案');

    const wrong = showNotice({ ...RESULT, isCorrect: false });
    expect(wrong.feedback).not.toHaveTextContent('你的答案');
    expect(wrong.feedback).not.toHaveTextContent('undefined');
  });

  it('按正误和回调提供正确的动作，并始终允许关闭', () => {
    const onContinue = vi.fn().mockResolvedValue({ ok: true });
    const onTooEasy = vi.fn().mockResolvedValue(CORRECTION_RESULT);

    let shown = showNotice(RESULT, { onContinue, onTooEasy });
    expect(buttonNames(shown.feedback)).toEqual(['详情', '太简单了', '继续答题']);

    shown = showNotice({ ...RESULT, isCorrect: false }, { onContinue, onTooEasy });
    expect(buttonNames(shown.feedback)).toEqual(['详情', '关闭', '继续答题']);
    expect(shown.queries.queryByRole('button', { name: '太简单了' })).not.toBeInTheDocument();

    shown = showNotice(RESULT, { onTooEasy });
    expect(buttonNames(shown.feedback)).toEqual(['详情', '太简单了', '关闭']);

    shown = showNotice({ ...RESULT, isCorrect: false });
    expect(buttonNames(shown.feedback)).toEqual(['详情', '关闭']);
  });

  it('详情原位展开，展开期间暂停自动关闭，收起后按剩余时间关闭', () => {
    const { feedback, queries } = showNotice();
    advanceTime(1_000);

    fireEvent.click(queries.getByRole('button', { name: '详情' }));
    const details = feedback.querySelector('.bingeup-feedback-details');
    expect(details).toHaveTextContent('/əbˈzɔːrb/');
    expect(details).toHaveTextContent('Plants absorb sunlight.');
    expect(details).toHaveTextContent('植物吸收阳光。');
    expect(details).toHaveTextContent('使专心');
    expect(queries.getByRole('button', { name: '收起详情' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    advanceTime(6_000);
    expect(queryFeedback()).not.toBeNull();

    fireEvent.click(queries.getByRole('button', { name: '收起详情' }));
    advanceTime(LEARNING_FEEDBACK_DURATION_MS);
    finishExit();
    expect(queryFeedback()).toBeNull();
  });

  it('挂载到 documentElement 的开放 ShadowRoot，样式限定为非模态右下角通知且不改宿主页', () => {
    const pageContent = document.createElement('div');
    pageContent.textContent = '页面内容';
    pageContent.style.cssText = 'position: fixed; inset: 0; color: rgb(7, 8, 9);';
    document.body.appendChild(pageContent);
    document.body.style.overflow = 'scroll';
    const originalBodyOverflow = document.body.style.overflow;
    const pageStyle = pageContent.getAttribute('style');

    const { host, shadowRoot, feedback, style } = showNotice(RESULT, { onContinue: vi.fn() });
    const bundle = getIslandShadowStyleBundle();

    expectNonModalSurface(host, shadowRoot, feedback);
    expect(host.style.position).toBe('fixed');
    expect(host.style.right).toBe('16px');
    expect(host.style.bottom).toBe('16px');
    expect(host.style.width).toContain('400px');
    expect(host.style.width).toContain('calc(100vw - 32px)');
    expect(host.style.top).toBe('');
    expect(host.style.left).toBe('');
    expect(host.style.pointerEvents).toBe('none');
    expect(LEARNING_FEEDBACK_CSS).toMatch(
      /\.bingeup-learning-feedback\s*\{[^}]*pointer-events:\s*auto;/s,
    );
    expect(style.parentNode).toBe(shadowRoot);
    expect(style.textContent).toContain(bundle.css);
    expect(style.textContent).toContain(LEARNING_FEEDBACK_CSS);
    expect(style.textContent).not.toContain('@scope');
    expect(document.head.querySelector('#' + STYLE_ID)).toBeNull();
    expect(document.getElementById(STYLE_ID)).toBeNull();
    expect(document.querySelectorAll('#' + NOTICE_ID)).toHaveLength(1);
    expect(document.body.style.overflow).toBe(originalBodyOverflow);
    expect(pageContent.getAttribute('style')).toBe(pageStyle);

    act(() => notice.close());

    expect(queryFeedback()).toBeNull();
    expect(document.getElementById(NOTICE_ID)).toBeNull();
    expect(document.body.style.overflow).toBe(originalBodyOverflow);
    expect(pageContent.getAttribute('style')).toBe(pageStyle);
  });

  it('显示时不抢页面输入焦点，自动关闭仍为五秒并保持 body overflow', () => {
    document.body.style.overflow = 'scroll';
    const pageInput = document.createElement('input');
    pageInput.type = 'text';
    document.body.appendChild(pageInput);
    pageInput.focus();

    const { host } = showNotice(RESULT, { onContinue: vi.fn() });

    expect(LEARNING_FEEDBACK_DURATION_MS).toBe(5_000);
    expect(document.activeElement).toBe(pageInput);
    expect(document.body.style.overflow).toBe('scroll');
    advanceTime(4_999);
    expect(queryFeedback()).not.toBeNull();

    advanceTime(1);
    expect(queryFeedback()).toBeNull();
    expect(host.isConnected).toBe(true);
    expect(document.activeElement).toBe(pageInput);
    expect(document.body.style.overflow).toBe('scroll');

    finishExit();
    expect(document.getElementById(NOTICE_ID)).toBeNull();
    expect(document.activeElement).toBe(pageInput);
    expect(document.body.style.overflow).toBe('scroll');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['.bingeup-learning-feedback__status', '标题'],
    ['.bingeup-learning-feedback__content', '内容'],
    ['.bingeup-learning-feedback__actions', 'footer'],
  ])('鼠标悬停整个反馈的%s时暂停计时，离开后只使用剩余时长', (selector) => {
    const { feedback } = showNotice(RESULT, { onContinue: vi.fn() });
    const hoverTarget = feedback.querySelector<HTMLElement>(selector);
    expect(hoverTarget).not.toBeNull();
    advanceTime(2_000);

    fireEvent.mouseEnter(hoverTarget!);
    advanceTime(10_000);
    expect(queryFeedback()).not.toBeNull();

    fireEvent.mouseLeave(hoverTarget!);
    advanceTime(2_999);
    expect(queryFeedback()).not.toBeNull();
    advanceTime(1);
    expect(queryFeedback()).toBeNull();
    finishExit();
    expect(document.getElementById(NOTICE_ID)).toBeNull();
  });

  it('继续期间防止重复请求并暂停收起，确认成功才关闭', async () => {
    let resolve!: (value: StartLearningResponse) => void;
    const onContinue = vi.fn(() => new Promise<StartLearningResponse>((done) => (resolve = done)));
    const { feedback, queries } = showNotice(RESULT, { onContinue });
    const button = queries.getByRole('button', { name: '继续答题' });

    fireEvent.click(button);
    fireEvent.click(button);
    expect(onContinue).toHaveBeenCalledOnce();
    expect(button).toBeDisabled();
    advanceTime(10_000);
    expect(feedback).toBeInTheDocument();

    await act(async () => resolve({ ok: true }));
    expect(queryFeedback()).toBeNull();
    finishExit();
    expect(document.getElementById(NOTICE_ID)).toBeNull();
  });

  it('TooEasy 成功后防重复，并清除悬停或聚焦造成的计时暂停', async () => {
    let resolve!: (value: CorrectionResult) => void;
    const onTooEasy = vi.fn(() => new Promise<CorrectionResult>((done) => (resolve = done)));
    const { feedback, queries } = showNotice(RESULT, { onTooEasy });
    const button = queries.getByRole('button', { name: '太简单了' });

    fireEvent.mouseEnter(feedback);
    act(() => button.focus());
    advanceTime(10_000);
    expect(feedback).toBeInTheDocument();

    fireEvent.click(button);
    fireEvent.click(button);
    expect(onTooEasy).toHaveBeenCalledOnce();
    expect(button).toBeDisabled();

    await act(async () => resolve(CORRECTION_RESULT));
    expect(queries.queryByRole('button', { name: '太简单了' })).not.toBeInTheDocument();
    expect(feedback).toHaveTextContent('已标记为太简单');

    advanceTime(4_999);
    expect(queryFeedback()).not.toBeNull();
    advanceTime(1);
    expect(queryFeedback()).toBeNull();
    finishExit();
    expect(document.getElementById(NOTICE_ID)).toBeNull();
  });

  it('TooEasy 失败保留错误并允许重试，重试成功后才显示已标记', async () => {
    const onTooEasy = vi
      .fn<() => Promise<CorrectionResult>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(CORRECTION_RESULT);
    const { feedback, queries } = showNotice(RESULT, { onTooEasy });

    await act(async () => fireEvent.click(queries.getByRole('button', { name: '太简单了' })));
    expect(queries.getByRole('alert')).toHaveTextContent('暂时无法标记，请重试。');
    expect(queries.getByRole('button', { name: '太简单了' })).toBeEnabled();
    advanceTime(60_000);
    expect(feedback).toBeInTheDocument();

    await act(async () => fireEvent.click(queries.getByRole('button', { name: '太简单了' })));
    expect(onTooEasy).toHaveBeenCalledTimes(2);
    expect(feedback).toHaveTextContent('已标记为太简单');
    expect(queries.queryByRole('button', { name: '太简单了' })).not.toBeInTheDocument();
  });

  it('TooEasy 处理中与 continue 互斥，成功后才可继续', async () => {
    let resolveTooEasy!: (value: CorrectionResult) => void;
    const onTooEasy = vi.fn(() => new Promise<CorrectionResult>((done) => (resolveTooEasy = done)));
    const onContinue = vi.fn().mockResolvedValue({ ok: true });
    const { queries } = showNotice(RESULT, { onTooEasy, onContinue });

    fireEvent.click(queries.getByRole('button', { name: '太简单了' }));
    const continueButton = queries.getByRole('button', { name: '继续答题' });
    expect(continueButton).toBeDisabled();
    fireEvent.click(continueButton);
    expect(onContinue).not.toHaveBeenCalled();

    await act(async () => resolveTooEasy(CORRECTION_RESULT));
    expect(queries.getByRole('button', { name: '继续答题' })).toBeEnabled();
    fireEvent.click(queries.getByRole('button', { name: '继续答题' }));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('continue 处理中也忽略 TooEasy，不会通过纠正再次评分', async () => {
    let resolveContinue!: (value: StartLearningResponse) => void;
    const onContinue = vi.fn(
      () => new Promise<StartLearningResponse>((done) => (resolveContinue = done)),
    );
    const onTooEasy = vi.fn().mockResolvedValue(CORRECTION_RESULT);
    const { queries } = showNotice(RESULT, { onContinue, onTooEasy });

    fireEvent.click(queries.getByRole('button', { name: '继续答题' }));
    const tooEasyButton = queries.getByRole('button', { name: '太简单了' });
    expect(tooEasyButton).toBeDisabled();
    fireEvent.click(tooEasyButton);
    expect(onTooEasy).not.toHaveBeenCalled();

    await act(async () => resolveContinue({ ok: true }));
    finishExit();
    expect(document.getElementById(NOTICE_ID)).toBeNull();
  });

  it.each<[StartLearningFailureReason, string]>([
    ['globally-paused', '学习已暂停，请先恢复学习。'],
    ['interaction-active', '已有答题窗口，请先完成当前题目。'],
    ['context-unavailable', '请先打开支持的视频页面。'],
    ['no-learning-content', '暂时没有可学内容。'],
    ['failed', '暂时无法继续，请重试。'],
  ])('继续失败 %s 在 Shadow 通知中以 alert 显示原因并保留重试', async (reason, message) => {
    const onContinue = vi
      .fn<() => Promise<StartLearningResponse>>()
      .mockResolvedValueOnce({ ok: false, reason })
      .mockResolvedValueOnce({ ok: true });
    const { feedback, queries } = showNotice(RESULT, { onContinue });

    await act(async () => fireEvent.click(queries.getByRole('button', { name: '继续答题' })));
    expect(queries.getByRole('alert')).toHaveTextContent(message);
    expect(feedback.contains(queries.getByRole('alert'))).toBe(true);
    expect(document.body.contains(queries.getByRole('alert'))).toBe(false);
    expect(queries.getByRole('button', { name: '继续答题' })).toBeEnabled();

    advanceTime(60_000);
    expect(feedback).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => fireEvent.click(queries.getByRole('button', { name: '继续答题' })));
    expect(onContinue).toHaveBeenCalledTimes(2);
    finishExit();
    expect(document.getElementById(NOTICE_ID)).toBeNull();
  });

  it('继续回调抛错时不假报成功，允许再次尝试', async () => {
    const { feedback, queries } = showNotice(RESULT, {
      onContinue: vi.fn().mockRejectedValue(new Error('offline')),
    });

    await act(async () => fireEvent.click(queries.getByRole('button', { name: '继续答题' })));
    advanceTime(60_000);

    expect(queries.getByRole('alert')).toHaveTextContent('暂时无法继续，请重试。');
    expect(feedback).toBeInTheDocument();
    expect(queries.getByRole('button', { name: '继续答题' })).toBeEnabled();
  });

  it('下一结果取代旧通知，旧计时器和未完成回调不能关闭新提示', async () => {
    document.body.style.overflow = 'scroll';
    let resolve!: (value: StartLearningResponse) => void;
    showNotice(RESULT, {
      onContinue: () => new Promise<StartLearningResponse>((done) => (resolve = done)),
    });
    advanceTime(3_000);
    fireEvent.click(shownNotice().queries.getByRole('button', { name: '继续答题' }));

    const newer = showNotice({
      ...RESULT,
      isCorrect: false,
      explanation: { ...RESULT.explanation, word: 'feel', meanings: ['感觉'] },
    });
    expect(document.querySelectorAll('#' + NOTICE_ID)).toHaveLength(1);
    expect(newer.shadowRoot.querySelectorAll('#' + STYLE_ID)).toHaveLength(1);
    expect(newer.queries.getByRole('heading', { level: 2, name: 'feel' })).toBeInTheDocument();
    expect(newer.feedback).toHaveTextContent('答错了');
    expect(document.body.style.overflow).toBe('scroll');

    await act(async () => resolve({ ok: true }));
    advanceTime(2_000);
    expect(queryFeedback()).not.toBeNull();
    expect(document.body.style.overflow).toBe('scroll');
    advanceTime(3_000);
    expect(queryFeedback()).toBeNull();
    finishExit();
    expect(document.getElementById(NOTICE_ID)).toBeNull();
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('不同实例只保留一个 Shadow 通知，关闭旧实例不会关闭新实例', () => {
    showNotice(RESULT);
    advanceTime(3_000);
    const newer = new LearningFeedbackNotice();
    try {
      act(() => newer.show({ ...RESULT, isCorrect: false }));
      advanceTime(0);
      act(() => notice.close());
      expect(queryFeedback()).not.toBeNull();
      expect(document.querySelectorAll('#' + NOTICE_ID)).toHaveLength(1);
      expect(shownNotice().shadowRoot.querySelectorAll('#' + STYLE_ID)).toHaveLength(1);
      advanceTime(2_000);
      expect(queryFeedback()).toHaveTextContent('答错了');
      advanceTime(3_000);
      expect(queryFeedback()).toBeNull();
      finishExit();
      expect(document.getElementById(NOTICE_ID)).toBeNull();
    } finally {
      act(() => newer.close());
    }
  });

  it('不拦截页面点击、Tab、Space 或 Escape，关闭也不会抢回用户后来选择的焦点', () => {
    document.body.style.overflow = 'auto';
    const pageButton = document.createElement('button');
    pageButton.textContent = '页面操作';
    document.body.appendChild(pageButton);
    const onPageClick = vi.fn();
    pageButton.addEventListener('click', onPageClick);
    pageButton.focus();

    let shown = showNotice(RESULT, { onContinue: vi.fn(), onTooEasy: vi.fn() });
    expectNonModalSurface(shown.host, shown.shadowRoot, shown.feedback);
    expect(document.activeElement).toBe(pageButton);
    expect(document.body.style.overflow).toBe('auto');

    expect(fireEvent.click(pageButton)).toBe(true);
    expect(onPageClick).toHaveBeenCalledOnce();
    expect(fireEvent.keyDown(pageButton, { key: 'Tab' })).toBe(true);
    expect(fireEvent.keyDown(pageButton, { key: ' ' })).toBe(true);
    expect(document.activeElement).toBe(pageButton);
    expect(fireEvent.keyDown(document, { key: 'Escape' })).toBe(true);
    advanceTime(0);
    expect(queryFeedback()).not.toBeNull();

    const laterPageInput = document.createElement('input');
    laterPageInput.type = 'text';
    document.body.appendChild(laterPageInput);
    laterPageInput.focus();
    act(() => notice.close());

    expect(queryFeedback()).toBeNull();
    expect(document.activeElement).toBe(laterPageInput);
    expect(document.body.style.overflow).toBe('auto');

    shown = showNotice({ ...RESULT, isCorrect: false });
    expect(fireEvent.click(shown.queries.getByRole('button', { name: '关闭' }))).toBe(true);
    expect(queryFeedback()).toBeNull();
    finishExit();
    expect(document.getElementById(NOTICE_ID)).toBeNull();
    expect(document.body.style.overflow).toBe('auto');
  });

  it('主动关闭清理计时器和 Shadow 样式；再次调用关闭无副作用', () => {
    showNotice(RESULT);
    advanceTime(1_000);
    act(() => notice.close());
    act(() => notice.close());

    expect(queryFeedback()).toBeNull();
    expect(document.getElementById(NOTICE_ID)).toBeNull();
    expect(document.querySelector('#' + STYLE_ID)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    advanceTime(10_000);
    expect(queryFeedback()).toBeNull();
    expect(document.getElementById(NOTICE_ID)).toBeNull();
  });

  it('显示和关闭都不抢页面输入框或 ShadowRoot 内输入框的焦点', () => {
    const pageInput = document.createElement('input');
    pageInput.type = 'text';
    document.body.appendChild(pageInput);
    pageInput.focus();

    let shown = showNotice(RESULT);
    expect(document.activeElement).toBe(pageInput);
    expect(shown.shadowRoot.activeElement).toBeNull();

    act(() => notice.close());
    expect(document.activeElement).toBe(pageInput);

    const shadowHost = document.createElement('div');
    document.body.appendChild(shadowHost);
    const pageShadowRoot = shadowHost.attachShadow({ mode: 'open' });
    const shadowInput = document.createElement('input');
    shadowInput.type = 'text';
    pageShadowRoot.appendChild(shadowInput);
    shadowInput.focus();
    expect(pageShadowRoot.activeElement).toBe(shadowInput);

    shown = showNotice(RESULT);
    expect(document.activeElement).toBe(shadowHost);
    expect(pageShadowRoot.activeElement).toBe(shadowInput);
    expect(shown.shadowRoot.activeElement).toBeNull();

    act(() => notice.close());
    expect(document.activeElement).toBe(shadowHost);
    expect(pageShadowRoot.activeElement).toBe(shadowInput);
  });

  it('提示出现后首次聚焦按钮也暂停计时，失焦到提示外后按剩余时长关闭', () => {
    const { feedback, shadowRoot, queries } = showNotice(RESULT, { onContinue: vi.fn() });
    const button = queries.getByRole('button', { name: '继续答题' });

    act(() => button.focus());
    expect(shadowRoot.activeElement).toBe(button);
    advanceTime(10_000);
    expect(queryFeedback()).not.toBeNull();

    act(() => button.blur());
    advanceTime(4_999);
    expect(feedback).toBeInTheDocument();
    advanceTime(1);
    expect(queryFeedback()).toBeNull();
    finishExit();
    expect(document.getElementById(NOTICE_ID)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('减少动态效果只关闭入场动画，并保留 5 秒展示与 0ms 清理', () => {
    expect(LEARNING_FEEDBACK_EXIT_DURATION_MS).toBe(0);
    expect(LEARNING_FEEDBACK_CSS).toContain('@media (prefers-reduced-motion: reduce)');
    expect(LEARNING_FEEDBACK_CSS).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none;/,
    );
    showNotice(RESULT);

    advanceTime(5_000);
    expect(queryFeedback()).toBeNull();
    finishExit();

    expect(document.getElementById(NOTICE_ID)).toBeNull();
  });

  it('长词形与释义保留完整内容，并允许在 Shadow 通知内断行', () => {
    const word = 'a'.repeat(100);
    const meaning = '很长的释义'.repeat(300);
    const { feedback, queries } = showNotice({
      ...RESULT,
      explanation: { ...RESULT.explanation, word, meanings: [meaning] },
    });

    expect(queries.getByRole('heading', { level: 2, name: word })).toBeInTheDocument();
    expect(feedback).toHaveTextContent(meaning);
    expect(LEARNING_FEEDBACK_CSS).toContain('overflow-wrap: anywhere');
    expect(LEARNING_FEEDBACK_CSS).toContain('max-height: calc(100dvh - 32px)');
  });

  it('反馈按钮的 keydown 只停止冒泡，不阻止默认行为，也不影响页面输入', () => {
    const pageInput = document.createElement('input');
    pageInput.type = 'text';
    document.body.appendChild(pageInput);
    const onDocumentKeyDown = vi.fn();
    document.addEventListener('keydown', onDocumentKeyDown);

    const { queries } = showNotice(RESULT, { onContinue: vi.fn() });
    const button = queries.getByRole('button', { name: '继续答题' });
    expect(fireEvent.keyDown(button, { key: 'Enter' })).toBe(true);
    expect(onDocumentKeyDown).not.toHaveBeenCalled();

    pageInput.focus();
    expect(fireEvent.keyDown(pageInput, { key: ' ' })).toBe(true);
    expect(onDocumentKeyDown).toHaveBeenCalledOnce();
  });
});
