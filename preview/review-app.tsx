import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Card, Tag } from 'animal-island-ui';
import optionsCss from '@/entrypoints/options/options.css?raw';
import onboardingCss from '@/entrypoints/onboarding/onboarding.css?raw';
import popupCss from '@/entrypoints/popup/popup.css?raw';
import statsCss from '@/entrypoints/stats/stats.css?raw';
import { showEnablePrompt } from '@/content/enable-prompt';
import { showPlaybackRecoveryNotice } from '@/content/playback-recovery-notice';
import { LEARNING_FEEDBACK_CSS, LearningFeedbackNotice } from '@/content/learning-feedback-notice';
import { LearningFeedback } from '@/ui/overlay/LearningFeedback';
import { WORD_SUMMARY_CSS } from '@/ui/overlay/WordSummary';
import { SPEECH_CONTROLS_CSS } from '@/ui/speech/SpeechControls';
import { OnboardingApp } from '@/ui/onboarding/OnboardingApp';
import { OptionsApp } from '@/ui/options/OptionsApp';
import { PopupApp } from '@/ui/popup/PopupApp';
import { StatsApp } from '@/ui/stats/StatsApp';
import type { CorrectionResult, LearningItem, OverlayAction, SubmissionResult } from '@/types';

import { grantPreviewOrigin, revokePreviewOrigin, setActiveTabScenario } from './chrome-shim';
import {
  makeDemoChoiceQuestion,
  makeDemoContextChoiceQuestion,
  makeDemoNewWordItem,
  makeDemoSpellingQuestion,
  makeDemoSubmissionResult,
  type PreviewLearningScenario,
} from './demo-data';
import { getPreviewDevScenario, setPreviewGlobalPause } from './mock-message-client';
import { mountOverlayShadow } from './overlay-shadow';
import { ShadowFrame } from './shadow-frame';
import { clearStatsDemoData, seedStatsDemoData } from './stats-fixtures';

/**
 * BingeUp × Animal Island UI 预览页（开发调试用）。
 *
 * 目标：在普通网页环境里逐块查看迁移后的全部界面并留批注。所有界面都使用真实
 * 组件与真实样式：
 * - Popup / Options / Stats / Onboarding：真实 App 组件 + 各自入口 CSS，隔离在
 *   独立 ShadowRoot 内（页面之间类名相同但布局不同，避免互相覆盖）；
 * - 视频遮罩：复刻 overlay-controller 的 Shadow DOM 挂载与样式管线；
 * - 启用提示 / 答题反馈提示 / 播放恢复提示：调用真实入口函数（同一 Shadow 管线）。
 * 消息链路来自 preview/mock-message-client.ts，浏览器 API 来自 preview/chrome-shim.ts。
 */

// ─── 通用外壳 ───────────────────────────────────────────────

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="preview-section" id={id}>
      <header className="preview-section-head">
        <h2>{title}</h2>
        <p>{description}</p>
      </header>
      {children}
    </section>
  );
}

function PreviewCard({
  title,
  hint,
  children,
  actions,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <Card className="preview-card">
      <div className="preview-card-head">
        <div>
          <strong className="preview-card-title">{title}</strong>
          {hint !== undefined && <span className="preview-card-hint">{hint}</span>}
        </div>
        {actions !== undefined && <div className="preview-card-actions">{actions}</div>}
      </div>
      {children}
    </Card>
  );
}

// ─── Popup 面板（四态） ──────────────────────────────────────

type PopupStateId = 'learnable' | 'paused' | 'no-active-tab' | 'needs-permission';

const BILIBILI_TAB = { id: 101, url: 'https://www.bilibili.com/video/BV1xx411c7mD' };

const POPUP_STATES: Array<{
  id: PopupStateId;
  label: string;
  hint: string;
  setup: () => void;
}> = [
  {
    id: 'learnable',
    label: '可学习',
    hint: 'bilibili.com · 已启用 · 完整适配 + 今日学习指标',
    setup: () => {
      setActiveTabScenario(BILIBILI_TAB);
      grantPreviewOrigin('www.bilibili.com');
      setPreviewGlobalPause(0);
    },
  },
  {
    id: 'paused',
    label: '已暂停',
    hint: '全局暂停 10 分钟 · 恢复倒计时 · 开始学习禁用',
    setup: () => {
      setActiveTabScenario(BILIBILI_TAB);
      grantPreviewOrigin('www.bilibili.com');
      setPreviewGlobalPause(Date.now() + 10 * 60 * 1000);
    },
  },
  {
    id: 'no-active-tab',
    label: '无活动标签页',
    hint: 'chrome.tabs.query 返回空数组的降级状态',
    setup: () => {
      setActiveTabScenario(null);
      setPreviewGlobalPause(0);
    },
  },
  {
    id: 'needs-permission',
    label: '需权限',
    hint: 'example.com · 基础网页模式 · 主机权限未授予',
    setup: () => {
      setActiveTabScenario({ id: 102, url: 'https://example.com/watch/1' });
      revokePreviewOrigin('example.com');
      setPreviewGlobalPause(0);
    },
  },
];

