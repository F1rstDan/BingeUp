import { renameSync, writeFileSync } from 'node:fs';
import type { DictionaryContentManifest } from '@/types';
import {
  BUILT_IN_CONTENT_LICENSE,
  BUILT_IN_CONTENT_SOURCE,
  CONTENT_CONTRACT_VERSION,
  validateContentPackage,
} from '@/dictionary/content-contract';
import { QUESTION_TEMPLATE_VERSION } from '@/learning/content-hash';
import { MANIFEST_PATH, loadDictionaryPackage, readContentVersion } from './package';

const DATASET_ID = 'bingeup-built-in';

async function main(): Promise<void> {
  const content = await loadDictionaryPackage();
  const dictionaryVersion = readContentVersion(content.texts.sourceMetadata);
  const manifest: DictionaryContentManifest = {
    schemaVersion: 1,
    contentContractVersion: CONTENT_CONTRACT_VERSION,
    dictionaryVersion,
    generatedAt: new Date().toISOString(),
    datasetId: DATASET_ID,
    questionTemplateVersion: QUESTION_TEMPLATE_VERSION,
    files: content.files,
    counts: {
      effectiveWords: content.words.length,
      decks: content.decks.length,
      questionPlans: content.questions.length,
    },
    source: { content: BUILT_IN_CONTENT_SOURCE, license: BUILT_IN_CONTENT_LICENSE },
  };
  const validation = await validateContentPackage({
    manifest,
    words: content.words,
    decks: content.decks,
    questions: content.questions,
    fileHashes: content.fileHashes,
  });
  if (!validation.valid) {
    throw new Error(`词库内容包校验失败：${validation.errors.slice(0, 10).join('；')}`);
  }

  const tempPath = `${MANIFEST_PATH}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  renameSync(tempPath, MANIFEST_PATH);
  console.log(
    `词库 manifest 已生成：有效 ${content.words.length}，词库 ${content.decks.length}，题组 ${content.questions.length}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
