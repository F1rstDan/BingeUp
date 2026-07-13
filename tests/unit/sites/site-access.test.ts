import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addWebsite } from '@/sites/site-access';

const mocks = vi.hoisted(() => ({
  getSiteState: vi.fn(),
  enableSite: vi.fn(),
  addCustomSite: vi.fn(),
}));

vi.mock('@/messaging/message-client', () => ({
  messageClient: mocks,
}));

const permissionsContains = vi.fn();
const permissionsRequest = vi.fn();
const permissionsRemove = vi.fn();

describe('网站加入边界（Issue #16）', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getSiteState.mockResolvedValue({
      hostname: 'www.youtube.com',
      enabled: false,
      mode: 'full-adaptation',
      firstQuestionPending: false,
    });
    mocks.enableSite.mockResolvedValue(undefined);

    permissionsContains.mockReset().mockResolvedValue(false);
    permissionsRequest.mockReset().mockResolvedValue(true);
    permissionsRemove.mockReset().mockResolvedValue(true);

    vi.stubGlobal('chrome', {
      permissions: {
        contains: permissionsContains,
        request: permissionsRequest,
        remove: permissionsRemove,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('专属网站复用既有启用流程且不申请可选权限', async () => {
    const result = await addWebsite('https://www.youtube.com/watch?v=x');

    expect(result).toEqual({ ok: true, hostname: 'www.youtube.com', status: 'added' });
    expect(mocks.enableSite).toHaveBeenCalledWith('www.youtube.com');
    expect(mocks.addCustomSite).not.toHaveBeenCalled();
    expect(chrome.permissions.request).not.toHaveBeenCalled();
  });

  it('专属网站处于默认启用状态时仍物化站点记录供设置页列出', async () => {
    mocks.getSiteState.mockResolvedValue({
      hostname: 'www.youtube.com',
      enabled: true,
      mode: 'full-adaptation',
      firstQuestionPending: true,
    });

    const result = await addWebsite('www.youtube.com');

    expect(result).toEqual({
      ok: true,
      hostname: 'www.youtube.com',
      status: 'already-enabled',
    });
    expect(mocks.enableSite).toHaveBeenCalledWith('www.youtube.com');
    expect(chrome.permissions.request).not.toHaveBeenCalled();
  });

  it('自定义网站状态已启用但权限被撤销时重新申请权限并保留兼容等级', async () => {
    mocks.getSiteState.mockResolvedValue({
      hostname: 'example.com',
      enabled: true,
      mode: 'generic-video',
      firstQuestionPending: false,
    });

    const result = await addWebsite('example.com');

    expect(chrome.permissions.request).toHaveBeenCalledWith({
      origins: ['https://example.com/*'],
    });
    expect(mocks.addCustomSite).toHaveBeenCalledWith('example.com');
    expect(result).toEqual({
      ok: true,
      hostname: 'example.com',
      status: 'permission-restored',
    });
  });

  it('重复添加已有权限的自定义网站时不重复授权或写入', async () => {
    mocks.getSiteState.mockResolvedValue({
      hostname: 'example.com',
      enabled: true,
      mode: 'basic-web',
      firstQuestionPending: false,
    });
    permissionsContains.mockResolvedValue(true);

    const result = await addWebsite('example.com');

    expect(result).toEqual({ ok: true, hostname: 'example.com', status: 'already-enabled' });
    expect(chrome.permissions.request).not.toHaveBeenCalled();
    expect(mocks.addCustomSite).not.toHaveBeenCalled();
  });

  it('用户拒绝权限时不写入站点状态', async () => {
    mocks.getSiteState.mockResolvedValue({
      hostname: 'example.com',
      enabled: false,
      mode: 'unsupported',
      firstQuestionPending: false,
    });
    permissionsRequest.mockResolvedValue(false);

    const result = await addWebsite('example.com');

    expect(result).toEqual({ ok: false, message: '未授予访问权限，无法加入该网站。' });
    expect(mocks.addCustomSite).not.toHaveBeenCalled();
  });

  it('站点写入失败时撤销本次新授予的精确权限', async () => {
    mocks.getSiteState.mockResolvedValue({
      hostname: 'example.com',
      enabled: false,
      mode: 'unsupported',
      firstQuestionPending: false,
    });
    mocks.addCustomSite.mockRejectedValue(new Error('storage 不可用'));

    const result = await addWebsite('example.com');

    expect(chrome.permissions.remove).toHaveBeenCalledWith({
      origins: ['https://example.com/*'],
    });
    expect(result).toEqual({ ok: false, message: '加入失败：storage 不可用' });
  });

  it('非 HTTPS 输入在读取或写入状态前被拒绝', async () => {
    const result = await addWebsite('http://example.com/page');

    expect(result).toEqual({ ok: false, message: '仅支持普通 HTTPS 网站。' });
    expect(mocks.getSiteState).not.toHaveBeenCalled();
    expect(chrome.permissions.request).not.toHaveBeenCalled();
  });

  it('查询权限失败时不撤销可能已存在的权限', async () => {
    mocks.getSiteState.mockResolvedValue({
      hostname: 'example.com',
      enabled: false,
      mode: 'unsupported',
      firstQuestionPending: false,
    });
    permissionsContains.mockRejectedValue(new Error('permissions 不可用'));

    const result = await addWebsite('example.com');

    expect(result).toEqual({ ok: false, message: '加入失败：permissions 不可用' });
    expect(permissionsRemove).not.toHaveBeenCalled();
  });
});
