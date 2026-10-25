import type { DeckRecord, DictionaryContentManifest, WordQuestionPlan, WordRecord } from '@/types';
import {
  BUILT_IN_CONTENT_LICENSE,
  BUILT_IN_CONTENT_SOURCE,
  CONTENT_CONTRACT_VERSION,
  computeQuestionPlanHashes,
} from '@/dictionary/content-contract';
import { QUESTION_TEMPLATE_VERSION, sha256Hex } from '@/learning/content-hash';

export const PACKAGE_WORDS: WordRecord[] = [
  {
    id: 'w-reservoir',
    word: 'reservoir',
    lemma: 'reservoir',
    phonetic: '/ˈɹɛzəvˌwɑɹ/',
    partOfSpeech: ['n.'],
    coreMeaningZh: ['水库'],
    secondaryMeanings: [{ partOfSpeech: 'n.', meaningZh: '储备' }],
    exampleSentence: 'The reservoir supplies water to the town.',
    exampleTranslation: '这座水库为小镇供水。',
    surfaceFormInExample: 'reservoir',
    difficulty: 3,
    frequencyRank: 5907,
    source: BUILT_IN_CONTENT_SOURCE,
    license: BUILT_IN_CONTENT_LICENSE,
  },
  {
    id: 'w-bench',
    word: 'bench',
    lemma: 'bench',
    phonetic: '/ˈbɛntʃ/',
    partOfSpeech: ['n.'],
    coreMeaningZh: ['长椅'],
    exampleSentence: 'They sat on a bench in the park.',
    exampleTranslation: '他们坐在公园的长椅上。',
    surfaceFormInExample: 'bench',
    difficulty: 2,
    frequencyRank: 3000,
    source: BUILT_IN_CONTENT_SOURCE,
    license: BUILT_IN_CONTENT_LICENSE,
  },
  {
    id: 'w-candle',
    word: 'candle',
    lemma: 'candle',
    phonetic: '/ˈkændəl/',
    partOfSpeech: ['n.'],
    coreMeaningZh: ['蜡烛'],
    exampleSentence: 'She lit a candle on the table.',
    exampleTranslation: '她在桌上点了一支蜡烛。',
    surfaceFormInExample: 'candle',
    difficulty: 1,
    frequencyRank: 2500,
    source: BUILT_IN_CONTENT_SOURCE,
    license: BUILT_IN_CONTENT_LICENSE,
  },
  {
    id: 'w-mirror',
    word: 'mirror',
    lemma: 'mirror',
    phonetic: '/ˈmɪɹɚ/',
    partOfSpeech: ['n.'],
    coreMeaningZh: ['镜子'],
    exampleSentence: 'She checked her hair in the mirror.',
    exampleTranslation: '她在镜子里整理头发。',
    surfaceFormInExample: 'mirror',
    difficulty: 3,
    frequencyRank: 4000,
    source: BUILT_IN_CONTENT_SOURCE,
    license: BUILT_IN_CONTENT_LICENSE,
  },
];

export const PACKAGE_DECKS: DeckRecord[] = [
  {
    id: 'deck-daily-high-frequency',
    name: '日常高频',
    source: BUILT_IN_CONTENT_SOURCE,
    license: BUILT_IN_CONTENT_LICENSE,
    wordIds: ['w-bench', 'w-candle'],
    wordDifficulties: { 'w-bench': 2, 'w-candle': 1 },
  },
  {
    id: 'deck-cet4',
    name: '四级',
    source: BUILT_IN_CONTENT_SOURCE,
    license: BUILT_IN_CONTENT_LICENSE,
    wordIds: ['w-bench', 'w-mirror', 'w-reservoir'],
    wordDifficulties: { 'w-bench': 2, 'w-mirror': 3, 'w-reservoir': 2 },
  },
  {
    id: 'deck-cet6',
    name: '六级',
    source: BUILT_IN_CONTENT_SOURCE,
    license: BUILT_IN_CONTENT_LICENSE,
    wordIds: ['w-mirror', 'w-reservoir'],
    wordDifficulties: { 'w-mirror': 3, 'w-reservoir': 3 },
  },
];

export async function buildPackageTexts(): Promise<{
  texts: Record<string, string>;
  manifest: DictionaryContentManifest;
  questions: WordQuestionPlan[];
}> {
  const wordsById = new Map(PACKAGE_WORDS.map((word) => [word.id, word]));
  const questions: WordQuestionPlan[] = [];
  for (const word of PACKAGE_WORDS) {
    const others = PACKAGE_WORDS.filter((candidate) => candidate.id !== word.id);
    const distractors = others.map((candidate) => candidate.id) as [string, string, string];
    const draft: WordQuestionPlan = {
      wordId: word.id,
      enToZh: { distractors, checkedContentHash: '' },
      zhToEn: { distractors, checkedContentHash: '' },
      contextChoice: {
        distractors: others.map((candidate) => ({
          wordId: candidate.id,
          surfaceForm: candidate.word,
        })) as [
          { wordId: string; surfaceForm: string },
          { wordId: string; surfaceForm: string },
          { wordId: string; surfaceForm: string },
        ],
        checkedContentHash: '',
      },
      spelling: { prefixLength: 1, checkedContentHash: '' },
    };
    const hashes = await computeQuestionPlanHashes(word, draft, wordsById);
    questions.push({
      ...draft,
      enToZh: { ...draft.enToZh, checkedContentHash: hashes.enToZh },
      zhToEn: { ...draft.zhToEn!, checkedContentHash: hashes.zhToEn! },
      contextChoice: { ...draft.contextChoice!, checkedContentHash: hashes.contextChoice! },
      spelling: { ...draft.spelling!, checkedContentHash: hashes.spelling! },
    });
  }
  const texts: Record<string, string> = {
    'words.json': `${JSON.stringify(PACKAGE_WORDS, null, 2)}\n`,
    'decks.json': `${JSON.stringify(PACKAGE_DECKS, null, 2)}\n`,
    'questions.json': `${JSON.stringify(questions, null, 2)}\n`,
    'source-metadata.json': '{"schemaVersion":1,"contentVersion":"1"}\n',
    'LICENSE.txt': 'test license\n',
  };
  const files = Object.fromEntries(
    await Promise.all(
      Object.entries({
        words: texts['words.json']!,
        decks: texts['decks.json']!,
        questions: texts['questions.json']!,
        sourceMetadata: texts['source-metadata.json']!,
        license: texts['LICENSE.txt']!,
      }).map(async ([key, text]) => [
        key,
        { sha256: await sha256Hex(text), bytes: Buffer.byteLength(text) },
      ]),
    ),
  ) as DictionaryContentManifest['files'];
  const manifest: DictionaryContentManifest = {
    schemaVersion: 1,
    contentContractVersion: CONTENT_CONTRACT_VERSION,
    dictionaryVersion: '1',
    generatedAt: '2026-10-23T00:00:00.000Z',
    datasetId: 'bingeup-built-in',
    questionTemplateVersion: QUESTION_TEMPLATE_VERSION,
    files,
    counts: { effectiveWords: 4, decks: 3, questionPlans: 4 },
    source: { content: BUILT_IN_CONTENT_SOURCE, license: BUILT_IN_CONTENT_LICENSE },
  };
  texts['manifest.json'] = `${JSON.stringify(manifest, null, 2)}\n`;
  return { texts, manifest, questions };
}

export function packageFetchMock(texts: Record<string, string>) {
  return async (input: RequestInfo | URL) => {
    const path = String(input).split('/').pop()!;
    if (!(path in texts)) return new Response('', { status: 404 });
    return new Response(texts[path]);
  };
}
