import { useId, useRef, type ReactNode } from 'react';
import { Button } from 'animal-island-ui';
import { VolumeIcon } from 'naive-icons';
import { useLocalSpeech, type LocalSpeechStatus } from '@/ui/speech/local-speech';

function shortSpeechStatus(status: LocalSpeechStatus): string | null {
  switch (status) {
    case 'unsupported':
    case 'unavailable':
      return '本地朗读不可用';
    case 'error':
      return '朗读失败';
    case 'waiting-voices':
      return '正在准备本地语音…';
    default:
      return null;
  }
}

/** 简短朗读状态与重试；状态只展示在当前界面内，不打断页面其他内容。 */
function SpeechStatus({ ownerId, disabled = false }: { ownerId: string; disabled?: boolean }) {
  const speech = useLocalSpeech(ownerId);
  const status = shortSpeechStatus(speech.state.status);
  if (status === null) return null;

  return (
    <p className="bingeup-speech-status" aria-live="polite">
      <span>{status}</span>
      <Button
        className="bingeup-speech-retry"
        type="text"
        size="small"
        disabled={disabled}
        onClick={speech.retry}
      >
        重试
      </Button>
    </p>
  );
}

/** 紧凑的单词朗读入口；保留有框按钮，图标固定为次要文字色。 */
export function SpeechControls({
  ownerId,
  wordText,
  phonetic,
  disabled = false,
}: {
  ownerId: string;
  wordText: string;
  phonetic?: string;
  disabled?: boolean;
}) {
  const speech = useLocalSpeech(ownerId);
  const active = speech.isSpeaking('word');

  return (
    <div
      className="bingeup-speech-controls bingeup-speech-controls--word"
      data-voice-name={speech.state.voiceName ?? undefined}
      data-preferred-voice={speech.state.preferredVoiceName}
      title={speech.state.voiceName ? `朗读音色：${speech.state.voiceName}` : undefined}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="bingeup-word-speech-row bingeup-word-pronunciation">
        <Button
          className="bingeup-speech-icon-button"
          type="default"
          size="small"
          icon={<VolumeIcon size={16} />}
          aria-pressed={active}
          aria-label={active ? '停止朗读单词' : '系统朗读单词'}
          disabled={disabled}
          onClick={() => (active ? speech.stop() : speech.speak(wordText, 'word'))}
        />
        {phonetic && <span className="bingeup-new-word-phonetic">{phonetic}</span>}
      </div>
    </div>
  );
}

/**
 * 整块可朗读的例句气泡。文字与译文放在同一个普通容器内，不嵌套按钮；
 * 鼠标选择文字时不触发朗读，Enter/Space 只在整块区域上切换朗读状态。
 */
