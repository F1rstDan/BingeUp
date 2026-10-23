/**
 * 内置词库重建协调器。
 *
 * 命令：
 *   prepare           冻结 100 词试批和其余稳定 ID 批次
 *   accept <batchId>  校验候选词条、合入 IPA、生成固定题组和联合哈希
 *   review <batchId>  登记独立复核结果
 *   build             全部批次通过后生成 staging 候选包
 *   status            输出进度
 *
 * 状态文件只保存进度、哈希和复核绑定；身份映射只来自 legacy-registry.json。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  DeckRecord,
  DictionaryContentManifest,
  LegacyRegistry,
  LegacyRegistryEntry,
  WordQuestionPlan,
  WordRecord,
} from '@/types';
import {
  BUILT_IN_CONTENT_LICENSE,
  BUILT_IN_CONTENT_SOURCE,
  CONTENT_CONTRACT_VERSION,
  computeQuestionPlanHashes,
  validateBuiltInWordRecord,
  validateContentPackage,
  validateLegacyRegistry,
  validateQuestionPlan,
} from '@/dictionary/content-contract';
import {
  QUESTION_TEMPLATE_VERSION,
  canonicalJson,
  primaryMeaning,
  sha256Hex,
} from '@/learning/content-hash';

const ROOT = process.cwd();
const DATA_DIR = join(ROOT, 'data/dictionary-rebuild');
const BATCH_DIR = join(DATA_DIR, 'batches');
const STAGING_DIR = join(DATA_DIR, 'staging');
const STATE_PATH = join(DATA_DIR, 'state.json');
const LOCK_PATH = join(DATA_DIR, 'state.lock');
const PROMPTS = {
  generate: join(DATA_DIR, 'prompts/generate.md'),
  review: join(DATA_DIR, 'prompts/review.md'),
};
const IPA_PATH = join(DATA_DIR, 'sources/en_US.txt');
const IPA_SHA256 = '2af6f154a5c363275f052d1f85acedef38ed185ca9745aa4314be77f6b70de67';
const IPA_SELECTIONS_PATH = join(DATA_DIR, 'ipa-selections.json');
const IPA_OVERRIDES_PATH = join(DATA_DIR, 'ipa-overrides.json');
const PLAN_OVERRIDES_PATH = join(DATA_DIR, 'plan-overrides.json');
const DECK_IDS = ['deck-daily-high-frequency', 'deck-cet4', 'deck-cet6'] as const;
let cachedIpa: Map<string, string[]> | null = null;
let cachedSelections: { selections: Record<string, { index: number; reason: string }> } | null =
  null;
let cachedOverrides: {
  overrides: Record<string, { ipa: string; reason: string; reviewedBy: string }>;
} | null = null;
let cachedPlanOverrides: {
  synonymGroups?: string[][];
  words?: Record<
    string,
    { contextChoice?: boolean; spelling?: boolean; excludeDistractors?: string[]; reason?: string }
  >;
} | null = null;

interface SeedWord {
  id: string;
  word: string;
  difficulty: number;
  frequencyRank: number;
  decks: Array<{ deckId: string; difficulty: number }>;
}

interface Seed {
  schemaVersion: 1;
  datasetId: string;
  registryVersion: string;
  source: Record<string, string>;
  decks: Array<{ id: string; name: string; description: string }>;
  words: SeedWord[];
}

interface EffectiveWord {
  id: string;
  word: string;
  difficulty: number;
  frequencyRank: number;
  decks: Array<{ deckId: string; difficulty: number }>;
  disposition: LegacyRegistryEntry['disposition'];
}

interface CandidateEntry {
  wordId: string;
  word: string;
  partOfSpeech: string;
  coreMeaningZh: string;
  secondaryMeanings: Array<{ partOfSpeech: string; meaningZh: string }>;
  exampleSentence: string;
  exampleTranslation: string;
  surfaceFormInExample: string;
}

interface BatchState {
  id: string;
  kind: 'pilot' | 'main';
  wordIds: string[];
  inputHash: string;
  samplingSeed: string;
  sampleWordIds: string[];
  outputHash: string | null;
  /** 仅词条候选文件的哈希；用于区分重验与新生成。 */
  entryHash?: string | null;
  generationPromptHash: string;
  status: 'pending' | 'running' | 'needs-fix' | 'verified';
  attempts: number;
  generation: {
    provider: string;
    model: string;
    settings: Record<string, unknown>;
  } | null;
  review: {
    outputHash: string;
    promptHash: string;
    inspectedWordIds: string[];
    mode: 'full' | 'sample';
    reviewer: string;
    result: 'pass' | 'fail';
  } | null;
  failures: Array<{
    wordId: string;
    stage: 'structure' | 'semantics' | 'pronunciation' | 'question';
    code: string;
    message: string;
    attempts: number;
  }>;
  elapsedMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cost: { amount: number; currency: string } | null;
}

interface RebuildState {
  schemaVersion: 1;
  datasetId: string;
  seedHash: string;
  contractVersion: string;
  questionTemplateVersion: string;
  defaultPromptHashes: { generate: string; review: string };
  registryHash: string;
  seedReview: { reviewedWordIds: string[]; failures: Array<{ wordId: string; reason: string }> };
  wordAttempts?: Record<string, { promptHash: string; attempts: number }>;
  batches: BatchState[];
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function writeAtomic(path: string, text: string): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, text, 'utf8');
  renameSync(temp, path);
}

function writeJsonAtomic(path: string, value: unknown): void {
  writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJsonl<T>(path: string): T[] {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line) as T;
      } catch {
        throw new Error(`${path} 第 ${index + 1} 行不是合法 JSON`);
      }
    });
}

function writeJsonl(path: string, values: unknown[]): void {
  writeAtomic(path, values.map((value) => canonicalJson(value)).join('\n') + '\n');
}

function byteCompare(a: string, b: string): number {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return Buffer.compare(left, right);
}

function nodeSha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function acquireLock(): void {
  if (existsSync(LOCK_PATH)) {
    const lock = JSON.parse(readFileSync(LOCK_PATH, 'utf8')) as { pid: number; at: string };
    throw new Error(`状态文件已被协调者持有（PID ${lock.pid}，${lock.at}）`);
  }
  writeFileSync(LOCK_PATH, canonicalJson({ pid: process.pid, at: new Date().toISOString() }));
}

function releaseLock(): void {
  if (existsSync(LOCK_PATH)) rmSync(LOCK_PATH);
}

function withLock<T>(run: () => T): T {
  acquireLock();
  try {
    return run();
  } finally {
    releaseLock();
  }
}

function loadSeed(): Seed {
  return readJson<Seed>(join(DATA_DIR, 'seed.json'));
}

function loadRegistry(): LegacyRegistry {
  return readJson<LegacyRegistry>(join(DATA_DIR, 'legacy-registry.json'));
}

function effectiveWords(seed: Seed, registry: LegacyRegistry): EffectiveWord[] {
  const seedById = new Map(seed.words.map((word) => [word.id, word]));
  const canonicalDisposition = new Map<string, LegacyRegistryEntry['disposition']>();
  for (const entry of registry.entries) {
    if (entry.disposition === 'deactivate')
      canonicalDisposition.set(entry.canonicalId, 'deactivate');
  }
  const byCanonical = new Map<string, EffectiveWord>();
  for (const entry of registry.entries) {
    if (entry.disposition === 'deactivate') continue;
    if (canonicalDisposition.get(entry.canonicalId) === 'deactivate') continue;
    const origin = seedById.get(entry.legacyId);
    if (!origin) throw new Error(`种子缺少旧 ID：${entry.legacyId}`);
    const existing = byCanonical.get(entry.canonicalId);
    if (!existing) {
      const canonicalSeed = seedById.get(entry.canonicalId);
      if (!canonicalSeed) throw new Error(`种子缺少规范 ID：${entry.canonicalId}`);
      byCanonical.set(entry.canonicalId, {
        id: canonicalSeed.id,
        word: canonicalSeed.word,
        difficulty: canonicalSeed.difficulty,
        frequencyRank: canonicalSeed.frequencyRank,
        decks: canonicalSeed.decks.map((deck) => ({ ...deck })),
        disposition: canonicalDisposition.get(entry.canonicalId) ?? 'keep',
      });
    }
    const target = byCanonical.get(entry.canonicalId)!;
    for (const membership of origin.decks) {
      const current = target.decks.find((deck) => deck.deckId === membership.deckId);
      if (!current) {
        target.decks.push({ ...membership });
      } else if (membership.difficulty < current.difficulty) {
        current.difficulty = membership.difficulty;
      }
    }
  }
  return [...byCanonical.values()].sort((a, b) => byteCompare(a.id, b.id));
}

