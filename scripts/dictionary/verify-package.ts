import type { DictionaryContentManifest } from '@/types';
import { CONTENT_FILE_NAMES, validateContentPackage } from '@/dictionary/content-contract';
import { loadDictionaryPackage, readContentVersion, readManifest } from './package';

async function main(): Promise<void> {
  const manifest = readManifest() as DictionaryContentManifest & { schemaVersion: number };
  if (manifest.schemaVersion !== 1) {
    throw new Error(`词库 manifest schemaVersion 必须为 1：${manifest.schemaVersion}`);
  }
  const content = await loadDictionaryPackage();
  const sourceVersion = readContentVersion(content.texts.sourceMetadata);
  if (manifest.dictionaryVersion !== sourceVersion) {
    throw new Error(
      `manifest 内容版本与源元数据不一致：${manifest.dictionaryVersion} / ${sourceVersion}`,
    );
  }
  const byteErrors = CONTENT_FILE_NAMES.filter(
    (name) => content.files[name].bytes !== manifest.files[name]?.bytes,
  );
  if (byteErrors.length > 0) {
    throw new Error(`词库文件字节数不一致：${byteErrors.join('、')}`);
  }
  const validation = await validateContentPackage({
    manifest,
    words: content.words,
    decks: content.decks,
    questions: content.questions,
    fileHashes: content.fileHashes,
  });
  if (!validation.valid) {
    console.error(`词库包校验失败：${validation.errors.length} 项`);
    for (const error of validation.errors.slice(0, 20)) console.error(`  ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `词库包校验通过：有效 ${content.words.length}，词库 ${content.decks.length}，题组 ${content.questions.length}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
