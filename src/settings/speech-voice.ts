/** 默认朗读音色；按名称前缀匹配，兼容不同 Windows 版本的完整语音名。 */
export const DEFAULT_SPEECH_VOICE_NAME = 'Microsoft Zira';

export function isLocalEnglishVoice(voice: SpeechSynthesisVoice): boolean {
  return voice.localService === true && /^en(?:-|$)/i.test(voice.lang || '');
}

/** 本地英语语音排序：保存的音色优先，其次 Zira、Mark，最后其他本地语音。 */
export function compareSpeechVoices(
  a: SpeechSynthesisVoice,
  b: SpeechSynthesisVoice,
  preferredName: string,
): number {
  const rank = (voice: SpeechSynthesisVoice) =>
    /^en-US$/i.test(voice.lang) ? 0 : /^en[-_]?GB$/i.test(voice.lang) ? 1 : 2;
  const preferred = preferredName.trim().toLowerCase();
  const nameRank = (voice: SpeechSynthesisVoice) => {
    const name = voice.name.toLowerCase();
    if (preferred) {
      if (name === preferred) return 0;
      if (name.startsWith(preferred) || name.includes(preferred)) return 1;
    }
    if (name.includes('zira')) return 2;
    if (name.includes('mark')) return 3;
    if (name.includes('aria') || name.includes('jenny') || name.includes('guy')) return 4;
    if (name.includes('david')) return 6;
    return 5;
  };
  return (
    rank(a) - rank(b) ||
    a.lang.localeCompare(b.lang) ||
    nameRank(a) - nameRank(b) ||
    a.name.localeCompare(b.name)
  );
}
