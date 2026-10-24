import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import type {
  LearningItem,
  MultipleChoiceQuestion,
  NewWordPresentation,
  SpellingQuestion,
  SubmissionResult,
} from '@/types';
import { OverlayApp, type OverlayAction } from '@/ui/overlay/OverlayApp';

// ─── 固件 ────────────────────────────────────────────────────

const NEW_WORD_PRESENTATION: NewWordPresentation = {
  word: {
    id: 'w-1',
    word: 'abandon',
    lemma: 'abandon',
    phonetic: '/əˈbændən/',
    partOfSpeech: ['v.', 'n.'],
    coreMeaningZh: ['放弃', '遗弃'],
    exampleSentence: 'He abandoned his car.',
    exampleTranslation: '他抛弃了他的车。',
    difficulty: 3,
    frequencyRank: 1,
    source: 'built-in',
    license: 'CC-BY-4.0',
  },
};

const QUESTION: MultipleChoiceQuestion = {
  id: 'q-1',
  type: 'en-to-zh',
  cardId: 'card-1',
  wordId: 'w-2',
  prompt: 'absorb',
  options: ['吸收', '释放', '反射', '聚集'],
  correctIndex: 0,
  explanation: {
    word: 'absorb',
    phonetic: '/əbˈzɔːrb/',
    partOfSpeech: ['v.'],
    meanings: ['吸收'],
    exampleSentence: 'Plants absorb sunlight.',
    exampleTranslation: '植物吸收阳光。',
  },
};

const CONTEXT_QUESTION: MultipleChoiceQuestion = {
  ...QUESTION,
  id: 'q-context-1',
  type: 'context-choice',
  prompt: 'Plants ____ sunlight.',
  options: ['absorb', 'release', 'reflect', 'gather'],
};

const PREVIOUS_RESULT: SubmissionResult = {
  isCorrect: true,
  correctAnswer: '吸收',
  cardId: QUESTION.cardId,
  reviewLogId: 'review-1',
  explanation: QUESTION.explanation,
};

const SPELLING_QUESTION: SpellingQuestion = {
  id: 'q-spell-1',
  type: 'spelling',
  cardId: 'card-spell',
  wordId: 'w-spell',
  prompt: '吸收',
  correctAnswer: 'absorb',
  explanation: {
    word: 'absorb',
    phonetic: '/əbˈzɔːrb/',
    partOfSpeech: ['v.'],
    meanings: ['吸收'],
    exampleSentence: 'Plants absorb sunlight.',
    exampleTranslation: '植物吸收阳光。',
  },
};

function renderOverlay(item: LearningItem, onAction = vi.fn()) {
  render(<OverlayApp item={item} onAction={onAction} />);
  return onAction;
}

function click(text: string) {
  fireEvent.click(screen.getByText(text));
}

function clickButton(name: RegExp) {
  fireEvent.click(screen.getByRole('button', { name }));
}

function submitButton() {
  return screen.getByRole('button', { name: /^提交(?:\s+Enter)?$/ });
}

function clickSubmitButton() {
  fireEvent.click(submitButton());
}

/** 在 document 上触发 keydown（组件在此监听）。fireEvent 自动包裹 act()。 */
function pressKey(key: string, init: KeyboardEventInit = {}) {
  fireEvent.keyDown(document, { key, ...init });
}

const FEEDBACK_NOTICE_ATTRIBUTE = 'data-test-learning-feedback-notice';

/** 模拟右下角的真实反馈形态：独立 Shadow DOM、非模态 status，不抢焦点。 */
function showLearningFeedbackNotice() {
  const host = document.createElement('div');
  host.setAttribute(FEEDBACK_NOTICE_ATTRIBUTE, '');
  Object.assign(host.style, {
    position: 'fixed',
    right: '24px',
    bottom: '24px',
  });
  const shadowRoot = host.attachShadow({ mode: 'open' });
  const notice = document.createElement('div');
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  notice.textContent = '答题反馈：本题已完成';
  shadowRoot.append(notice);
  document.documentElement.append(host);
  return host;
}

afterEach(() => {
  for (const host of document.querySelectorAll(`[${FEEDBACK_NOTICE_ATTRIBUTE}]`)) host.remove();
});

// ─── 新词展示 ────────────────────────────────────────────────