export function ExampleSpeechPanel({
  ownerId,
  exampleText,
  disabled = false,
  children,
}: {
  ownerId: string;
  exampleText: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const speech = useLocalSpeech(ownerId);
  const active = speech.isSpeaking('example');
  const contentId = useId();
  const actionRef = useRef<HTMLDivElement | null>(null);

  const activate = (): void => {
    if (disabled) return;
    if (active) speech.stop();
    else speech.speak(exampleText, 'example');
  };

  return (
    <div
      className={`bingeup-example-panel${active ? ' bingeup-example-panel--speaking' : ''}`}
      data-voice-name={speech.state.voiceName ?? undefined}
      data-preferred-voice={speech.state.preferredVoiceName}
    >
      <div
        ref={actionRef}
        className="bingeup-example-action"
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-pressed={active}
        aria-label={active ? '停止朗读例句' : '朗读例句'}
        aria-describedby={contentId}
        aria-disabled={disabled || undefined}
        onClick={() => {
          // 只在拖选的是本例句文字时保留选择行为，不把选择操作当成朗读点击。
          const selection = window.getSelection();
          const anchor = selection?.anchorNode ?? null;
          if (
            selection &&
            !selection.isCollapsed &&
            selection.toString().trim() &&
            anchor &&
            actionRef.current?.contains(anchor)
          ) {
            return;
          }
          activate();
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          activate();
        }}
      >
        <VolumeIcon className="bingeup-example-speaker" size={18} aria-hidden="true" />
        <div className="bingeup-example-content" id={contentId}>
          {children}
        </div>
      </div>
      <SpeechStatus ownerId={ownerId} disabled={disabled} />
    </div>
  );
}

/** 两个 ShadowRoot 共用的朗读控件样式；颜色全部来自 --animal-* 令牌。 */
export const SPEECH_CONTROLS_CSS = `
  .bingeup-speech-controls { min-width: 0; margin: 0; }
  .bingeup-speech-controls--word {
    display: flex; flex-direction: column; align-items: flex-start;
    gap: var(--animal-spacing-xs); text-align: left;
  }
  .bingeup-word-speech-row {
    display: flex; flex-wrap: wrap; align-items: center;
    gap: var(--animal-spacing-xs) var(--animal-spacing-sm); min-width: 0;
  }
  .bingeup-speech-icon-button {
    flex: none; width: 32px; min-width: 32px; height: 32px; padding: 0;
    color: var(--animal-text-color-secondary);
  }
  .bingeup-speech-icon-button svg { color: var(--animal-text-color-secondary); }
  .bingeup-speech-icon-button svg path {
    fill: currentColor; stroke: currentColor;
  }
  .bingeup-word-pronunciation {
    display: inline-flex; flex-wrap: wrap; align-items: baseline;
    gap: var(--animal-spacing-xs); min-width: 0;
  }
  .bingeup-new-word-phonetic {
    min-width: 0; max-width: 100%; color: var(--animal-text-color-secondary);
    font-size: var(--animal-font-size-sm); line-height: 1.4; overflow-wrap: anywhere;
  }
  .bingeup-example-panel {
    margin-bottom: var(--animal-spacing-sm); overflow: hidden;
    border-radius: var(--animal-border-radius-lg); background: var(--animal-bg-color-secondary);
    text-align: left;
  }
  .bingeup-example-action {
    display: flex; align-items: flex-start; gap: 6px; min-width: 0;
    padding: 9px 11px; border-radius: var(--animal-border-radius-lg);
    cursor: pointer; outline: none; user-select: text;
    transition: background var(--animal-motion-duration-fast) var(--animal-motion-ease);
  }
  .bingeup-example-action:hover {
    background: color-mix(in srgb, var(--animal-bg-color-secondary) 88%, var(--animal-primary-color));
  }
  .bingeup-example-action:focus-visible {
    outline: 2px solid var(--animal-primary-color); outline-offset: -2px;
  }
  .bingeup-example-action[aria-disabled="true"] { cursor: default; }
  .bingeup-example-speaker {
    flex: none; width: 18px; height: 18px; margin-top: 2px;
    color: var(--animal-text-color-secondary);
  }
  .bingeup-example-speaker path { fill: currentColor; stroke: currentColor; }
  .bingeup-example-content { flex: 1 1 auto; min-width: 0; user-select: text; }
  .bingeup-example {
    margin: 0; font-size: var(--animal-font-size-base);
    font-style: italic; line-height: 1.5; overflow-wrap: anywhere;
  }
  .bingeup-example-translation {
    margin: 2px 0 0; color: var(--animal-text-color-secondary);
    font-size: var(--animal-font-size-sm); line-height: 1.5; overflow-wrap: anywhere;
  }
  .bingeup-speech-status {
    display: flex; flex-wrap: wrap; align-items: center; gap: 2px 4px;
    margin: 0; padding: 0 11px 8px;
    color: var(--animal-text-color-secondary); font-size: 12px; line-height: 1.4;
    text-align: left; overflow-wrap: anywhere;
  }
  .bingeup-speech-retry {
    height: 24px; min-width: 0; padding: 0 5px;
    color: var(--animal-text-color-secondary); font-size: 12px;
  }
  @media (prefers-reduced-motion: reduce) {
    .bingeup-example-action { transition: none; }
  }
`;