function loadIpaCandidates(): Map<string, string[]> {
  if (cachedIpa) return cachedIpa;
  const bytes = readFileSync(IPA_PATH);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== IPA_SHA256) {
    throw new Error(`IPA 来源哈希不符：期望 ${IPA_SHA256}，实际 ${actual}`);
  }
  const result = new Map<string, string[]>();
  for (const line of bytes.toString('utf8').split(/\r?\n/)) {
    const match = line.match(/^([^\t]+)\t(.+)$/);
    if (!match) continue;
    const word = match[1]!.toLowerCase();
    const candidates = match[2]!
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (candidates.length > 0) result.set(word, candidates);
  }
  cachedIpa = result;
  return result;
}

function pilotSelection(
  words: EffectiveWord[],
  ipa: Map<string, string[]>,
  datasetId: string,
): string[] {
  const selected = new Set<string>();
  const missing = words.filter((word) => !ipa.has(word.word.toLowerCase()));
  const multiple = words.filter((word) => (ipa.get(word.word.toLowerCase())?.length ?? 0) > 1);
  const hardOrder = (word: EffectiveWord) => nodeSha256(`${datasetId}:hard:${word.id}`);
  // 先用缺项和异读困难项覆盖约 20 个位置。
  const hard = [...missing, ...multiple]
    .filter((word) => !selected.has(word.id))
    .sort((a, b) => (hardOrder(a) < hardOrder(b) ? -1 : 1));
  for (const word of hard.slice(0, 20)) selected.add(word.id);

  const buckets = new Map<string, EffectiveWord[]>();
  for (const word of words) {
    if (selected.has(word.id)) continue;
    for (const deck of word.decks) {
      const key = `${deck.deckId}:${deck.difficulty}`;
      const list = buckets.get(key) ?? [];
      list.push(word);
      buckets.set(key, list);
    }
  }
  for (const list of buckets.values()) {
    list.sort((a, b) => {
      const left = nodeSha256(`${datasetId}:pilot:${a.id}`);
      const right = nodeSha256(`${datasetId}:pilot:${b.id}`);
      return left < right ? -1 : left > right ? 1 : byteCompare(a.id, b.id);
    });
  }
  const keys = [...buckets.keys()].sort();
  while (selected.size < 100) {
    let progressed = false;
    for (const key of keys) {
      const list = buckets.get(key)!;
      while (list.length > 0 && selected.has(list[0]!.id)) list.shift();
      const next = list.shift();
      if (!next) continue;
      selected.add(next.id);
      progressed = true;
      if (selected.size >= 100) break;
    }
    if (!progressed) break;
  }
  if (selected.size < 100) {
    for (const word of words) {
      if (selected.size >= 100) break;
      selected.add(word.id);
    }
  }
  return [...selected].sort((a, b) => {
    const left = nodeSha256(`${datasetId}:order:${a}`);
    const right = nodeSha256(`${datasetId}:order:${b}`);
    return left < right ? -1 : left > right ? 1 : byteCompare(a, b);
  });
}

function sampleIds(batchId: string, wordIds: string[], seed: string): string[] {
  if (wordIds.length <= 3) return [...wordIds];
  const count = Math.min(wordIds.length, Math.max(3, Math.ceil(wordIds.length * 0.1)));
  return [...wordIds]
    .sort((a, b) => {
      const left = createHash('sha256').update(`${seed}:${batchId}:${a}`).digest('hex');
      const right = createHash('sha256').update(`${seed}:${batchId}:${b}`).digest('hex');
      return left < right ? -1 : left > right ? 1 : byteCompare(a, b);
    })
    .slice(0, count)
    .sort(byteCompare);
}

function promptHashes(): { generate: string; review: string } {
  return {
    generate: createHash('sha256')
      .update(readFileSync(PROMPTS.generate, 'utf8'), 'utf8')
      .digest('hex'),
    review: createHash('sha256').update(readFileSync(PROMPTS.review, 'utf8'), 'utf8').digest('hex'),
  };
}

function prepare(force = false): void {
  if (existsSync(STATE_PATH) && !force) {
    throw new Error(
      'state.json 已存在；批次选择已冻结，不重新排批（仅在无已接受输出时可使用 --force）',
    );
  }
  if (force && existsSync(STATE_PATH)) {
    const previous = loadState();
    if (previous.batches.some((batch) => batch.outputHash !== null)) {
      throw new Error('已有接受输出，不能强制重排批次');
    }
  }
  const seed = loadSeed();
  const registry = loadRegistry();
  const words = effectiveWords(seed, registry);
  const ipa = loadIpaCandidates();
  const pilot = pilotSelection(words, ipa, seed.datasetId);
  const pilotSet = new Set(pilot);
  const remaining = words.filter((word) => !pilotSet.has(word.id)).map((word) => word.id);
  const prompt = promptHashes();
  mkdirSync(BATCH_DIR, { recursive: true });

  const batches: BatchState[] = [];
  for (let index = 0; index < 4; index += 1) {
    const wordIds = pilot.slice(index * 25, index * 25 + 25);
    batches.push(
      createBatch(
        `pilot-${String(index + 1).padStart(2, '0')}`,
        'pilot',
        wordIds,
        seed,
        registry,
        prompt,
      ),
    );
  }
  for (let index = 0; index < remaining.length; index += 25) {
    const wordIds = remaining.slice(index, index + 25);
    const id = `main-${String(batches.length - 3).padStart(3, '0')}`;
    batches.push(createBatch(id, 'main', wordIds, seed, registry, prompt));
  }
  const wordsById = new Map(words.map((word) => [word.id, word]));
  for (const batch of batches.filter((item) => item.kind === 'main')) {
    const hard = batch.wordIds.filter((wordId) => {
      const word = wordsById.get(wordId);
      const candidates = word ? (ipa.get(word.word.toLowerCase()) ?? []) : [];
      return candidates.length !== 1;
    });
    batch.sampleWordIds = [...new Set([...batch.sampleWordIds, ...hard])].sort(byteCompare);
  }

  const state: RebuildState = {
    schemaVersion: 1,
    datasetId: seed.datasetId,
    seedHash: nodeSha256(canonicalJson(seed)),
    contractVersion: CONTENT_CONTRACT_VERSION,
    questionTemplateVersion: QUESTION_TEMPLATE_VERSION,
    defaultPromptHashes: prompt,
    registryHash: registry.registryHash,
    seedReview: { reviewedWordIds: registry.entries.map((entry) => entry.legacyId), failures: [] },
    wordAttempts: {},
    batches,
  };
  writeJsonAtomic(STATE_PATH, state);
  console.log(`已创建 ${batches.length} 个批次：4 个试批，${batches.length - 4} 个主批次`);
  console.log(`试批词数：${pilot.length}；剩余有效词：${remaining.length}`);
}

function createBatch(
  id: string,
  kind: 'pilot' | 'main',
  wordIds: string[],
  seed: Seed,
  registry: LegacyRegistry,
  prompt: { generate: string; review: string },
): BatchState {
  const byId = new Map(seed.words.map((word) => [word.id, word]));
  const input = wordIds.map((wordId) => {
    const word = byId.get(wordId);
    if (!word) throw new Error(`未知目标 ID：${wordId}`);
    return {
      wordId,
      word: word.word,
      decks: word.decks,
      difficulty: word.difficulty,
      frequencyRank: word.frequencyRank,
      orientation: 'general-common-meaning',
    };
  });
  const inputPath = join(BATCH_DIR, `${id}.input.jsonl`);
  writeJsonl(inputPath, input);
  const inputHash = nodeSha256(
    canonicalJson({
      batchId: id,
      wordIds,
      input,
      contractVersion: CONTENT_CONTRACT_VERSION,
      generatePromptHash: prompt.generate,
      registryHash: registry.registryHash,
      datasetId: seed.datasetId,
    }),
  );
  const samplingSeed = nodeSha256(canonicalJson({ datasetId: seed.datasetId, wordIds }));
  return {
    id,
    kind,
    wordIds,
    inputHash,
    samplingSeed,
    sampleWordIds: kind === 'pilot' ? [...wordIds] : sampleIds(id, wordIds, samplingSeed),
    outputHash: null,
    entryHash: null,
    generationPromptHash: prompt.generate,
    status: 'pending',
    attempts: 0,
    generation: null,
    review: null,
    failures: [],
    elapsedMs: null,
    inputTokens: null,
    outputTokens: null,
    cost: null,
  };
}