function PopupStage(): JSX.Element {
  const [stateId, setStateId] = useState<PopupStateId>(() => {
    POPUP_STATES[0]!.setup();
    return 'learnable';
  });
  const active = POPUP_STATES.find((state) => state.id === stateId) ?? POPUP_STATES[0]!;
  return (
    <PreviewCard
      title="Popup 面板（340px）"
      hint={active.hint}
      actions={
        <div className="preview-switch">
          {POPUP_STATES.map((state) => (
            <Button
              key={state.id}
              size="small"
              type={state.id === stateId ? 'primary' : 'default'}
              onClick={() => {
                state.setup();
                setStateId(state.id);
              }}
            >
              {state.label}
            </Button>
          ))}
        </div>
      }
    >
      <div className="preview-browser-frame preview-browser-frame--popup">
        <ShadowFrame
          key={stateId}
          pageCss={popupCss}
          canvasClassName="preview-canvas preview-canvas-popup"
          style={{ width: '340px' }}
        >
          <PopupApp />
        </ShadowFrame>
      </div>
    </PreviewCard>
  );
}

// ─── 设置页 / 统计页 / 引导页 ────────────────────────────────

function OptionsStage(): JSX.Element {
  return (
    <PreviewCard
      title="设置页"
      hint="学习设置 / 网站管理 / 数据管理三个标签可交互；危险操作打开原版 Modal 二次确认"
    >
      <div className="preview-browser-frame">
        <ShadowFrame pageCss={optionsCss} canvasClassName="preview-canvas preview-canvas-page">
          <OptionsApp />
        </ShadowFrame>
      </div>
    </PreviewCard>
  );
}

type StatsMode = 'populated' | 'empty';

