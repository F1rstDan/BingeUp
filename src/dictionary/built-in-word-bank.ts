import type { WordBankPort } from '@/learning/learning-service';
import type { WordRecord, DeckRecord } from '@/types';

/**
 * 内置词库适配器（Issue #25：异步化 + 从 JSON 文件加载）。
 *
 * 从 public/dictionaries/ 加载由构建流水线生成的词库数据。
 * 首次加载后缓存到内存，后续查询直接返回缓存数据。
 * 内容脚本通过此适配器访问词库，不将完整数据常驻 bundle。
 */
export class BuiltInWordBank implements WordBankPort {
  private words: Map<string, WordRecord> = new Map();
  private decks: Map<string, DeckRecord> = new Map();
  private defaultDeckId: string | null = null;
  private loaded = false;
  private loadingPromise: Promise<void> | null = null;

  /** 加载词库数据（幂等）。 */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = this.loadData();
    await this.loadingPromise;
    this.loaded = true;
  }

  private async loadData(): Promise<void> {
    try {
      const baseUrl = chrome.runtime.getURL('dictionaries');
      const [wordsRes, decksRes] = await Promise.all([
        fetch(`${baseUrl}/words.json`),
        fetch(`${baseUrl}/decks.json`),
      ]);

      if (!wordsRes.ok || !decksRes.ok) {
        throw new Error(`词库加载失败: words=${wordsRes.status} decks=${decksRes.status}`);
      }

      const wordsData: WordRecord[] = await wordsRes.json();
      const decksData: DeckRecord[] = await decksRes.json();

      for (const w of wordsData) {
        this.words.set(w.id, w);
      }

      for (const d of decksData) {
        this.decks.set(d.id, d);
      }

      if (decksData.length > 0) {
        this.defaultDeckId = decksData[0]!.id;
      }
    } catch (err) {
      console.error('[BuiltInWordBank] 词库加载失败:', err);
      throw err;
    }
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

    // 按词库内难度排序（优先低难度），取前 count 个
    candidates.sort((a, b) => a.deckDifficulty - b.deckDifficulty);
    return candidates.slice(0, params.count).map((c) => c.word);
  }
}