describe('OverlayApp — 新词展示', () => {
  it('渲染词形、释义和例句，不渲染选项', () => {
    renderOverlay({ kind: 'new-word-presentation', presentation: NEW_WORD_PRESENTATION });
    expect(screen.getByText('abandon')).toBeInTheDocument();
    expect(screen.getByText('/əˈbændən/')).toBeInTheDocument();
    expect(screen.getByText('放弃；遗弃')).toBeInTheDocument();
    expect(screen.getByText('He abandoned his car.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /选项/ })).not.toBeInTheDocument();
  });

  it('例句整块是朗读入口，文字和译文可选中且没有嵌套按钮', () => {
    const onAction = vi.fn();
    const { container } = render(
      <OverlayApp
        item={{ kind: 'new-word-presentation', presentation: NEW_WORD_PRESENTATION }}
        onAction={onAction}
      />,
    );
    const example = container.querySelector('.bingeup-example-action');

    expect(example).not.toBeNull();
    expect(example).toHaveAttribute('role', 'button');
    expect(example).toHaveAttribute('tabindex', '0');
    expect(example).toHaveTextContent('He abandoned his car.');
    expect(example).toHaveTextContent('他抛弃了他的车。');
    expect(example?.querySelectorAll('button')).toHaveLength(0);
    expect(example?.querySelector('svg')).toBeInTheDocument();

    fireEvent.click(example!);
    fireEvent.keyDown(example!, { key: 'Enter' });
    fireEvent.keyDown(example!, { key: ' ' });
    expect(onAction).not.toHaveBeenCalled();
  });

  it('渲染"学到了"、"我认识，换一个"、"跳过"三个按钮', () => {
    renderOverlay({ kind: 'new-word-presentation', presentation: NEW_WORD_PRESENTATION });
    expect(screen.getByRole('button', { name: /学到了/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /我认识，换一个/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /跳过/ })).toBeInTheDocument();
  });

  it('点击"学到了"发出 accept-new-word 动作', () => {
    const onAction = renderOverlay({
      kind: 'new-word-presentation',
      presentation: NEW_WORD_PRESENTATION,
    });
    clickButton(/学到了/);
    expect(onAction).toHaveBeenCalledWith({ type: 'accept-new-word', wordId: 'w-1' });
  });

  it('点击"我认识，换一个"发出 self-report 动作', () => {
    const onAction = renderOverlay({
      kind: 'new-word-presentation',
      presentation: NEW_WORD_PRESENTATION,
    });
    clickButton(/我认识，换一个/);
    expect(onAction).toHaveBeenCalledWith({ type: 'self-report', wordId: 'w-1' });
  });

  it('点击"跳过"发出 skip 动作', () => {
    const onAction = renderOverlay({
      kind: 'new-word-presentation',
      presentation: NEW_WORD_PRESENTATION,
    });
    clickButton(/跳过/);
    expect(onAction).toHaveBeenCalledWith({ type: 'skip' });
  });

  it('操作后禁用所有按钮，防止重复触发', () => {
    renderOverlay({ kind: 'new-word-presentation', presentation: NEW_WORD_PRESENTATION });
    const accept = screen.getByRole('button', { name: /学到了/ });
    fireEvent.click(accept);
    expect(accept).toBeDisabled();
    expect(screen.getByRole('button', { name: /我认识，换一个/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /跳过/ })).toBeDisabled();
  });
});

// ─── 题目交互 ────────────────────────────────────────────────

describe('OverlayApp — 题目交互', () => {
  it('渲染题目提示和四个选项', () => {
    renderOverlay({ kind: 'question', question: QUESTION });
    expect(screen.getByText('absorb')).toBeInTheDocument();
    expect(screen.getByText('吸收')).toBeInTheDocument();
    expect(screen.getByText('释放')).toBeInTheDocument();
    expect(screen.getByText('反射')).toBeInTheDocument();
    expect(screen.getByText('聚集')).toBeInTheDocument();
  });

  it('选项序号使用 1-4，不再使用 A-D', () => {
    const { container } = render(
      <OverlayApp item={{ kind: 'question', question: QUESTION }} onAction={vi.fn()} />,
    );
    const keys = [...container.querySelectorAll('.bingeup-option-key')].map(
      (element) => element.textContent,
    );
    expect(keys).toEqual(['1', '2', '3', '4']);
  });

  it('题目卡用可朗读音标替代词性标签', () => {
    const { container } = render(
      <OverlayApp item={{ kind: 'question', question: QUESTION }} onAction={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: '朗读单词' })).toBeInTheDocument();
    expect(container.querySelector('.bingeup-question-pronunciation')).toHaveTextContent(
      '/əbˈzɔːrb/',
    );
    expect(container.querySelector('.bingeup-part-of-speech')).toBeNull();
  });

  it('语境题不展示会泄露答案的音标和朗读入口', () => {
    const { container } = render(
      <OverlayApp item={{ kind: 'question', question: CONTEXT_QUESTION }} onAction={vi.fn()} />,
    );

    expect(container.querySelector('.bingeup-question-pronunciation')).toBeNull();
    expect(screen.queryByRole('button', { name: '朗读单词' })).not.toBeInTheDocument();
  });

  it('未选择时提交按钮禁用', () => {
    renderOverlay({ kind: 'question', question: QUESTION });
    expect(submitButton()).toBeDisabled();
  });

  it('选择选项后可以提交', () => {
    renderOverlay({ kind: 'question', question: QUESTION });
    click('吸收');
    expect(submitButton()).toBeEnabled();
  });

  it('仅选中项显示原版 Radio，切换后只保留一个选中状态', () => {
    const { container } = render(
      <OverlayApp item={{ kind: 'question', question: QUESTION }} onAction={vi.fn()} />,
    );

    expect(container.querySelector('.bingeup-option-radio')).toBeNull();

    click('吸收');
    expect(container.querySelectorAll('.bingeup-option-radio')).toHaveLength(1);
    expect(container.querySelector('.bingeup-option-radio input[type="radio"]')).toBeChecked();

    click('释放');
    const selectedRadio = container.querySelector('.bingeup-option-radio');
    expect(container.querySelectorAll('.bingeup-option-radio')).toHaveLength(1);
    expect(selectedRadio?.closest('.bingeup-option')).toHaveTextContent('释放');
    expect(selectedRadio?.querySelector('input[type="radio"]')).toBeChecked();
  });

  it('未提交时显示按顺序排列的三个题目操作和快捷键', () => {
    renderOverlay({ kind: 'question', question: QUESTION });

    const actions = within(screen.getByRole('group', { name: '题目操作' })).getAllByRole('button');
    expect(actions.map((button) => button.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      '跳过 Esc',
      '提交并继续 Shift + Enter',
      '提交 Enter',
    ]);
  });

  it('选择答案后点击提交并继续发出 submit-and-continue 动作', () => {
    const onAction = renderOverlay({ kind: 'question', question: QUESTION });
    click('吸收');
    clickButton(/提交并继续/);

    const call = onAction.mock.calls[0]![0] as OverlayAction;
    expect(call.type).toBe('submit-and-continue');
    if (call.type === 'submit-and-continue') {
      expect(call.question).toBe(QUESTION);
      expect(call.selectedIndex).toBe(0);
    }
  });

  it('提交正确答案发出 submit-answer 动作，含 selectedIndex 和 responseTimeMs', () => {
    const onAction = renderOverlay({ kind: 'question', question: QUESTION });
    click('吸收');
    clickSubmitButton();
    const call = onAction.mock.calls[0]![0] as OverlayAction;
    expect(call.type).toBe('submit-answer');
    if (call.type === 'submit-answer') {
      expect(call.question).toBe(QUESTION);
      expect(call.selectedIndex).toBe(0);
      expect(call.responseTimeMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('提交错误答案也发出 submit-answer 动作', () => {
    const onAction = renderOverlay({ kind: 'question', question: QUESTION });
    click('释放');
    clickSubmitButton();
    const call = onAction.mock.calls[0]![0] as OverlayAction;
    expect(call.type).toBe('submit-answer');
    if (call.type === 'submit-answer') {
      expect(call.selectedIndex).toBe(1);
    }
  });

  it('跳过发出 skip 动作', () => {
    const onAction = renderOverlay({ kind: 'question', question: QUESTION });
    clickButton(/跳过/);
    expect(onAction).toHaveBeenCalledWith({ type: 'skip' });
  });

  it('提交后禁用选项和全部题目操作', () => {
    renderOverlay({ kind: 'question', question: QUESTION });
    click('吸收');
    clickSubmitButton();
    expect(screen.getByText('吸收').closest('button')).toBeDisabled();
    expect(submitButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: /提交并继续/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /跳过/ })).toBeDisabled();
  });
});

// ─── 提交后等待控制器处理 ────────────────────────────────────

describe('OverlayApp — 提交锁定', () => {
  it.each([
    { kind: 'question', isCorrect: true },
    { kind: 'question', isCorrect: false },
    { kind: 'spelling-question', isCorrect: true },
    { kind: 'spelling-question', isCorrect: false },
  ] as const)('$kind 提交结果为 $isCorrect 时不在遮罩中追加反馈', async ({ kind, isCorrect }) => {
    const result: SubmissionResult = {
      isCorrect,
      correctAnswer: 'absorb',
      cardId: 'card-1',
      reviewLogId: 'log-1',
      explanation: QUESTION.explanation,
    };
    const onAction = vi.fn().mockResolvedValue(result);
    const item: LearningItem =
      kind === 'question' ? { kind, question: QUESTION } : { kind, question: SPELLING_QUESTION };
    renderOverlay(item, onAction);
    if (kind === 'question') {
      click(isCorrect ? '吸收' : '释放');
    } else {
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: isCorrect ? 'absorb' : 'wrong' },
      });
    }

    await act(async () => clickSubmitButton());

    expect(screen.queryByText(/答对了|答错了|正确答案|上一题反馈/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /学习信息|其实是蒙的|这个太简单|明白了|^继续/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '评分纠正' })).not.toBeInTheDocument();
    expect(screen.queryByText('Plants absorb sunlight.')).not.toBeInTheDocument();
    expect(onAction).toHaveBeenCalledTimes(1);
    for (const button of screen.getAllByRole('button')) {
      if (button.tagName === 'BUTTON') expect(button).toBeDisabled();
      else expect(button).toHaveAttribute('aria-disabled', 'true');
    }
  });

  it.each([
    ['单题选择提交', 'question', false, false, 'submit-answer'],
    ['单题选择继续', 'question', false, true, 'submit-and-continue'],
    ['连续选择结束', 'question', true, false, 'submit-and-end'],
    ['连续选择继续', 'question', true, true, 'submit-and-continue'],
    ['单题拼写提交', 'spelling-question', false, false, 'submit-spelling'],
    ['单题拼写继续', 'spelling-question', false, true, 'submit-spelling-and-continue'],
    ['连续拼写结束', 'spelling-question', true, false, 'submit-spelling-and-end'],
    ['连续拼写继续', 'spelling-question', true, true, 'submit-spelling-and-continue'],
  ] as const)(
    '%s 保存期间禁用全部操作，重复点击和快捷键不会再次提交或跳过',
    async (_label, kind, isContinuous, continueLearning, type) => {
      let finish!: () => void;
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const onAction = vi.fn(() => pending);
      const item: LearningItem =
        kind === 'question' ? { kind, question: QUESTION } : { kind, question: SPELLING_QUESTION };
      render(<OverlayApp item={item} onAction={onAction} isContinuous={isContinuous} />);
      if (kind === 'question') {
        click('吸收');
      } else {
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'absorb' } });
      }

      if (continueLearning) clickButton(/提交并继续/);
      else if (isContinuous) clickButton(/提交并结束/);
      else clickSubmitButton();

      for (const button of screen.getAllByRole('button')) {
        if (button.tagName === 'BUTTON') expect(button).toBeDisabled();
        else expect(button).toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(button);
      }
      pressKey('Escape');
      expect(fireEvent.keyDown(document, { key: 'Enter', cancelable: true })).toBe(true);
      expect(fireEvent.keyDown(document, { key: 'Enter', shiftKey: true, cancelable: true })).toBe(
        true,
      );
      pressKey('2');
      pressKey('b');
      if (kind === 'spelling-question') {
        const input = screen.getByRole('textbox');
        expect(input).toBeDisabled();
        expect(fireEvent.keyDown(input, { key: 'Enter', cancelable: true })).toBe(true);
        fireEvent.change(input, { target: { value: 'changed' } });
        expect(input).toHaveValue('absorb');
      } else {
        expect(screen.getByRole('button', { name: '吸收' })).toHaveAttribute(
          'aria-pressed',
          'true',
        );
        expect(screen.getByRole('button', { name: '释放' })).toHaveAttribute(
          'aria-pressed',
          'false',
        );
      }
      expect(onAction).toHaveBeenCalledTimes(1);
      expect(onAction).toHaveBeenCalledWith(
        expect.objectContaining({ type, answerChanges: 0, responseTimeMs: expect.any(Number) }),
      );

      await act(async () => {
        finish();
        await pending;
      });

      pressKey('Escape');
      expect(onAction).toHaveBeenCalledTimes(1);
      for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    },
  );

  it.each(['question', 'spelling-question'] as const)(
    '%s 提交回调内同步触发快捷键和点击，也只提交一次',
    (kind) => {
      const onAction = vi.fn().mockImplementationOnce(() => {
        pressKey('Escape');
        pressKey('Enter', { shiftKey: true });
        clickButton(/提交并继续/);
      });
      const item: LearningItem =
        kind === 'question' ? { kind, question: QUESTION } : { kind, question: SPELLING_QUESTION };
      renderOverlay(item, onAction);
      if (kind === 'question') click('吸收');
      else fireEvent.change(screen.getByRole('textbox'), { target: { value: 'absorb' } });

      clickSubmitButton();

      expect(onAction).toHaveBeenCalledTimes(1);
      expect(onAction).toHaveBeenCalledWith(
        expect.objectContaining({
          type: kind === 'question' ? 'submit-answer' : 'submit-spelling',
        }),
      );
    },
  );
});

