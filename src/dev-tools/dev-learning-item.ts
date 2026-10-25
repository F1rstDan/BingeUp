import type { CardRepositoryPort } from '@/storage/repositories/card-repository';
import { CardUniquenessError } from '@/storage/repositories/card-repository';
import type { WordBankPort } from '@/learning/learning-service';
import {
  generatePlannedContextChoice,
  generatePlannedEnToZh,
  generatePlannedSpelling,
  generatePlannedZhToEn,
} from '@/learning/planned-questions';
import type {
  CardRecord,
  LearningItem,
  SelfRatedLevel,
  WordQuestionPlan,
  WordRecord,
} from '@/types';
import type { DevCardType, PrepareDevCardResult } from '@/dev-tools/messages';

const SHORT_TERM_DELAY_MS = 10 * 60_000;

interface DevLearningSettings {
  selectedDeckId: string;
  selfRatedLevel: SelfRatedLevel;
}

export interface DevLearningItemDeps {
  cards: CardRepositoryPort;
  words: WordBankPort;
  clock: { now(): number };
  settings: { get(): Promise<DevLearningSettings> };
  random?: () => number;
}

/**
 * 开发题卡准备模块。
 *
 * Popup 只提交题型，选词、固定题组校验和必要的真实建卡全部在此处完成，
 * 避免多个调用方各自复制正式学习规则。
 */
export class DevLearningItemService {
  private readonly deps: DevLearningItemDeps;

  constructor(deps: DevLearningItemDeps) {
    this.deps = deps;
  }

  async prepare(cardType: DevCardType): Promise<PrepareDevCardResult> {
    const [settings, cards] = await Promise.all([
      this.deps.settings.get(),
      this.deps.cards.getAll(),
    ]);
    const deck = await this.resolveDeck(settings.selectedDeckId);

    if (cardType === 'new-word') {
      const candidate = await this.pickCandidate(deck.id, cards, settings);
      return candidate === null
        ? { ok: false, reason: 'no-unlearned-word' }
        : { ok: true, item: { kind: 'new-word-presentation', presentation: { word: candidate } } };
    }

    const deckWordIds = new Set(deck.wordIds);
    const deckCards = cards.filter((card) => deckWordIds.has(card.wordId));
    let sawDeckWord = deck.wordIds.length > 0;
    let sawValidTarget = false;

    for (const card of this.shuffle(deckCards)) {
      const target = await this.deps.words.getWord(card.wordId);
      if (target === null) continue;
      sawDeckWord = true;
      const plan = await this.deps.words.getQuestionPlan(card.wordId);
      if (plan === null) continue;
      if (!this.hasRequestedPlan(cardType, plan)) continue;
      const item = await this.tryBuildItem(cardType, target, card.id, plan);
      if (item !== null) {
        sawValidTarget = true;
        return { ok: true, item };
      }
    }

    const candidates = await this.pickCandidates(deck.id, cards, settings, cardType);
    for (const target of candidates) {
      sawDeckWord = true;
      const plan = await this.deps.words.getQuestionPlan(target.id);
      if (plan === null || !this.hasRequestedPlan(cardType, plan)) continue;

      const card = this.buildAcceptedNewCard(target.id, deck.id);
      const provisionalItem = await this.tryBuildItem(cardType, target, card.id, plan);
      if (provisionalItem === null) continue;
      sawValidTarget = true;

      const existing = await this.deps.cards.getByWordId(target.id);
      if (existing !== undefined) {
        const existingItem = await this.tryBuildItem(cardType, target, existing.id, plan);
        if (existingItem !== null) return { ok: true, item: existingItem };
        continue;
      }

      try {
        await this.deps.cards.save(card);
        return { ok: true, item: provisionalItem };
      } catch (error) {
        if (!(error instanceof CardUniquenessError)) throw error;
        const concurrent = await this.deps.cards.getByWordId(target.id);
        if (concurrent === undefined) throw error;
        const concurrentItem = await this.tryBuildItem(cardType, target, concurrent.id, plan);
        if (concurrentItem !== null) return { ok: true, item: concurrentItem };
      }
    }

    if (!sawDeckWord) return { ok: false, reason: 'no-learning-content' };
    if (cardType === 'context-choice' && !sawValidTarget) {
      return { ok: false, reason: 'no-context-example' };
    }
    return { ok: false, reason: 'insufficient-question-data' };
  }

  private async resolveDeck(selectedDeckId: string) {
    if (selectedDeckId !== '') {
      const selected = await this.deps.words.getDeck(selectedDeckId);
      if (selected !== null) return selected;
    }
    return this.deps.words.getDefaultDeck();
  }

