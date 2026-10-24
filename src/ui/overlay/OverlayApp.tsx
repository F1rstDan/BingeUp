import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button, Card, Input, Tag } from 'animal-island-ui';
import { CheckIcon } from 'naive-icons';
import type { LearningItem, OverlayAction } from '@/types';
import { localSpeech } from '@/ui/speech/local-speech';
import { PronunciationTag, WordSummary } from '@/ui/overlay/WordSummary';

export type { OverlayAction };

/** 快捷键提示：按钮内的装饰性提示，用原版令牌着色，不覆盖按钮组件样式。 */
function KeyHint({ children }: { children: string }) {
  return <span className="bingeup-key-hint">{children}</span>;
}

interface OverlayAppProps {
  item: LearningItem;
  onAction: (action: OverlayAction) => unknown | Promise<unknown>;
  /** 是否处于连续学习模式。 */
  isContinuous?: boolean;
}

/**
 * 学习遮罩 React 应用（Issue #6 / #7 / #8；M5 工单 #44 原版视觉迁移）。
 *
 * 渲染在 OverlayController 的 ShadowRoot 内，使用 animal-island-ui 的原版
 * Card/Button/Input/Tag 与 --animal-* 令牌；自定义外壳只负责布局与令牌着色，
 * 不覆盖库组件的颜色、圆角或阴影。
 *
 * 单题模式：根据 LearningItem 渲染新词展示或题目。
 * - 新词展示：词形、释义、例句 + "学到了"/"我认识，换一个"/"跳过"；
 * - 题目：选择或输入答案，再提交；结果由控制器关闭当前题卡后以独立非模态提示展示。
 * - 快捷键仅在组件挂载期间生效（document 级监听，卸载即移除）。
 *
 * 连续学习模式（Issue #8）：
 * - 选择题/拼写题动作固定为"跳过" + "提交并继续" + "提交并结束"；
 * - 新词展示动作变为"学到了，继续" / "我认识，换一个" + "结束学习"；
 * - "跳过"不提交当前题；"提交并结束"提交当前题并按完成处理。
 *
 * 所有动作均锁定当前界面，防止保存期间改答、跳过或重复提交。
 * Enter 单题提交或连续提交并结束；Shift + Enter 始终提交并继续。
 */
