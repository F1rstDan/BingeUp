import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSiteState = vi.fn();

vi.mock('@/messaging/message-client', () => ({
  messageClient: { getSiteState },
}));

describe('bootstrapContent — 启动诊断', () => {
  beforeEach(() => {
    vi.resetModules();
    getSiteState.mockReset();
  });

  it('站点被暂停时报告未启动原因', async () => {
    getSiteState.mockResolvedValue({
      hostname: 'www.bilibili.com',
      enabled: false,
      mode: 'full-adaptation',
      firstQuestionPending: false,
    });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { bootstrapContent } = await import('@/content/bootstrap');

    await bootstrapContent();

    expect(info).toHaveBeenCalledWith(
      '[BingeUp] 内容脚本未启动：网站已暂停',
      'www.bilibili.com',
    );
    info.mockRestore();
  });
});
