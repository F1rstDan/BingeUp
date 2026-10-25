import type { WordBankPort } from '@/learning/learning-service';
import type { DeckRecord, DictionaryContentManifest, WordQuestionPlan, WordRecord } from '@/types';
import { validateContentPackage } from '@/dictionary/content-contract';
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
  private defaultDeckId: string | null = null;
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
    let manifest: DictionaryContentManifest & { schemaVersion: number };
    try {
      manifest = await fetchJson<DictionaryContentManifest & { schemaVersion: number }>(
        `${baseUrl}/manifest.json`,
      );
    } catch (error) {
      throw new Error('词库 manifest 缺失或无法读取', { cause: error });
    }
    if (manifest.schemaVersion !== 1) {
      throw new Error(`词库 manifest schemaVersion 必须为 1：${manifest.schemaVersion}`);
    }
    await this.loadCurrentPackage(baseUrl, manifest as DictionaryContentManifest);
  }

  /** 当前整包：先校验 manifest 与全部依赖哈希，再允许任何学习内容进入内存。 */
  private async loadCurrentPackage(
    baseUrl: string,
    manifest: DictionaryContentManifest,
  ): Promise<void> {
    const fileTexts = {
      words: await fetchText(`${baseUrl}/words.json`),
      decks: await fetchText(`${baseUrl}/decks.json`),
      questions: await fetchText(`${baseUrl}/questions.json`),
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

    const validation = await validateContentPackage({
      manifest,
      words: wordsData,
      decks: decksData,
      questions: questionsData,
      fileHashes,
      verifyQuestionHashes: false,
    });
    if (!validation.valid) {
      throw new Error(`词库内容包校验失败：${validation.errors.slice(0, 5).join('；')}`);
    }

    this.loadMaps(wordsData, decksData);
    for (const plan of questionsData) this.questionPlans.set(plan.wordId, plan);
  }

  private loadMaps(wordsData: WordRecord[], decksData: DeckRecord[]): void {
    this.words.clear();
    this.decks.clear();
    this.questionPlans.clear();
    for (const w of wordsData) this.words.set(w.id, w);
    for (const d of decksData) this.decks.set(d.id, d);
    this.defaultDeckId = decksData[0]?.id ?? null;
  }

  /** 读取当前词条的固定题组。 */
  async getQuestionPlan(wordId: string): Promise<WordQuestionPlan | null> {
    await this.ensureLoaded();
    return this.questionPlans.get(wordId) ?? null;
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
    return this.words.get(wordId) ?? null;
  }

  async getWordsByIds(wordIds: string[]): Promise<WordRecord[]> {
    await this.ensureLoaded();
    const result: WordRecord[] = [];
    for (const id of wordIds) {
      const word = this.words.get(id);
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