  private async pickCandidate(
    deckId: string,
    existingCards: CardRecord[],
    settings: DevLearningSettings,
  ): Promise<WordRecord | null> {
    const candidates = await this.pickCandidates(deckId, existingCards, settings, 'new-word');
    return candidates[0] ?? null;
  }

  private async pickCandidates(
    deckId: string,
    existingCards: CardRecord[],
    settings: DevLearningSettings,
    cardType: DevCardType,
  ): Promise<WordRecord[]> {
    const excludedWordIds = new Set(existingCards.map((card) => card.wordId));
    const zones = this.difficultyZones(this.preferredDifficulty(settings.selfRatedLevel));

    for (const zone of zones) {
      const sampled = await this.deps.words.sampleDeckWords({
        deckId,
        count: 50,
        preferredDifficulty: zone,
        excludeWordIds: [...excludedWordIds],
      });
      const valid: WordRecord[] = [];
      for (const word of this.shuffle(sampled)) {
        if (excludedWordIds.has(word.id)) continue;
        if (cardType === 'new-word') {
          valid.push(word);
          continue;
        }
        const plan = await this.deps.words.getQuestionPlan(word.id);
        if (plan === null || !this.hasRequestedPlan(cardType, plan)) continue;
        const item = await this.tryBuildItem(cardType, word, 'candidate-probe', plan);
        if (item !== null) valid.push(word);
      }
      if (valid.length > 0) return valid;
    }

    return [];
  }

  private hasRequestedPlan(cardType: DevCardType, plan: WordQuestionPlan): boolean {
    switch (cardType) {
      case 'new-word':
        return true;
      case 'en-to-zh':
        return plan.enToZh !== null;
      case 'zh-to-en':
        return plan.zhToEn !== null;
      case 'context-choice':
        return plan.contextChoice !== null;
      case 'spelling':
        return plan.spelling !== null;
    }
  }

  private preferredDifficulty(level: SelfRatedLevel): number[] {
    switch (level) {
      case 'beginner':
        return [1, 2];
      case 'intermediate':
        return [2, 3];
      case 'advanced':
        return [3, 4];
    }
  }

  private difficultyZones(preferred: number[]): number[][] {
    const zones = [preferred];
    for (const difficulty of [1, 2, 3, 4]) {
      if (!preferred.includes(difficulty)) zones.push([difficulty]);
    }
    return zones;
  }

  private async tryBuildItem(
    cardType: DevCardType,
    target: WordRecord,
    cardId: string,
    plan: WordQuestionPlan,
  ): Promise<LearningItem | null> {
    try {
      switch (cardType) {
        case 'en-to-zh':
        case 'zh-to-en':
        case 'context-choice': {
          const referencedIds = new Set<string>();
          for (const wordId of plan.enToZh.distractors) referencedIds.add(wordId);
          for (const wordId of plan.zhToEn?.distractors ?? []) referencedIds.add(wordId);
          for (const item of plan.contextChoice?.distractors ?? []) {
            referencedIds.add(item.wordId);
          }
          const referenced = await this.deps.words.getWordsByIds([...referencedIds]);
          const wordsById = new Map(referenced.map((word) => [word.id, word]));
          wordsById.set(target.id, target);

          if (cardType === 'en-to-zh') {
            return {
              kind: 'question',
              question: generatePlannedEnToZh(target, plan, wordsById, cardId, this.random),
            };
          }
          if (cardType === 'zh-to-en') {
            return {
              kind: 'question',
              question: generatePlannedZhToEn(target, plan, wordsById, cardId, this.random),
            };
          }
          return {
            kind: 'question',
            question: generatePlannedContextChoice(target, plan, wordsById, cardId, this.random),
          };
        }
        case 'spelling':
          return {
            kind: 'spelling-question',
            question: generatePlannedSpelling(target, plan, cardId),
          };
        case 'new-word':
          return { kind: 'new-word-presentation', presentation: { word: target } };
      }
    } catch {
      return null;
    }
  }

  private buildAcceptedNewCard(wordId: string, deckId: string): CardRecord {
    const now = this.deps.clock.now();
    return {
      id: crypto.randomUUID(),
      wordId,
      deckId,
      stage: 'short-term',
      origin: 'accepted-new',
      createdAt: now,
      updatedAt: now,
      nextReviewAt: now + SHORT_TERM_DELAY_MS,
    };
  }

  private get random(): () => number {
    return this.deps.random ?? Math.random;
  }

  private shuffle<T>(values: T[]): T[] {
    const remaining = [...values];
    const result: T[] = [];
    while (remaining.length > 0) {
      const index = Math.min(remaining.length - 1, Math.floor(this.random() * remaining.length));
      result.push(remaining.splice(index, 1)[0]!);
    }
    return result;
  }
}