function StatsStage(): JSX.Element {
  const [mode, setMode] = useState<StatsMode>('populated');
  const [attempt, setAttempt] = useState(0);
  const [scenario, setScenario] = useState<PreviewLearningScenario>(() => getPreviewDevScenario());
  const [status, setStatus] = useState<'seeding' | 'ready' | 'error'>('seeding');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleDevDataChanged = (): void => {
      setMode('populated');
      setScenario(getPreviewDevScenario());
      setAttempt((value) => value + 1);
    };
    window.addEventListener('bingeup:dev-data-changed', handleDevDataChanged);
    return () => window.removeEventListener('bingeup:dev-data-changed', handleDevDataChanged);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus('seeding');
    setError(null);
    void (async () => {
      try {
        if (mode === 'populated') await seedStatsDemoData(scenario);
        else await clearStatsDemoData();
        if (!cancelled) setStatus('ready');
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, scenario, attempt]);

  return (
    <PreviewCard
      title="统计页"
      hint="真实 IndexedDB 数据链路：Popup 开发工具的“模拟学习历史”会同步切换这里的数据"
      actions={
        <div className="preview-switch">
          <Button
            size="small"
            type={mode === 'populated' ? 'primary' : 'default'}
            onClick={() => setMode('populated')}
          >
            非空态
          </Button>
          <Button
            size="small"
            type={mode === 'empty' ? 'primary' : 'default'}
            onClick={() => setMode('empty')}
          >
            空态
          </Button>
          <Button size="small" onClick={() => setAttempt((value) => value + 1)}>
            重新读取
          </Button>
        </div>
      }
    >
      <div className="preview-browser-frame">
        {status === 'seeding' && <p className="preview-status">正在写入演示数据…</p>}
        {status === 'error' && (
          <p className="preview-status preview-status--error">数据准备失败：{error}</p>
        )}
        {status === 'ready' && (
          <ShadowFrame
            key={`${mode}-${attempt}`}
            pageCss={statsCss}
            canvasClassName="preview-canvas preview-canvas-page"
          >
            <StatsApp />
          </ShadowFrame>
        )}
      </div>
    </PreviewCard>
  );
}

function scheduleClicks(steps: Array<() => void>, firstDelayMs = 220, gapMs = 160): () => void {
  const timers: number[] = [];
  steps.forEach((step, index) => {
    timers.push(window.setTimeout(step, firstDelayMs + index * gapMs));
  });
  return () => timers.forEach((timer) => window.clearTimeout(timer));
}

function driveClickByText(shadow: ShadowRoot, predicate: (text: string) => boolean): () => void {
  return scheduleClicks([
    () => {
      const button = Array.from(shadow.querySelectorAll('button')).find((candidate) =>
        predicate(candidate.textContent?.trim() ?? ''),
      );
      button?.click();
    },
  ]);
}

function OnboardingStages(): JSX.Element {
  const [attempt, setAttempt] = useState(0);
  return (
    <>
      <PreviewCard title="安装引导 · 选择页" hint="学习水平、词库与默认支持网站可交互">
        <div className="preview-browser-frame">
          <ShadowFrame pageCss={onboardingCss} canvasClassName="preview-canvas preview-canvas-page">
            <OnboardingApp />
          </ShadowFrame>
        </div>
      </PreviewCard>
      <PreviewCard
        title="安装引导 · 完成页"
        hint="挂载后自动点击「完成引导」（走 mock completeOnboarding），无需手动操作"
        actions={
          <Button size="small" onClick={() => setAttempt((value) => value + 1)}>
            重新演示
          </Button>
        }
      >
        <div className="preview-browser-frame">
          <ShadowFrame
            key={attempt}
            pageCss={onboardingCss}
            canvasClassName="preview-canvas preview-canvas-page"
            onMounted={(shadow) => {
              driveClickByText(shadow, (text) => text.includes('完成引导'));
            }}
          >
            <OnboardingApp />
          </ShadowFrame>
        </div>
      </PreviewCard>
    </>
  );
}

// ─── 视频遮罩（Shadow DOM 五态 + 变体） ──────────────────────

const OVERLAY_ACTION_LABELS: Record<OverlayAction['type'], string> = {
  'accept-new-word': '接受新词',
  'self-report': '自报认识',
  'submit-answer': '提交答案',
  'submit-spelling': '提交拼写',
  'correct-rating': '纠正评分',
  skip: '跳过',
  'submit-and-continue': '提交并继续',
  'submit-spelling-and-continue': '提交拼写并继续',
  'submit-and-end': '提交并结束',
  'submit-spelling-and-end': '提交拼写并结束',
  'accept-new-word-and-continue': '接受新词并继续',
  'self-report-and-continue': '自报认识并继续',
  'exit-learning': '结束学习',
  recover: '返回视频',
};

function formatOverlayAction(action: OverlayAction): string {
  const label = OVERLAY_ACTION_LABELS[action.type];
  if (action.type === 'submit-answer') {
    return `${label}（选项 ${String.fromCharCode(65 + action.selectedIndex)}）`;
  }
  if (action.type === 'submit-spelling') return `${label}（${action.spelledAnswer}）`;
  if (action.type === 'correct-rating') {
    return `${label}（${action.correction === 'guessed' ? '其实是蒙的' : '这个太简单'}）`;
  }
  return label;
}

/** 遮罩动作的演示处理：提交类动作返回真实形态的 SubmissionResult，其余只记录。 */
function demoOverlayActionHandler(action: OverlayAction): unknown {
  switch (action.type) {
    case 'submit-answer':
    case 'submit-and-continue':
    case 'submit-and-end':
      return {
        ...makeDemoSubmissionResult(
          action.question,
          action.selectedIndex === action.question.correctIndex,
        ),
        submittedAnswer: action.question.options[action.selectedIndex],
      };
    case 'submit-spelling':
    case 'submit-spelling-and-continue':
    case 'submit-spelling-and-end': {
      const normalized = action.spelledAnswer.trim().toLowerCase();
      const acceptable = (action.question.acceptableAnswers ?? []).map((answer) =>
        answer.trim().toLowerCase(),
      );
      const isCorrect =
        normalized === action.question.correctAnswer.trim().toLowerCase() ||
        acceptable.includes(normalized);
      return {
        ...makeDemoSubmissionResult(action.question, isCorrect),
        submittedAnswer: action.spelledAnswer,
      };
    }
    case 'correct-rating': {
      const result: CorrectionResult = {
        cardId: 'demo-card-deliberate',
        reviewLogId: action.reviewLogId,
        rating: action.correction === 'guessed' ? 'again' : 'easy',
        nextReviewAt: Date.now() + 24 * 60 * 60 * 1000,
      };
      return result;
    }
    default:
      return undefined;
  }
}

function OverlayStage({
  title,
  hint,
  item,
  isContinuous,
  nextItem,
  driver,
}: {
  title: string;
  hint: string;
  item: LearningItem;
  isContinuous?: boolean;
  nextItem?: (result: SubmissionResult) => LearningItem | null;
  driver?: (shadow: ShadowRoot) => () => void;
}): JSX.Element {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null) return undefined;
    const mount = mountOverlayShadow(stage, {
      item,
      isContinuous,
      nextItem,
      onAction: (action) => {
        setLog((entries) => [formatOverlayAction(action), ...entries].slice(0, 5));
        return demoOverlayActionHandler(action);
      },
    });
    const cancelDriver = driver?.(mount.shadowRoot);
    return () => {
      cancelDriver?.();
      mount.dispose();
    };
  }, [attempt]);

  return (
    <PreviewCard
      title={title}
      hint={hint}
      actions={
        <Button size="small" onClick={() => setAttempt((value) => value + 1)}>
          重置
        </Button>
      }
    >
      <div className="preview-overlay-stage" ref={stageRef}>
        <div className="preview-video-fake" aria-hidden="true">
          <span className="preview-video-fake-title">视频区域（演示背景）</span>
          <span className="preview-video-fake-controls">00:00 / 12:34 ───────── ●</span>
        </div>
      </div>
      <ul className="preview-action-log">
        {log.length === 0 ? <li className="preview-action-log-empty">尚无动作</li> : null}
        {log.map((entry, index) => (
          <li key={`${entry}-${index}`}>{entry}</li>
        ))}
      </ul>
    </PreviewCard>
  );
}