function loadState(): RebuildState {
  const state = readJson<RebuildState>(STATE_PATH);
  state.wordAttempts ??= {};
  return state;
}

function saveState(state: RebuildState): void {
  writeJsonAtomic(STATE_PATH, state);
}

function getBatch(state: RebuildState, id: string): BatchState {
  const batch = state.batches.find((item) => item.id === id);
  if (!batch) throw new Error(`未知批次：${id}`);
  return batch;
}

function verifyBatchArtifacts(
  batch: BatchState,
  seed: Seed,
  registry: LegacyRegistry,
  prompt: { generate: string; review: string },
): string[] {
  const errors: string[] = [];
  const input = readJsonl<Record<string, unknown>>(batchPath(batch.id, 'input.jsonl'));
  const expectedInputHash = nodeSha256(
    canonicalJson({
      batchId: batch.id,
      wordIds: batch.wordIds,
      input,
      contractVersion: CONTENT_CONTRACT_VERSION,
      generatePromptHash: prompt.generate,
      registryHash: registry.registryHash,
      datasetId: seed.datasetId,
    }),
  );
  if (expectedInputHash !== batch.inputHash) errors.push('输入或依赖哈希不符');
  if (batch.generationPromptHash !== prompt.generate) errors.push('生成提示版本已改变');
  if (batch.outputHash === null) errors.push('缺少输出哈希');
  const entries = readJsonl<CandidateEntry>(batchPath(batch.id, 'output.jsonl'));
  const plans = readJsonl<WordQuestionPlan>(batchPath(batch.id, 'questions.jsonl'));
  const audit = readJson<unknown[]>(batchPath(batch.id, 'audit.json'));
  const expectedOutputHash = nodeSha256(
    canonicalJson({
      words: nodeSha256(canonicalJson(entries)),
      questions: nodeSha256(canonicalJson(plans)),
      audit: nodeSha256(canonicalJson(audit)),
    }),
  );
  if (expectedOutputHash !== batch.outputHash) errors.push('输出、题组或自检依据哈希不符');
  if (!batch.review) {
    errors.push('缺少复核记录');
  } else {
    if (batch.review.outputHash !== batch.outputHash) errors.push('复核未绑定当前输出');
    if (batch.review.promptHash !== prompt.review) errors.push('复核提示版本已改变');
    if (batch.kind === 'pilot' && batch.review.mode !== 'full') errors.push('试批不是逐词复核');
    for (const wordId of batch.sampleWordIds) {
      if (!batch.review.inspectedWordIds.includes(wordId)) {
        errors.push(`复核样本缺失：${wordId}`);
      }
    }
  }
  return errors;
}

function parseEntry(raw: unknown, wordId: string): CandidateEntry {
  if (typeof raw !== 'object' || raw === null) throw new Error(`${wordId}: 输出不是对象`);
  const value = raw as Record<string, unknown>;
  if (typeof value.error === 'string') throw new Error(`${wordId}: 生成失败：${value.error}`);
  if (value.wordId !== wordId) throw new Error(`${wordId}: wordId 不匹配：${String(value.wordId)}`);
  const fields = [
    'word',
    'partOfSpeech',
    'coreMeaningZh',
    'exampleSentence',
    'exampleTranslation',
    'surfaceFormInExample',
  ] as const;
  for (const field of fields) {
    if (typeof value[field] !== 'string' || (value[field] as string).trim() === '') {
      throw new Error(`${wordId}: ${field} 必填`);
    }
  }
  const secondary = value.secondaryMeanings ?? [];
  if (!Array.isArray(secondary)) throw new Error(`${wordId}: secondaryMeanings 必须是数组`);
  return {
    wordId,
    word: value.word as string,
    partOfSpeech: value.partOfSpeech as string,
    coreMeaningZh: value.coreMeaningZh as string,
    secondaryMeanings: secondary.map((item) => {
      if (typeof item !== 'object' || item === null) throw new Error(`${wordId}: 其他义项非法`);
      const meaning = item as Record<string, unknown>;
      if (typeof meaning.partOfSpeech !== 'string' || typeof meaning.meaningZh !== 'string') {
        throw new Error(`${wordId}: 其他义项缺少字段`);
      }
      return { partOfSpeech: meaning.partOfSpeech, meaningZh: meaning.meaningZh };
    }),
    exampleSentence: value.exampleSentence as string,
    exampleTranslation: value.exampleTranslation as string,
    surfaceFormInExample: value.surfaceFormInExample as string,
  };
}

function resolveIpa(wordId: string, word: string): { phonetic: string; source: string } {
  const candidates = loadIpaCandidates().get(word.toLowerCase()) ?? [];
  cachedSelections ??= readJson<{
    selections: Record<string, { index: number; reason: string }>;
  }>(IPA_SELECTIONS_PATH);
  cachedOverrides ??= readJson<{
    overrides: Record<string, { ipa: string; reason: string; reviewedBy: string }>;
  }>(IPA_OVERRIDES_PATH);
  const override = cachedOverrides.overrides[wordId];
  if (override) {
    return { phonetic: override.ipa, source: 'project-transcription' };
  }
  if (candidates.length === 1) return { phonetic: candidates[0]!, source: 'ipa-dict-en_US' };
  if (candidates.length > 1) {
    const selection = cachedSelections.selections[wordId];
    if (!selection) throw new Error(`${wordId}: 多候选读音需要逐词选择`);
    const candidate = candidates[selection.index];
    if (!candidate) throw new Error(`${wordId}: 读音候选索引越界`);
    return { phonetic: candidate, source: 'ipa-dict-en_US' };
  }
  throw new Error(`${wordId}: ${word} 缺少 IPA，需要独立转写`);
}

function toWordRecord(entry: CandidateEntry, effective: EffectiveWord): WordRecord {
  if (entry.word !== effective.word) {
    throw new Error(`${effective.id}: word 与种子规范词形不一致`);
  }
  const ipa = resolveIpa(effective.id, effective.word);
  return {
    id: effective.id,
    word: effective.word,
    lemma: effective.word,
    phonetic: ipa.phonetic,
    partOfSpeech: [entry.partOfSpeech],
    coreMeaningZh: [entry.coreMeaningZh],
    secondaryMeanings: entry.secondaryMeanings,
    exampleSentence: entry.exampleSentence,
    exampleTranslation: entry.exampleTranslation,
    surfaceFormInExample: entry.surfaceFormInExample,
    difficulty: effective.difficulty,
    frequencyRank: effective.frequencyRank,
    source: BUILT_IN_CONTENT_SOURCE,
    license: BUILT_IN_CONTENT_LICENSE,
  };
}

function meaningSet(word: WordRecord): Set<string> {
  return new Set([
    primaryMeaning(word),
    ...(word.secondaryMeanings ?? []).map((meaning) => meaning.meaningZh),
  ]);
}

