import type {
  DevCardType,
  DevDeckSummary,
  DevDataSnapshot,
  DevExtensionMessage,
  PrepareDevCardResult,
} from '@/dev-tools/messages';

export async function prepareDevCard(cardType: DevCardType): Promise<PrepareDevCardResult> {
  return send({ type: 'DEV_PREPARE_CARD', cardType });
}

export async function getDevDeckSummary(): Promise<DevDeckSummary> {
  return send({ type: 'DEV_GET_DECK_SUMMARY' });
}

export async function getDevDataSnapshot(): Promise<DevDataSnapshot> {
  return send({ type: 'DEV_GET_DATA_SNAPSHOT' });
}

async function send<T>(message: DevExtensionMessage): Promise<T> {
  const response = await chrome.runtime.sendMessage(message);
  if (
    typeof response === 'object' &&
    response !== null &&
    '__bingeupError' in response &&
    typeof response.__bingeupError === 'string'
  ) {
    throw new Error(response.__bingeupError);
  }
  return response as T;
}