// ─── 快捷键仅限学习界面（验收标准 5） ──────────────────────

describe('OverlayApp — 快捷键', () => {
  describe('新词展示快捷键', () => {
    it('按下 1 触发 accept-new-word', () => {
      const onAction = renderOverlay({
        kind: 'new-word-presentation',
        presentation: NEW_WORD_PRESENTATION,
      });
      pressKey('1');
      expect(onAction).toHaveBeenCalledWith({ type: 'accept-new-word', wordId: 'w-1' });
    });

    it('按下 2 触发 self-report', () => {
      const onAction = renderOverlay({
        kind: 'new-word-presentation',
        presentation: NEW_WORD_PRESENTATION,
      });
      pressKey('2');
      expect(onAction).toHaveBeenCalledWith({ type: 'self-report', wordId: 'w-1' });
    });

    it('按下 3 或 Escape 触发 skip', () => {
      const onAction = renderOverlay({
        kind: 'new-word-presentation',
        presentation: NEW_WORD_PRESENTATION,
      });
      pressKey('3');
      expect(onAction).toHaveBeenCalledWith({ type: 'skip' });
    });
  });

  describe('题目快捷键', () => {
    it.each([
      ['1', 0],
      ['2', 1],
      ['3', 2],
      ['4', 3],
    ] as const)('按下 %s 选择第 %i 个选项', (key, index) => {
      renderOverlay({ kind: 'question', question: QUESTION });
      pressKey(key);
      const selectedOption = screen.getByText(QUESTION.options[index]!).closest('button');
      expect(selectedOption).toHaveAttribute('aria-pressed', 'true');
      // M5：选中状态用原版令牌样式 + naive-icons 图标表达，不仅依赖颜色。
      expect(selectedOption?.querySelector('svg')).not.toBeNull();
    });

    it('选择后按 Enter 提交', () => {
      const onAction = renderOverlay({ kind: 'question', question: QUESTION });
      pressKey('1');
      pressKey('Enter');
      const call = onAction.mock.calls[0]![0] as OverlayAction;
      expect(call.type).toBe('submit-answer');
      if (call.type === 'submit-answer') {
        expect(call.selectedIndex).toBe(0);
      }
    });

    it('选择后按 Shift + Enter 提交并继续', () => {
      const onAction = renderOverlay({ kind: 'question', question: QUESTION });
      pressKey('1');
      pressKey('Enter', { shiftKey: true });

      const call = onAction.mock.calls[0]![0] as OverlayAction;
      expect(call.type).toBe('submit-and-continue');
      if (call.type === 'submit-and-continue') {
        expect(call.selectedIndex).toBe(0);
      }
    });

    it('按 Escape 跳过', () => {
      const onAction = renderOverlay({ kind: 'question', question: QUESTION });
      pressKey('Escape');
      expect(onAction).toHaveBeenCalledWith({ type: 'skip' });
    });
  });

  describe('快捷键防重复', () => {
    it('操作后快捷键不再触发动作', () => {
      const onAction = renderOverlay({
        kind: 'new-word-presentation',
        presentation: NEW_WORD_PRESENTATION,
      });
      pressKey('1');
      pressKey('1');
      expect(onAction).toHaveBeenCalledTimes(1);
    });
  });

  describe('Issue #26：答案修改计数', () => {
    it('选择题只统计首次选择后的改选', () => {
      const onAction = renderOverlay({ kind: 'question', question: QUESTION });
      click('吸收');
      click('释放');
      click('吸收');
      clickSubmitButton();

      expect(onAction).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'submit-answer', answerChanges: 2 }),
      );
    });

    it('重复选择同一选项不增加改选计数', () => {
      const onAction = renderOverlay({ kind: 'question', question: QUESTION });
      click('吸收');
      click('吸收');
      pressKey('1');
      clickSubmitButton();

      expect(onAction).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'submit-answer', answerChanges: 0 }),
      );
    });

    it('拼写题只统计删除或替换已有内容的纠错操作', () => {
      const onAction = renderOverlay({ kind: 'spelling-question', question: SPELLING_QUESTION });
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'absorb' } });
      fireEvent.change(input, { target: { value: 'absor' } });
      fireEvent.change(input, { target: { value: 'absorx' } });
      fireEvent.change(input, { target: { value: 'absory' } });
      clickSubmitButton();

      expect(onAction).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'submit-spelling', answerChanges: 2 }),
      );
    });
  });
});