function chooseDistractors(
  target: WordRecord,
  pool: WordRecord[],
  mode: 'en-to-zh' | 'zh-to-en' | 'context-choice',
  excluded: Set<string> = new Set(),
): WordRecord[] {
  const targetMeanings = meaningSet(target);
  const candidates = pool.filter((candidate) => {
    if (candidate.id === target.id) return false;
    if (excluded.has(candidate.id)) return false;
    if (candidate.word.toLowerCase() === target.word.toLowerCase()) return false;
    if (targetMeanings.has(primaryMeaning(candidate))) return false;
    for (const meaning of candidate.secondaryMeanings ?? []) {
      if (targetMeanings.has(meaning.meaningZh)) return false;
    }
    if (mode === 'zh-to-en' || mode === 'context-choice') {
      if (candidate.partOfSpeech[0] !== target.partOfSpeech[0]) return false;
    }
    if (mode === 'context-choice' && candidate.word === target.surfaceFormInExample) {
      return false;
    }
    return true;
  });
  const scored = candidates
    .map((candidate) => ({
      candidate,
      pos: candidate.partOfSpeech[0] === target.partOfSpeech[0] ? 0 : 1,
      difficulty: Math.abs(candidate.difficulty - target.difficulty),
      tie: createHash('sha256').update(`${target.id}:${candidate.id}`).digest('hex'),
    }))
    .sort(
      (a, b) =>
        a.pos - b.pos ||
        a.difficulty - b.difficulty ||
        (a.tie < b.tie ? -1 : a.tie > b.tie ? 1 : byteCompare(a.candidate.id, b.candidate.id)),
    );
  const selected: WordRecord[] = [];
  const meanings = new Set<string>();
  for (const item of scored) {
    if (selected.length >= 3) break;
    const meaning = primaryMeaning(item.candidate);
    if (meanings.has(meaning)) continue;
    meanings.add(meaning);
    selected.push(item.candidate);
  }
  return selected;
}

async function buildPlans(
  target: WordRecord,
  pool: WordRecord[],
  batchKind: 'pilot' | 'main',
): Promise<{ plan: WordQuestionPlan; audit: Record<string, unknown> }> {
  cachedPlanOverrides ??= readJson(PLAN_OVERRIDES_PATH);
  const override = cachedPlanOverrides.words?.[target.id];
  const excluded = new Set(override?.excludeDistractors ?? []);
  for (const group of cachedPlanOverrides.synonymGroups ?? []) {
    if (group.includes(target.id)) {
      for (const id of group) if (id !== target.id) excluded.add(id);
    }
  }
  const en = chooseDistractors(target, pool, 'en-to-zh', excluded);
  if (en.length < 3) throw new Error(`${target.id}: 英选中干扰项不足`);
  const zh = chooseDistractors(target, pool, 'zh-to-en', excluded);
  const context = chooseDistractors(target, pool, 'context-choice', excluded);
  const surfaceIsLemma = target.surfaceFormInExample?.toLowerCase() === target.word.toLowerCase();
  const allowContext =
    surfaceIsLemma &&
    (batchKind === 'pilot' ? override?.contextChoice !== false : override?.contextChoice === true);
  const allowSpelling =
    batchKind === 'pilot' ? override?.spelling !== false : override?.spelling === true;
  const draft: WordQuestionPlan = {
    wordId: target.id,
    enToZh: {
      distractors: en.map((word) => word.id) as [string, string, string],
      checkedContentHash: '',
    },
    zhToEn:
      zh.length === 3
        ? {
            distractors: zh.map((word) => word.id) as [string, string, string],
            checkedContentHash: '',
          }
        : null,
    contextChoice:
      allowContext && context.length === 3
        ? {
            distractors: context.map((word) => ({
              wordId: word.id,
              surfaceForm: word.word,
            })) as [
              { wordId: string; surfaceForm: string },
              { wordId: string; surfaceForm: string },
              { wordId: string; surfaceForm: string },
            ],
            checkedContentHash: '',
          }
        : null,
    spelling:
      allowSpelling && [...target.word].length > 3
        ? { prefixLength: 1, checkedContentHash: '' }
        : null,
  };
  const wordsById = new Map(pool.map((word) => [word.id, word]));
  const hashes = await computeQuestionPlanHashes(target, draft, wordsById);
  const plan: WordQuestionPlan = {
    ...draft,
    enToZh: { ...draft.enToZh, checkedContentHash: hashes.enToZh },
    zhToEn: draft.zhToEn ? { ...draft.zhToEn, checkedContentHash: hashes.zhToEn! } : null,
    contextChoice: draft.contextChoice
      ? { ...draft.contextChoice, checkedContentHash: hashes.contextChoice! }
      : null,
    spelling: draft.spelling ? { ...draft.spelling, checkedContentHash: hashes.spelling! } : null,
  };
  const errors = await validateQuestionPlan(target, plan, wordsById);
  if (errors.length > 0) throw new Error(`${target.id}: ${errors.join('；')}`);
  return {
    plan,
    audit: {
      wordId: target.id,
      enToZh: en.map((word) => ({
        wordId: word.id,
        reason: `选项「${primaryMeaning(word)}」不是「${target.word}」的主释义「${primaryMeaning(target)}」或其他义项。`,
      })),
      zhToEn: zh.map((word) => ({
        wordId: word.id,
        reason: `英文「${word.word}」的常见义项「${primaryMeaning(word)}」不符合主释义「${primaryMeaning(target)}」。`,
      })),
      contextChoice: context.map((word) => ({
        wordId: word.id,
        surfaceForm: word.word,
        reason: `将「${word.word}」代入可见句子后不表达主释义「${primaryMeaning(target)}」。`,
      })),
      spelling: plan.spelling
        ? `提示包含主释义、词性、挖空例句、首字母和字母数，未显示完整词元。`
        : null,
    },
  };
}

function batchPath(id: string, suffix: string): string {
  return join(BATCH_DIR, `${id}.${suffix}`);
}

function acceptedEntriesFromBatch(id: string): CandidateEntry[] {
  const path = batchPath(id, 'output.jsonl');
  if (!existsSync(path)) return [];
  return readJsonl<CandidateEntry>(path);
}

function incrementWordAttempts(state: RebuildState, wordIds: string[], promptHash: string): void {
  state.wordAttempts ??= {};
  for (const wordId of wordIds) {
    const current = state.wordAttempts[wordId];
    state.wordAttempts[wordId] = {
      promptHash,
      attempts: current?.promptHash === promptHash ? current.attempts + 1 : 1,
    };
  }
}

function buildPool(
  state: RebuildState,
  seed: Seed,
  registry: LegacyRegistry,
  pending: Array<{ entry: CandidateEntry; effective: EffectiveWord }>,
): WordRecord[] {
  const effectiveById = new Map(effectiveWords(seed, registry).map((word) => [word.id, word]));
  const byId = new Map<string, WordRecord>();
  for (const batch of state.batches) {
    if (batch.outputHash === null) continue;
    for (const entry of acceptedEntriesFromBatch(batch.id)) {
      const effective = effectiveById.get(entry.wordId);
      if (!effective) continue;
      try {
        byId.set(entry.wordId, toWordRecord(entry, effective));
      } catch {
        // 未通过 IPA 合入的批次不进入干扰项池。
      }
    }
  }
  for (const { entry, effective } of pending) {
    byId.set(entry.wordId, toWordRecord(entry, effective));
  }
  return [...byId.values()].sort((a, b) => byteCompare(a.id, b.id));
}

