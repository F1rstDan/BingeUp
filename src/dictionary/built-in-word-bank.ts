import type { WordBankPort } from '@/learning/learning-service';
import type {
  DeckRecord,
  DictionaryContentManifest,
  LegacyRegistry,
  WordQuestionPlan,
  WordRecord,
} from '@/types';
import {
  BUILT_IN_CONTENT_LICENSE,
  BUILT_IN_CONTENT_SOURCE,
  validateContentPackage,
} from '@/dictionary/content-contract';
import { sha256Hex } from '@/learning/content-hash';

/**
 * 内置词库适配器（Issue #25：异步化 + JSON 加载）。
 *
 * 从 public/dictionaries/ 加载由构建流水线生成的词库数据。
 * 这些 JSON 必须在 manifest 的 web_accessible_resources 中声明，否则
 * chrome.runtime.getURL 返回的 URL 在 fetch 时会被 Chrome 屏蔽为 chrome-extension://invalid/。
 * 内容脚本通过此适配器访问词库，不将完整数据常驻 bundle。
 */
export class BuiltInWordBank implements WordBankPort {
  private words: Map<string, WordRecord> = new Map();
  private decks: Map<string, DeckRecord> = new Map();
  private questionPlans: Map<string, WordQuestionPlan> = new Map();
  private registry: LegacyRegistry | null = null;
  private aliasToCanonical: Map<string, string> = new Map();
  private defaultDeckId: string | null = null;
  private contentVersion: 'legacy-v1' | 'content-v2' = 'legacy-v1';
  private loaded = false;
  private loadingPromise: Promise<void> | null = null;

