import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeckRecord, DictionaryContentManifest, WordQuestionPlan, WordRecord } from '@/types';
import { CONTENT_FILE_NAMES } from '@/dictionary/content-contract';
import { sha256Hex } from '@/learning/content-hash';

export const DICTIONARY_DIR = join(process.cwd(), 'public/dictionaries');
export const MANIFEST_PATH = join(DICTIONARY_DIR, 'manifest.json');

export const CONTENT_FILE_PATHS = {
  words: 'words.json',
  decks: 'decks.json',
  questions: 'questions.json',
  sourceMetadata: 'source-metadata.json',
  license: 'LICENSE.txt',
} as const satisfies Record<(typeof CONTENT_FILE_NAMES)[number], string>;

export interface LoadedDictionaryPackage {
  texts: Record<(typeof CONTENT_FILE_NAMES)[number], string>;
  words: WordRecord[];
  decks: DeckRecord[];
  questions: WordQuestionPlan[];
  files: DictionaryContentManifest['files'];
  fileHashes: Record<keyof DictionaryContentManifest['files'], string>;
}

export function readManifest(): DictionaryContentManifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as DictionaryContentManifest;
}

/** 内容版本只由源元数据声明，生成 manifest 时不得从已有 manifest 回读。 */
export function readContentVersion(sourceMetadata: string): string {
  let source: { schemaVersion?: unknown; contentVersion?: unknown };
  try {
    source = JSON.parse(sourceMetadata) as { schemaVersion?: unknown; contentVersion?: unknown };
  } catch (error) {
    throw new Error(
      `源元数据不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (source.schemaVersion !== 1) {
    throw new Error('源元数据 schemaVersion 必须为 1');
  }
  if (typeof source.contentVersion !== 'string' || source.contentVersion.trim() === '') {
    throw new Error('源元数据缺少 contentVersion');
  }
  return source.contentVersion;
}

/** 构建与校验共用同一套当前包读取、哈希和 JSON 解析规则。 */
export async function loadDictionaryPackage(): Promise<LoadedDictionaryPackage> {
  const texts = Object.fromEntries(
    CONTENT_FILE_NAMES.map((name) => [
      name,
      readFileSync(join(DICTIONARY_DIR, CONTENT_FILE_PATHS[name]), 'utf8'),
    ]),
  ) as Record<(typeof CONTENT_FILE_NAMES)[number], string>;
  const files = Object.fromEntries(
    await Promise.all(
      CONTENT_FILE_NAMES.map(async (name) => [
        name,
        { sha256: await sha256Hex(texts[name]), bytes: Buffer.byteLength(texts[name]) },
      ]),
    ),
  ) as DictionaryContentManifest['files'];
  const fileHashes = Object.fromEntries(
    CONTENT_FILE_NAMES.map((name) => [name, files[name].sha256]),
  ) as Record<keyof DictionaryContentManifest['files'], string>;

  return {
    texts,
    words: JSON.parse(texts.words) as WordRecord[],
    decks: JSON.parse(texts.decks) as DeckRecord[],
    questions: JSON.parse(texts.questions) as WordQuestionPlan[],
    files,
    fileHashes,
  };
}
