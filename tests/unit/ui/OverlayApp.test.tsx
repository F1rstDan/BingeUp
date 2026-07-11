import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

function makeQuestion(overrides: Partial<MultipleChoiceQuestion> = {}): MultipleChoiceQuestion {
  return { ...QUESTION, ...overrides };
}

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

/** 在 document 上触发 keydown（组件在此监听）。fireEvent 自动包裹 act()。 */
function pressKey(key: string) {
  fireEvent.keyDown(document, { key });
}

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

  it('渲染"知道了"、"我认识，换一个"、"跳过"三个按钮', () => {
    renderOverlay({ kind: 'new-word-presentation', presentation: NEW_WORD_PRESENTATION });
    expect(screen.getByRole('button', { name: /知道了/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /我认识，换一个/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /跳过/ })).toBeInTheDocument();
  });

  it('点击"知道了"发出 accept-new-word 动作', () => {
    const onAction = renderOverlay({
      kind: 'new-word-presentation',
      presentation: NEW_WORD_PRESENTATION,
    });
    clickButton(/知道了/);
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
    const accept = screen.getByRole('button', { name: /知道了/ });
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

  it('未选择时提交按钮禁用', () => {
    renderOverlay({ kind: 'question', question: QUESTION });
    expect(screen.getByRole('button', { name: /提交/ })).toBeDisabled();
  });

  it('选择选项后可以提交', () => {
    renderOverlay({ kind: 'question', question: QUESTION });
    click('吸收');
    expect(screen.getByRole('button', { name: /提交/ })).toBeEnabled();
  });

  it('提交正确答案发出 submit-answer 动作，含 selectedIndex 和 responseTimeMs', () => {
    const onAction = renderOverlay({ kind: 'question', question: QUESTION });
    click('吸收');
    clickButton(/提交/);
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
    clickButton(/提交/);
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

  it('提交后禁用选项，提交和跳过按钮替换为反馈区', () => {
    renderOverlay({ kind: 'question', question: QUESTION });
    click('吸收');
    clickButton(/提交/);
    expect(screen.getByText('吸收').closest('button')).toBeDisabled();
    // 提交和跳过按钮消失，被"继续"替代
    expect(screen.queryByRole('button', { name: /^提交$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^跳过$/ })).not.toBeInTheDocument();
  });
});

// ─── 单题反馈（验收标准 5） ──────────────────────────────────

describe('OverlayApp — 单题反馈', () => {
  it('提交后显示正确性（答对）', () => {
    renderOverlay({ kind: 'question', question: QUESTION });
    click('吸收');
    clickButton(/提交/);
    expect(screen.getByText(/答对了|正确|答对/)).toBeInTheDocument();
  });

  it('提交后显示正确性（答错）', () => {
    const wrongQuestion = makeQuestion({ correctIndex: 1 });
    renderOverlay({ kind: 'question', question: wrongQuestion });
    click('吸收'); // selectedIndex=0, correct=1
    clickButton(/提交/);
    expect(screen.getByText(/答错了|错误|答错/)).toBeInTheDocument();
  });

  it('反馈区默认折叠，点击可展开学习信息', () => {
    renderOverlay({ kind: 'question', question: QUESTION });
    click('吸收');
    clickButton(/提交/);
    expect(screen.queryByText('Plants absorb sunlight.')).not.toBeInTheDocument();
    clickButton(/学习信息|详情|展开/);
    expect(screen.getByText('Plants absorb sunlight.')).toBeInTheDocument();
    expect(screen.getByText('植物吸收阳光。')).toBeInTheDocument();
  });

  it('反馈后有"继续"按钮，点击发出 skip 动作（表示交互结束）', () => {
    const onAction = renderOverlay({ kind: 'question', question: QUESTION });
    click('吸收');
    clickButton(/^提交$/);
    clickButton(/^继续/);
    expect(onAction).toHaveBeenLastCalledWith({ type: 'skip' });
  });

  it('单题反馈阶段显示"提交并继续"入口，点击发出 submit-and-continue（Issue #8 验收标准 1）', () => {
    const onAction = renderOverlay({ kind: 'question', question: QUESTION });
    click('吸收');
    clickButton(/^提交$/);
    // 反馈阶段应有"继续"和"提交并继续"两个按钮
    expect(screen.getByRole('button', { name: /^继续/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /提交并继续/ })).toBeInTheDocument();
    clickButton(/提交并继续/);
    const call = onAction.mock.calls[onAction.mock.calls.length - 1]![0] as OverlayAction;
    expect(call.type).toBe('submit-and-continue');
    if (call.type === 'submit-and-continue') {
      expect(call.selectedIndex).toBe(0);
    }
  });
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
    it('按下数字键 1-4 选择对应选项', () => {
      renderOverlay({ kind: 'question', question: QUESTION });
      pressKey('1');
      expect(screen.getByText('吸收').closest('button')).toHaveClass('selected');
    });

    it('按下字母键 A-D 选择对应选项', () => {
      renderOverlay({ kind: 'question', question: QUESTION });
      pressKey('b');
      expect(screen.getByText('释放').closest('button')).toHaveClass('selected');
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

    it('按 Escape 跳过', () => {
      const onAction = renderOverlay({ kind: 'question', question: QUESTION });
      pressKey('Escape');
      expect(onAction).toHaveBeenCalledWith({ type: 'skip' });
    });
  });

  describe('反馈阶段快捷键', () => {
    it('提交后按 Enter 触发继续（发出 skip）', () => {
      const onAction = renderOverlay({ kind: 'question', question: QUESTION });
      pressKey('1');
      pressKey('Enter'); // 提交
      pressKey('Enter'); // 继续
      expect(onAction).toHaveBeenLastCalledWith({ type: 'skip' });
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
});

// ─── Issue #8：连续学习模式与拼写题 ──────────────────────────────

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

const PREVIOUS_FEEDBACK: SubmissionResult = {
  isCorrect: false,
  correctAnswer: 'abandon',
  cardId: 'card-1',
  reviewLogId: 'log-prev',
  explanation: {
    word: 'abandon',
    partOfSpeech: ['v.'],
    meanings: ['放弃'],
  },
};

function renderOverlayContinuous(
  item: LearningItem,
  options: { previousFeedback?: SubmissionResult; onAction?: ReturnType<typeof vi.fn> } = {},
) {
  const onAction = options.onAction ?? vi.fn();
  render(
    <OverlayApp
      item={item}
      onAction={onAction}
      isContinuous
      previousFeedback={options.previousFeedback}
    />,
  );
  return onAction;
}

describe('OverlayApp — 连续学习模式（Issue #8 验收标准 1、2）', () => {
  describe('连续模式标记与上一题反馈', () => {
    it('连续模式渲染"连续学习"标记', () => {
      renderOverlayContinuous({ kind: 'question', question: QUESTION });
      expect(screen.getByText('连续学习')).toBeInTheDocument();
    });

    it('连续模式渲染上一题反馈区（含正确答案文本）', () => {
      renderOverlayContinuous(
        { kind: 'question', question: QUESTION },
        { previousFeedback: PREVIOUS_FEEDBACK },
      );
      expect(screen.getByText('上一题反馈')).toBeInTheDocument();
      expect(screen.getByText(/答错了/)).toBeInTheDocument();
      expect(screen.getByText('abandon')).toBeInTheDocument();
    });

    it('无上一题反馈时不渲染反馈区', () => {
      renderOverlayContinuous({ kind: 'question', question: QUESTION });
      expect(screen.queryByText('上一题反馈')).not.toBeInTheDocument();
    });
  });

  describe('验收标准 2：无障碍反馈（不依赖颜色）', () => {
    it('上一题反馈区包含 ✓/✗ 图标', () => {
      renderOverlayContinuous(
        { kind: 'question', question: QUESTION },
        { previousFeedback: PREVIOUS_FEEDBACK },
      );
      expect(screen.getByText('✗')).toBeInTheDocument();
    });

    it('上一题答对时显示 ✓ 图标', () => {
      const correctFeedback: SubmissionResult = {
        ...PREVIOUS_FEEDBACK,
        isCorrect: true,
      };
      renderOverlayContinuous(
        { kind: 'question', question: QUESTION },
        { previousFeedback: correctFeedback },
      );
      expect(screen.getByText('✓')).toBeInTheDocument();
      expect(screen.getByText(/答对了/)).toBeInTheDocument();
    });

    it('反馈区有 aria-label 描述结果', () => {
      renderOverlayContinuous(
        { kind: 'question', question: QUESTION },
        { previousFeedback: PREVIOUS_FEEDBACK },
      );
      expect(screen.getByLabelText('上一题答错')).toBeInTheDocument();
    });
  });

  describe('连续模式选择题按钮', () => {
    it('未提交时显示"提交并继续"和"结束学习"按钮', () => {
      renderOverlayContinuous({ kind: 'question', question: QUESTION });
      expect(screen.getByRole('button', { name: /提交并继续/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /结束学习/ })).toBeInTheDocument();
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

    it('点击"结束学习"发出 exit-learning 动作', () => {
      const onAction = renderOverlayContinuous({ kind: 'question', question: QUESTION });
      clickButton(/结束学习/);
      expect(onAction).toHaveBeenCalledWith({ type: 'exit-learning' });
    });
  });

  describe('连续模式新词展示按钮', () => {
    it('显示"知道了，继续"和"结束学习"按钮', () => {
      renderOverlayContinuous({ kind: 'new-word-presentation', presentation: NEW_WORD_PRESENTATION });
      expect(screen.getByRole('button', { name: /知道了，继续/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /结束学习/ })).toBeInTheDocument();
    });

    it('点击"知道了，继续"发出 accept-new-word-and-continue', () => {
      const onAction = renderOverlayContinuous({
        kind: 'new-word-presentation',
        presentation: NEW_WORD_PRESENTATION,
      });
      clickButton(/知道了，继续/);
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
  });
});

describe('OverlayApp — 拼写题（Issue #8 验收标准 3）', () => {
  function renderSpelling(opts: { continuous?: boolean; onAction?: ReturnType<typeof vi.fn> } = {}) {
    const onAction = opts.onAction ?? vi.fn();
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

  it('连续模式显示"结束学习"按钮', () => {
    renderSpelling({ continuous: true });
    expect(screen.getByRole('button', { name: /结束学习/ })).toBeInTheDocument();
  });

  it('非连续模式显示"提交"按钮（单题模式不会出现拼写题，但 UI 兼容）', () => {
    renderSpelling({ continuous: false });
    expect(screen.getByRole('button', { name: /^提交$/ })).toBeInTheDocument();
  });
});

describe('OverlayApp — 连续模式快捷键（Issue #8）', () => {
  it('连续模式 Escape 触发 exit-learning', () => {
    const onAction = renderOverlayContinuous({ kind: 'question', question: QUESTION });
    pressKey('Escape');
    expect(onAction).toHaveBeenCalledWith({ type: 'exit-learning' });
  });

  it('连续模式选择题 Enter 触发 submit-and-continue', () => {
    const onAction = renderOverlayContinuous({ kind: 'question', question: QUESTION });
    pressKey('1');
    pressKey('Enter');
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
