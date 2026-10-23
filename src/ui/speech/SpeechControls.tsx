import { Button } from 'animal-island-ui';
import { VolumeIcon } from 'naive-icons';
import { useLocalSpeech, type SpeechLabel } from '@/ui/speech/local-speech';

export type SpeechControlsVariant = 'all' | 'word' | 'example';

/** 手动本地朗读控件；只响应用户激活，不自动播放。 */
export function SpeechControls({
  ownerId,
  wordText,
  exampleText,
  disabled = false,
  variant = 'all',
  phonetic,
}: {
  ownerId: string;
  wordText: string;
  exampleText?: string;
  disabled?: boolean;
  /** word/example 用于把两个入口放进不同的卡片区域；all 保留在同一组。 */
  variant?: SpeechControlsVariant;
  /** 单词朗读按钮旁的音标，只随 word 变体渲染。 */
  phonetic?: string;
}) {
  const speech = useLocalSpeech(ownerId);
  const button = (label: SpeechLabel, text: string, name: string) => {
    const active = speech.isSpeaking(label);
    return (
      <Button
        type={label === 'word' ? 'default' : 'text'}
        size="small"
        icon={<VolumeIcon size={16} />}
        aria-pressed={active}
        aria-label={active ? '停止朗读' : name}
        disabled={disabled}
        onClick={() => (active ? speech.stop() : speech.speak(text, label))}
      />
    );
  };
  const unavailable = speech.state.status === 'unavailable' || speech.state.status === 'error';
  const showStatus = variant !== 'example';
  return (
    <div
      className={`bingeup-speech-controls bingeup-speech-controls--${variant}`}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {variant === 'word' ? (
        <div className="bingeup-word-speech-row">
          {button('word', wordText, '系统朗读单词')}
          <span className="bingeup-word-pronunciation">
            {phonetic && <span className="bingeup-new-word-phonetic">{phonetic}</span>}
          </span>
        </div>
      ) : (
        <div className="bingeup-speech-buttons">
          {variant === 'all' && button('word', wordText, '系统朗读单词')}
          {exampleText ? button('example', exampleText, '系统朗读例句') : null}
        </div>
      )}
      {showStatus && unavailable && (
        <Button size="small" type="text" onClick={speech.retry} disabled={disabled}>
          重试
        </Button>
      )}
      {showStatus && speech.state.message && (
        <p className="bingeup-speech-status" aria-live="polite">
          {speech.state.message}
          {speech.state.voiceLang ? `（${speech.state.voiceLang}）` : ''}
        </p>
      )}
    </div>
  );
}
