import type {
  DeckRecord,
  DictionaryContentManifest,
  SecondaryMeaning,
  WordQuestionPlan,
  WordRecord,
} from '@/types';
import {
  QUESTION_TEMPLATE_VERSION,
  contextPrompt,
  hashQuestionInput,
  primaryMeaning,
  primaryPartOfSpeech,
  questionPromptFor,
  referenceFor,
  spellingHintFor,
  type QuestionHashInput,
} from '@/learning/content-hash';

/** 正式内置词条使用的词性白名单。 */
export const VALID_PARTS_OF_SPEECH = new Set([
  'n.',
  'v.',
  'adj.',
  'adv.',
  'prep.',
  'conj.',
  'pron.',
  'num.',
  'art.',
  'int.',
  'det.',
  'abbr.',
  'aux.',
]);

export const CONTENT_CONTRACT_VERSION = 'learning-content-v1';
export const BUILT_IN_CONTENT_SOURCE = 'bingeup-dictionary';
export const BUILT_IN_CONTENT_LICENSE = 'LicenseRef-BingeUp-Dictionary-v1';
export const BUILT_IN_DECK_IDS = ['deck-daily-high-frequency', 'deck-cet4', 'deck-cet6'] as const;
export const CONTENT_FILE_NAMES = [
  'words',
  'decks',
  'questions',
  'sourceMetadata',
  'license',
] as const;

export interface ContentValidationResult {
  valid: boolean;
  errors: string[];
}

function textLength(value: string): number {
  return [...value].length;
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/** 主释义与其他义项共用的文本规则。 */
export function validateMeaningText(value: unknown): string[] {
  if (typeof value !== 'string') return ['释义必须是字符串'];
  const errors: string[] = [];
  if (value !== value.trim()) errors.push('释义首尾不能有空白');
  const length = textLength(value);
  if (length < 1 || length > 24) errors.push(`释义长度必须在 1–24 字符之间，当前 ${length}`);
  if (/[\r\n]/.test(value)) errors.push('释义不能包含换行');
  if (/[；;，,]/.test(value)) errors.push('释义不能拼接其他义项');
  if (/^(n|v|adj|adv|prep|conj|pron|num|art|int|det|abbr|aux)\.\s*/i.test(value)) {
    errors.push('释义不能包含词性前缀');
  }
  return errors;
}

function validateSecondaryMeaning(meaning: SecondaryMeaning): string[] {
  if (!isNonEmpty(meaning.partOfSpeech)) return ['其他义项缺少词性'];
  if (!VALID_PARTS_OF_SPEECH.has(meaning.partOfSpeech)) {
    return [`其他义项词性不在白名单：${meaning.partOfSpeech}`];
  }
  return validateMeaningText(meaning.meaningZh);
}

function countWholeWord(text: string, word: string): number {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...text.matchAll(new RegExp(`\\b${escaped}\\b`, 'gi'))].length;
}