  /** 加载词库数据（幂等）。失败时清空 in-flight promise 允许下次重试，错误向上抛出。 */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = this.loadData();
    try {
      await this.loadingPromise;
      this.loaded = true;
    } catch (error) {
      this.loadingPromise = null;
      throw error;
    }
  }

  private async loadData(): Promise<void> {
    const baseUrl = chrome.runtime.getURL('dictionaries');
    let manifest: (DictionaryContentManifest & { schemaVersion: number }) | null = null;
    try {
      manifest = await fetchJson<DictionaryContentManifest & { schemaVersion: number }>(
        `${baseUrl}/manifest.json`,
      );
    } catch {
      // 旧包允许没有 manifest；新内容包缺失 manifest 时必须拒绝，不能静默降级。
      manifest = null;
    }
    if (manifest?.schemaVersion === 2) {
      await this.loadContentV2(baseUrl, manifest as DictionaryContentManifest);
      return;
    }

    const [wordsData, decksData] = await Promise.all([
      fetchJson<WordRecord[]>(`${baseUrl}/words.json`),
      fetchJson<DeckRecord[]>(`${baseUrl}/decks.json`),
    ]);
    if (
      wordsData.some(
        (word) =>
          word.source === BUILT_IN_CONTENT_SOURCE ||
          word.license === BUILT_IN_CONTENT_LICENSE ||
          word.secondaryMeanings !== undefined,
      )
    ) {
      throw new Error('新词库内容包缺少 manifest，拒绝加载以避免资源混版');
    }
    this.loadMaps(wordsData, decksData);
    this.contentVersion = 'legacy-v1';
  }

  /** 新整包：先校验 manifest 与全部依赖哈希，再允许任何学习内容进入内存。 */
  private async loadContentV2(baseUrl: string, manifest: DictionaryContentManifest): Promise<void> {
    const fileTexts = {
      words: await fetchText(`${baseUrl}/words.json`),
      decks: await fetchText(`${baseUrl}/decks.json`),
      questions: await fetchText(`${baseUrl}/questions.json`),
      legacyRegistry: await fetchText(`${baseUrl}/legacy-registry.json`),
      sourceMetadata: await fetchText(`${baseUrl}/source-metadata.json`),
      license: await fetchText(`${baseUrl}/LICENSE.txt`),
    };
    const fileHashes = Object.fromEntries(
      await Promise.all(
        Object.entries(fileTexts).map(async ([name, text]) => [name, await sha256Hex(text)]),
      ),
    ) as Record<keyof DictionaryContentManifest['files'], string>;
    const wordsData = JSON.parse(fileTexts.words) as WordRecord[];
    const decksData = JSON.parse(fileTexts.decks) as DeckRecord[];
    const questionsData = JSON.parse(fileTexts.questions) as WordQuestionPlan[];
    const registryData = JSON.parse(fileTexts.legacyRegistry) as LegacyRegistry;

    const validation = await validateContentPackage({
      manifest,
      words: wordsData,
      decks: decksData,
      questions: questionsData,
      registry: registryData,
      fileHashes,
      verifyQuestionHashes: false,
    });
    if (!validation.valid) {
      throw new Error(`词库内容包校验失败：${validation.errors.slice(0, 5).join('；')}`);
    }

    this.words.clear();
    this.decks.clear();
    this.questionPlans.clear();
    this.aliasToCanonical.clear();
    this.loadMaps(wordsData, decksData);
    for (const plan of questionsData) this.questionPlans.set(plan.wordId, plan);
    this.registry = registryData;
    for (const entry of registryData.entries) {
      this.aliasToCanonical.set(entry.legacyId, entry.canonicalId);
      this.aliasToCanonical.set(entry.canonicalId, entry.canonicalId);
    }
    this.contentVersion = 'content-v2';
  }

  private loadMaps(wordsData: WordRecord[], decksData: DeckRecord[]): void {
    this.words.clear();
    this.decks.clear();
    this.questionPlans.clear();
    this.aliasToCanonical.clear();
    this.registry = null;
    for (const w of wordsData) this.words.set(w.id, w);
    for (const d of decksData) this.decks.set(d.id, d);
    this.defaultDeckId = decksData[0]?.id ?? null;
  }

  /** 把旧 ID 解析为有效规范 ID；未知 ID 原样返回。 */
  resolveWordId(wordId: string): string {
    return this.aliasToCanonical.get(wordId) ?? wordId;
  }

  /** 内容包类型；旧包没有固定题组。 */
  getContentVersion(): 'legacy-v1' | 'content-v2' {
    return this.contentVersion;
  }

  /** 读取版本化身份注册表；旧包返回 null。 */
  async getLegacyRegistry(): Promise<LegacyRegistry | null> {
    await this.ensureLoaded();
    return this.registry;
  }

  /** 读取固定题组；旧包或未配置时返回 null。 */
  async getQuestionPlan(wordId: string): Promise<WordQuestionPlan | null> {
    await this.ensureLoaded();
    return this.questionPlans.get(this.resolveWordId(wordId)) ?? null;
  }

  async getDefaultDeck(): Promise<DeckRecord> {
    await this.ensureLoaded();
    if (this.defaultDeckId) {
      const deck = this.decks.get(this.defaultDeckId);
      if (deck) return deck;
    }
    const first = this.decks.values().next().value;
    if (first) return first as DeckRecord;
    throw new Error('内置词库为空，无法获取默认词库');
  }

  async getDeck(deckId: string): Promise<DeckRecord | null> {
    await this.ensureLoaded();
    return this.decks.get(deckId) ?? null;
  }

  async getWord(wordId: string): Promise<WordRecord | null> {
    await this.ensureLoaded();
    return this.words.get(this.resolveWordId(wordId)) ?? null;
  }

  async getWordsByIds(wordIds: string[]): Promise<WordRecord[]> {
    await this.ensureLoaded();
    const result: WordRecord[] = [];
    for (const id of wordIds) {
      const word = this.words.get(this.resolveWordId(id));
      if (word) result.push(word);
    }
    return result;
  }

  async listWords(): Promise<WordRecord[]> {
    await this.ensureLoaded();
    return [...this.words.values()];
  }

  async sampleDeckWords(params: {
    deckId: string;
    count: number;
    preferredDifficulty: number[];
    excludeWordIds: string[];
  }): Promise<WordRecord[]> {
    await this.ensureLoaded();

    const deck = this.decks.get(params.deckId);
    if (!deck) return [];

    const deckWordIds = new Set(deck.wordIds);
    const excludeSet = new Set(params.excludeWordIds);
    const difficultySet = new Set(params.preferredDifficulty);

    // 获取词库中的单词，排除已排除项，按难度筛选
    const candidates: Array<{ word: WordRecord; deckDifficulty: number }> = [];

    for (const wordId of deckWordIds) {
      if (excludeSet.has(wordId)) continue;
      const word = this.words.get(wordId);
      if (!word) continue;

      const deckDifficulty = deck.wordDifficulties?.[wordId] ?? word.difficulty;

      if (difficultySet.has(deckDifficulty)) {
        candidates.push({ word, deckDifficulty });
      }
    }

    // 按词频排名排序（优先高频词），同频随机打乱，取前 count 个
    candidates.sort((a, b) => {
      const rankDiff = a.word.frequencyRank - b.word.frequencyRank;
      if (rankDiff !== 0) return rankDiff;
      return Math.random() - 0.5;
    });
    return candidates.slice(0, params.count).map((c) => c.word);
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`词库资源加载失败：${url} (${response.status})`);
  return response.text();
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`词库资源加载失败：${url} (${response.status})`);
  return (await response.json()) as T;
}
