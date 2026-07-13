/**
 * 构建流水线内部类型定义。
 * 这些类型独立于 src/types/，避免构建脚本依赖浏览器扩展运行时。
 */

/** ECDICT CSV 原始行（部分字段）。 */
export interface EcdictRow {
  word: string;
  phonetic: string;
  definition: string;
  translation: string;
  pos: string;
  collins: string;
  oxford: string;
  tag: string;
  bnc: string;
  frq: string;
  exchange: string;
  detail: string;
}

/** 解析后的例句，含目标词表层词形和位置。 */
export interface ParsedExample {
  sentence: string;
  translationZh: string;
  surfaceForm: string;
  surfaceStart: number;
  surfaceEnd: number;
}

/** 难度计算规则版本。 */
export const DIFFICULTY_RULE_VERSION = 1;

/**
 * 难度计算（1-4）。
 *
 * 规则（v1）：
 * - 1：Oxford 3000，或 frq 排名前 3000，或初高中基础词
 * - 2：CET4，或 frq 排名 3001-8000
 * - 3：CET6，或 frq 排名 8001-15000
 * - 4：其他首发词库中的低频词
 */
export type Difficulty = 1 | 2 | 3 | 4;

/** 词库 ID 常量。 */
export const DECK_IDS = {
  daily: 'deck-daily-high-frequency',
  cet4: 'deck-cet4',
  cet6: 'deck-cet6',
} as const;

/** 词库元数据。 */
export interface DeckMeta {
  id: string;
  name: string;
  description: string;
  source: string;
  license: string;
}

/** 单词构建中间表示。 */
export interface BuildWord {
  id: string;
  word: string;
  lemma: string;
  phonetic: string;
  partOfSpeech: string[];
  coreMeaningZh: string[];
  exampleSentence: string;
  exampleTranslation: string;
  surfaceFormInExample: string;
  difficulty: Difficulty;
  source: string;
  license: string;
  /** 该词所属的词库 ID 列表。 */
  deckIds: string[];
  /** 在每个词库中的难度。 */
  deckDifficulties: Record<string, Difficulty>;
  /** 词频排名（frq 优先，bnc 回退），越小越常用。 */
  frequencyRank: number;
  /** 是否为功能词（the, of, to 等）。 */
  isFunctionWord: boolean;
  /** 是否有合法的例句。 */
  hasValidExample: boolean;
}

/** 字典来源元数据。 */
export interface DictionarySourceMetadata {
  sourceName: 'ECDICT';
  repository: string;
  commitHash: string;
  importedAt: string;
  declaredLicense: 'MIT';
  licenseFileHash: string;
}

/** 构建 manifest。 */
export interface BuildManifest {
  schemaVersion: 1;
  dictionaryVersion: string;
  generatedAt: string;
  sourceCommit: string;
  sourceLicense: 'MIT';
  totalWordCount: number;
  decks: Record<string, number>;
  difficultyRuleVersion: number;
}