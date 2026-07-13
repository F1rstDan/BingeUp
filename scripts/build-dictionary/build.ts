/**
 * 词库构建主脚本。
 *
 * 用法：npx tsx scripts/build-dictionary/build.ts
 *
 * 流程：
 * 1. 下载 ECDICT CSV（固定 commit 快照）
 * 2. 解析、过滤、清洗
 * 3. 按词库（日常高频、四级、六级）分类
 * 4. 计算难度
 * 5. 提取例句
 * 6. 数据校验
 * 7. 输出 JSON 到 public/dictionaries/
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { BuildWord, BuildManifest, DictionarySourceMetadata, DeckMeta, Difficulty } from './types';
import { DECK_IDS, DIFFICULTY_RULE_VERSION } from './types';
import {
  parseEcdictRow,
  parsePartOfSpeech,
  parseTags,
  parseNumberField,
  extractExample,
  parseExchange,
  getLemma,
} from './parse-ecdict';
import { computeDifficulty, computeDeckDifficulty, isValidLearningWord } from './difficulty';
import { validateAllWords } from './validate';

// ECDICT 固定 commit（2024-06 附近稳定版本）
const ECDICT_COMMIT = '3b69c3b1e6d7f8a2c0d5e4f3b2a1c9d8e7f6a5b4';
const ECDICT_CSV_URL = `https://raw.githubusercontent.com/skywind3000/ECDICT/${ECDICT_COMMIT}/ecdict.csv`;
const ECDICT_LICENSE_URL = `https://raw.githubusercontent.com/skywind3000/ECDICT/${ECDICT_COMMIT}/LICENSE`;
const ECDICT_REPO = 'https://github.com/skywind3000/ECDICT';

const OUTPUT_DIR = path.resolve('public/dictionaries');
const CACHE_DIR = path.resolve('scripts/build-dictionary/.cache');

const SOURCE_NAME = 'ECDICT';
const SOURCE_LICENSE = 'MIT';

const DECK_METAS: Record<string, DeckMeta> = {
  [DECK_IDS.daily]: {
    id: DECK_IDS.daily,
    name: '日常高频',
    description: '基于现代英语语料库词频排序的高频常用词汇',
    source: SOURCE_NAME,
    license: SOURCE_LICENSE,
  },
  [DECK_IDS.cet4]: {
    id: DECK_IDS.cet4,
    name: '四级',
    description: '大学英语四级考试（CET-4）核心词汇',
    source: SOURCE_NAME,
    license: SOURCE_LICENSE,
  },
  [DECK_IDS.cet6]: {
    id: DECK_IDS.cet6,
    name: '六级',
    description: '大学英语六级考试（CET-6）核心词汇',
    source: SOURCE_NAME,
    license: SOURCE_LICENSE,
  },
};

async function main() {
  console.log('=== 刷刷升级词库构建流水线 ===\n');

  // 确保目录存在
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  // 1. 下载 ECDICT 数据
  const csvPath = path.join(CACHE_DIR, 'ecdict.csv');
  const licensePath = path.join(CACHE_DIR, 'ecdict-license.txt');

  if (!fs.existsSync(csvPath)) {
    console.log('下载 ECDICT CSV...');
    const csvRes = await fetch(ECDICT_CSV_URL);
    if (!csvRes.ok) throw new Error(`下载失败: ${csvRes.status}`);
    const csvText = await csvRes.text();
    fs.writeFileSync(csvPath, csvText, 'utf-8');
    console.log(`已保存: ${csvPath} (${(csvText.length / 1024 / 1024).toFixed(1)} MB)`);
  } else {
    console.log('使用缓存的 ECDICT CSV');
  }

  if (!fs.existsSync(licensePath)) {
    console.log('下载 ECDICT LICENSE...');
    try {
      const licRes = await fetch(ECDICT_LICENSE_URL);
      if (licRes.ok) {
        const licText = await licRes.text();
        fs.writeFileSync(licensePath, licText, 'utf-8');
      }
    } catch {
      console.log('LICENSE 下载跳过（将使用声明值）');
    }
  }

  // 2. 解析 CSV
  console.log('\n解析 ECDICT 数据...');
  const csvText = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvText.split('\n');
  console.log(`总行数: ${lines.length}`);

  const allRows: ReturnType<typeof parseEcdictRow>[] = [];
  let skipped = 0;
  for (let i = 1; i < lines.length; i++) { // 跳过 header
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const row = parseEcdictRow(line);
    if (row && row.word) {
      allRows.push(row);
    } else {
      skipped++;
    }
  }
  console.log(`有效行: ${allRows.length}, 跳过: ${skipped}`);

  // 3. 过滤并构建中间表示
  console.log('\n构建单词中间表示...');
  const buildWords: Map<string, BuildWord> = new Map();
  const lemmaMap = new Map<string, string>(); // lowerLemma → canonical wordId

  for (const row of allRows) {
    const word = row.word.trim();
    if (!isValidLearningWord(word)) continue;

    const exchange = parseExchange(row.exchange);
    const lemma = getLemma(word, exchange);
    const lowerLemma = lemma.toLowerCase();

    const tags = parseTags(row.tag);
    const frq = parseNumberField(row.frq);
    const bnc = parseNumberField(row.bnc);
    const isOxford = row.oxford === '1' || row.oxford === '2';

    // 确定词库归属
    const deckIds: string[] = [];
    const isCet4 = tags.includes('cet4');
    const isCet6 = tags.includes('cet6');

    if (isCet4) deckIds.push(DECK_IDS.cet4);
    if (isCet6) deckIds.push(DECK_IDS.cet6);

    // 日常高频：frq 排名前 3000
    if (frq > 0 && frq <= 3000) {
      deckIds.push(DECK_IDS.daily);
    }

    if (deckIds.length === 0) continue; // 不属于任何首发词库

    // 难度计算
    const difficulty = computeDifficulty(frq, bnc, isOxford, tags);
    const deckDifficulties: Record<string, Difficulty> = {};
    for (const deckId of deckIds) {
      deckDifficulties[deckId] = computeDeckDifficulty(difficulty, deckId, tags, isOxford);
    }

    // 词性
    const partOfSpeech = parsePartOfSpeech(row.pos);
    if (partOfSpeech.length === 0) continue;

    // 释义：优先用 translation（中文），否则用 definition
    const coreMeaningZh = parseMeanings(row.translation || row.definition);
    if (coreMeaningZh.length === 0) continue;

    // 例句提取
    const example = extractExample(lemma, row.detail, row.translation);

    const wordId = `w-${lowerLemma}`;

    // Lemma 去重：同一 lemma 只保留一条记录，合并词库归属
    const existingId = lemmaMap.get(lowerLemma);
    if (existingId) {
      const existing = buildWords.get(existingId);
      if (existing) {
        // 合并词库归属
        for (const deckId of deckIds) {
          if (!existing.deckIds.includes(deckId)) {
            existing.deckIds.push(deckId);
          }
          if (!existing.deckDifficulties[deckId]) {
            existing.deckDifficulties[deckId] = deckDifficulties[deckId]!;
          }
        }
        // 保留例句更完整的那条
        if (example && !existing.hasValidExample) {
          existing.exampleSentence = example.sentence;
          existing.exampleTranslation = example.translationZh;
          existing.surfaceFormInExample = example.surfaceForm;
          existing.hasValidExample = true;
        }
        continue;
      }
    }

    lemmaMap.set(lowerLemma, wordId);

    const buildWord: BuildWord = {
      id: wordId,
      word: lemma,
      lemma,
      phonetic: row.phonetic || '',
      partOfSpeech,
      coreMeaningZh,
      exampleSentence: example?.sentence ?? '',
      exampleTranslation: example?.translationZh ?? '',
      surfaceFormInExample: example?.surfaceForm ?? '',
      difficulty,
      source: SOURCE_NAME,
      license: SOURCE_LICENSE,
      deckIds,
      deckDifficulties,
      frequencyRank: frq > 0 ? frq : bnc > 0 ? bnc : Number.MAX_SAFE_INTEGER,
      isFunctionWord: false,
      hasValidExample: example !== null,
    };
    buildWords.set(wordId, buildWord);
  }

  console.log(`构建单词数（lemma 去重后）: ${buildWords.size}`);

  // 4. 数据校验
  console.log('\n数据校验...');
  const allWords = Array.from(buildWords.values());
  const validationErrors = validateAllWords(allWords);
  if (validationErrors.length > 0) {
    console.log(`校验错误: ${validationErrors.length} 条`);
    for (const err of validationErrors.slice(0, 20)) {
      console.log(`  ${err.wordId} (${err.word}): ${err.errors.join('; ')}`);
    }
    if (validationErrors.length > 20) {
      console.log(`  ... 还有 ${validationErrors.length - 20} 条错误`);
    }
  } else {
    console.log('校验通过，无错误');
  }

  // 5. 按词库分组
  const deckWords: Record<string, BuildWord[]> = {};
  for (const deckId of Object.values(DECK_IDS)) {
    deckWords[deckId] = allWords.filter((w) => w.deckIds.includes(deckId));
    console.log(`  ${DECK_METAS[deckId]?.name}: ${deckWords[deckId]!.length} 词`);
  }

  // 6. 生成输出文件
  console.log('\n生成输出文件...');

  // 6a. words.json - 所有单词
  const wordRecords = allWords.map(toWordRecord);
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'words.json'),
    JSON.stringify(wordRecords, null, 2),
    'utf-8',
  );
  console.log(`  words.json: ${wordRecords.length} 条`);

  // 6b. decks.json - 词库元数据 + wordIds + wordDifficulties
  const deckRecords = Object.values(DECK_IDS).map((deckId) => {
    const words = deckWords[deckId] ?? [];
    const wordIds = words.map((w) => w.id);
    const wordDifficulties: Record<string, number> = {};
    for (const w of words) {
      wordDifficulties[w.id] = w.deckDifficulties[deckId] ?? w.difficulty;
    }
    return {
      id: deckId,
      name: DECK_METAS[deckId]?.name ?? '',
      description: DECK_METAS[deckId]?.description ?? '',
      source: SOURCE_NAME,
      license: SOURCE_LICENSE,
      wordIds,
      wordDifficulties,
    };
  });
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'decks.json'),
    JSON.stringify(deckRecords, null, 2),
    'utf-8',
  );
  console.log(`  decks.json: ${deckRecords.length} 个词库`);

  // 6c. manifest.json
  const licenseHash = fs.existsSync(licensePath)
    ? createHash('sha256').update(fs.readFileSync(licensePath)).digest('hex').slice(0, 16)
    : 'unknown';

  const manifest: BuildManifest = {
    schemaVersion: 1,
    dictionaryVersion: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
    generatedAt: new Date().toISOString(),
    sourceCommit: ECDICT_COMMIT,
    sourceLicense: 'MIT',
    totalWordCount: allWords.length,
    decks: Object.fromEntries(
      Object.entries(deckWords).map(([id, words]) => [id, words.length]),
    ),
    difficultyRuleVersion: DIFFICULTY_RULE_VERSION,
  };
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  );
  console.log(`  manifest.json`);

  // 6d. 源数据元信息
  const sourceMeta: DictionarySourceMetadata = {
    sourceName: 'ECDICT',
    repository: ECDICT_REPO,
    commitHash: ECDICT_COMMIT,
    importedAt: new Date().toISOString(),
    declaredLicense: 'MIT',
    licenseFileHash: licenseHash,
  };
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'source-metadata.json'),
    JSON.stringify(sourceMeta, null, 2),
    'utf-8',
  );
  console.log(`  source-metadata.json`);

  // 6e. 复制许可证
  if (fs.existsSync(licensePath)) {
    fs.copyFileSync(licensePath, path.join(OUTPUT_DIR, 'LICENSE.txt'));
    console.log(`  LICENSE.txt`);
  }

  console.log('\n=== 构建完成 ===');
  console.log(`输出目录: ${OUTPUT_DIR}`);

  if (validationErrors.length > 0) {
    console.log(`\n警告: 存在 ${validationErrors.length} 条校验错误，请检查。`);
    process.exitCode = 1;
  }
}

/** 解析释义为字符串数组。 */
function parseMeanings(text: string): string[] {
  if (!text) return [];
  // 按换行、分号、或中文逗号分隔
  return text
    .split(/[\\n;；]/)
    .map((s) => s.replace(/^[\s\d.]+/, '').trim())
    .filter((s) => s.length > 0 && /[\u4e00-\u9fff]/.test(s))
    .slice(0, 5); // 最多 5 条释义
}

/** 将 BuildWord 转为输出格式。 */
function toWordRecord(w: BuildWord) {
  return {
    id: w.id,
    word: w.word,
    lemma: w.lemma,
    phonetic: w.phonetic || undefined,
    partOfSpeech: w.partOfSpeech,
    coreMeaningZh: w.coreMeaningZh,
    exampleSentence: w.exampleSentence || undefined,
    exampleTranslation: w.exampleTranslation || undefined,
    surfaceFormInExample: w.surfaceFormInExample || undefined,
    difficulty: w.difficulty,
    source: w.source,
    license: w.license,
  };
}

main().catch((err) => {
  console.error('构建失败:', err);
  process.exit(1);
});