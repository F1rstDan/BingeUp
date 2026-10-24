import { Tag } from 'animal-island-ui';
import { VolumeHighIcon } from '@hugeicons/core-free-icons';
import { HugeIcon } from '@/ui/icons/HugeIcon';
import { useLocalSpeech } from '@/ui/speech/local-speech';
import { ExampleSpeechPanel } from '@/ui/speech/SpeechControls';

export interface WordSummaryMeaning {
  partOfSpeech: string;
  meaningZh: string;
}

export interface WordSummaryData {
  word: string;
  phonetic?: string;
  partOfSpeech: string[];
  meanings: string[];
  exampleSentence?: string;
  exampleTranslation?: string;
  secondaryMeanings?: WordSummaryMeaning[];
}

const POS_HELP: Record<string, string> = {
  'adj.': '形容词：描述名词或代词的性质、状态。',
  'n.': '名词：表示人、事物、地点或概念。',
  'v.': '动词：表示动作或状态。',
  'adv.': '副词：修饰动词、形容词或其他副词。',
  'prep.': '介词：表示时间、地点、方向等关系。',
  'conj.': '连词：连接词、短语或句子。',
  'pron.': '代词：代替名词或名词短语。',
  'num.': '数词：表示数量或顺序。',
  'art.': '冠词：限定名词。',
  'aux.': '助动词：与主要动词构成时态、语态或语气。',
  'int.': '感叹词：表达情绪或反应。',
};

export function PosTag({ parts }: { parts: string[] }): JSX.Element {
  const label = parts.join('/');
  const explanation = parts.map((part) => POS_HELP[part] ?? `词性：${part}`).join('；');
  return (
    <span className="bingeup-pos-tooltip" title={explanation}>
      <Tag size="small" className="bingeup-pos-tag">
        {label}
      </Tag>
    </span>
  );
}

/** 可点击的“喇叭 + 音标”标签；整块触发朗读，不嵌套按钮。 */
export function PronunciationTag({
  ownerId,
  wordText,
  phonetic,
  disabled = false,
}: {
  ownerId: string;
  wordText: string;
  phonetic?: string;
  disabled?: boolean;
}): JSX.Element | null {
  const speech = useLocalSpeech(ownerId);
  const active = speech.isSpeaking('word');
  if (!phonetic) return null;

  const activate = (): void => {
    if (disabled) return;
    if (active) speech.stop();
    else speech.speak(wordText, 'word');
  };

  return (
    <button
      type="button"
      className="bingeup-pronunciation-wrap"
      data-voice-name={speech.state.voiceName ?? undefined}
      data-preferred-voice={speech.state.preferredVoiceName}
      aria-label={active ? '停止朗读单词' : '朗读单词'}
      aria-pressed={active}
      disabled={disabled}
      onClick={activate}
    >
      <Tag
        size="small"
        variant="soft"
        color="default"
        className={`bingeup-pronunciation-tag${active ? ' bingeup-pronunciation-tag--active' : ''}`}
      >
        <HugeIcon icon={VolumeHighIcon} size={15} />
        <span className="bingeup-new-word-phonetic">{phonetic}</span>
      </Tag>
    </button>
  );
}

