import { useCallback, useEffect, useRef, useState } from 'react';
import type { LearningItem, OverlayAction } from '@/types';

export type { OverlayAction };

interface OverlayAppProps {
  item: LearningItem;
  onAction: (action: OverlayAction) => void;
}

/**
 * 学习遮罩 React 应用（Issue #6）。
 *
 * 单题模式：根据 LearningItem 渲染新词展示或题目。
 * - 新词展示：词形、释义、例句 + "知道了"/"我认识，换一个"/"跳过"；
 * - 题目：选项 → 提交 → 可展开反馈（正确性 + 学习信息）→ 继续；
 * - 快捷键仅在组件挂载期间生效（document 级监听，卸载即移除）。
 *
 * 状态流转：
 * - submit-answer 是"软"动作：发出回调 + 进入反馈阶段（submitted=true），不禁用"继续"；
 * - accept-new-word / self-report / skip 是"终态"动作：发出回调 + 禁用所有交互（done=true）。
 */
export function OverlayApp({ item, onAction }: OverlayAppProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);
  const [done, setDone] = useState(false);
  const startTimeRef = useRef<number>(Date.now());

  /** 终态动作：禁用所有交互并发出回调。 */
  const fireFinal = useCallback(
    (action: OverlayAction) => {
      if (done) return;
      setDone(true);
      onAction(action);
    },
    [done, onAction],
  );

  /** 提交答案：发出 submit-answer 回调，进入反馈阶段（不禁用"继续"）。 */
  const doSubmit = useCallback(() => {
    if (item.kind !== 'question' || selected === null || submitted || done) return;
    setSubmitted(true);
    onAction({
      type: 'submit-answer',
      question: item.question,
      selectedIndex: selected,
      responseTimeMs: Date.now() - startTimeRef.current,
    });
  }, [item, selected, submitted, done, onAction]);

  // ─── 键盘快捷键（仅学习界面生效） ────────────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (done) return;
      const key = e.key;

      if (item.kind === 'new-word-presentation') {
        if (key === '1') {
          fireFinal({ type: 'accept-new-word', wordId: item.presentation.word.id });
        } else if (key === '2') {
          fireFinal({ type: 'self-report', wordId: item.presentation.word.id });
        } else if (key === '3' || key === 'Escape') {
          fireFinal({ type: 'skip' });
        }
        return;
      }

      // 题目模式
      if (submitted) {
        // 反馈阶段：Enter 继续
        if (key === 'Enter') {
          fireFinal({ type: 'skip' });
        }
        return;
      }

      // 答题阶段
      if (key >= '1' && key <= '4') {
        const idx = parseInt(key, 10) - 1;
        if (idx < item.question.options.length) {
          setSelected(idx);
        }
      } else if (key.match(/^[a-dA-D]$/)) {
        const idx = key.toLowerCase().charCodeAt(0) - 97;
        if (idx < item.question.options.length) {
          setSelected(idx);
        }
      } else if (key === 'Enter') {
        if (selected !== null) {
          doSubmit();
        }
      } else if (key === 'Escape') {
        fireFinal({ type: 'skip' });
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [item, submitted, selected, done, fireFinal, doSubmit]);

  // ─── 新词展示 ──────────────────────────────────────────────
  if (item.kind === 'new-word-presentation') {
    const { word } = item.presentation;
    return (
      <div className="bingeup-overlay" role="dialog" aria-label="单词学习">
        <div className="bingeup-card">
          <div className="bingeup-new-word">
            <div className="bingeup-prompt">{word.word}</div>
            {word.phonetic && <div className="bingeup-phonetic">{word.phonetic}</div>}
            <div className="bingeup-meaning">{word.coreMeaningZh.join('；')}</div>
            <div className="bingeup-example">{word.exampleSentence}</div>
            <div className="bingeup-example-translation">{word.exampleTranslation}</div>
          </div>
          <div className="bingeup-actions bingeup-actions-new-word">
            <button
              type="button"
              className="bingeup-accept"
              onClick={() => fireFinal({ type: 'accept-new-word', wordId: word.id })}
              disabled={done}
            >
              知道了 <span className="bingeup-key-hint">1</span>
            </button>
            <button
              type="button"
              className="bingeup-self-report"
              onClick={() => fireFinal({ type: 'self-report', wordId: word.id })}
              disabled={done}
            >
              我认识，换一个 <span className="bingeup-key-hint">2</span>
            </button>
            <button
              type="button"
              className="bingeup-skip"
              onClick={() => fireFinal({ type: 'skip' })}
              disabled={done}
            >
              跳过 <span className="bingeup-key-hint">3</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── 题目 ──────────────────────────────────────────────────
  const { question } = item;
  const isCorrect = submitted && selected === question.correctIndex;

  return (
    <div className="bingeup-overlay" role="dialog" aria-label="单词学习">
      <div className="bingeup-card">
        <div className="bingeup-prompt">{question.prompt}</div>
        <div className="bingeup-options" role="group" aria-label="选项">
          {question.options.map((option, idx) => (
            <button
              key={idx}
              type="button"
              className={`bingeup-option ${selected === idx ? 'selected' : ''} ${
                submitted && idx === question.correctIndex ? 'correct' : ''
              } ${submitted && selected === idx && idx !== question.correctIndex ? 'wrong' : ''}`}
              onClick={() => !submitted && !done && setSelected(idx)}
              disabled={submitted || done}
            >
              <span className="bingeup-option-key">{String.fromCharCode(65 + idx)}</span>
              <span className="bingeup-option-text">{option}</span>
            </button>
          ))}
        </div>

        {submitted ? (
          <div className="bingeup-feedback">
            <div className={`bingeup-feedback-result ${isCorrect ? 'correct' : 'wrong'}`}>
              {isCorrect ? '答对了' : '答错了'}
            </div>
            <button
              type="button"
              className="bingeup-explanation-toggle"
              onClick={() => setShowExplanation((s) => !s)}
            >
              {showExplanation ? '收起' : '学习信息'}
            </button>
            {showExplanation && (
              <div className="bingeup-explanation">
                {question.explanation.phonetic && (
                  <div className="bingeup-explanation-phonetic">
                    {question.explanation.phonetic}
                  </div>
                )}
                <div className="bingeup-explanation-pos">
                  {question.explanation.partOfSpeech.join(' ')}
                </div>
                <div className="bingeup-explanation-meanings">
                  {question.explanation.meanings.join('；')}
                </div>
                {question.explanation.exampleSentence && (
                  <div className="bingeup-explanation-example">
                    {question.explanation.exampleSentence}
                  </div>
                )}
                {question.explanation.exampleTranslation && (
                  <div className="bingeup-explanation-example-translation">
                    {question.explanation.exampleTranslation}
                  </div>
                )}
              </div>
            )}
            <div className="bingeup-actions">
              <button
                type="button"
                className="bingeup-continue"
                onClick={() => fireFinal({ type: 'skip' })}
                disabled={done}
              >
                继续 <span className="bingeup-key-hint">Enter</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="bingeup-actions">
            <button
              type="button"
              className="bingeup-submit"
              onClick={doSubmit}
              disabled={selected === null || done}
            >
              提交
            </button>
            <button
              type="button"
              className="bingeup-skip"
              onClick={() => fireFinal({ type: 'skip' })}
              disabled={done}
            >
              跳过
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
