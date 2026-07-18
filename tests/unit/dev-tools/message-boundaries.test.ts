import { describe, expect, it, vi } from 'vitest';
import { createDevContentMessageListener, isDevContentMessage } from '@/dev-tools/content-handler';
import { isDevExtensionMessage } from '@/dev-tools/background-handler';

describe('开发工具消息边界', () => {
  it('只接受已登记的题型', () => {
    expect(isDevContentMessage({ type: 'DEV_PING' })).toBe(true);
    expect(isDevContentMessage({ type: 'DEV_SHOW_CARD', cardType: 'spelling' })).toBe(true);
    expect(isDevContentMessage({ type: 'DEV_SHOW_CARD', cardType: 'unknown' })).toBe(false);
    expect(isDevExtensionMessage({ type: 'DEV_PREPARE_CARD', cardType: 'context-choice' })).toBe(
      true,
    );
    expect(isDevExtensionMessage({ type: 'DEV_PREPARE_CARD', cardType: 'unknown' })).toBe(false);
  });

  it('ping 同步响应，题卡请求异步转发给控制器', async () => {
    const controller = { showDevCard: vi.fn(async () => ({ ok: true as const })) };
    const listener = createDevContentMessageListener(controller as never);
    const sendResponse = vi.fn();

    expect(listener({ type: 'DEV_PING' }, {} as chrome.runtime.MessageSender, sendResponse)).toBe(
      false,
    );
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });

    expect(
      listener(
        { type: 'DEV_SHOW_CARD', cardType: 'en-to-zh' },
        {} as chrome.runtime.MessageSender,
        sendResponse,
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(controller.showDevCard).toHaveBeenCalledWith('en-to-zh'));
    expect(sendResponse).toHaveBeenLastCalledWith({ ok: true });
  });
});
