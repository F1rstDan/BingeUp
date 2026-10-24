import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { Button } from 'animal-island-ui';
import {
  BadgeXIcon,
  Cancel01Icon,
  CheckmarkBadge03Icon,
  MountainIcon,
  ZzzIcon,
} from '@hugeicons/core-free-icons';
import type { StartLearningFailureReason, StartLearningResponse } from '@/messaging/messages';
import type { CorrectionResult, SubmissionResult } from '@/types';
import { HugeIcon } from '@/ui/icons/HugeIcon';
import { localSpeech, useLocalSpeech } from '@/ui/speech/local-speech';
import { WordSummary } from '@/ui/overlay/WordSummary';

export const LEARNING_FEEDBACK_DURATION_MS = 5_000;
export const LEARNING_FEEDBACK_EXIT_DURATION_MS = 0;

const FAILURE_MESSAGES: Record<StartLearningFailureReason, string> = {
  'globally-paused': '学习已暂停，请先恢复学习。',
  'interaction-active': '已有答题窗口，请先完成当前题目。',
  'context-unavailable': '请先打开支持的视频页面。',
  'no-learning-content': '暂时没有可学内容。',
  failed: '暂时无法继续，请重试。',
};

const TOO_EASY_FAILURE_MESSAGE = '暂时无法标记，请重试。';
const TOO_HARD_FAILURE_MESSAGE = '暂时无法标记，请重试。';

// 沿用 animal-island-ui 2.3.0 的 Modal 纸片轮廓；反馈不挂载 Modal 的遮罩、焦点锁与滚动锁。
const FEEDBACK_PAPER_PATH =
  'M0.501,0.005 L0.501,0.005 L0.523,0.005 L0.549,0.006 C0.704,0.01,0.796,0.017,0.825,0.027 L0.827,0.028 C0.872,0.045,0.939,0.044,0.978,0.17 C1,0.254,1,0.365,0.99,0.505 L0.988,0.513 C0.979,0.558,0.971,0.598,0.965,0.633 C0.956,0.689,0.979,0.77,0.964,0.865 C0.953,0.928,0.921,0.966,0.869,0.979 C0.821,0.986,0.773,0.992,0.726,0.995 L0.712,0.996 L0.694,0.997 C0.648,1,0.586,1,0.507,1 L0.501,1 L0.464,1 C0.385,1,0.325,0.998,0.283,0.995 C0.234,0.992,0.184,0.987,0.133,0.979 C0.081,0.966,0.05,0.928,0.039,0.865 C0.023,0.77,0.047,0.689,0.037,0.633 C0.031,0.595,0.023,0.552,0.013,0.505 C-0.006,0.365,-0.002,0.254,0.024,0.17 C0.064,0.045,0.13,0.045,0.174,0.028 L0.175,0.028 C0.204,0.017,0.303,0.009,0.474,0.005 L0.501,0.005';

export interface LearningFeedbackProps {
  result: SubmissionResult;
  onContinue?: () => Promise<StartLearningResponse>;
  onTooEasy?: () => Promise<CorrectionResult>;
  onTooHard?: () => Promise<CorrectionResult>;
  onClose: () => void;
  /** 预览页常驻展示：不自动收起，按钮只用于观察布局。 */
  staticPreview?: boolean;
}

