import type { CardStage, QuestionType } from '@/types';

/**
 * 根据学习阶段选择题型。
 *
 * - short-term / self-reported-known：en-to-zh（首次接触，英文→中文最易）；
 * - long-term（reps 0-1）：zh-to-en（中文→英文，难度提升）；
 * - long-term（reps >= 2）：context-choice（例句语境，难度最高）。
 *
 * 拼写题由连续学习模式单独处理，不由此函数返回。
 */
export function chooseQuestionType(stage: CardStage, schedulerReps?: number): QuestionType {
  if (stage !== 'long-term') {
    return 'en-to-zh';
  }
  const reps = schedulerReps ?? 0;
  if (reps < 2) {
    return 'zh-to-en';
  }
  return 'context-choice';
}