/** 单词卡标准组合；各界面按需隐藏单词、含义、例句或其他义项。 */
export function WordSummary({
  ownerId,
  data,
  disabled = false,
  showWord = true,
  showMeaning = true,
  showPronunciation = true,
  showExample = true,
  showSecondary = true,
  wordClassName = 'bingeup-word-summary__word',
  className = '',
}: {
  ownerId: string;
  data: WordSummaryData;
  disabled?: boolean;
  showWord?: boolean;
  showMeaning?: boolean;
  showPronunciation?: boolean;
  showExample?: boolean;
  showSecondary?: boolean;
  wordClassName?: string;
  className?: string;
}): JSX.Element {
  const secondary = data.secondaryMeanings ?? [];
  return (
    <section className={`bingeup-word-summary ${className}`.trim()}>
      {showWord && (
        <h2 className={`bingeup-word-summary__word ${wordClassName}`.trim()} lang="en">
          {data.word}
        </h2>
      )}
      {(showMeaning || showPronunciation) && (
        <div className="bingeup-word-summary__meaning-row">
          {showMeaning && data.partOfSpeech.length > 0 && <PosTag parts={data.partOfSpeech} />}
          {showMeaning && (
            <span className="bingeup-word-summary__meaning">{data.meanings.join('；')}</span>
          )}
          {showPronunciation && (
            <PronunciationTag
              ownerId={ownerId}
              wordText={data.word}
              phonetic={data.phonetic}
              disabled={disabled}
            />
          )}
        </div>
      )}
      {showExample && data.exampleSentence && (
        <ExampleSpeechPanel
          ownerId={ownerId}
          exampleText={data.exampleSentence}
          disabled={disabled}
        >
          <p className="bingeup-example" lang="en">
            {data.exampleSentence}
          </p>
          {data.exampleTranslation && (
            <p className="bingeup-example-translation">{data.exampleTranslation}</p>
          )}
        </ExampleSpeechPanel>
      )}
      {showSecondary && secondary.length > 0 && (
        <p className="bingeup-secondary">
          <span className="bingeup-secondary-label">其他常见义</span>
          {secondary.map((meaning, index) => (
            <span
              className="bingeup-secondary-item"
              key={`${meaning.partOfSpeech}:${meaning.meaningZh}`}
            >
              <span className="bingeup-secondary-pos">{meaning.partOfSpeech}</span>{' '}
              <span>{meaning.meaningZh}</span>
              {index < secondary.length - 1 && (
                <span className="bingeup-secondary-separator" aria-hidden="true">
                  ·
                </span>
              )}
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

export const WORD_SUMMARY_CSS = `
  .bingeup-word-summary { min-width: 0; }
  .bingeup-word-summary__word {
    margin: 0; color: var(--animal-text-color); font-size: 27px; font-weight: 800;
    line-height: 1.2; letter-spacing: 0.01em; text-align: center; overflow-wrap: anywhere;
  }
  .bingeup-word-summary__meaning-row {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: center;
    gap: 4px 6px; margin: var(--animal-spacing-xs) 0 var(--animal-spacing-md);
    font-size: 17px; font-weight: 700; line-height: 1.45; text-align: center;
    overflow-wrap: anywhere;
  }
  .bingeup-word-summary__meaning { min-width: 0; }
  .bingeup-pos-tooltip { display: inline-flex; flex: none; align-items: center; }
  .bingeup-pos-tag { line-height: 1; }
  .bingeup-pronunciation-wrap {
    display: inline-flex; flex: none; align-items: center; padding: 0; border: 0;
    appearance: none; background: transparent; color: inherit; font: inherit;
    border-radius: 999px; box-shadow: none; line-height: 1; vertical-align: middle; cursor: pointer;
  }
  .bingeup-pronunciation-wrap:disabled { cursor: default; opacity: 0.6; }
  .bingeup-pronunciation-wrap svg { display: block; }
  .bingeup-pronunciation-wrap:focus-visible {
    outline: 2px solid var(--animal-primary-color); outline-offset: 2px;
  }
  .bingeup-pronunciation-tag {
    display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px;
    border: 0; box-shadow: none; background: var(--animal-bg-color-secondary);
    color: var(--animal-text-color-secondary); line-height: 1; cursor: pointer;
  }
  .bingeup-pronunciation-tag > span {
    display: inline-flex; align-items: center; gap: 4px;
    background: transparent; line-height: 1;
  }
  .bingeup-pronunciation-tag svg { color: var(--animal-text-color); }
  .bingeup-pronunciation-tag:hover,
  .bingeup-pronunciation-tag--active { color: var(--animal-primary-color); }
  .bingeup-secondary {
    display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px var(--animal-spacing-xs);
    margin: var(--animal-spacing-sm) 0 var(--animal-spacing-md);
    font-size: var(--animal-font-size-sm); line-height: 1.6; text-align: left;
  }
  .bingeup-secondary-label {
    margin-right: var(--animal-spacing-xs); color: var(--animal-text-color-secondary);
    font-weight: 700; white-space: nowrap;
  }
  .bingeup-secondary-item { min-width: 0; overflow-wrap: anywhere; }
  .bingeup-secondary-pos { margin-right: 3px; font-weight: 700; }
  .bingeup-secondary-separator {
    margin-left: var(--animal-spacing-xs); color: var(--animal-text-color-secondary);
  }
`;