// ─── Issue #8：连续学习模式与拼写题 ──────────────────────────────

function renderOverlayContinuous(item: LearningItem, onAction = vi.fn()) {
  render(<OverlayApp item={item} onAction={onAction} isContinuous />);
  return onAction;
}

describe('OverlayApp — 连续学习模式（Issue #8）', () => {
  describe('连续模式标记', () => {
    it('连续模式渲染"连续学习"标记', () => {
      renderOverlayContinuous({ kind: 'question', question: QUESTION });
      expect(screen.getByText('连续学习')).toBeInTheDocument();
    });

    it('新词卡顶部统一，音标不带“读音”，其他义项直接展示', () => {
      const item: LearningItem = {
        kind: 'new-word-presentation',
        presentation: {
          word: {
            ...NEW_WORD_PRESENTATION.word,
            secondaryMeanings: [
              { partOfSpeech: 'n.', meaningZh: '放任' },
              { partOfSpeech: 'v.', meaningZh: '抛弃' },
            ],
          },
        },
      };
      const { container } = render(<OverlayApp item={item} onAction={vi.fn()} isContinuous />);

      expect(container.querySelector('.bingeup-new-word-badge')).toHaveTextContent('连续学习');

      const pronunciation = container.querySelector('.bingeup-pronunciation-wrap');
      expect(pronunciation).toHaveTextContent('/əˈbændən/');
      expect(pronunciation).not.toHaveTextContent('读音');
      expect(container.querySelector('.bingeup-word-pronunciation-label')).toBeNull();

      const meaning = container.querySelector('.bingeup-word-summary__meaning-row');
      expect(meaning).toHaveTextContent('v./n.');
      expect(meaning).toHaveTextContent('放弃；遗弃');
      expect(container.querySelector('.bingeup-pos-tooltip')).toHaveAttribute(
        'title',
        expect.stringContaining('动词'),
      );

      const example = container.querySelector('.bingeup-example-panel');
      expect(example).toHaveTextContent('He abandoned his car.');
      expect(example).toHaveTextContent('他抛弃了他的车。');

      const secondary = container.querySelector('.bingeup-secondary');
      expect(secondary).toHaveTextContent('其他常见义');
      expect(secondary).toHaveTextContent('n. 放任');
      expect(screen.queryByRole('button', { name: /其他常见义/ })).not.toBeInTheDocument();
    });

    it('连续答题界面不显示上一题反馈或评分操作', () => {
      renderOverlayContinuous({ kind: 'question', question: QUESTION });
      expect(screen.queryByText('上一题反馈')).not.toBeInTheDocument();
      expect(screen.queryByRole('group', { name: '评分纠正' })).not.toBeInTheDocument();
    });

    it.each([
      [true, '上一题答对了'],
      [false, '上一题答错了'],
    ])('下一题顶部显示上一题正误 %s', (isCorrect, label) => {
      const { container } = render(
        <OverlayApp
          item={{ kind: 'question', question: QUESTION }}
          onAction={vi.fn()}
          isContinuous
          previousResult={{
            ...PREVIOUS_RESULT,
            isCorrect,
            submittedAnswer: isCorrect ? undefined : '释放',
          }}
        />,
      );

      const banner = within(container).getByRole('status');
      expect(banner).toHaveTextContent(label);
      if (isCorrect) {
        expect(banner).not.toHaveTextContent('你的答案');
        expect(banner).not.toHaveTextContent('正确答案');
      } else {
        expect(banner).toHaveTextContent('你的答案释放');
        expect(banner).toHaveTextContent('正确答案吸收');
      }
      expect(banner).toHaveAttribute('data-correct', String(isCorrect));
      expect(banner.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      expect(container.querySelector('.bingeup-card')?.firstElementChild).toBe(banner);
    });
  });

  describe('连续模式选择题按钮', () => {
    it('未提交时显示一排三个按钮及快捷键', () => {
      renderOverlayContinuous({ kind: 'question', question: QUESTION });
      const actions = within(screen.getByRole('group', { name: '题目操作' })).getAllByRole(
        'button',
      );
      expect(actions.map((button) => button.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
        '跳过 Esc',
        '提交并继续 Shift + Enter',
        '提交并结束 Enter',
      ]);
    });

    it('未选择时"提交并继续"禁用', () => {
      renderOverlayContinuous({ kind: 'question', question: QUESTION });
      expect(screen.getByRole('button', { name: /提交并继续/ })).toBeDisabled();
    });

    it('选择后"提交并继续"启用', () => {
      renderOverlayContinuous({ kind: 'question', question: QUESTION });
      click('吸收');
      expect(screen.getByRole('button', { name: /提交并继续/ })).toBeEnabled();
    });

    it('点击"提交并继续"发出 submit-and-continue 动作', () => {
      const onAction = renderOverlayContinuous({ kind: 'question', question: QUESTION });
      click('吸收');
      clickButton(/提交并继续/);
      const call = onAction.mock.calls[0]![0] as OverlayAction;
      expect(call.type).toBe('submit-and-continue');
      if (call.type === 'submit-and-continue') {
        expect(call.selectedIndex).toBe(0);
      }
    });

    it('点击"提交并结束"发出 submit-and-end 动作', () => {
      const onAction = renderOverlayContinuous({ kind: 'question', question: QUESTION });
      click('吸收');
      clickButton(/提交并结束/);
      const call = onAction.mock.calls[0]![0] as OverlayAction;
      expect(call.type).toBe('submit-and-end');
      if (call.type === 'submit-and-end') {
        expect(call.selectedIndex).toBe(0);
      }
    });
  });

  describe('连续模式新词展示按钮', () => {
    it('显示"学到了，继续"和"结束学习"按钮', () => {
      renderOverlayContinuous({
        kind: 'new-word-presentation',
        presentation: NEW_WORD_PRESENTATION,
      });
      expect(screen.getByRole('button', { name: /学到了，继续/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /结束学习/ })).toBeInTheDocument();
    });

    it('点击"学到了，继续"发出 accept-new-word-and-continue', () => {
      const onAction = renderOverlayContinuous({
        kind: 'new-word-presentation',
        presentation: NEW_WORD_PRESENTATION,
      });
      clickButton(/学到了，继续/);
      expect(onAction).toHaveBeenCalledWith({
        type: 'accept-new-word-and-continue',
        wordId: 'w-1',
      });
    });

    it('点击"我认识，换一个"发出 self-report-and-continue', () => {
      const onAction = renderOverlayContinuous({
        kind: 'new-word-presentation',
        presentation: NEW_WORD_PRESENTATION,
      });
      clickButton(/我认识，换一个/);
      expect(onAction).toHaveBeenCalledWith({
        type: 'self-report-and-continue',
        wordId: 'w-1',
      });
    });

    it.each([
      ['学到了，继续', 'accept-new-word-and-continue'],
      ['我认识，换一个', 'self-report-and-continue'],
      ['结束学习', 'exit-learning'],
    ] as const)('%s 在同步重复点击和快捷键下也只触发一次', (label, type) => {
      const onAction = renderOverlayContinuous({
        kind: 'new-word-presentation',
        presentation: NEW_WORD_PRESENTATION,
      });
      const button = screen.getByRole('button', { name: new RegExp(label) });
      onAction.mockImplementationOnce(() => {
        pressKey('1');
        pressKey('2');
        pressKey('Escape');
        fireEvent.click(button);
      });

      fireEvent.click(button);
      fireEvent.click(button);
      pressKey('1');
      pressKey('2');
      pressKey('Escape');

      expect(onAction).toHaveBeenCalledTimes(1);
      expect(onAction).toHaveBeenCalledWith(
        type === 'exit-learning' ? { type } : { type, wordId: 'w-1' },
      );
      for (const action of screen
        .getAllByRole('button')
        .filter((button) => button.tagName === 'BUTTON')) {
        expect(action).toBeDisabled();
      }
      expect(screen.getByRole('button', { name: '朗读例句' })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    });
  });
});

describe('OverlayApp — 右下角非模态反馈存在时', () => {
  it('反馈是右下角 Shadow DOM status，数字键仍选择下一题答案', () => {
    renderOverlay({ kind: 'question', question: QUESTION });
    const feedbackHost = showLearningFeedbackNotice();
    const feedbackStatus = feedbackHost.shadowRoot?.querySelector('[role="status"]');

    expect(feedbackHost.style.position).toBe('fixed');
    expect(feedbackHost.style.right).toBe('24px');
    expect(feedbackHost.style.bottom).toBe('24px');
    expect(feedbackStatus).toHaveTextContent('答题反馈：本题已完成');
    expect(feedbackStatus).not.toHaveAttribute('aria-modal');

    pressKey('2');
    expect(screen.getByRole('button', { name: '释放' })).toHaveAttribute('aria-pressed', 'true');

    pressKey('3');
    expect(screen.getByRole('button', { name: '反射' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Enter 仍提交当前下一题', () => {
    const onAction = renderOverlay({ kind: 'question', question: QUESTION });
    showLearningFeedbackNotice();
    click('吸收');
    pressKey('Enter');

    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'submit-answer', selectedIndex: 0 }),
    );
  });

  it('Shift + Enter 仍提交并继续', () => {
    const onAction = renderOverlayContinuous({ kind: 'question', question: QUESTION });
    showLearningFeedbackNotice();
    click('吸收');
    pressKey('Enter', { shiftKey: true });

    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'submit-and-continue', selectedIndex: 0 }),
    );
  });

  it('拼写输入保持焦点，输入后 Enter 仍提交当前下一题', () => {
    const onAction = vi.fn();
    render(
      <OverlayApp
        item={{ kind: 'spelling-question', question: SPELLING_QUESTION }}
        onAction={onAction}
        isContinuous
      />,
    );
    const input = screen.getByRole('textbox');
    expect(input).toHaveFocus();
    showLearningFeedbackNotice();
    expect(input).toHaveFocus();

    fireEvent.change(input, { target: { value: 'absorb' } });
    expect(fireEvent.keyDown(input, { key: 'Enter', cancelable: true })).toBe(false);

    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'submit-spelling-and-end',
        spelledAnswer: 'absorb',
      }),
    );
  });

  it.each(['question', 'spelling-question'] as const)('%s 中 Escape 仍跳过下一题', (kind) => {
    const onAction = vi.fn();
    const item: LearningItem =
      kind === 'question' ? { kind, question: QUESTION } : { kind, question: SPELLING_QUESTION };
    render(<OverlayApp item={item} onAction={onAction} isContinuous />);
    showLearningFeedbackNotice();

    pressKey('Escape');

    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'skip' });
  });
});

