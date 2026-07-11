import type {
  CooldownStatusResponse,
  ExtensionMessage,
  PauseResponse,
  PopupDataResponse,
  SiteStateResponse,
} from '@/messaging/messages';

/**
 * Content / Popup → Background 消息客户端。封装 chrome.runtime.sendMessage，
 * 提供类型安全的 SDK 风格接口（M1-02 / Issue #9）。
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

  // ─── Issue #9 ─────────────────────────────────────────────
  async completeOnboarding(hostnames: string[]): Promise<void> {
    await send({ type: 'ONBOARDING_COMPLETE', hostnames });
  },
  async enableSite(hostname: string): Promise<SiteStateResponse> {
    return send({ type: 'SITE_ENABLE', hostname });
  },
  async disableSite(hostname: string): Promise<SiteStateResponse> {
    return send({ type: 'SITE_DISABLE', hostname });
  },
  async pauseAll(): Promise<PauseResponse> {
    return send({ type: 'PAUSE_ALL' });
  },
  async pauseToday(now: number): Promise<PauseResponse> {
    return send({ type: 'PAUSE_TODAY', now });
  },
  async resumeAll(): Promise<PauseResponse> {
    return send({ type: 'RESUME_ALL' });
  },
  async recordPromptDecline(hostname: string): Promise<void> {
    await send({ type: 'PROMPT_DECLINE', hostname });
  },
  async getPopupData(hostname: string): Promise<PopupDataResponse> {
    return send({ type: 'GET_POPUP_DATA', hostname });
  },
};

function send<T>(message: ExtensionMessage): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}
