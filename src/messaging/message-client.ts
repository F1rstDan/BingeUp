import type { ExtensionMessage, CooldownStatusResponse, SiteStateResponse } from '@/messaging/messages';

/**
 * Content → Background 消息客户端。封装 chrome.runtime.sendMessage，
 * 提供类型安全的 SDK 风格接口（M1-02）。
 */
export const messageClient = {
  async getCooldownStatus(): Promise<CooldownStatusResponse> {
    return send({ type: 'COOLDOWN_GET_STATUS' });
  },
  async completeQuestion(): Promise<CooldownStatusResponse> {
    return send({ type: 'COOLDOWN_COMPLETE_QUESTION' });
  },
  async skipQuestion(): Promise<CooldownStatusResponse> {
    return send({ type: 'COOLDOWN_SKIP_QUESTION' });
  },
  async getSiteState(hostname: string): Promise<SiteStateResponse> {
    return send({ type: 'SITE_GET_STATE', hostname });
  },
  async markFirstQuestionHandled(hostname: string): Promise<SiteStateResponse> {
    return send({ type: 'SITE_MARK_FIRST_QUESTION_HANDLED', hostname });
  },
};

function send<T>(message: ExtensionMessage): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}