export function OverlayApp({ item, onAction, isContinuous }: OverlayAppProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [spelledAnswer, setSpelledAnswer] = useState('');
  const [answerChanges, setAnswerChanges] = useState(0);
  const [done, setDone] = useState(false);
  const actionLockedRef = useRef(false);
  const startTimeRef = useRef<number>(Date.now());
  const spellingInputRef = useRef<HTMLDivElement | null>(null);
  const ownerId = useId();

  /** 终态动作：禁用所有交互并发出回调。 */
  const fireFinal = useCallback(
    (action: OverlayAction) => {
      if (actionLockedRef.current) return;
      actionLockedRef.current = true;
      localSpeech.stopOwnedBy(ownerId);
      setDone(true);
      onAction(action);
    },
    [onAction, ownerId],
  );

  /** 提交选择或拼写答案，控制器负责关闭当前界面与后续学习。 */
  const doSubmit = useCallback(
    (continueLearning = false) => {
      if (actionLockedRef.current) return;
      if (item.kind === 'question' && selected !== null) {
        fireFinal({
          type: continueLearning
            ? 'submit-and-continue'
            : isContinuous
              ? 'submit-and-end'
              : 'submit-answer',
          question: item.question,
          selectedIndex: selected,
          responseTimeMs: Date.now() - startTimeRef.current,
          answerChanges,
        });
      } else if (item.kind === 'spelling-question' && spelledAnswer.trim() !== '') {
        fireFinal({
          type: continueLearning
            ? 'submit-spelling-and-continue'
            : isContinuous
              ? 'submit-spelling-and-end'
              : 'submit-spelling',
          question: item.question,
          spelledAnswer,
          responseTimeMs: Date.now() - startTimeRef.current,
          answerChanges,
        });
      }
    },
    [item, selected, spelledAnswer, isContinuous, fireFinal, answerChanges],
  );

  const selectAnswer = useCallback((index: number) => {
    if (actionLockedRef.current) return;
    setSelected((current) => {
      if (current !== null && current !== index) setAnswerChanges((count) => count + 1);
      return index;
    });
  }, []);

  const changeSpellingAnswer = useCallback((next: string) => {
    if (actionLockedRef.current) return;
    setSpelledAnswer((current) => {
      if (current !== '' && (next.length < current.length || !next.startsWith(current))) {
        setAnswerChanges((count) => count + 1);
      }
      return next;
    });
  }, []);

  // ─── 拼写题自动聚焦输入框（库 Input 不转发 ref，聚焦其内部 input） ──
  useEffect(() => {
    if (item.kind === 'spelling-question' && !done) {
      spellingInputRef.current?.querySelector('input')?.focus();
    }
  }, [item, done]);

  // ─── 键盘快捷键（仅学习界面生效） ────────────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (actionLockedRef.current) return;
      const key = e.key;

      if (item.kind === 'new-word-presentation') {
        if (isContinuous) {
          // 连续模式新词展示
          if (key === '1') {
            fireFinal({ type: 'accept-new-word-and-continue', wordId: item.presentation.word.id });
          } else if (key === '2') {
            fireFinal({ type: 'self-report-and-continue', wordId: item.presentation.word.id });
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

      if (key === 'Enter') {
        e.preventDefault();
        doSubmit(e.shiftKey);
        return;
      }
      if (key === 'Escape') {
        fireFinal({ type: 'skip' });
        return;
      }
      if (item.kind === 'spelling-question') return;

      // 选择题：数字键选择答案，不干预拼写输入。
      if (key >= '1' && key <= '4') {
        const idx = parseInt(key, 10) - 1;
        if (idx < item.question.options.length) {
          selectAnswer(idx);
        }
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [item, isContinuous, fireFinal, doSubmit, selectAnswer]);

  // ─── 新词展示 ──────────────────────────────────────────────
  if (item.kind === 'new-word-presentation') {
    const { word } = item.presentation;
    return (
      <div className="bingeup-overlay" role="dialog" aria-label="单词学习">
        <Card className="bingeup-card">
          <div className="bingeup-new-word">
            {isContinuous && (
              <div className="bingeup-new-word-badge">
                <Tag size="small">连续学习</Tag>
              </div>
            )}
            <WordSummary
              ownerId={ownerId}
              data={{
                word: word.word,
                phonetic: word.phonetic,
                partOfSpeech: word.partOfSpeech,
                meanings: word.coreMeaningZh,
                exampleSentence: word.exampleSentence,
                exampleTranslation: word.exampleTranslation,
                secondaryMeanings: word.secondaryMeanings,
              }}
              wordClassName="bingeup-prompt"
              disabled={done}
            />
          </div>
          <div className="bingeup-actions bingeup-actions-new-word">
            {isContinuous ? (
              <>
                <Button
                  type="primary"
                  onClick={() =>
                    fireFinal({ type: 'accept-new-word-and-continue', wordId: word.id })
                  }
                  disabled={done}
                >
                  学到了，继续 <KeyHint>1</KeyHint>
                </Button>
                <Button
                  onClick={() => fireFinal({ type: 'self-report-and-continue', wordId: word.id })}
                  disabled={done}
                >
                  我认识，换一个 <KeyHint>2</KeyHint>
                </Button>
                <Button onClick={() => fireFinal({ type: 'exit-learning' })} disabled={done}>
                  结束学习 <KeyHint>Esc</KeyHint>
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="primary"
                  onClick={() => fireFinal({ type: 'accept-new-word', wordId: word.id })}
                  disabled={done}
                >
                  学到了 <KeyHint>1</KeyHint>
                </Button>
                <Button
                  onClick={() => fireFinal({ type: 'self-report', wordId: word.id })}
                  disabled={done}
                >
                  我认识，换一个 <KeyHint>2</KeyHint>
                </Button>
                <Button onClick={() => fireFinal({ type: 'skip' })} disabled={done}>
                  跳过 <KeyHint>3</KeyHint>
                </Button>
              </>
            )}
          </div>
        </Card>
      </div>
    );
  }

  // ─── 选择与拼写题 ──────────────────────────────────────────
  const { question } = item;
  const spellingHint = item.kind === 'spelling-question' ? item.question.hint : undefined;
  const promptLang =
    question.type === 'en-to-zh' || question.type === 'context-choice' ? 'en' : 'zh-CN';
  const canSubmit =
    item.kind === 'spelling-question' ? spelledAnswer.trim() !== '' : selected !== null;

  return (
    <div
      className="bingeup-overlay"
      role="dialog"
      aria-label={item.kind === 'spelling-question' ? '单词拼写' : '单词学习'}
    >
      <Card className="bingeup-card">
        {isContinuous && (
          <div className="bingeup-continuous-badge">
            <Tag size="small">连续学习</Tag>
          </div>
        )}
        <div className="bingeup-prompt" lang={promptLang}>
          {question.prompt}
        </div>
        {question.explanation.phonetic && (
          <div className="bingeup-question-pronunciation">
            <PronunciationTag
              ownerId={ownerId}
              wordText={question.explanation.word}
              phonetic={question.explanation.phonetic}
              disabled={done}
            />
          </div>
        )}
        {item.kind === 'spelling-question' ? (
          <>
            {spellingHint && (
              <div className="bingeup-spelling-hint" onKeyDown={(event) => event.stopPropagation()}>
                {spellingHint.exampleSentence && (
                  <p className="bingeup-spelling-example" lang="en">
                    {spellingHint.exampleSentence}
                  </p>
                )}
                <p className="bingeup-spelling-meta">
                  首字母 {spellingHint.prefix} · {spellingHint.letterCount} 个字母 · 请写出词典形式
                </p>
              </div>
            )}
            <div className="bingeup-phonetic">请输入英文单词</div>
            <div className="bingeup-spelling-field" ref={spellingInputRef}>
              <Input
                size="large"
                value={spelledAnswer}
                onChange={(e) => changeSpellingAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (actionLockedRef.current) return;
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    doSubmit(e.shiftKey);
                  }
                }}
                placeholder="输入单词..."
                disabled={done}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
          </>
        ) : (
          <div className="bingeup-options" role="group" aria-label="选项">
            {item.question.options.map((option, idx) => {
              const selectedOption = selected === idx;
              return (
                <button
                  key={idx}
                  type="button"
                  className={`bingeup-option${selectedOption ? ' bingeup-option--selected' : ''}`}
                  aria-pressed={selectedOption}
                  onClick={() => selectAnswer(idx)}
                  disabled={done}
                >
                  <span className="bingeup-option-key" aria-hidden="true">
                    {idx + 1}
                  </span>
                  <span className="bingeup-option-text">{option}</span>
                  {selectedOption && <CheckIcon className="bingeup-option-icon" size={18} />}
                </button>
              );
            })}
          </div>
        )}

        <div
          className="bingeup-actions bingeup-question-actions"
          role="group"
          aria-label="题目操作"
        >
          <Button onClick={() => fireFinal({ type: 'skip' })} disabled={done}>
            跳过 <KeyHint>Esc</KeyHint>
          </Button>
          <Button onClick={() => doSubmit(true)} disabled={!canSubmit || done}>
            提交并继续 <KeyHint>Shift + Enter</KeyHint>
          </Button>
          <Button type="primary" onClick={() => doSubmit()} disabled={!canSubmit || done}>
            {isContinuous ? '提交并结束' : '提交'} <KeyHint>Enter</KeyHint>
          </Button>
        </div>
      </Card>
    </div>
  );
}