async function accept(batchId: string): Promise<void> {
  acquireLock();
  try {
    const state = loadState();
    const batch = getBatch(state, batchId);
    if (batch.status === 'verified')
      throw new Error(`${batchId}: 已验证批次不能直接覆盖，请先标记返工`);
    const exhausted = batch.wordIds.filter((wordId) => {
      const record = state.wordAttempts?.[wordId];
      return record?.promptHash === promptHashes().generate && record.attempts >= 3;
    });
    if (exhausted.length > 0) {
      throw new Error(`${batchId}: 以下词已达到同提示 3 次生成上限：${exhausted.join(',')}`);
    }
    const seed = loadSeed();
    const registry = loadRegistry();
    const effectiveById = new Map(effectiveWords(seed, registry).map((word) => [word.id, word]));
    const inputs = readJsonl<{ wordId: string }>(batchPath(batchId, 'input.jsonl'));
    const outputPath = batchPath(batchId, 'output.jsonl');
    if (!existsSync(outputPath)) throw new Error(`${batchId}: 缺少 output.jsonl`);
    const raw = readJsonl<unknown>(outputPath);
    const failures: BatchState['failures'] = [];
    const entries = new Map<string, CandidateEntry>();
    for (const item of raw) {
      const wordId = (item as { wordId?: string }).wordId;
      if (typeof wordId !== 'string') {
        failures.push({
          wordId: 'unknown',
          stage: 'structure',
          code: 'missing-word-id',
          message: '输出行缺少 wordId',
          attempts: batch.attempts + 1,
        });
        continue;
      }
      if (!inputs.some((input) => input.wordId === wordId)) {
        failures.push({
          wordId,
          stage: 'structure',
          code: 'unknown-id',
          message: `未知目标 ID：${wordId}`,
          attempts: batch.attempts + 1,
        });
        continue;
      }
      if (entries.has(wordId)) {
        failures.push({
          wordId,
          stage: 'structure',
          code: 'duplicate-id',
          message: `重复输出：${wordId}`,
          attempts: batch.attempts + 1,
        });
        continue;
      }
      try {
        entries.set(wordId, parseEntry(item, wordId));
      } catch (error) {
        failures.push({
          wordId,
          stage: 'structure',
          code: 'invalid-entry',
          message: error instanceof Error ? error.message : String(error),
          attempts: batch.attempts + 1,
        });
      }
    }
    for (const input of inputs) {
      if (
        !entries.has(input.wordId) &&
        !failures.some((failure) => failure.wordId === input.wordId)
      ) {
        failures.push({
          wordId: input.wordId,
          stage: 'structure',
          code: 'missing-word',
          message: `缺少词条：${input.wordId}`,
          attempts: batch.attempts + 1,
        });
      }
    }

    const pending: Array<{ entry: CandidateEntry; effective: EffectiveWord }> = [];
    for (const input of inputs) {
      const entry = entries.get(input.wordId);
      const effective = effectiveById.get(input.wordId);
      if (!entry || !effective) continue;
      try {
        const record = toWordRecord(entry, effective);
        const errors = validateBuiltInWordRecord(record);
        if (errors.length > 0) throw new Error(errors.join('；'));
        pending.push({ entry, effective });
      } catch (error) {
        failures.push({
          wordId: input.wordId,
          stage:
            error instanceof Error && error.message.includes('IPA') ? 'pronunciation' : 'structure',
          code: 'invalid-record',
          message: error instanceof Error ? error.message : String(error),
          attempts: batch.attempts + 1,
        });
      }
    }

    if (failures.length > 0) {
      batch.status = 'needs-fix';
      batch.attempts += 1;
      batch.failures = failures;
      saveState(state);
      throw new Error(`${batchId}: 有 ${failures.length} 个词条未通过，批次保持 needs-fix`);
    }

    const pool = buildPool(state, seed, registry, pending);
    const pilotIds = new Set(
      state.batches.filter((item) => item.kind === 'pilot').flatMap((item) => item.wordIds),
    );
    const planPool = batch.kind === 'pilot' ? pool.filter((word) => pilotIds.has(word.id)) : pool;
    const byId = new Map(planPool.map((word) => [word.id, word]));
    const plans: WordQuestionPlan[] = [];
    const audits: Record<string, unknown>[] = [];
    for (const input of inputs) {
      const effective = effectiveById.get(input.wordId)!;
      const entry = entries.get(input.wordId)!;
      const target = byId.get(input.wordId) ?? toWordRecord(entry, effective);
      try {
        const { plan, audit } = await buildPlans(target, planPool, batch.kind);
        plans.push(plan);
        audits.push(audit);
      } catch (error) {
        failures.push({
          wordId: input.wordId,
          stage: 'question',
          code: 'invalid-question-plan',
          message: error instanceof Error ? error.message : String(error),
          attempts: batch.attempts + 1,
        });
      }
    }
    if (failures.length > 0) {
      batch.status = 'needs-fix';
      batch.attempts += 1;
      batch.failures = failures;
      saveState(state);
      throw new Error(`${batchId}: 题组检查失败，批次保持 needs-fix`);
    }

    const outputEntries = inputs.map((input) => entries.get(input.wordId)!);
    const entryHash = nodeSha256(canonicalJson(outputEntries));
    writeJsonl(outputPath, outputEntries);
    writeJsonl(batchPath(batchId, 'questions.jsonl'), plans);
    writeJsonAtomic(batchPath(batchId, 'audit.json'), audits);
    const outputHash = nodeSha256(
      canonicalJson({
        words: nodeSha256(canonicalJson(outputEntries)),
        questions: nodeSha256(canonicalJson(plans)),
        audit: nodeSha256(canonicalJson(audits)),
      }),
    );
    batch.status = 'needs-fix';
    batch.outputHash = outputHash;
    batch.attempts += 1;
    batch.failures = [];
    const metaPath = batchPath(batchId, 'meta.json');
    if (existsSync(metaPath)) {
      const meta = readJson<{
        provider?: string;
        model?: string;
        settings?: Record<string, unknown>;
        elapsedMs?: number;
        inputTokens?: number;
        outputTokens?: number;
        cost?: { amount: number; currency: string };
      }>(metaPath);
      batch.generation =
        meta.provider && meta.model
          ? { provider: meta.provider, model: meta.model, settings: meta.settings ?? {} }
          : null;
      batch.elapsedMs = meta.elapsedMs ?? null;
      batch.inputTokens = meta.inputTokens ?? null;
      batch.outputTokens = meta.outputTokens ?? null;
      batch.cost = meta.cost ?? null;
    }
    batch.review = null;
    if (batch.entryHash !== entryHash) {
      incrementWordAttempts(state, batch.wordIds, promptHashes().generate);
    }
    batch.entryHash = entryHash;
    saveState(state);
    console.log(`${batchId}: ${outputEntries.length} 词与题组已登记，等待独立复核`);
    console.log(`outputHash ${outputHash}`);
  } finally {
    releaseLock();
  }
}

interface ReviewFile {
  reviewer: string;
  mode: 'full' | 'sample';
  inspectedWordIds: string[];
  result: 'pass' | 'fail';
  findings: Array<{ wordId: string; stage?: string; message: string }>;
}

function review(batchId: string, file: string): void {
  withLock(() => {
    const state = loadState();
    const batch = getBatch(state, batchId);
    if (batch.outputHash === null) throw new Error(`${batchId}: 尚未登记输出`);
    const input = readJson<ReviewFile>(file);
    if (batch.kind === 'pilot' && input.mode !== 'full') {
      throw new Error(`${batchId}: 试批必须使用逐词完整复核`);
    }
    if (input.mode === 'full' && batch.kind === 'pilot') {
      const inspected = new Set(input.inspectedWordIds);
      const missing = batch.wordIds.filter((wordId) => !inspected.has(wordId));
      if (missing.length > 0)
        throw new Error(`${batchId}: 试批必须逐词复核，缺少 ${missing.join(',')}`);
    }
    for (const wordId of batch.sampleWordIds) {
      if (!input.inspectedWordIds.includes(wordId)) {
        throw new Error(`${batchId}: 缺少冻结样本复核：${wordId}`);
      }
    }
    const prompt = promptHashes();
    if (input.result === 'fail' || input.findings.length > 0) {
      batch.status = 'needs-fix';
      batch.review = {
        outputHash: batch.outputHash,
        promptHash: prompt.review,
        inspectedWordIds: input.inspectedWordIds,
        mode: input.mode,
        reviewer: input.reviewer,
        result: 'fail',
      };
      batch.failures = input.findings.map((finding) => ({
        wordId: finding.wordId,
        stage: 'semantics',
        code: 'review-finding',
        message: finding.message,
        attempts: batch.attempts,
      }));
    } else {
      batch.status = 'verified';
      batch.review = {
        outputHash: batch.outputHash,
        promptHash: prompt.review,
        inspectedWordIds: input.inspectedWordIds,
        mode: input.mode,
        reviewer: input.reviewer,
        result: 'pass',
      };
      batch.failures = [];
    }
    saveState(state);
    console.log(`${batchId}: 复核结果 ${input.result}`);
  });
}

