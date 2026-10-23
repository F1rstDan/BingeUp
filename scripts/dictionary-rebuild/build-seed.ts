/**
 * 从旧内置词库生成一次性身份种子和版本化身份注册表。
 *
 * 只读取身份元数据：ID、词形、词频、通用难度、词库成员关系和词库内难度。
 * 不读取旧释义、例句或音标，避免旧学习文本进入新流水线。
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface LegacyWord {
  id: string;
  word: string;
  lemma: string;
  difficulty: number;
  frequencyRank: number;
  source: string;
  license: string;
}

interface LegacyDeck {
  id: string;
  name: string;
  description?: string;
  wordIds: string[];
  wordDifficulties?: Record<string, number>;
}

interface Decision {
  legacyId: string;
  disposition: 'keep' | 'correct' | 'merge' | 'deactivate';
  canonicalId: string;
  canonicalWord?: string;
  reason: string;
  evidence: string[];
}

const ROOT = process.cwd();
const DATA_DIR = join(ROOT, 'data/dictionary-rebuild');
const LEGACY_DIR = join(ROOT, 'public/dictionaries');
const DATASET_ID = 'bingeup-legacy-2026-10-23';
const REGISTRY_VERSION = 'legacy-registry-1';
const SOURCE = {
  name: 'ECDICT',
  repository: 'https://github.com/skywind3000/ECDICT',
  commit: 'bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b',
  license: 'MIT',
  capturedAt: '2026-10-23',
  note: '只继承 ID、分类、词频和难度事实；不继承词条学习文本。',
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function byteCompare(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function main() {
  const words = JSON.parse(readFileSync(join(LEGACY_DIR, 'words.json'), 'utf8')) as LegacyWord[];
  const decks = JSON.parse(readFileSync(join(LEGACY_DIR, 'decks.json'), 'utf8')) as LegacyDeck[];
  const decisionsFile = JSON.parse(
    readFileSync(join(DATA_DIR, 'registry-decisions.json'), 'utf8'),
  ) as { decisions: Decision[] };

  const deckOrder = new Map(decks.map((deck, index) => [deck.id, index]));
  const decisions = new Map(decisionsFile.decisions.map((item) => [item.legacyId, item]));

  const seedWords = [...words]
    .sort((a, b) => byteCompare(a.id, b.id))
    .map((word) => {
      const memberships = decks
        .filter((deck) => deck.wordIds.includes(word.id))
        .sort((a, b) => (deckOrder.get(a.id) ?? 0) - (deckOrder.get(b.id) ?? 0))
        .map((deck) => ({
          deckId: deck.id,
          difficulty: deck.wordDifficulties?.[word.id] ?? word.difficulty,
        }));
      return {
        id: word.id,
        word: word.lemma || word.word,
        difficulty: word.difficulty,
        frequencyRank: word.frequencyRank,
        decks: memberships,
      };
    });

  const seed = {
    schemaVersion: 1,
    datasetId: DATASET_ID,
    registryVersion: REGISTRY_VERSION,
    source: SOURCE,
    decks: decks.map((deck) => ({
      id: deck.id,
      name: deck.name,
      description: deck.description ?? '',
    })),
    words: seedWords,
  };
  const seedHash = sha256(seed);

  const seedById = new Map(seedWords.map((word) => [word.id, word]));
  const registryEntries = seedWords.map((word) => {
    const decision = decisions.get(word.id);
    const disposition = decision?.disposition ?? 'keep';
    const canonicalId = decision?.canonicalId ?? word.id;
    const canonicalWord = decision?.canonicalWord ?? seedById.get(canonicalId)?.word ?? word.word;
    return {
      legacyId: word.id,
      disposition,
      canonicalId,
      canonicalWord,
      reason: decision?.reason ?? '保留：词形与身份元数据通过机器核对，未发现已确认错拼或重复。',
      evidence: decision?.evidence ?? ['seed-entry', 'wordform-review-v1'],
      seedEntryHash: sha256(word),
      original: {
        word: word.word,
        difficulty: word.difficulty,
        frequencyRank: word.frequencyRank,
        decks: word.decks,
      },
    };
  });

  const registryBase = {
    schemaVersion: 1,
    registryVersion: REGISTRY_VERSION,
    datasetId: DATASET_ID,
    seedHash,
    source: SOURCE,
    review: {
      reviewedAt: '2026-10-23',
      method:
        '逐 ID 核对词形、重复项、词库成员关系和音标覆盖；仅对已确认错拼和规范大小写写入例外决策。',
      evidenceSources: [
        'ipa-dict en_US 972cd67dd5f96bc5660e28070cde26e3928abcd7',
        'https://github.com/dwyl/english-words',
        'https://dictionary.cambridge.org/',
      ],
    },
    entries: registryEntries,
  };
  const registry = { ...registryBase, registryHash: sha256(registryBase) };

  // 生成前检查：每个原始 ID 恰好一条结论，目标必须存在且不是自身以外的未知项。
  if (registryEntries.length !== seedWords.length) throw new Error('注册表条目数量与种子不一致');
  const seen = new Set<string>();
  for (const entry of registryEntries) {
    if (seen.has(entry.legacyId)) throw new Error(`重复的旧 ID：${entry.legacyId}`);
    seen.add(entry.legacyId);
    if (!seedById.has(entry.canonicalId)) throw new Error(`未知规范目标：${entry.canonicalId}`);
    if (entry.disposition === 'keep' && entry.canonicalId !== entry.legacyId) {
      throw new Error(`保留项改写了身份：${entry.legacyId}`);
    }
  }
  for (const decision of decisions.values()) {
    if (!seedById.has(decision.legacyId)) throw new Error(`决策引用未知 ID：${decision.legacyId}`);
  }

  writeFileSync(join(DATA_DIR, 'seed.json'), `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
  writeFileSync(
    join(DATA_DIR, 'legacy-registry.json'),
    `${JSON.stringify(registry, null, 2)}\n`,
    'utf8',
  );

  const effectiveIds = new Set(registryEntries.map((entry) => entry.canonicalId));
  console.log(`种子词条：${seedWords.length}`);
  console.log(`原始 ID：${registryEntries.length}`);
  console.log(`有效词：${effectiveIds.size}`);
  console.log(`seedHash：${seedHash}`);
  console.log(`registryHash：${registry.registryHash}`);
}

main();
