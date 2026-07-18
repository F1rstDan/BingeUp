import type { CardRepositoryPort } from '@/storage/repositories/card-repository';
import type { ReviewLogRepositoryPort } from '@/storage/repositories/review-log-repository';
import type { SessionLogRepositoryPort } from '@/storage/repositories/session-log-repository';
import type { WordBankPort } from '@/learning/learning-service';
import type { CardStage } from '@/types';
import type { DevDataModule, DevDataSnapshot, DevDeckSummary } from '@/dev-tools/messages';

export interface DevDataDeps {
  cards: CardRepositoryPort;
  reviewLogs: ReviewLogRepositoryPort;
  sessionLogs: SessionLogRepositoryPort;
  words: WordBankPort;
  settings: { get(): Promise<{ selectedDeckId: string }> };
}

const CARD_STAGES: CardStage[] = ['new', 'short-term', 'long-term', 'self-reported-known'];

export class DevDataService implements DevDataModule {
  private readonly deps: DevDataDeps;

  constructor(deps: DevDataDeps) {
    this.deps = deps;
  }

  async getCurrentDeckSummary(): Promise<DevDeckSummary> {
    const [{ selectedDeckId }, cards] = await Promise.all([
      this.deps.settings.get(),
      this.deps.cards.getAll(),
    ]);
    const deck = await this.resolveDeck(selectedDeckId);
    const deckWordIds = new Set(deck.wordIds);
    const deckCards = cards.filter((card) => deckWordIds.has(card.wordId));
    const stageCounts = Object.fromEntries(CARD_STAGES.map((stage) => [stage, 0])) as Record<
      CardStage,
      number
    >;
    for (const card of deckCards) stageCounts[card.stage] += 1;

    return {
      deck: { id: deck.id, name: deck.name },
      wordCount: deck.wordIds.length,
      learningCardCount: deckCards.length,
      stageCounts,
    };
  }

  async getSnapshot(): Promise<DevDataSnapshot> {
    const [cards, reviewLogs, sessionLogs] = await Promise.all([
      this.deps.cards.getAll(),
      this.deps.reviewLogs.getAll(),
      this.deps.sessionLogs.getAll(),
    ]);
    return { cards, reviewLogs, sessionLogs };
  }

  private async resolveDeck(selectedDeckId: string) {
    if (selectedDeckId !== '') {
      const selected = await this.deps.words.getDeck(selectedDeckId);
      if (selected !== null) return selected;
    }
    return this.deps.words.getDefaultDeck();
  }
}
