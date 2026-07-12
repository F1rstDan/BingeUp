import { useCallback, useEffect, useRef, useState } from 'react';
import type { LearningItem, OverlayAction, Question, SubmissionResult } from '@/types';

export type { OverlayAction };

interface OverlayAppProps {
  item: LearningItem;
  onAction: (action: OverlayAction) => void;
  /** 连续学习模式：上一题的提交反馈，在下一题上方展示（Issue #8 验收标准 2）。 */
  previousFeedback?: SubmissionResult;
  /** 上一题的题目（用于反馈区展示题干与正确答案）。 */
  previousQuestion?: Question;
  /** 是否处于连续学习模式。 */
  isContinuous?: boolean;
}

/**
 * 学习遮罩 React 应用（Issue #6 / #7 / #8）。
 *
 * 单题模式：根据 LearningItem 渲染新词展示或题目。
 * - 新词展示：词形、释义、例句 + "知道了"/"我认识，换一个"/"跳过"；
 * - 题目：选项 → 提交 → 反馈（正确性 + 学习信息）→ 继续；
 * - 快捷键仅在组件挂载期间生效（document 级监听，卸载即移除）。
 *
 * 连续学习模式（Issue #8）：
 * - 顶部展示上一题的无障碍反馈（文字 + 图标，不仅依赖颜色）；
 * - 选择题/拼写题动作固定为"跳过" + "提交并继续" + "提交并结束"；
 * - 新词展示动作变为"知道了，继续" / "我认识，换一个" + "结束学习"；
 * - "跳过"不提交当前题；"提交并结束"提交当前题并按完成处理。
 *
 * 状态流转：
 * - submit-answer / submit-spelling 是"软"动作：发出回调 + 进入反馈阶段；
 * - submit-and-continue / submit-spelling-and-continue：提交并加载下一题；
 * - submit-and-end / submit-spelling-and-end：提交并关闭连续学习；
 * - accept-new-word / self-report / skip / exit-learning 是"终态"动作。
 */
