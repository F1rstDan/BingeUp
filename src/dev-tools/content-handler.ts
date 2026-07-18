import type { ContentController } from '@/content/content-controller';
import type { DevContentMessage, DevPingResponse, DevShowCardResult } from '@/dev-tools/messages';
import { isDevCardType } from '@/dev-tools/messages';

export function isDevContentMessage(value: unknown): value is DevContentMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false;
  const type = (value as { type?: unknown }).type;
  if (type === 'DEV_PING') return true;
  return type === 'DEV_SHOW_CARD' && isDevCardType((value as { cardType?: unknown }).cardType);
}

export function createDevContentMessageListener(controller: ContentController) {
  return (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): boolean => {
    if (!isDevContentMessage(message)) return false;
    if (message.type === 'DEV_PING') {
      const response: DevPingResponse = { ok: true };
      sendResponse(response);
      return false;
    }

    void controller
      .showDevCard(message.cardType)
      .then((result: DevShowCardResult) => sendResponse(result))
      .catch((error) => {
        console.error('[BingeUp] 开发题卡消息处理失败', error);
        sendResponse({ ok: false, reason: 'failed' });
      });
    return true;
  };
}