describe('OverlayApp — 拼写题（Issue #8 验收标准 3）', () => {
  function renderSpelling(
    opts: {
      continuous?: boolean;
      onAction?: ReturnType<typeof vi.fn<(action: OverlayAction) => void>>;
    } = {},
  ) {
    const onAction = opts.onAction ?? vi.fn<(action: OverlayAction) => void>();
    render(
      <OverlayApp
        item={{ kind: 'spelling-question', question: SPELLING_QUESTION }}
        onAction={onAction}
        isContinuous={opts.continuous}
      />,
    );
    return onAction;
  }

  it('渲染题干（中文释义）和输入框', () => {
    renderSpelling();
    expect(screen.getByText('吸收')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('输入单词...')).toBeInTheDocument();
  });

  it('输入框为空时提交按钮禁用', () => {
    renderSpelling({ continuous: true });
    expect(screen.getByRole('button', { name: /提交并继续/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /提交并结束/ })).toBeDisabled();
  });

  it('输入后提交按钮启用', () => {
    renderSpelling({ continuous: true });
    fireEvent.change(screen.getByPlaceholderText('输入单词...'), { target: { value: 'absorb' } });
    expect(screen.getByRole('button', { name: /提交并继续/ })).toBeEnabled();
  });

  it('连续模式点击"提交并继续"发出 submit-spelling-and-continue', () => {
    const onAction = renderSpelling({ continuous: true });
    const input = screen.getByPlaceholderText('输入单词...');
    fireEvent.change(input, { target: { value: 'absorb' } });
    clickButton(/提交并继续/);
    const call = onAction.mock.calls[0]![0] as OverlayAction;
    expect(call.type).toBe('submit-spelling-and-continue');
    if (call.type === 'submit-spelling-and-continue') {
      expect(call.spelledAnswer).toBe('absorb');
    }
  });

  it('连续模式点击"提交并结束"发出 submit-spelling-and-end', () => {
    const onAction = renderSpelling({ continuous: true });
    const input = screen.getByPlaceholderText('输入单词...');
    fireEvent.change(input, { target: { value: 'absorb' } });
    clickButton(/提交并结束/);
    const call = onAction.mock.calls[0]![0] as OverlayAction;
    expect(call.type).toBe('submit-spelling-and-end');
    if (call.type === 'submit-spelling-and-end') {
      expect(call.spelledAnswer).toBe('absorb');
    }
  });

  it('连续模式显示"提交并结束"按钮', () => {
    renderSpelling({ continuous: true });
    expect(screen.getByRole('button', { name: /提交并结束/ })).toBeInTheDocument();
  });

  it('非连续模式显示提交、提交并继续和跳过按钮', () => {
    renderSpelling({ continuous: false });
    expect(submitButton()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /提交并继续/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /跳过/ })).toBeEnabled();
  });

  it('拼写题挂载时自动聚焦输入框', () => {
    renderSpelling();
    expect(screen.getByRole('textbox')).toHaveFocus();
  });

  it.each([
    [false, false, 'submit-spelling'],
    [false, true, 'submit-spelling-and-continue'],
    [true, false, 'submit-spelling-and-end'],
    [true, true, 'submit-spelling-and-continue'],
  ] as const)(
    '拼写输入框在连续模式 %s、Shift %s 时只触发 %s 一次',
    (continuous, shiftKey, type) => {
      const onAction = renderSpelling({ continuous });
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'absorb' } });

      fireEvent.keyDown(input, { key: 'Enter', shiftKey });

      expect(onAction).toHaveBeenCalledTimes(1);
      expect(onAction).toHaveBeenCalledWith(
        expect.objectContaining({
          type,
          question: SPELLING_QUESTION,
          spelledAnswer: 'absorb',
          responseTimeMs: expect.any(Number),
          answerChanges: 0,
        }),
      );
    },
  );

  it.each([
    [false, 'submit-spelling'],
    [true, 'submit-spelling-and-continue'],
  ] as const)('单题拼写 document 级 Enter（Shift %s）触发 %s', (shiftKey, type) => {
    const onAction = renderSpelling();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'absorb' } });

    pressKey('Enter', { shiftKey });

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ type }));
  });

  it('只有空白输入时点击和快捷键均不提交，也不锁定跳过操作', () => {
    const onAction = renderSpelling();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  ' } });

    clickSubmitButton();
    clickButton(/提交并继续/);
    pressKey('Enter');
    pressKey('Enter', { shiftKey: true });

    expect(onAction).not.toHaveBeenCalled();
    expect(submitButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: /提交并继续/ })).toBeDisabled();
    pressKey('Escape');
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'skip' });
  });
});