export function OverlayApp({
  item,
  onAction,
  previousFeedback,
  previousQuestion,
  isContinuous,
}: OverlayAppProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [spelledAnswer, setSpelledAnswer] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);
  const [done, setDone] = useState(false);
  const startTimeRef = useRef<number>(Date.now());
  const spellingInputRef = useRef<HTMLInputElement | null>(null);

  /** 终态动作：禁用所有交互并发出回调。 */
  const fireFinal = useCallback(
    (action: OverlayAction) => {
      if (done) return;
      setDone(true);
      onAction(action);
    },
    [done, onAction],
  );

  /** 提交选择题答案：发出 submit-answer 回调，进入反馈阶段（不禁用"继续"）。 */
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

  /** 提交拼写题答案：发出 submit-spelling 回调，进入反馈阶段。 */
  const doSubmitSpelling = useCallback(() => {
    if (item.kind !== 'spelling-question' || spelledAnswer.trim() === '' || submitted || done) return;
    setSubmitted(true);
    onAction({
      type: 'submit-spelling',
      question: item.question,
      spelledAnswer: spelledAnswer,
      responseTimeMs: Date.now() - startTimeRef.current,
    });
  }, [item, spelledAnswer, submitted, done, onAction]);

  /** 提交选择题并继续：提交并加载下一题，防止重复触发。 */
  const doSubmitAndContinue = useCallback(() => {
    if (item.kind !== 'question' || selected === null || done) return;
    setDone(true);
    onAction({
      type: 'submit-and-continue',
      question: item.question,
      selectedIndex: selected,
      responseTimeMs: Date.now() - startTimeRef.current,
    });
  }, [item, selected, done, onAction]);

  /** 提交拼写题并继续。 */
  const doSubmitSpellingAndContinue = useCallback(() => {
    if (item.kind !== 'spelling-question' || spelledAnswer.trim() === '' || done) return;
    setDone(true);
    onAction({
      type: 'submit-spelling-and-continue',
      question: item.question,
      spelledAnswer: spelledAnswer,
      responseTimeMs: Date.now() - startTimeRef.current,
    });
  }, [item, spelledAnswer, done, onAction]);

  /** 连续学习中提交拼写题并结束当前交互。 */
  const doSubmitSpellingAndEnd = useCallback(() => {
    if (item.kind !== 'spelling-question' || spelledAnswer.trim() === '' || done) return;
    setDone(true);
    onAction({
      type: 'submit-spelling-and-end',
      question: item.question,
      spelledAnswer,
      responseTimeMs: Date.now() - startTimeRef.current,
    });
  }, [item, spelledAnswer, done, onAction]);

  /** 连续学习中提交选择题并结束当前交互。 */
  const doSubmitAndEnd = useCallback(() => {
    if (item.kind !== 'question' || selected === null || done) return;
    setDone(true);
    onAction({
      type: 'submit-and-end',
      question: item.question,
      selectedIndex: selected,
      responseTimeMs: Date.now() - startTimeRef.current,
    });
  }, [item, selected, done, onAction]);

  // ─── 拼写题自动聚焦输入框 ──────────────────────────────────
  useEffect(() => {
    if (item.kind === 'spelling-question' && !submitted && !done) {
      spellingInputRef.current?.focus();
    }
  }, [item, submitted, done]);

  // ─── 键盘快捷键（仅学习界面生效） ────────────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (done) return;
      const key = e.key;

      if (item.kind === 'new-word-presentation') {
        if (isContinuous) {
          // 连续模式新词展示
          if (key === '1') {
            onAction({ type: 'accept-new-word-and-continue', wordId: item.presentation.word.id });
          } else if (key === '2') {
            onAction({ type: 'self-report-and-continue', wordId: item.presentation.word.id });
          } else if (key === 'Escape') {
            fireFinal({ type: 'exit-learning' });
          }
          return;
        }
        if (key === '1') {
          fireFinal({ type: 'accept-new-word', wordId: item.presentation.word.id });
        } else if (key === '2') {
          fireFinal({ type: 'self-report', wordId: item.presentation.word.id });
        } else if (key === '3' || key === 'Escape') {
          fireFinal({ type: 'skip' });
        }
        return;
      }

      // 拼写题
      if (item.kind === 'spelling-question') {
        if (submitted) {
          // 反馈阶段
          if (key === 'Escape' || (key === 'Enter' && !e.shiftKey)) {
            e.preventDefault();
            fireFinal({ type: 'skip' });
          } else if (key === 'Enter' && e.shiftKey) {
            e.preventDefault();
            doSubmitSpellingAndContinue();
          }
          return;
        }
        // 输入阶段：Enter 提交
        if (key === 'Enter' && spelledAnswer.trim() !== '') {
          e.preventDefault();
          if (isContinuous) {
            if (e.shiftKey) {
              doSubmitSpellingAndContinue();
            } else {
              doSubmitSpellingAndEnd();
            }
          } else {
            doSubmitSpelling();
          }
        } else if (isContinuous && key === 'Escape') {
          fireFinal({ type: 'skip' });
        }
        return;
      }

      // 选择题
      if (submitted) {
        // 反馈阶段
        if (key === 'Escape' || (key === 'Enter' && !e.shiftKey)) {
          e.preventDefault();
          fireFinal({ type: 'skip' });
        } else if (key === 'Enter' && e.shiftKey) {
          e.preventDefault();
          doSubmitAndContinue();
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
          e.preventDefault();
          if (isContinuous) {
            if (e.shiftKey) {
              doSubmitAndContinue();
            } else {
              doSubmitAndEnd();
            }
          } else if (e.shiftKey) {
            doSubmitAndContinue();
          } else {
            doSubmit();
          }
        }
      } else if (key === 'Escape') {
        fireFinal({ type: 'skip' });
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [item, submitted, selected, done, isContinuous, spelledAnswer, fireFinal, doSubmit, doSubmitSpelling, doSubmitAndContinue, doSubmitSpellingAndContinue, doSubmitAndEnd, doSubmitSpellingAndEnd, onAction]);

  // ─── 上一题反馈区（连续模式，验收标准 2：无障碍反馈） ──────────
  const renderPreviousFeedback = () => {
    if (!isContinuous || !previousFeedback) return null;
    const isCorrect = previousFeedback.isCorrect;
    return (
      <div
        className={`bingeup-previous-feedback ${isCorrect ? 'correct' : 'wrong'}`}
        role="status"
        aria-label={`上一题${isCorrect ? '答对' : '答错'}`}
      >
        <div className="bingeup-previous-feedback-title">上一题反馈</div>
        {previousQuestion && (
          <div className="bingeup-previous-feedback-prompt">{previousQuestion.prompt}</div>
        )}
        <div className={`bingeup-previous-feedback-result ${isCorrect ? 'correct' : 'wrong'}`}>
          <span className={`bingeup-feedback-icon ${isCorrect ? 'correct' : 'wrong'}`} aria-hidden="true">
            {isCorrect ? '✓' : '✗'}
          </span>
          {isCorrect ? '答对了' : '答错了'}
        </div>
        <div className="bingeup-previous-feedback-answer">
          正确答案：<span className="correct-answer">{previousFeedback.correctAnswer}</span>
        </div>
      </div>
    );
  };

  const renderExplanation = (question: Question) => (
    <div className="bingeup-explanation">
      {question.explanation.phonetic && (
        <div className="bingeup-explanation-phonetic">{question.explanation.phonetic}</div>
      )}
      <div className="bingeup-explanation-pos">{question.explanation.partOfSpeech.join(' ')}</div>
      <div className="bingeup-explanation-meanings">{question.explanation.meanings.join('；')}</div>
      {question.explanation.exampleSentence && (
        <div className="bingeup-explanation-example">{question.explanation.exampleSentence}</div>
      )}
      {question.explanation.exampleTranslation && (
        <div className="bingeup-explanation-example-translation">
          {question.explanation.exampleTranslation}
        </div>
      )}
    </div>
  );

  // ─── 新词展示 ──────────────────────────────────────────────
  if (item.kind === 'new-word-presentation') {
    const { word } = item.presentation;
    return (
      <div className="bingeup-overlay" role="dialog" aria-label="单词学习">
        <div className="bingeup-card">
          {isContinuous && <div className="bingeup-continuous-badge">连续学习</div>}
          {renderPreviousFeedback()}
          <div className="bingeup-new-word">
            <div className="bingeup-prompt">{word.word}</div>
            {word.phonetic && <div className="bingeup-phonetic">{word.phonetic}</div>}
            <div className="bingeup-meaning">{word.coreMeaningZh.join('；')}</div>
            <div className="bingeup-example">{word.exampleSentence}</div>
            <div className="bingeup-example-translation">{word.exampleTranslation}</div>
          </div>
          <div className="bingeup-actions bingeup-actions-new-word">
            {isContinuous ? (
              <>
                <button
                  type="button"
                  className="bingeup-accept"
                  onClick={() => onAction({ type: 'accept-new-word-and-continue', wordId: word.id })}
                  disabled={done}
                >
                  知道了，继续 <span className="bingeup-key-hint">1</span>
                </button>
                <button
                  type="button"
                  className="bingeup-self-report"
                  onClick={() => onAction({ type: 'self-report-and-continue', wordId: word.id })}
                  disabled={done}
                >
                  我认识，换一个 <span className="bingeup-key-hint">2</span>
                </button>
                <button
                  type="button"
                  className="bingeup-exit"
                  onClick={() => fireFinal({ type: 'exit-learning' })}
                  disabled={done}
                >
                  结束学习 <span className="bingeup-key-hint">Esc</span>
                </button>
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── 拼写题（仅连续模式） ──────────────────────────────────
  if (item.kind === 'spelling-question') {
    const { question } = item;
    const normalizedSpelled = spelledAnswer.trim().toLowerCase();
    const normalizedCorrect = question.correctAnswer.trim().toLowerCase();
    const acceptable = (question.acceptableAnswers ?? []).map((a) => a.trim().toLowerCase());
    const isCorrect =
      submitted &&
      (normalizedSpelled === normalizedCorrect || acceptable.includes(normalizedSpelled));
    return (
      <div className="bingeup-overlay" role="dialog" aria-label="单词拼写">
        <div className="bingeup-card">
          {isContinuous && <div className="bingeup-continuous-badge">连续学习</div>}
          {renderPreviousFeedback()}
          <div className="bingeup-prompt">{question.prompt}</div>
          <div className="bingeup-phonetic">请输入英文单词</div>
          <input
            ref={spellingInputRef}
            type="text"
            className="bingeup-spelling-input"
            value={spelledAnswer}
            onChange={(e) => setSpelledAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && spelledAnswer.trim() !== '' && !submitted && !done) {
                e.preventDefault();
                e.stopPropagation();
                if (isContinuous) {
                  if (e.shiftKey) {
                    doSubmitSpellingAndContinue();
                  } else {
                    doSubmitSpellingAndEnd();
                  }
                } else {
                  doSubmitSpelling();
                }
              }
            }}
            placeholder="输入单词..."
            disabled={submitted || done}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />

          {submitted ? (
            <div className="bingeup-feedback">
              <div className={`bingeup-feedback-result ${isCorrect ? 'correct' : 'wrong'}`}>
                <span className={`bingeup-feedback-icon ${isCorrect ? 'correct' : 'wrong'}`} aria-hidden="true">
                  {isCorrect ? '✓' : '✗'}
                </span>
                {isCorrect ? '答对了' : '答错了'}
              </div>
              {!isCorrect && (
                <div className="bingeup-feedback-answer">
                  正确答案：<span className="correct-answer">{question.correctAnswer}</span>
                </div>
              )}
              {isCorrect ? (
                <>
                  <button
                    type="button"
                    className="bingeup-explanation-toggle"
                    onClick={() => setShowExplanation((s) => !s)}
                  >
                    {showExplanation ? '收起' : '学习信息'}
                  </button>
                  {showExplanation && renderExplanation(question)}
                </>
              ) : (
                renderExplanation(question)
              )}
              {isContinuous && (
                <div className="bingeup-actions bingeup-question-actions" role="group" aria-label="题目操作">
                  <button
                    type="button"
                    className="bingeup-skip"
                    onClick={() => fireFinal({ type: 'skip' })}
                    disabled={done}
                  >
                    跳过 <span className="bingeup-key-hint">Esc</span>
                  </button>
                  <button
                    type="button"
                    className="bingeup-continue"
                    onClick={doSubmitSpellingAndContinue}
                    disabled={done}
                  >
                    继续 <span className="bingeup-key-hint">Shift + Enter</span>
                  </button>
                  <button
                    type="button"
                    className="bingeup-submit"
                    onClick={() => fireFinal({ type: 'skip' })}
                    disabled={done}
                  >
                    明白了 <span className="bingeup-key-hint">Enter</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className={`bingeup-actions${isContinuous ? ' bingeup-question-actions' : ''}`} role={isContinuous ? 'group' : undefined} aria-label={isContinuous ? '题目操作' : undefined}>
              {isContinuous ? (
                <>
                  <button
                    type="button"
                    className="bingeup-skip"
                    onClick={() => fireFinal({ type: 'skip' })}
                    disabled={done}
                  >
                    跳过 <span className="bingeup-key-hint">Esc</span>
                  </button>
                  <button
                    type="button"
                    className="bingeup-continue"
                    onClick={doSubmitSpellingAndContinue}
                    disabled={spelledAnswer.trim() === '' || done}
                  >
                    提交并继续 <span className="bingeup-key-hint">Shift + Enter</span>
                  </button>
                  <button
                    type="button"
                    className="bingeup-exit"
                    onClick={doSubmitSpellingAndEnd}
                    disabled={spelledAnswer.trim() === '' || done}
                  >
                    提交并结束 <span className="bingeup-key-hint">Enter</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="bingeup-submit"
                  onClick={doSubmitSpelling}
                  disabled={spelledAnswer.trim() === '' || done}
                >
                  提交
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── 选择题 ──────────────────────────────────────────────────
  const { question } = item;
  const isCorrect = submitted && selected === question.correctIndex;

  return (
    <div className="bingeup-overlay" role="dialog" aria-label="单词学习">
      <div className="bingeup-card">
        {isContinuous && <div className="bingeup-continuous-badge">连续学习</div>}
        {renderPreviousFeedback()}
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
              <span className={`bingeup-feedback-icon ${isCorrect ? 'correct' : 'wrong'}`} aria-hidden="true">
                {isCorrect ? '✓' : '✗'}
              </span>
              {isCorrect ? '答对了' : '答错了'}
            </div>
            {!isCorrect && (
              <div className="bingeup-feedback-answer">
                正确答案：<span className="correct-answer">{question.options[question.correctIndex]}</span>
              </div>
            )}
            {isCorrect ? (
              <>
                <button
                  type="button"
                  className="bingeup-explanation-toggle"
                  onClick={() => setShowExplanation((s) => !s)}
                >
                  {showExplanation ? '收起' : '学习信息'}
                </button>
                {showExplanation && renderExplanation(question)}
              </>
            ) : (
              renderExplanation(question)
            )}
            <div
              className={`bingeup-actions${isContinuous || !isCorrect ? ' bingeup-question-actions' : ''}`}
              role="group"
              aria-label="题目操作"
            >
              {isContinuous ? (
                <>
                  <button
                    type="button"
                    className="bingeup-skip"
                    onClick={() => fireFinal({ type: 'skip' })}
                    disabled={done}
                  >
                    跳过 <span className="bingeup-key-hint">Esc</span>
                  </button>
                  <button
                    type="button"
                    className="bingeup-continue"
                    onClick={doSubmitAndContinue}
                    disabled={done}
                  >
                    继续 <span className="bingeup-key-hint">Shift + Enter</span>
                  </button>
                  <button
                    type="button"
                    className="bingeup-submit"
                    onClick={() => fireFinal({ type: 'skip' })}
                    disabled={done}
                  >
                    明白了 <span className="bingeup-key-hint">Enter</span>
                  </button>
                </>
              ) : isCorrect ? (
                <>
                  <button
                    type="button"
                    className="bingeup-continue"
                    onClick={() => fireFinal({ type: 'skip' })}
                    disabled={done}
                  >
                    继续 <span className="bingeup-key-hint">Enter</span>
                  </button>
                  <button
                    type="button"
                    className="bingeup-submit"
                    onClick={doSubmitAndContinue}
                    disabled={done}
                  >
                    提交并继续 <span className="bingeup-key-hint">Shift + Enter</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="bingeup-skip"
                    onClick={() => fireFinal({ type: 'skip' })}
                    disabled={done}
                  >
                    跳过 <span className="bingeup-key-hint">Esc</span>
                  </button>
                  <button
                    type="button"
                    className="bingeup-continue"
                    onClick={doSubmitAndContinue}
                    disabled={done}
                  >
                    继续 <span className="bingeup-key-hint">Shift + Enter</span>
                  </button>
                  <button
                    type="button"
                    className="bingeup-submit"
                    onClick={() => fireFinal({ type: 'skip' })}
                    disabled={done}
                  >
                    明白了 <span className="bingeup-key-hint">Enter</span>
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div
            className="bingeup-actions bingeup-question-actions"
            role="group"
            aria-label="题目操作"
          >
            {isContinuous ? (
              <>
                <button
                  type="button"
                  className="bingeup-skip"
                  onClick={() => fireFinal({ type: 'skip' })}
                  disabled={done}
                >
                  跳过 <span className="bingeup-key-hint">Esc</span>
                </button>
                <button
                  type="button"
                  className="bingeup-continue"
                  onClick={doSubmitAndContinue}
                  disabled={selected === null || done}
                >
                  提交并继续 <span className="bingeup-key-hint">Shift + Enter</span>
                </button>
                <button
                  type="button"
                  className="bingeup-exit"
                  onClick={doSubmitAndEnd}
                  disabled={selected === null || done}
                >
                  提交并结束 <span className="bingeup-key-hint">Enter</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="bingeup-skip"
                  onClick={() => fireFinal({ type: 'skip' })}
                  disabled={done}
                >
                  跳过 <span className="bingeup-key-hint">Esc</span>
                </button>
                <button
                  type="button"
                  className="bingeup-continue"
                  onClick={doSubmitAndContinue}
                  disabled={selected === null || done}
                >
                  提交并继续 <span className="bingeup-key-hint">Shift + Enter</span>
                </button>
                <button
                  type="button"
                  className="bingeup-submit"
                  onClick={doSubmit}
                  disabled={selected === null || done}
                >
                  提交 <span className="bingeup-key-hint">Enter</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