async function buildPackage(pilotOnly = false): Promise<void> {
  acquireLock();
  try {
    const state = loadState();
    const seed = loadSeed();
    const registry = loadRegistry();
    const prompt = promptHashes();
    if (state.seedHash !== nodeSha256(canonicalJson(seed))) {
      throw new Error('种子已改变，不能继续使用现有批次');
    }
    if (state.registryHash !== registry.registryHash) {
      throw new Error('注册表已改变，不能继续使用现有批次');
    }
    if (
      state.defaultPromptHashes.generate !== prompt.generate ||
      state.defaultPromptHashes.review !== prompt.review
    ) {
      throw new Error('生成或复核提示已改变，需要重新验证受影响批次');
    }
    const selectedBatches = pilotOnly
      ? state.batches.filter((batch) => batch.kind === 'pilot')
      : state.batches;
    if (selectedBatches.some((batch) => batch.status !== 'verified')) {
      throw new Error('仍有批次未验证，不能生成候选包');
    }
    const selectedIds = new Set(selectedBatches.flatMap((batch) => batch.wordIds));
    const effective = effectiveWords(seed, registry).filter((word) => selectedIds.has(word.id));
    const effectiveById = new Map(effective.map((word) => [word.id, word]));
    const wordsById = new Map<string, WordRecord>();
    const plansById = new Map<string, WordQuestionPlan>();
    const invalidBatches: string[] = [];
    for (const batch of selectedBatches) {
      const errors = verifyBatchArtifacts(batch, seed, registry, prompt);
      if (errors.length > 0) {
        batch.status = 'needs-fix';
        batch.outputHash = null;
        batch.review = null;
        batch.failures = [
          ...batch.failures,
          ...errors.map((message) => ({
            wordId: '*',
            stage: 'structure' as const,
            code: 'artifact-hash-mismatch',
            message,
            attempts: batch.attempts,
          })),
        ];
        invalidBatches.push(`${batch.id}: ${errors.join('；')}`);
        continue;
      }
      const entries = readJsonl<CandidateEntry>(batchPath(batch.id, 'output.jsonl'));
      const plans = readJsonl<WordQuestionPlan>(batchPath(batch.id, 'questions.jsonl'));
      if (entries.length !== batch.wordIds.length) throw new Error(`${batch.id}: 词条数量不一致`);
      for (const entry of entries) {
        const effectiveWord = effectiveById.get(entry.wordId);
        if (!effectiveWord) throw new Error(`${batch.id}: 未知词条 ${entry.wordId}`);
        const word = toWordRecord(entry, effectiveWord);
        if (wordsById.has(word.id)) throw new Error(`重复有效词：${word.id}`);
        wordsById.set(word.id, word);
      }
      for (const plan of plans) {
        if (plansById.has(plan.wordId)) throw new Error(`重复题组：${plan.wordId}`);
        plansById.set(plan.wordId, plan);
      }
    }
    if (invalidBatches.length > 0) {
      saveState(state);
      throw new Error(`批次产物已失效：${invalidBatches.slice(0, 5).join('；')}`);
    }
    if (wordsById.size !== effective.length) {
      throw new Error(`有效词覆盖不完整：${wordsById.size}/${effective.length}`);
    }
    for (const word of effective) {
      if (!wordsById.has(word.id)) throw new Error(`缺少有效词：${word.id}`);
      if (!plansById.has(word.id)) throw new Error(`缺少题组：${word.id}`);
    }
    const words = [...wordsById.values()].sort((a, b) => byteCompare(a.id, b.id));
    const plans = [...plansById.values()].sort((a, b) => byteCompare(a.wordId, b.wordId));
    for (const plan of plans) {
      const errors = await validateQuestionPlan(wordsById.get(plan.wordId)!, plan, wordsById);
      if (errors.length > 0) throw new Error(`${plan.wordId}: 题组失效：${errors.join('；')}`);
    }
    const decks: DeckRecord[] = DECK_IDS.map((deckId) => {
      const members = effective.filter((word) =>
        word.decks.some((membership) => membership.deckId === deckId),
      );
      const wordIds = members.map((word) => word.id).sort(byteCompare);
      const wordDifficulties: Record<string, number> = {};
      for (const word of members) {
        wordDifficulties[word.id] =
          word.decks.find((membership) => membership.deckId === deckId)?.difficulty ??
          word.difficulty;
      }
      const seedDeck = seed.decks.find((deck) => deck.id === deckId)!;
      return {
        id: deckId,
        name: seedDeck.name,
        description: seedDeck.description,
        source: BUILT_IN_CONTENT_SOURCE,
        license: BUILT_IN_CONTENT_LICENSE,
        wordIds,
        wordDifficulties,
      };
    });

    const outDir = pilotOnly ? join(DATA_DIR, 'staging-pilot') : STAGING_DIR;
    const packageRegistry = pilotOnly
      ? (() => {
          const base = {
            ...registry,
            registryVersion: `${registry.registryVersion}-pilot`,
            entries: registry.entries.filter((entry) => selectedIds.has(entry.canonicalId)),
          };
          const withoutHash = { ...base } as Partial<LegacyRegistry>;
          delete withoutHash.registryHash;
          return { ...base, registryHash: nodeSha256(canonicalJson(withoutHash)) };
        })()
      : registry;
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(join(outDir, 'licenses'), { recursive: true });
    const wordsText = `${JSON.stringify(words, null, 2)}\n`;
    const decksText = `${JSON.stringify(decks, null, 2)}\n`;
    const questionsText = `${JSON.stringify(plans, null, 2)}\n`;
    const registryText = `${JSON.stringify(packageRegistry, null, 2)}\n`;
    const sourceMetadata = {
      schemaVersion: 2,
      datasetId: pilotOnly ? `${seed.datasetId}-pilot` : seed.datasetId,
      contentVersion: `dictionary-${seed.datasetId}`,
      contentSource: {
        name: BUILT_IN_CONTENT_SOURCE,
        license: BUILT_IN_CONTENT_LICENSE,
        promptVersion: 'generate-v1',
        questionTemplateVersion: QUESTION_TEMPLATE_VERSION,
      },
      seed: seed.source,
      pronunciation: {
        name: 'ipa-dict en_US',
        repository: 'https://github.com/open-dict-data/ipa-dict',
        commit: '972cd67dd5f96bc5660e28070cde26e3928abcd7',
        sha256: '2af6f154a5c363275f052d1f85acedef38ed185ca9745aa4314be77f6b70de67',
        note: '保留 ipa-dict、cmudict-ipa 与 CMUdict 的来源链和各自许可。',
      },
      review: {
        pilot: '100 词逐词独立复核',
        main: '冻结抽样及困难项额外复核',
      },
    };
    const sourceMetadataText = `${JSON.stringify(sourceMetadata, null, 2)}\n`;
    const licenseText = [
      '刷刷升级内置词库组合声明',
      '==========================',
      '',
      '本项目原创及独立生成、审订的学习文本使用 Apache-2.0。',
      '第三方数据按各自许可保留：',
      '- licenses/Apache-2.0.txt：项目文本许可',
      '- licenses/ipa-dict-LICENSE.txt：ipa-dict MIT',
      '- licenses/cmudict-ipa-LICENSE.txt：cmudict-ipa MIT',
      '- licenses/CMUdict-LICENSE.txt：CMUdict 原始版权、条件和免责文本',
      '- licenses/ECDICT-LICENSE.txt：一次性身份种子来源的 MIT 通知',
      '',
      '词条许可证标识：LicenseRef-BingeUp-Dictionary-v1',
    ].join('\n');
    writeFileSync(join(outDir, 'words.json'), wordsText, 'utf8');
    writeFileSync(join(outDir, 'decks.json'), decksText, 'utf8');
    writeFileSync(join(outDir, 'questions.json'), questionsText, 'utf8');
    writeFileSync(join(outDir, 'legacy-registry.json'), registryText, 'utf8');
    writeFileSync(join(outDir, 'source-metadata.json'), sourceMetadataText, 'utf8');
    writeFileSync(join(outDir, 'LICENSE.txt'), licenseText, 'utf8');
    for (const [name, source] of [
      ['Apache-2.0.txt', join(ROOT, 'LICENSE')],
      ['ipa-dict-LICENSE.txt', join(DATA_DIR, 'sources/ipa-dict-LICENSE.txt')],
      ['cmudict-ipa-LICENSE.txt', join(DATA_DIR, 'sources/cmudict-ipa-LICENSE.txt')],
      ['CMUdict-LICENSE.txt', join(DATA_DIR, 'sources/CMUdict-LICENSE.txt')],
      ['ECDICT-LICENSE.txt', join(DATA_DIR, 'sources/ECDICT-LICENSE.txt')],
    ] as const) {
      writeFileSync(join(outDir, 'licenses', name), readFileSync(source, 'utf8'), 'utf8');
    }
    const fileHashes = {
      words: { sha256: await sha256Hex(wordsText), bytes: Buffer.byteLength(wordsText) },
      decks: { sha256: await sha256Hex(decksText), bytes: Buffer.byteLength(decksText) },
      questions: {
        sha256: await sha256Hex(questionsText),
        bytes: Buffer.byteLength(questionsText),
      },
      legacyRegistry: {
        sha256: await sha256Hex(registryText),
        bytes: Buffer.byteLength(registryText),
      },
      sourceMetadata: {
        sha256: await sha256Hex(sourceMetadataText),
        bytes: Buffer.byteLength(sourceMetadataText),
      },
      license: { sha256: await sha256Hex(licenseText), bytes: Buffer.byteLength(licenseText) },
    };
    const manifest: DictionaryContentManifest = {
      schemaVersion: 2,
      contentContractVersion: CONTENT_CONTRACT_VERSION,
      dictionaryVersion: pilotOnly ? '2026.10.1-pilot' : '2026.10.1',
      generatedAt: new Date().toISOString(),
      datasetId: pilotOnly ? `${seed.datasetId}-pilot` : seed.datasetId,
      registryVersion: packageRegistry.registryVersion,
      registryHash: packageRegistry.registryHash,
      questionTemplateVersion: QUESTION_TEMPLATE_VERSION,
      files: fileHashes,
      counts: {
        legacyWords: packageRegistry.entries.length,
        effectiveWords: words.length,
        decks: decks.length,
        questionPlans: plans.length,
      },
      source: { content: BUILT_IN_CONTENT_SOURCE, license: BUILT_IN_CONTENT_LICENSE },
    };
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    writeFileSync(join(outDir, 'manifest.json'), manifestText, 'utf8');
    const validation = await validateContentPackage({
      manifest,
      words,
      decks,
      questions: plans,
      registry: packageRegistry,
      fileHashes: Object.fromEntries(
        Object.entries(fileHashes).map(([key, value]) => [key, value.sha256]),
      ) as Record<keyof DictionaryContentManifest['files'], string>,
    });
    if (!validation.valid) {
      rmSync(outDir, { recursive: true, force: true });
      throw new Error(`候选包校验失败：${validation.errors.slice(0, 10).join('；')}`);
    }
    writeJsonAtomic(join(outDir, 'build-summary.json'), {
      valid: true,
      datasetId: pilotOnly ? `${seed.datasetId}-pilot` : seed.datasetId,
      legacyWords: packageRegistry.entries.length,
      effectiveWords: words.length,
      corrected: packageRegistry.entries.filter((entry) => entry.disposition === 'correct').length,
      merged: packageRegistry.entries.filter((entry) => entry.disposition === 'merge').length,
      deactivated: packageRegistry.entries.filter((entry) => entry.disposition === 'deactivate')
        .length,
      decks: decks.map((deck) => ({ id: deck.id, words: deck.wordIds.length })),
      questions: plans.length,
      verifiedBatches: selectedBatches.length,
      generatedAt: manifest.generatedAt,
    });
    console.log(`候选包已写入 ${outDir}`);
    console.log(`有效词 ${words.length}，题组 ${plans.length}，批次 ${selectedBatches.length}`);
  } finally {
    releaseLock();
  }
}

