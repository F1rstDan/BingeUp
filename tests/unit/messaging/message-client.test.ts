import { afterEach, describe, expect, it, vi } from 'vitest';
import { messageClient } from '@/messaging/message-client';
import { ContentUnavailableError } from '@/learning/planned-questions';

describe('messageClient — 错误边界', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('保留内容不可用错误码并重建可判别错误', async () => {
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn(async () => ({
          __bingeupError: '学习卡已失效：card-1',
          __bingeupErrorCode: 'content-unavailable',
        })),
      },
    });

    await expect(messageClient.getNextLearningItem()).rejects.toBeInstanceOf(
      ContentUnavailableError,
    );
  });

  it('普通错误仍为 Error', async () => {
    vi.stubGlobal('chrome', {
      runtime: { sendMessage: vi.fn(async () => ({ __bingeupError: '普通失败' })) },
    });
    await expect(messageClient.getNextLearningItem()).rejects.toThrow('普通失败');
  });

  it('读取安装引导状态并返回完成标志', async () => {
    const sendMessage = vi.fn(async () => ({ onboardingCompleted: true }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    await expect(messageClient.getOnboardingStatus()).resolves.toEqual({
      onboardingCompleted: true,
    });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'GET_ONBOARDING_STATUS' });
  });
});
