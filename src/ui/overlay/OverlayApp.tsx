import { useCallback, useState } from 'react';
import type { InteractionOutcome } from '@/types';

export interface HardcodedQuestion {
  prompt: string;
  options: string[];
  correctIndex: number;
}

/** 第一条纵向切片的硬编码选择题；后续 Issue 会替换为真实题目系统。 */
export const HARDCODED_QUESTION: HardcodedQuestion = {
  prompt: 'abandon',
  options: ['建造', '放弃；遗弃', '聚集', '转移'],
  correctIndex: 1,
};

interface OverlayAppProps {
  question: HardcodedQuestion;
  onOutcome: (outcome: InteractionOutcome) => void;
}

/**
 * 学习遮罩 React 应用（M6-02）。单题模式：选项 → 提交 / 跳过。
 * 防止重复提交：提交后立即进入 closed 语义，onOutcome 只触发一次。
 */
export function OverlayApp({ question, onOutcome }: OverlayAppProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = useCallback(() => {
    if (selected === null || submitted) return;
    setSubmitted(true);
    onOutcome('submitted');
  }, [selected, submitted, onOutcome]);

  const handleSkip = useCallback(() => {
    if (submitted) return;
    setSubmitted(true);
    onOutcome('skipped');
  }, [submitted, onOutcome]);

  return (
    <div className="bingeup-overlay" role="dialog" aria-label="单词学习">
      <div className="bingeup-card">
        <div className="bingeup-prompt">{question.prompt}</div>
        <div className="bingeup-options">
          {question.options.map((option, idx) => (
            <button
              key={idx}
              type="button"
              className={`bingeup-option ${selected === idx ? 'selected' : ''}`}
              onClick={() => !submitted && setSelected(idx)}
              disabled={submitted}
            >
              <span className="bingeup-option-key">{String.fromCharCode(65 + idx)}</span>
              <span className="bingeup-option-text">{option}</span>
            </button>
          ))}
        </div>
        <div className="bingeup-actions">
          <button
            type="button"
            className="bingeup-submit"
            onClick={handleSubmit}
            disabled={selected === null || submitted}
          >
            提交
          </button>
          <button type="button" className="bingeup-skip" onClick={handleSkip} disabled={submitted}>
            跳过
          </button>
        </div>
      </div>
    </div>
  );
}