function status(): void {
  if (!existsSync(STATE_PATH)) {
    console.log('尚未执行 prepare');
    return;
  }
  const state = loadState();
  const counts = new Map<string, number>();
  for (const batch of state.batches) {
    counts.set(batch.status, (counts.get(batch.status) ?? 0) + 1);
  }
  console.log(`数据集：${state.datasetId}`);
  console.log(`契约：${state.contractVersion}；题组模板：${state.questionTemplateVersion}`);
  console.log(`批次：${state.batches.length}`);
  for (const [name, count] of counts) console.log(`  ${name}: ${count}`);
  const pending = state.batches.filter((item) => item.status !== 'verified');
  for (const batch of pending.slice(0, 10)) {
    console.log(`  ${batch.id} (${batch.kind}, ${batch.status}, ${batch.wordIds.length} 词)`);
    for (const failure of batch.failures.slice(0, 3)) {
      console.log(`    ${failure.wordId}: ${failure.message}`);
    }
  }
  if (pending.length > 10) console.log(`  … 还有 ${pending.length - 10} 个未验证批次`);
}

function reopen(batchId: string): void {
  withLock(() => {
    const state = loadState();
    const batch = getBatch(state, batchId);
    batch.status = 'needs-fix';
    batch.outputHash = null;
    batch.review = null;
    saveState(state);
    console.log(`${batchId}: 已标记返工`);
  });
}

