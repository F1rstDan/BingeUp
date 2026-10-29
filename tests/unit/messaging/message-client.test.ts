import { afterEach, describe, expect, it, vi } from 'vitest';
import { messageClient, retryRecoverySnapshot } from '@/messaging/message-client';
import { ContentUnavailableError } from '@/learning/planned-questions';
import type { AnswerSubmission, SubmissionResult } from '@/types';

vi.mock('animal-island-ui/style?raw', () => ({
  default: ':root{--animal-primary-color:#19c8b9;--animal-font-family:Nunito,sans-serif}',
}));

const BACKUP_NOTICE_ID = 'bingeup-persistence-notice';

function stubRuntime(sendMessage: ReturnType<typeof vi.fn>): void {
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage,
      getURL: (path: string) => 'chrome-extension://test-id/' + path,
    },
  });
}

const QUESTION: AnswerSubmission['question'] = {
  id: 'question-1',
  type: 'en-to-zh',
  cardId: 'card-1',
  wordId: 'w-1',
  prompt: 'abandon',
  options: ['放弃', '建造'],
  correctIndex: 0,
  explanation: { word: 'abandon', partOfSpeech: ['v.'], meanings: ['放弃'] },
};

const SUBMISSION: AnswerSubmission = {
  question: QUESTION,
  selectedIndex: 0,
  responseTimeMs: 1200,
  source: 'natural',
};

const RESULT: SubmissionResult = {
  isCorrect: true,
  correctIndex: 0,
  correctAnswer: '放弃',
  cardId: 'card-1',
  reviewLogId: 'question:question-1',
  submittedAnswer: '放弃',
  explanation: QUESTION.explanation,
  rating: 'good',
};

describe('messageClient — 错误边界', () => {
  afterEach(() => {
    document.getElementById(BACKUP_NOTICE_ID)?.remove();
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

  it('兼容普通答题结果并把备份告警 envelope 解为原 result', async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce(RESULT)
      .mockResolvedValueOnce({
        __bingeupEnvelope: 'result-with-backup-warning',
        result: RESULT,
        backupWarning: { message: '自动快照写入失败' },
      });
    stubRuntime(sendMessage);

    await expect(messageClient.submitLearningAnswer(SUBMISSION)).resolves.toEqual(RESULT);
    await expect(messageClient.submitLearningAnswer(SUBMISSION)).resolves.toEqual(RESULT);
    expect(
      document.getElementById(BACKUP_NOTICE_ID)?.shadowRoot?.querySelector('[role="alert"]'),
    ).toHaveTextContent('学习记录已保存，自动备份未完成');
  });

  it('拒绝缺少原 result 的 envelope，避免显示虚假保存成功', async () => {
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn(async () => ({
          __bingeupEnvelope: 'result-with-backup-warning',
          backupWarning: { message: '失败' },
        })),
      },
    });

    await expect(messageClient.submitLearningAnswer(SUBMISSION)).rejects.toThrow(
      '后台响应格式无效',
    );
  });

  it('void 创建卡告警也先解包并显示备份提示', async () => {
    const sendMessage = vi.fn(async () => ({
      __bingeupEnvelope: 'result-with-backup-warning',
      result: null,
      backupWarning: { message: '快照写入失败' },
    }));
    stubRuntime(sendMessage);

    await expect(messageClient.selfReportKnown('w-1')).resolves.toBeUndefined();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'LEARNING_SELF_REPORT_KNOWN', wordId: 'w-1' });
    expect(
      document.getElementById(BACKUP_NOTICE_ID)?.shadowRoot?.querySelector('[role="alert"]'),
    ).toHaveTextContent('学习记录已保存，自动备份未完成');
  });

  it('设置与 Popup 调用只返回业务 result，不暴露 envelope', async () => {
    const settings = { selectedDeckId: 'deck-1' };
    const popup = { onboardingCompleted: true };
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({
        __bingeupEnvelope: 'result-with-backup-warning',
        result: settings,
        backupWarning: { message: '快照写入失败' },
      })
      .mockResolvedValueOnce({
        __bingeupEnvelope: 'result-with-backup-warning',
        result: popup,
        backupWarning: { message: '快照写入失败' },
      })
      .mockResolvedValueOnce({ ok: true });
    stubRuntime(sendMessage);

    await expect(messageClient.getAppSettings()).resolves.toEqual(settings);
    await expect(messageClient.getPopupData('example.com')).resolves.toEqual(popup);

    const retryButton = [
      ...(document
        .getElementById(BACKUP_NOTICE_ID)
        ?.shadowRoot?.querySelectorAll<HTMLButtonElement>('button') ?? []),
    ].find((button) => button.textContent === '重试备份');
    retryButton!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(sendMessage).toHaveBeenLastCalledWith({ type: 'RETRY_RECOVERY_SNAPSHOT' });
    expect(sendMessage).toHaveBeenCalledTimes(3);
  });

  it('只发送专用备份重试消息，并将失败响应还原为错误', async () => {
    const sendMessage = vi.fn().mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    await expect(retryRecoverySnapshot()).resolves.toBeUndefined();
    expect(sendMessage).toHaveBeenLastCalledWith({ type: 'RETRY_RECOVERY_SNAPSHOT' });

    sendMessage.mockResolvedValueOnce({ ok: false, error: '配额不足' });
    await expect(retryRecoverySnapshot()).rejects.toThrow('配额不足');
  });
});
