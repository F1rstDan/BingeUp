import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSiteState = vi.fn();

vi.mock('@/messaging/message-client', () => ({
  messageClient: { getSiteState },
}));

describe('bootstrapContent — 启动诊断', () => {
  beforeEach(() => {
    vi.resetModules();
    getSiteState.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it('受支持站点启动时报告适配器', async () => {
    getSiteState.mockResolvedValue({
      hostname: 'www.bilibili.com',
      enabled: true,
      mode: 'full-adaptation',
      firstQuestionPending: true,
    });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { bootstrapContent } = await import('@/content/bootstrap');

    await bootstrapContent();

    expect(info).toHaveBeenCalledWith('[BingeUp] 内容脚本已启动，等待有效主视频', {
      hostname: 'www.bilibili.com',
      adapter: 'bilibili',
    });
    info.mockRestore();
  });

  it('不支持的页面报告未启动原因', async () => {
    vi.stubGlobal('location', { hostname: 'music.youtube.com' });
    getSiteState.mockResolvedValue({
      hostname: 'music.youtube.com',
      enabled: true,
      mode: 'full-adaptation',
      firstQuestionPending: true,
    });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { bootstrapContent } = await import('@/content/bootstrap');

    await bootstrapContent();

    expect(info).toHaveBeenCalledWith(
      '[BingeUp] 内容脚本未启动：当前页面不受支持',
      'music.youtube.com',
    );
    info.mockRestore();
  });
});