function checkRegistry(): void {
  const seed = loadSeed();
  const registry = loadRegistry();
  const errors: string[] = [];
  const seedById = new Map(seed.words.map((word) => [word.id, word]));
  const seedHash = nodeSha256(canonicalJson(seed));
  if (registry.seedHash !== seedHash) errors.push('注册表 seedHash 与冻结种子不一致');
  const registryBase = { ...registry };
  delete (registryBase as Partial<LegacyRegistry>).registryHash;
  if (nodeSha256(canonicalJson(registryBase)) !== registry.registryHash) {
    errors.push('注册表 registryHash 与内容不一致');
  }
  if (registry.entries.length !== seed.words.length) {
    errors.push(`注册表条目 ${registry.entries.length} 与种子 ${seed.words.length} 不一致`);
  }
  const seen = new Set<string>();
  const effectiveIds = new Set<string>();
  const memberships = new Map<string, Map<string, number>>();
  for (const entry of registry.entries) {
    if (seen.has(entry.legacyId)) errors.push(`重复旧 ID：${entry.legacyId}`);
    seen.add(entry.legacyId);
    const source = seedById.get(entry.legacyId);
    if (!source) {
      errors.push(`未知旧 ID：${entry.legacyId}`);
      continue;
    }
    const expectedOriginal = {
      word: source.word,
      difficulty: source.difficulty,
      frequencyRank: source.frequencyRank,
      decks: source.decks,
    };
    if (canonicalJson(entry.original) !== canonicalJson(expectedOriginal)) {
      errors.push(`${entry.legacyId}: 原始身份元数据被改写`);
    }
    if (nodeSha256(canonicalJson(source)) !== entry.seedEntryHash) {
      errors.push(`${entry.legacyId}: seedEntryHash 不匹配`);
    }
    const target = seedById.get(entry.canonicalId);
    if (!target && entry.disposition !== 'deactivate') {
      errors.push(`${entry.legacyId}: 未知规范目标 ${entry.canonicalId}`);
      continue;
    }
    if (entry.disposition === 'deactivate') continue;
    effectiveIds.add(entry.canonicalId);
    const targetMemberships = memberships.get(entry.canonicalId) ?? new Map<string, number>();
    for (const membership of entry.original.decks) {
      const current = targetMemberships.get(membership.deckId);
      if (current === undefined || membership.difficulty < current) {
        targetMemberships.set(membership.deckId, membership.difficulty);
      }
    }
    memberships.set(entry.canonicalId, targetMemberships);
    if (entry.disposition === 'keep') {
      if (entry.canonicalId !== entry.legacyId) errors.push(`${entry.legacyId}: 保留项改写身份`);
      if (entry.canonicalWord !== target?.word) errors.push(`${entry.legacyId}: 保留项改写词形`);
    }
    if (entry.disposition === 'correct' && entry.canonicalWord !== target?.word) {
      // 规范大小写修正允许与种子词形不同，但必须显式出现在决策文件中。
      const decisions = readJson<{
        decisions: Array<{ legacyId: string; canonicalWord?: string }>;
      }>(join(DATA_DIR, 'registry-decisions.json')).decisions;
      if (
        !decisions.some(
          (decision) => decision.legacyId === entry.legacyId && decision.canonicalWord,
        )
      ) {
        errors.push(`${entry.legacyId}: 规范词形修正缺少决策依据`);
      }
    }
  }
  for (const word of seed.words) {
    if (!seen.has(word.id)) errors.push(`漏项：${word.id}`);
  }
  const placeholder = (id: string): WordRecord => ({
    id,
    word: id.replace('w-', ''),
    lemma: id.replace('w-', ''),
    phonetic: '/x/',
    partOfSpeech: ['n.'],
    coreMeaningZh: ['测试'],
    exampleSentence: 'Test.',
    exampleTranslation: '测试。',
    surfaceFormInExample: 'Test',
    difficulty: 1,
    frequencyRank: 1,
    source: BUILT_IN_CONTENT_SOURCE,
    license: BUILT_IN_CONTENT_LICENSE,
  });
  const wordsById = new Map([...effectiveIds].map((id) => [id, placeholder(id)]));
  const decksById = new Map<string, DeckRecord>();
  for (const deckId of DECK_IDS) {
    const wordIds = [...memberships.entries()]
      .filter(([, deckMap]) => deckMap.has(deckId))
      .map(([wordId]) => wordId)
      .sort(byteCompare);
    const wordDifficulties = Object.fromEntries(
      wordIds.map((wordId) => [wordId, memberships.get(wordId)!.get(deckId)!]),
    );
    decksById.set(deckId, {
      id: deckId,
      name: deckId,
      source: BUILT_IN_CONTENT_SOURCE,
      license: BUILT_IN_CONTENT_LICENSE,
      wordIds,
      wordDifficulties,
    });
  }
  errors.push(...validateLegacyRegistry(registry, wordsById, decksById));
  if (errors.length > 0) {
    console.error(`注册表核对失败：${errors.length} 项`);
    for (const error of errors.slice(0, 30)) console.error(`  ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`注册表核对通过：原始 ${registry.entries.length}，有效 ${effectiveIds.size}`);
  console.log(
    `  correct ${registry.entries.filter((entry) => entry.disposition === 'correct').length}`,
  );
  console.log(
    `  merge ${registry.entries.filter((entry) => entry.disposition === 'merge').length}`,
  );
  console.log(
    `  deactivate ${registry.entries.filter((entry) => entry.disposition === 'deactivate').length}`,
  );
  console.log(`  seedHash ${seedHash}`);
  console.log(`  registryHash ${registry.registryHash}`);
}

function ipaReviewList(): void {
  const seed = loadSeed();
  const registry = loadRegistry();
  const ipa = loadIpaCandidates();
  cachedSelections ??= readJson<{
    selections: Record<string, { index: number; reason: string }>;
  }>(IPA_SELECTIONS_PATH);
  cachedOverrides ??= readJson<{
    overrides: Record<string, { ipa: string; reason: string; reviewedBy: string }>;
  }>(IPA_OVERRIDES_PATH);
  const content = new Map<string, CandidateEntry>();
  for (const batch of loadState().batches) {
    const path = batchPath(batch.id, 'output.jsonl');
    if (!existsSync(path)) continue;
    for (const entry of readJsonl<CandidateEntry>(path)) content.set(entry.wordId, entry);
  }
  const rows = effectiveWords(seed, registry)
    .filter((word) => {
      const candidates = ipa.get(word.word.toLowerCase()) ?? [];
      if (candidates.length === 1) return false;
      if (cachedOverrides?.overrides[word.id]) return false;
      if (candidates.length > 1 && cachedSelections?.selections[word.id]) return false;
      return true;
    })
    .map((word) => {
      const entry = content.get(word.id);
      return {
        wordId: word.id,
        word: word.word,
        candidates: ipa.get(word.word.toLowerCase()) ?? [],
        partOfSpeech: entry?.partOfSpeech ?? null,
        coreMeaningZh: entry?.coreMeaningZh ?? null,
      };
    });
  const path = join(DATA_DIR, 'ipa-review.input.jsonl');
  writeJsonl(path, rows);
  console.log(`待复核读音：${rows.length} 项，已写入 ${path}`);
}

function stressPosition(ipa: string): number {
  const index = ipa.indexOf('ˈ');
  if (index < 0) return -1;
  return ipa.slice(1, index).replace(/[^aeiouæɑɒɔəɚɝɛɪiʊuʌɜɐ]/g, '').length;
}

/** 同词元、同重音位置的弱读/方言变体可固定选择；重音不同的词留给逐词复核。 */
function ipaAutoSelect(): void {
  const seed = loadSeed();
  const registry = loadRegistry();
  const ipa = loadIpaCandidates();
  cachedSelections ??= readJson<{
    selections: Record<string, { index: number; reason: string }>;
  }>(IPA_SELECTIONS_PATH);
  let added = 0;
  for (const word of effectiveWords(seed, registry)) {
    if (cachedSelections.selections[word.id]) continue;
    const candidates = ipa.get(word.word.toLowerCase()) ?? [];
    if (candidates.length < 2) continue;
    const stress = new Set(candidates.map(stressPosition));
    if (stress.size !== 1 || stress.has(-1)) continue;
    cachedSelections.selections[word.id] = {
      index: 0,
      reason: '同一词元、同一重音位置的弱读或方言变体；按固定美式快照顺序选主语料形式。',
    };
    added += 1;
  }
  writeJsonAtomic(IPA_SELECTIONS_PATH, {
    schemaVersion: 1,
    description: '多候选读音的逐词选择。键为单词 ID，候选索引从 0 开始。',
    selections: Object.fromEntries(
      Object.entries(cachedSelections.selections).sort(([a], [b]) => byteCompare(a, b)),
    ),
  });
  console.log(`已自动登记 ${added} 个同重音读音变体`);
}

function ipaReviewApply(file: string): void {
  const rows = readJsonl<{
    wordId: string;
    index?: number;
    ipa?: string;
    reason?: string;
    reviewedBy?: string;
  }>(file);
  const ipa = loadIpaCandidates();
  cachedSelections ??= readJson<{
    selections: Record<string, { index: number; reason: string }>;
  }>(IPA_SELECTIONS_PATH);
  cachedOverrides ??= readJson<{
    overrides: Record<string, { ipa: string; reason: string; reviewedBy: string }>;
  }>(IPA_OVERRIDES_PATH);
  for (const row of rows) {
    const word = loadSeed().words.find((item) => item.id === row.wordId);
    if (!word) throw new Error(`未知词 ID：${row.wordId}`);
    const candidates = ipa.get(word.word.toLowerCase()) ?? [];
    const reason = row.reason?.trim();
    if (!reason) throw new Error(`${row.wordId}: 缺少选择依据`);
    if (candidates.length > 1) {
      if (!Number.isInteger(row.index)) throw new Error(`${row.wordId}: 多候选读音缺少 index`);
      if (row.index! < 0 || row.index! >= candidates.length) {
        throw new Error(`${row.wordId}: 读音索引越界`);
      }
      cachedSelections.selections[row.wordId] = { index: row.index!, reason };
    } else {
      if (!row.ipa || !/^\/.*\/$/.test(row.ipa)) throw new Error(`${row.wordId}: 缺项读音格式非法`);
      cachedOverrides.overrides[row.wordId] = {
        ipa: row.ipa,
        reason,
        reviewedBy: row.reviewedBy ?? 'independent-ipa-review',
      };
    }
  }
  writeJsonAtomic(IPA_SELECTIONS_PATH, {
    schemaVersion: 1,
    description: '多候选读音的逐词选择。键为单词 ID，候选索引从 0 开始。',
    selections: Object.fromEntries(
      Object.entries(cachedSelections.selections).sort(([a], [b]) => byteCompare(a, b)),
    ),
  });
  writeJsonAtomic(IPA_OVERRIDES_PATH, {
    schemaVersion: 1,
    description: 'ipa-dict 缺项的独立转写，必须带复核依据。',
    overrides: Object.fromEntries(
      Object.entries(cachedOverrides.overrides).sort(([a], [b]) => byteCompare(a, b)),
    ),
  });
  console.log(`已应用 ${rows.length} 条读音复核结果`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'prepare') return prepare(args.includes('--force'));
  if (command === 'accept' && args[0]) return accept(args[0]);
  if (command === 'review' && args[0] && args[1]) return review(args[0], args[1]);
  if (command === 'build') return buildPackage(args.includes('--pilot'));
  if (command === 'status') return status();
  if (command === 'reopen' && args[0]) return reopen(args[0]);
  if (command === 'check-registry') return checkRegistry();
  if (command === 'ipa-list') return ipaReviewList();
  if (command === 'ipa-apply' && args[0]) return ipaReviewApply(args[0]);
  if (command === 'ipa-auto') return ipaAutoSelect();
  throw new Error(
    '用法：pipeline.ts prepare | accept <batchId> | review <batchId> <review.json> | reopen <batchId> | build [--pilot] | status | check-registry | ipa-auto | ipa-list | ipa-apply <file>',
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