const newWordItem: LearningItem = makeDemoNewWordItem();
const choiceQuestion = makeDemoChoiceQuestion();
const contextQuestion = makeDemoContextChoiceQuestion();
const spellingQuestion = makeDemoSpellingQuestion();
const choiceItem: LearningItem = { kind: 'question', question: choiceQuestion };
const contextItem: LearningItem = { kind: 'question', question: contextQuestion };
const spellingItem: LearningItem = { kind: 'spelling-question', question: spellingQuestion };

function OverlayStages(): JSX.Element {
  return (
    <div className="preview-grid">
      <OverlayStage
        title="遮罩 · 认识新词"
        hint="单题模式新词展示：学到了 / 我认识，换一个 / 跳过"
        item={newWordItem}
      />
      <OverlayStage
        title="遮罩 · 选择题"
        hint="可交互：点击选项后提交；快捷键 1-4、Enter、Esc 生效"
        item={choiceItem}
      />
      <OverlayStage
        title="遮罩 · 语境填空"
        hint="例句挖空后选择英文词形；四项顺序来自固定题组，提交后显示标准反馈"
        item={contextItem}
      />
      <OverlayStage
        title="遮罩 · 拼写题（连续学习）"
        hint="提交并继续会直接显示下一题，并在下一题顶部展示上一题答对或答错；不弹右下角提示"
        item={spellingItem}
        isContinuous
        nextItem={(result) => (result.isCorrect ? choiceItem : contextItem)}
      />
    </div>
  );
}

// ─── 启用提示与播放恢复提示（真实入口函数） ──────────────────

const previewFeedbackNotice = new LearningFeedbackNotice();

function StaticFeedbackPreview({ isCorrect }: { isCorrect: boolean }): JSX.Element {
  return (
    <div className="preview-feedback-static-item">
      <div className="preview-feedback-static-label">
        {isCorrect ? '答对提示（常驻）' : '答错提示（常驻）'}
      </div>
      <ShadowFrame
        pageCss={`${WORD_SUMMARY_CSS}\n${SPEECH_CONTROLS_CSS}\n${LEARNING_FEEDBACK_CSS}\n.preview-feedback-canvas { min-height: 0; padding: 0; background: transparent; }`}
        canvasClassName="preview-feedback-canvas"
      >
        <LearningFeedback
          result={makeDemoSubmissionResult(choiceQuestion, isCorrect)}
          onContinue={async () => ({ ok: true })}
          onTooEasy={async () => ({
            cardId: 'preview-card',
            reviewLogId: 'preview-log',
            rating: 'easy',
            nextReviewAt: Date.now() + 86_400_000,
          })}
          onTooHard={async () => ({
            cardId: 'preview-card',
            reviewLogId: 'preview-log',
            rating: 'hard',
            nextReviewAt: Date.now() + 86_400_000,
          })}
          onClose={() => {}}
          staticPreview
        />
      </ShadowFrame>
    </div>
  );
}