describe('OverlayApp — 连续模式快捷键（Issue #8）', () => {
  it('连续模式 Escape 触发 skip', () => {
    const onAction = renderOverlayContinuous({ kind: 'question', question: QUESTION });
    pressKey('Escape');
    expect(onAction).toHaveBeenCalledWith({ type: 'skip' });
  });

  it('连续模式选择题 Enter 触发 submit-and-end', () => {
    const onAction = renderOverlayContinuous({ kind: 'question', question: QUESTION });
    pressKey('1');
    pressKey('Enter');
    const call = onAction.mock.calls[0]![0] as OverlayAction;
    expect(call.type).toBe('submit-and-end');
  });

  it('连续模式选择题 Shift + Enter 触发 submit-and-continue', () => {
    const onAction = renderOverlayContinuous({ kind: 'question', question: QUESTION });
    pressKey('1');
    pressKey('Enter', { shiftKey: true });
    const call = onAction.mock.calls[0]![0] as OverlayAction;
    expect(call.type).toBe('submit-and-continue');
  });

  it('连续模式新词展示按 1 触发 accept-new-word-and-continue', () => {
    const onAction = renderOverlayContinuous({
      kind: 'new-word-presentation',
      presentation: NEW_WORD_PRESENTATION,
    });
    pressKey('1');
    expect(onAction).toHaveBeenCalledWith({
      type: 'accept-new-word-and-continue',
      wordId: 'w-1',
    });
  });
});