/** 右下角非模态答题反馈；点击反馈后取消自动关闭，不转移焦点或拦截页面快捷键。 */
export function LearningFeedback({
  result,
  onContinue,
  onTooEasy,
  onTooHard,
  onClose,
  staticPreview = false,
}: LearningFeedbackProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [markingTooEasy, setMarkingTooEasy] = useState(false);
  const [tooEasySaved, setTooEasySaved] = useState(false);
  const [markingTooHard, setMarkingTooHard] = useState(false);
  const [tooHardSaved, setTooHardSaved] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [countdownProgress, setCountdownProgress] = useState(staticPreview ? 0.45 : 0);
  const [countdownCancelled, setCountdownCancelled] = useState(false);
  const remainingMs = useRef(LEARNING_FEEDBACK_DURATION_MS);
  const mounted = useRef(false);
  const continuationPending = useRef(false);
  const tooEasyPending = useRef(false);
  const tooHardPending = useRef(false);
  const canMarkTooEasy = result.isCorrect && onTooEasy !== undefined;
  const canMarkTooHard = result.isCorrect && onTooHard !== undefined;
  const ownerId = useId();
  const speech = useLocalSpeech(ownerId);
  const speechBusy =
    speech.state.ownerId === ownerId &&
    (speech.state.status === 'preparing' || speech.state.status === 'speaking');
  const actionsLocked = continuing || markingTooEasy || markingTooHard;
  const { explanation } = result;
  const hasSubmittedAnswer = !result.isCorrect && Boolean(result.submittedAnswer);
  const hasRatingActions = canMarkTooEasy || canMarkTooHard || tooEasySaved || tooHardSaved;
  const hasFlowActions = onContinue !== undefined;
  const hasActions = hasRatingActions || hasFlowActions;

  const dismiss = (): void => {
    if (staticPreview) return;
    if (!continuationPending.current && !tooEasyPending.current && !tooHardPending.current) {
      localSpeech.stopOwnedBy(ownerId);
      setExiting(true);
    }
  };

  const cancelAutoClose = (): void => {
    if (staticPreview || countdownCancelled) return;
    setCountdownCancelled(true);
    setCountdownProgress(0);
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      localSpeech.stopOwnedBy(ownerId);
    };
  }, [ownerId]);

  useEffect(() => {
    if (staticPreview || countdownCancelled) return;
    if (
      hovered ||
      focused ||
      continuing ||
      markingTooEasy ||
      markingTooHard ||
      speechBusy ||
      exiting ||
      failure !== null
    )
      return;

    const startedAt = Date.now();
    const startingRemaining = remainingMs.current;
    setCountdownProgress(1 - startingRemaining / LEARNING_FEEDBACK_DURATION_MS);
    const interval = window.setInterval(() => {
      const remaining = Math.max(0, startingRemaining - (Date.now() - startedAt));
      setCountdownProgress(1 - remaining / LEARNING_FEEDBACK_DURATION_MS);
    }, 50);
    const timer = window.setTimeout(() => setExiting(true), remainingMs.current);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timer);
      remainingMs.current = Math.max(0, remainingMs.current - (Date.now() - startedAt));
    };
  }, [
    hovered,
    focused,
    continuing,
    markingTooEasy,
    markingTooHard,
    speechBusy,
    exiting,
    failure,
    staticPreview,
    countdownCancelled,
  ]);

  useEffect(() => {
    if (!exiting) return;

    const timer = window.setTimeout(onClose, LEARNING_FEEDBACK_EXIT_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [exiting, onClose]);

  const continueLearning = async (): Promise<void> => {
    if (staticPreview) return;
    if (
      !onContinue ||
      continuationPending.current ||
      tooEasyPending.current ||
      tooHardPending.current ||
      exiting
    )
      return;
    continuationPending.current = true;
    localSpeech.stopOwnedBy(ownerId);
    setContinuing(true);
    setFailure(null);

    try {
      const response = await onContinue();
      if (!mounted.current) return;
      if (response.ok) setExiting(true);
      else setFailure(FAILURE_MESSAGES[response.reason]);
    } catch {
      if (mounted.current) setFailure(FAILURE_MESSAGES.failed);
    } finally {
      if (mounted.current) {
        continuationPending.current = false;
        setContinuing(false);
      }
    }
  };

  const markTooEasy = async (): Promise<void> => {
    if (staticPreview) return;
    if (
      !onTooEasy ||
      !result.isCorrect ||
      tooEasySaved ||
      tooHardSaved ||
      tooEasyPending.current ||
      tooHardPending.current ||
      continuationPending.current ||
      exiting
    ) {
      return;
    }

    tooEasyPending.current = true;
    localSpeech.stopOwnedBy(ownerId);
    setMarkingTooEasy(true);
    setFailure(null);

    try {
      await onTooEasy();
      if (mounted.current) {
        setTooEasySaved(true);
        // 成功的原按钮会卸载，不保证再触发 blur/mouseleave；主动恢复自动收起。
        setFocused(false);
        setHovered(false);
      }
    } catch {
      if (mounted.current) setFailure(TOO_EASY_FAILURE_MESSAGE);
    } finally {
      if (mounted.current) {
        tooEasyPending.current = false;
        setMarkingTooEasy(false);
      }
    }
  };

  const markTooHard = async (): Promise<void> => {
    if (staticPreview) return;
    if (
      !onTooHard ||
      !result.isCorrect ||
      tooHardSaved ||
      tooEasySaved ||
      tooHardPending.current ||
      tooEasyPending.current ||
      continuationPending.current ||
      exiting
    ) {
      return;
    }

    tooHardPending.current = true;
    localSpeech.stopOwnedBy(ownerId);
    setMarkingTooHard(true);
    setFailure(null);

    try {
      await onTooHard();
      if (mounted.current) {
        setTooHardSaved(true);
        setFocused(false);
        setHovered(false);
      }
    } catch {
      if (mounted.current) setFailure(TOO_HARD_FAILURE_MESSAGE);
    } finally {
      if (mounted.current) {
        tooHardPending.current = false;
        setMarkingTooHard(false);
      }
    }
  };

  return (
    <>
      <svg className="bingeup-learning-feedback__clip" aria-hidden="true">
        <defs>
          <clipPath id="bingeup-feedback-clip" clipPathUnits="objectBoundingBox">
            <path d={FEEDBACK_PAPER_PATH} />
          </clipPath>
        </defs>
      </svg>
      {!exiting && (
        <section
          className="bingeup-learning-feedback"
          role="region"
          aria-label="答题反馈"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClickCapture={cancelAutoClose}
          onFocusCapture={() => setFocused(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              setFocused(false);
          }}
          // 用户主动操作反馈按钮时，按键只作用于该按钮，不触发下一题快捷键。
          onKeyDown={(event) => event.stopPropagation()}
        >
          <span
            className="bingeup-learning-feedback__close-control"
            data-countdown-cancelled={countdownCancelled}
          >
            <span
              className="bingeup-learning-feedback__close-timer"
              style={{ '--feedback-countdown': countdownProgress } as CSSProperties}
              aria-hidden="true"
            />
            <Button
              className="bingeup-learning-feedback__close"
              type="text"
              size="small"
              icon={<HugeIcon icon={Cancel01Icon} size={18} />}
              aria-label="关闭"
              title="关闭"
              disabled={actionsLocked || exiting}
              onClick={dismiss}
            />
          </span>
          <div role="status" aria-live="polite" aria-atomic="true">
            <span className="bingeup-learning-feedback__status" data-correct={result.isCorrect}>
              <span
                className="bingeup-learning-feedback__status-icon"
                data-correct={result.isCorrect}
              >
                <HugeIcon icon={result.isCorrect ? CheckmarkBadge03Icon : BadgeXIcon} size={22} />
              </span>
              <span>{result.isCorrect ? '答对了' : '答错了'}</span>
            </span>
          </div>
          <div className="bingeup-learning-feedback__content">
            <WordSummary
              ownerId={ownerId}
              data={{
                word: explanation.word,
                phonetic: explanation.phonetic,
                partOfSpeech: explanation.partOfSpeech,
                meanings: explanation.meanings,
                exampleSentence: explanation.exampleSentence,
                exampleTranslation: explanation.exampleTranslation,
                secondaryMeanings: explanation.secondaryMeanings,
              }}
              wordClassName="bingeup-learning-feedback__word"
              disabled={actionsLocked || exiting}
              showExample={false}
            />
            {hasSubmittedAnswer && (
              <div className="bingeup-learning-feedback__submitted-answer">
                <span className="bingeup-learning-feedback__answer-label">你的答案</span>
                <span className="bingeup-learning-feedback__wrong-value">
                  <span>{result.submittedAnswer}</span>
                </span>
              </div>
            )}
            {failure && (
              <p className="bingeup-learning-feedback__failure" role="alert">
                {failure}
              </p>
            )}
          </div>
          <div
            className="bingeup-learning-feedback__actions"
            data-has-actions={hasActions}
            data-after-answer={hasSubmittedAnswer}
          >
            {hasRatingActions && (
              <div className="bingeup-learning-feedback__rating-actions">
                {canMarkTooEasy && !tooEasySaved && !tooHardSaved && (
                  <Button
                    size="small"
                    icon={<HugeIcon icon={ZzzIcon} size={15} />}
                    loading={markingTooEasy}
                    disabled={actionsLocked || exiting}
                    onClick={() => void markTooEasy()}
                  >
                    太简单
                  </Button>
                )}
                {tooEasySaved && (
                  <span className="bingeup-learning-feedback__too-easy-success">
                    已标记为太简单
                  </span>
                )}
                {canMarkTooHard && !tooHardSaved && !tooEasySaved && (
                  <Button
                    size="small"
                    icon={<HugeIcon icon={MountainIcon} size={15} />}
                    loading={markingTooHard}
                    disabled={actionsLocked || exiting}
                    onClick={() => void markTooHard()}
                  >
                    太难了
                  </Button>
                )}
                {tooHardSaved && (
                  <span className="bingeup-learning-feedback__too-easy-success">
                    已标记为太难了
                  </span>
                )}
              </div>
            )}
            {hasFlowActions && (
              <div className="bingeup-learning-feedback__flow-actions">
                <Button
                  size="small"
                  loading={continuing}
                  disabled={actionsLocked || exiting}
                  onClick={() => void continueLearning()}
                >
                  继续答题
                </Button>
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}