function NoticesStage(): JSX.Element {
  return (
    <div className="preview-grid">
      <PreviewCard
        title="启用提示"
        hint="调用 src/content/enable-prompt.tsx 的真实入口：固定右上角、独立 ShadowRoot；点击「启用」后切换到「已启用，请刷新」态，点击「暂不」移除"
      >
        <div className="preview-actions">
          <Button
            type="primary"
            onClick={() => {
              showEnablePrompt('bilibili.com', {
                onEnable: () => Promise.resolve(),
                onDismiss: () => Promise.resolve(),
              });
            }}
          >
            触发启用提示
          </Button>
        </div>
      </PreviewCard>
      <PreviewCard
        title="右下角答题反馈提示"
        hint="纸片风格非模态 status，位于独立 Shadow DOM：无遮罩、不锁滚动、不抢焦点；5 秒后自动关闭，悬停或聚焦提示内按钮时暂停计时。"
      >
        <div className="preview-actions">
          {[true, false].map((isCorrect) => (
            <Button
              key={String(isCorrect)}
              onClick={() => {
                previewFeedbackNotice.show(makeDemoSubmissionResult(choiceQuestion, isCorrect));
              }}
            >
              {isCorrect ? '查看答对提示' : '查看答错提示'}
            </Button>
          ))}
        </div>
        <div className="preview-feedback-static">
          <StaticFeedbackPreview isCorrect />
          <StaticFeedbackPreview isCorrect={false} />
        </div>
      </PreviewCard>
      <PreviewCard
        title="播放恢复提示"
        hint="调用 src/content/playback-recovery-notice.ts 的真实入口：右下角固定、pointer-events: none、6 秒后自动消失"
      >
        <div className="preview-actions">
          <Button type="primary" onClick={() => showPlaybackRecoveryNotice()}>
            触发播放恢复提示
          </Button>
        </div>
      </PreviewCard>
    </div>
  );
}

// ─── 页面 ───────────────────────────────────────────────────

export function ReviewApp(): JSX.Element {
  return (
    <main className="preview-page">
      <header className="preview-hero">
        <Tag color="app-teal">
          <span style={{ padding: '2px 4px' }}>开发调试页</span>
        </Tag>
        <h1>BingeUp × Animal Island UI — 界面预览</h1>
        <p>
          逐块查看迁移后的全部界面：真实组件、真实样式、真实消息链路类型；消息与浏览器 API 由预览侧
          mock 提供。本页只服务人工验收与批注，不进入扩展构建产物（WXT 从 src/
          构建）。遮罩与附属提示使用与内容脚本一致的 Shadow DOM 样式管线。
        </p>
      </header>

      <Section
        id="popup"
        title="1 · Popup 面板"
        description="真实 PopupApp + 340px 页面画布；四种状态通过左上角按钮切换，切换时会重建组件并重置 chrome 垫片场景。"
      >
        <PopupStage />
      </Section>

      <Section
        id="options"
        title="2 · 设置页"
        description="真实 OptionsApp：学习设置 / 网站管理 / 数据管理可切换；保存、恢复默认、删除网站、清除数据均可交互（写入 mock 状态）。"
      >
        <OptionsStage />
      </Section>

      <Section
        id="stats"
        title="3 · 统计页"
        description="真实 StatsApp + 真实 IndexedDB 链路：非空态写入 7 张学习卡与两周复习日志，空态清空数据仓库。"
      >
        <StatsStage />
      </Section>

      <Section
        id="onboarding"
        title="4 · 安装引导"
        description="真实 OnboardingApp：选择页可交互；完成页由预览脚本自动点击「完成引导」后展示（按钮「关闭」在预览页不生效）。"
      >
        <div className="preview-grid preview-grid--two">
          <OnboardingStages />
        </div>
      </Section>

      <Section
        id="overlay"
        title="5 · 视频遮罩（Shadow DOM）"
        description="复刻 overlay-controller 的挂载：宿主元素 + attachShadow + 库 CSS 令牌映射与字体路径重写 + 外壳样式；每个区块可交互，动作会记录在下方。"
      >
        <OverlayStages />
      </Section>

      <Section
        id="notices"
        title="6 · 附属提示"
        description="直接调用内容脚本的真实入口：答题反馈显示为右下角非模态提示，不遮挡或阻断页面操作；启用和播放恢复提示也显示在页面角落。"
      >
        <NoticesStage />
      </Section>

      <footer className="preview-footnote">
        <p>
          说明：mock 客户端不模拟冷却、FSRS 调度与持久化；Popup 开发数据面板（仅 dev
          构建可见）由垫片返回演示快照；字体走文档级 @font-face，Shadow 内 @font-face 在 Chromium
          中本就不加载。批注请直接在 Codex 会话中指出区块编号与名称。
        </p>
      </footer>
    </main>
  );
}
