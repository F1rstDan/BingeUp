import type { WordRecord, DeckRecord } from '@/types';

/**
 * 内置示例词库（Issue #5 验收标准 1）。
 *
 * Beta 阶段的内置词库为项目自建的示例数据，以 CC0 释出。
 * 生产环境应替换为经过清洗的开放数据源（如 ECDICT，CC-BY-SA 4.0），
 * 并在构建脚本中记录来源与许可证。此处保留 source/license 字段以保证可追溯。
 */

const SOURCE = 'BingeUp built-in sample';
const LICENSE = 'CC0-1.0';

const WORDS: WordRecord[] = [
  {
    id: 'w-abandon',
    word: 'abandon',
    lemma: 'abandon',
    phonetic: '/əˈbændən/',
    partOfSpeech: ['v.'],
    coreMeaningZh: ['放弃；遗弃'],
    exampleSentence: 'He abandoned his car on the highway.',
    exampleTranslation: '他把车丢弃在高速公路上。',
    difficulty: 2,
    source: SOURCE,
    license: LICENSE,
  },
  {
    id: 'w-benefit',
    word: 'benefit',
    lemma: 'benefit',
    phonetic: '/ˈbenɪfɪt/',
    partOfSpeech: ['n.', 'v.'],
    coreMeaningZh: ['利益；好处'],
    exampleSentence: 'Regular exercise has many benefits.',
    exampleTranslation: '经常锻炼有很多好处。',
    difficulty: 1,
    source: SOURCE,
    license: LICENSE,
  },
  {
    id: 'w-capable',
    word: 'capable',
    lemma: 'capable',
    phonetic: '/ˈkeɪpəbl/',
    partOfSpeech: ['adj.'],
    coreMeaningZh: ['有能力的；能干的'],
    exampleSentence: 'She is capable of solving complex problems.',
    exampleTranslation: '她有能力解决复杂的问题。',
    difficulty: 2,
    source: SOURCE,
    license: LICENSE,
  },
  {
    id: 'w-deliberate',
    word: 'deliberate',
    lemma: 'deliberate',
    phonetic: '/dɪˈlɪbərət/',
    partOfSpeech: ['adj.'],
    coreMeaningZh: ['故意的；深思熟虑的'],
    exampleSentence: 'His silence was a deliberate choice.',
    exampleTranslation: '他的沉默是深思熟虑的选择。',
    difficulty: 3,
    source: SOURCE,
    license: LICENSE,
  },
  {
    id: 'w-enhance',
    word: 'enhance',
    lemma: 'enhance',
    phonetic: '/ɪnˈhɑːns/',
    partOfSpeech: ['v.'],
    coreMeaningZh: ['提高；增强'],
    exampleSentence: 'Music can enhance the mood of a film.',
    exampleTranslation: '音乐能增强电影的氛围。',
    difficulty: 2,
    source: SOURCE,
    license: LICENSE,
  },
  {
    id: 'w-frequent',
    word: 'frequent',
    lemma: 'frequent',
    phonetic: '/ˈfriːkwənt/',
    partOfSpeech: ['adj.'],
    coreMeaningZh: ['频繁的；经常的'],
    exampleSentence: 'Frequent breaks improve productivity.',
    exampleTranslation: '频繁的休息能提高生产力。',
    difficulty: 2,
    source: SOURCE,
    license: LICENSE,
  },
  {
    id: 'w-genuine',
    word: 'genuine',
    lemma: 'genuine',
    phonetic: '/ˈdʒenjuɪn/',
    partOfSpeech: ['adj.'],
    coreMeaningZh: ['真正的；真诚的'],
    exampleSentence: 'Her smile was warm and genuine.',
    exampleTranslation: '她的微笑温暖而真诚。',
    difficulty: 2,
    source: SOURCE,
    license: LICENSE,
  },
  {
    id: 'w-hesitate',
    word: 'hesitate',
    lemma: 'hesitate',
    phonetic: '/ˈhezɪteɪt/',
    partOfSpeech: ['v.'],
    coreMeaningZh: ['犹豫；踌躇'],
    exampleSentence: 'Don\'t hesitate to ask if you need help.',
    exampleTranslation: '如果需要帮助，不要犹豫。',
    difficulty: 3,
    source: SOURCE,
    license: LICENSE,
  },
  {
    id: 'w-influence',
    word: 'influence',
    lemma: 'influence',
    phonetic: '/ˈɪnfluəns/',
    partOfSpeech: ['n.', 'v.'],
    coreMeaningZh: ['影响；作用'],
    exampleSentence: 'Teachers have a great influence on children.',
    exampleTranslation: '老师对孩子有很大的影响。',
    difficulty: 2,
    source: SOURCE,
    license: LICENSE,
  },
  {
    id: 'w-justify',
    word: 'justify',
    lemma: 'justify',
    phonetic: '/ˈdʒʌstɪfaɪ/',
    partOfSpeech: ['v.'],
    coreMeaningZh: ['证明…正当；辩护'],
    exampleSentence: 'Nothing can justify his rude behavior.',
    exampleTranslation: '没有任何理由可以为他的粗鲁行为辩护。',
    difficulty: 3,
    source: SOURCE,
    license: LICENSE,
  },
  {
    id: 'w-legacy',
    word: 'legacy',
    lemma: 'legacy',
    phonetic: '/ˈleɡəsi/',
    partOfSpeech: ['n.'],
    coreMeaningZh: ['遗产；遗留'],
    exampleSentence: 'The writer left a rich literary legacy.',
    exampleTranslation: '这位作家留下了丰富的文学遗产。',
    difficulty: 3,
    source: SOURCE,
    license: LICENSE,
  },
  {
    id: 'w-mitigate',
    word: 'mitigate',
    lemma: 'mitigate',
    phonetic: '/ˈmɪtɪɡeɪt/',
    partOfSpeech: ['v.'],
    coreMeaningZh: ['减轻；缓和'],
    exampleSentence: 'We planted trees to mitigate noise pollution.',
    exampleTranslation: '我们种树来减轻噪音污染。',
    difficulty: 4,
    source: SOURCE,
    license: LICENSE,
  },
];

/** 内置词库列表。 */
export const BUILT_IN_DECKS: DeckRecord[] = [
  {
    id: 'deck-daily-high-frequency',
    name: '日常高频',
    description: 'Beta 内置示例词库，收录 12 个常见英语单词。',
    source: SOURCE,
    license: LICENSE,
    wordIds: WORDS.map((w) => w.id),
  },
];

const WORD_INDEX: Map<string, WordRecord> = new Map(WORDS.map((w) => [w.id, w]));

const DECK_INDEX: Map<string, DeckRecord> = new Map(BUILT_IN_DECKS.map((d) => [d.id, d]));

/** 按 id 查询单词，不存在返回 null。 */
export function getBuiltInWord(wordId: string): WordRecord | null {
  return WORD_INDEX.get(wordId) ?? null;
}

/** 按 id 查询词库，不存在返回 null。 */
export function getBuiltInDeck(deckId: string): DeckRecord | null {
  return DECK_INDEX.get(deckId) ?? null;
}

/** 列出所有内置单词。 */
export function listBuiltInWords(): WordRecord[] {
  return [...WORDS];
}

/** 默认词库（首个内置词库）。 */
export function getDefaultDeck(): DeckRecord {
  const deck = BUILT_IN_DECKS[0];
  if (deck === undefined) {
    throw new Error('内置词库为空，无法获取默认词库');
  }
  return deck;
}
