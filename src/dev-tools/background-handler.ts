import { CardRepository } from '@/storage/repositories/card-repository';
import { ReviewLogRepository } from '@/storage/repositories/review-log-repository';
import { SessionLogRepository } from '@/storage/repositories/session-log-repository';
import { BuiltInWordBank } from '@/dictionary/built-in-word-bank';
import { LocalSettingsStore } from '@/storage/local-settings';
import { isDevCardType, type DevExtensionMessage } from '@/dev-tools/messages';
import { DevDataService } from '@/dev-tools/dev-data';
import { DevLearningItemService } from '@/dev-tools/dev-learning-item';

export interface DevBackgroundDeps {
  db: IDBDatabase;
  store: LocalSettingsStore;
}

export function isDevExtensionMessage(value: unknown): value is DevExtensionMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false;
  const type = (value as { type?: unknown }).type;
  if (type === 'DEV_PREPARE_CARD') {
    return isDevCardType((value as { cardType?: unknown }).cardType);
  }
  return type === 'DEV_GET_DECK_SUMMARY' || type === 'DEV_GET_DATA_SNAPSHOT';
}

export async function handleDevExtensionMessage(
  message: DevExtensionMessage,
  deps: DevBackgroundDeps,
): Promise<unknown> {
  const cards = new CardRepository(deps.db);
  const words = new BuiltInWordBank();
  const settings = { get: () => deps.store.getAppSettings() };

  if (message.type === 'DEV_PREPARE_CARD') {
    return new DevLearningItemService({
      cards,
      words,
      clock: { now: () => Date.now() },
      settings,
    }).prepare(message.cardType);
  }

  const data = new DevDataService({
    cards,
    reviewLogs: new ReviewLogRepository(deps.db),
    sessionLogs: new SessionLogRepository(deps.db),
    words,
    settings,
  });
  if (message.type === 'DEV_GET_DECK_SUMMARY') return data.getCurrentDeckSummary();
  return data.getSnapshot();
}