/** 正式内置词条的严格结构检查。语义仍需独立复核。 */
export function validateBuiltInWordRecord(record: WordRecord): string[] {
  const errors: string[] = [];
  if (!isNonEmpty(record.id)) errors.push('id 不能为空');
  if (!isNonEmpty(record.word)) errors.push('word 不能为空');
  if (!isNonEmpty(record.lemma)) errors.push('lemma 不能为空');
  if (record.word !== record.lemma) errors.push('word 必须等于 lemma');
  if (record.word !== record.word.trim()) errors.push('word 首尾不能有空白');
  if (!/^[A-Za-z][A-Za-z'-]*$/.test(record.word)) errors.push('word 必须是单个规范英语词形');

  if (!Array.isArray(record.partOfSpeech) || record.partOfSpeech.length !== 1) {
    errors.push('partOfSpeech 必须恰好一项');
  } else if (!VALID_PARTS_OF_SPEECH.has(record.partOfSpeech[0]!)) {
    errors.push(`partOfSpeech 不在白名单：${record.partOfSpeech[0]}`);
  }

  if (!Array.isArray(record.coreMeaningZh) || record.coreMeaningZh.length !== 1) {
    errors.push('coreMeaningZh 必须恰好一项');
  } else {
    errors.push(...validateMeaningText(record.coreMeaningZh[0]));
  }

  const secondary = record.secondaryMeanings ?? [];
  if (!Array.isArray(secondary)) {
    errors.push('secondaryMeanings 必须是数组');
  } else {
    if (secondary.length > 2) errors.push('secondaryMeanings 最多两项');
    const seen = new Set<string>();
    for (const meaning of secondary) {
      if (!meaning || typeof meaning !== 'object') {
        errors.push('其他义项结构非法');
        continue;
      }
      errors.push(...validateSecondaryMeaning(meaning));
      const key = `${meaning.partOfSpeech}\u0000${meaning.meaningZh}`;
      if (seen.has(key)) errors.push(`其他义项重复：${meaning.meaningZh}`);
      seen.add(key);
      if (record.coreMeaningZh[0] === meaning.meaningZh) {
        errors.push(`其他义项与主释义重复：${meaning.meaningZh}`);
      }
    }
  }

  if (!isNonEmpty(record.exampleSentence)) errors.push('exampleSentence 必填');
  else {
    if (record.exampleSentence.includes('____')) errors.push('原句不能预留空位');
    if (/[\r\n]/.test(record.exampleSentence)) errors.push('例句不能包含换行');
    if (!/[.!?]["'”’)]?$/.test(record.exampleSentence.trim())) {
      errors.push('例句必须是完整句子');
    }
  }
  if (!isNonEmpty(record.exampleTranslation)) errors.push('exampleTranslation 必填');
  if (!isNonEmpty(record.surfaceFormInExample)) errors.push('surfaceFormInExample 必填');
  if (
    isNonEmpty(record.exampleSentence) &&
    isNonEmpty(record.surfaceFormInExample) &&
    countWholeWord(record.exampleSentence, record.surfaceFormInExample) !== 1
  ) {
    errors.push('surfaceFormInExample 必须在原句中按整词恰好出现一次');
  }

  if (!isNonEmpty(record.phonetic) || !/^\/.*\/$/.test(record.phonetic.trim())) {
    errors.push('phonetic 必须是一组斜线包围的 IPA');
  }
  if (!Number.isInteger(record.difficulty) || record.difficulty < 1 || record.difficulty > 4) {
    errors.push('difficulty 必须是 1–4 的整数');
  }
  if (!Number.isInteger(record.frequencyRank) || record.frequencyRank < 1) {
    errors.push('frequencyRank 必须是正整数');
  }
  if (!isNonEmpty(record.source)) errors.push('source 不能为空');
  if (!isNonEmpty(record.license)) errors.push('license 不能为空');
  return errors;
}

function optionsFor(
  type: 'en-to-zh' | 'zh-to-en',
  target: WordRecord,
  distractors: WordRecord[],
): string[] {
  return type === 'en-to-zh'
    ? [primaryMeaning(target), ...distractors.map(primaryMeaning)]
    : [target.word, ...distractors.map((word) => word.word)];
}

function hashInputForChoice(
  type: 'en-to-zh' | 'zh-to-en',
  target: WordRecord,
  distractors: WordRecord[],
): QuestionHashInput {
  return {
    type,
    templateVersion: QUESTION_TEMPLATE_VERSION,
    prompt: questionPromptFor(type, target),
    partOfSpeech: primaryPartOfSpeech(target),
    correctAnswer: type === 'en-to-zh' ? primaryMeaning(target) : target.word,
    options: optionsFor(type, target, distractors),
    references: [referenceFor(target), ...distractors.map(referenceFor)],
  };
}

function hashInputForContext(
  target: WordRecord,
  plan: NonNullable<WordQuestionPlan['contextChoice']>,
  wordsById: Map<string, WordRecord>,
): QuestionHashInput {
  const distractors = plan.distractors.map((item) => wordsById.get(item.wordId)!);
  return {
    type: 'context-choice',
    templateVersion: QUESTION_TEMPLATE_VERSION,
    prompt: contextPrompt(target),
    partOfSpeech: primaryPartOfSpeech(target),
    correctAnswer: target.surfaceFormInExample!,
    options: [target.surfaceFormInExample!, ...plan.distractors.map((item) => item.surfaceForm)],
    references: [referenceFor(target), ...distractors.map(referenceFor)],
  };
}

function hashInputForSpelling(
  target: WordRecord,
  plan: NonNullable<WordQuestionPlan['spelling']>,
): QuestionHashInput {
  return {
    type: 'spelling',
    templateVersion: QUESTION_TEMPLATE_VERSION,
    prompt: questionPromptFor('spelling', target),
    partOfSpeech: primaryPartOfSpeech(target),
    correctAnswer: target.word,
    options: [target.word],
    references: [referenceFor(target)],
    spellingHint: spellingHintFor(target, plan.prefixLength),
  };
}

export interface ComputedQuestionHashes {
  enToZh: string;
  zhToEn: string | null;
  contextChoice: string | null;
  spelling: string | null;
}

/** 从词条和固定干扰项计算应有哈希；构建器与校验器共用。 */
export async function computeQuestionPlanHashes(
  target: WordRecord,
  plan: WordQuestionPlan,
  wordsById: Map<string, WordRecord>,
): Promise<ComputedQuestionHashes> {
  const pick = (ids: string[]): WordRecord[] => ids.map((id) => wordsById.get(id)!);
  const enToZh = await hashQuestionInput(
    hashInputForChoice('en-to-zh', target, pick(plan.enToZh.distractors)),
  );
  const zhToEn = plan.zhToEn
    ? await hashQuestionInput(hashInputForChoice('zh-to-en', target, pick(plan.zhToEn.distractors)))
    : null;
  const contextChoice = plan.contextChoice
    ? await hashQuestionInput(hashInputForContext(target, plan.contextChoice, wordsById))
    : null;
  const spelling = plan.spelling
    ? await hashQuestionInput(hashInputForSpelling(target, plan.spelling))
    : null;
  return { enToZh, zhToEn, contextChoice, spelling };
}

function validateDistractorIds(
  target: WordRecord,
  plan: WordQuestionPlan,
  wordsById: Map<string, WordRecord>,
  errors: string[],
): void {
  for (const [label, set] of [
    ['enToZh', plan.enToZh],
    ['zhToEn', plan.zhToEn],
  ] as const) {
    if (!set) continue;
    if (!Array.isArray(set.distractors) || set.distractors.length !== 3) {
      errors.push(`${label}.distractors 必须恰好三项`);
      continue;
    }
    if (new Set(set.distractors).size !== 3) errors.push(`${label}.distractors 不能重复`);
    if (set.distractors.includes(target.id)) errors.push(`${label}.distractors 不能包含目标词`);
    for (const id of set.distractors) {
      if (!isNonEmpty(id) || !wordsById.has(id)) errors.push(`${label} 引用不存在的单词：${id}`);
    }
  }
  if (plan.contextChoice) {
    const items = plan.contextChoice.distractors;
    if (!Array.isArray(items) || items.length !== 3) {
      errors.push('contextChoice.distractors 必须恰好三项');
    } else {
      const ids = items.map((item) => item.wordId);
      if (new Set(ids).size !== 3) errors.push('contextChoice 干扰词不能重复');
      if (ids.includes(target.id)) errors.push('contextChoice 不能包含目标词');
      if (new Set(items.map((item) => item.surfaceForm)).size !== 3) {
        errors.push('contextChoice 的表层词形不能重复');
      }
      for (const item of items) {
        if (!isNonEmpty(item.surfaceForm)) errors.push('contextChoice 干扰项缺少表层词形');
        if (!wordsById.has(item.wordId)) {
          errors.push(`contextChoice 引用不存在的单词：${item.wordId}`);
        }
      }
    }
  }
}

function validateChoiceAmbiguity(
  target: WordRecord,
  plan: WordQuestionPlan,
  wordsById: Map<string, WordRecord>,
  errors: string[],
): void {
  const targetMeanings = new Set([
    primaryMeaning(target),
    ...(target.secondaryMeanings ?? []).map((item) => item.meaningZh),
  ]);
  for (const [label, ids] of [
    ['enToZh', plan.enToZh.distractors],
    ['zhToEn', plan.zhToEn?.distractors ?? null],
  ] as const) {
    if (!ids) continue;
    const meanings: string[] = [];
    for (const id of ids) {
      const word = wordsById.get(id);
      if (!word) continue;
      const meaning = primaryMeaning(word);
      meanings.push(meaning);
      if (targetMeanings.has(meaning)) {
        errors.push(`${label} 干扰项与目标义项重复：${word.word} / ${meaning}`);
      }
      for (const secondary of word.secondaryMeanings ?? []) {
        if (secondary.meaningZh === primaryMeaning(target)) {
          errors.push(
            `${label} 干扰项的常见义项命中目标主释义：${word.word} / ${secondary.meaningZh}`,
          );
        }
      }
    }
    if (new Set(meanings).size !== meanings.length) {
      errors.push(`${label} 干扰项释义不能重复`);
    }
  }
}

/** 校验单个固定题组，包括依赖哈希。 */
export async function validateQuestionPlan(
  target: WordRecord,
  plan: WordQuestionPlan,
  wordsById: Map<string, WordRecord>,
  options: { verifyHashes?: boolean } = {},
): Promise<string[]> {
  const errors: string[] = [];
  if (plan.wordId !== target.id) errors.push('题组 wordId 与目标词不一致');
  if (!plan.enToZh) errors.push('enToZh 必填');
  validateDistractorIds(target, plan, wordsById, errors);
  validateChoiceAmbiguity(target, plan, wordsById, errors);

  if (plan.spelling) {
    const length = [...target.word].length;
    if (!Number.isInteger(plan.spelling.prefixLength)) {
      errors.push('spelling.prefixLength 必须是整数');
    } else if (plan.spelling.prefixLength < 1 || plan.spelling.prefixLength >= length) {
      errors.push('spelling.prefixLength 必须大于 0 且不能显示完整词元');
    }
    if (length <= 3) errors.push('过短词元不能启用拼写计划');
  }

  if (errors.length === 0 && options.verifyHashes !== false) {
    const hashes = await computeQuestionPlanHashes(target, plan, wordsById);
    if (plan.enToZh.checkedContentHash !== hashes.enToZh) errors.push('enToZh 检查哈希失效');
    if (plan.zhToEn && plan.zhToEn.checkedContentHash !== hashes.zhToEn) {
      errors.push('zhToEn 检查哈希失效');
    }
    if (plan.contextChoice && plan.contextChoice.checkedContentHash !== hashes.contextChoice) {
      errors.push('contextChoice 检查哈希失效');
    }
    if (plan.spelling && plan.spelling.checkedContentHash !== hashes.spelling) {
      errors.push('spelling 检查哈希失效');
    }
  }
  for (const [label, hash] of [
    ['enToZh', plan.enToZh?.checkedContentHash],
    ['zhToEn', plan.zhToEn?.checkedContentHash],
    ['contextChoice', plan.contextChoice?.checkedContentHash],
    ['spelling', plan.spelling?.checkedContentHash],
  ] as const) {
    if (hash !== undefined && !isSha256(hash)) errors.push(`${label} 检查哈希格式非法`);
  }
  return errors;
}

export interface ContentPackageInput {
  manifest: DictionaryContentManifest;
  words: WordRecord[];
  decks: DeckRecord[];
  questions: WordQuestionPlan[];
  fileHashes: Record<keyof DictionaryContentManifest['files'], string>;
  /** 运行时已校验整包文件哈希时可跳过逐题重算，避免启动过慢。 */
  verifyQuestionHashes?: boolean;
}

/** 全量内容包检查；调用方负责读取文件和哈希。 */
export async function validateContentPackage(
  input: ContentPackageInput,
): Promise<ContentValidationResult> {
  const errors: string[] = [];
  const { manifest, words, decks, questions, fileHashes } = input;
  if (manifest.schemaVersion !== 1) errors.push('内容 manifest schemaVersion 必须为 1');
  if (manifest.contentContractVersion !== CONTENT_CONTRACT_VERSION) {
    errors.push(`内容契约版本不支持：${manifest.contentContractVersion}`);
  }
  if (manifest.questionTemplateVersion !== QUESTION_TEMPLATE_VERSION) {
    errors.push(`题组模板版本不支持：${manifest.questionTemplateVersion}`);
  }
  const manifestFileNames = Object.keys(manifest.files);
  if (manifestFileNames.length !== CONTENT_FILE_NAMES.length) {
    errors.push('manifest 文件数量必须为 5');
  }
  for (const name of CONTENT_FILE_NAMES) {
    const file = manifest.files[name];
    if (!file) {
      errors.push(`manifest 缺少文件：${name}`);
      continue;
    }
    if (fileHashes[name] !== file.sha256) errors.push(`包内文件哈希不一致：${name}`);
  }

  const wordsById = new Map<string, WordRecord>();
  for (const word of words) {
    if (wordsById.has(word.id)) errors.push(`重复有效 ID：${word.id}`);
    wordsById.set(word.id, word);
  }
  const normalizedWords = new Map<string, string>();
  for (const word of words) {
    errors.push(...validateBuiltInWordRecord(word).map((error) => `${word.id}: ${error}`));
    if (word.source !== BUILT_IN_CONTENT_SOURCE || word.license !== BUILT_IN_CONTENT_LICENSE) {
      errors.push(`${word.id}: source/license 不是本版内容声明`);
    }
    const key = word.word.toLowerCase();
    if (normalizedWords.has(key)) errors.push(`规范词形重复：${word.word}`);
    normalizedWords.set(key, word.id);
  }

  const decksById = new Map<string, DeckRecord>();
  const wordIdsInDecks = new Set<string>();
  for (const deck of decks) {
    if (decksById.has(deck.id)) errors.push(`重复词库 ID：${deck.id}`);
    decksById.set(deck.id, deck);
    if (!BUILT_IN_DECK_IDS.includes(deck.id as (typeof BUILT_IN_DECK_IDS)[number])) {
      errors.push(`未知内置词库：${deck.id}`);
    }
    if (deck.source !== BUILT_IN_CONTENT_SOURCE || deck.license !== BUILT_IN_CONTENT_LICENSE) {
      errors.push(`${deck.id}: source/license 不是本版内容声明`);
    }
    if (new Set(deck.wordIds).size !== deck.wordIds.length) {
      errors.push(`${deck.id}: wordIds 重复`);
    }
    for (const wordId of deck.wordIds) {
      wordIdsInDecks.add(wordId);
      if (!wordsById.has(wordId)) errors.push(`${deck.id}: 引用不存在的单词 ${wordId}`);
      const difficulty = deck.wordDifficulties?.[wordId];
      if (!Number.isInteger(difficulty) || difficulty! < 1 || difficulty! > 4) {
        errors.push(`${deck.id}: ${wordId} 缺少合法词库内难度`);
      }
    }
  }
  if (decks.length !== BUILT_IN_DECK_IDS.length) errors.push('内置词库数量必须为 3');
  for (const deckId of BUILT_IN_DECK_IDS) {
    if (!decksById.has(deckId)) errors.push(`manifest 缺少内置词库：${deckId}`);
  }
  for (const word of words) {
    if (!wordIdsInDecks.has(word.id)) errors.push(`有效词没有词库成员关系：${word.id}`);
  }

  const plansByWordId = new Map<string, WordQuestionPlan>();
  for (const plan of questions) {
    if (plansByWordId.has(plan.wordId)) errors.push(`重复题组：${plan.wordId}`);
    plansByWordId.set(plan.wordId, plan);
  }
  for (const word of words) {
    const plan = plansByWordId.get(word.id);
    if (!plan) {
      errors.push(`${word.id}: 缺少固定题组`);
      continue;
    }
    errors.push(
      ...(
        await validateQuestionPlan(word, plan, wordsById, {
          verifyHashes: input.verifyQuestionHashes,
        })
      ).map((e) => `${word.id}: ${e}`),
    );
  }
  for (const wordId of plansByWordId.keys()) {
    if (!wordsById.has(wordId)) errors.push(`题组引用不存在的有效词：${wordId}`);
  }

  if (manifest.counts.effectiveWords !== words.length) errors.push('manifest 有效词数不一致');
  if (manifest.counts.questionPlans !== questions.length) errors.push('manifest 题组数不一致');
  if (manifest.counts.decks !== decks.length) errors.push('manifest 词库数不一致');
  if (manifest.source.content !== BUILT_IN_CONTENT_SOURCE) errors.push('manifest 内容来源不正确');
  if (manifest.source.license !== BUILT_IN_CONTENT_LICENSE)
    errors.push('manifest 许可证标识不正确');
  return { valid: errors.length === 0, errors };
}
