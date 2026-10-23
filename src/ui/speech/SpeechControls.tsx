import { useLocalSpeech, type SpeechLabel } from '@/ui/speech/local-speech';

/** 手动本地朗读控件；只响应用户激活，不自动播放。 */
export function SpeechControls({
  ownerId,
  wordText,
  exampleText,
  disabled = false,
}: {
  ownerId: string;
  wordText: string;
  exampleText?: string;
  disabled?: boolean;
}) {
  const speech = useLocalSpeech(ownerId);
  const button = (label: SpeechLabel, text: string, name: string) => {
    const active = speech.isSpeaking(label);
    return (
      <button
        type="button"
        className="bingeup-speech-button"
        aria-pressed={active}
        aria-label={active ? '停止朗读' : name}
        disabled={disabled}
        onClick={() => (active ? speech.stop() : speech.speak(text, label))}
      >
        {active ? '停止朗读' : name}
      </button>
    );
  };
  const unavailable = speech.state.status === 'unavailable' || speech.state.status === 'error';
  return (
    <div className="bingeup-speech-controls" onKeyDown={(event) => event.stopPropagation()}>
      <div className="bingeup-speech-buttons">
        {button('word', wordText, '系统朗读单词')}
        {exampleText ? button('example', exampleText, '系统朗读例句') : null}
        {unavailable && (
          <button
            type="button"
            className="bingeup-speech-retry"
            onClick={speech.retry}
            disabled={disabled}
          >
            重试
          </button>
        )}
      </div>
      {speech.state.message && (
        <p className="bingeup-speech-status" aria-live="polite">
          {speech.state.message}
          {speech.state.voiceLang ? `（${speech.state.voiceLang}）` : ''}
        </p>
      )}
      <p className="bingeup-speech-note">
        音标对应本条主释义的美式读音。系统朗读使用设备英语语音，口音及同形异读词的读法可能与音标不同。
      </p>
    </div>
  );
}
