import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { OptionsApp } from '@/ui/options/OptionsApp';
import { DEFAULT_SETTINGS } from '@/settings/defaults';
import type { AppSettings } from '@/types';
import type { ExportPayload, ImportResult } from '@/storage/data-transfer';

const NativeURL = globalThis.URL;

const mocks = vi.hoisted(() => ({
  getAppSettings: vi.fn(),
  setAppSettings: vi.fn(),
  resetAppSettings: vi.fn(),
  getSiteState: vi.fn(),
  enableSite: vi.fn(),
  disableSite: vi.fn(),
  updateSiteSettings: vi.fn(),
  addCustomSite: vi.fn(),
  listSites: vi.fn(),
  removeSite: vi.fn(),
  exportData: vi.fn(),
  importData: vi.fn(),
  clearLearningProgress: vi.fn(),
  clearAllData: vi.fn(),
  rebuildDatabase: vi.fn(),
}));

const permissionsContains = vi.fn();
const permissionsRequest = vi.fn();
const permissionsRemove = vi.fn();

vi.mock('@/messaging/message-client', () => ({
  messageClient: {
    getAppSettings: mocks.getAppSettings,
    setAppSettings: mocks.setAppSettings,
    resetAppSettings: mocks.resetAppSettings,
    getSiteState: mocks.getSiteState,
    enableSite: mocks.enableSite,
    disableSite: mocks.disableSite,
    updateSiteSettings: mocks.updateSiteSettings,
    addCustomSite: mocks.addCustomSite,
    listSites: mocks.listSites,
    removeSite: mocks.removeSite,
    exportData: mocks.exportData,
    importData: mocks.importData,
    clearLearningProgress: mocks.clearLearningProgress,
    clearAllData: mocks.clearAllData,
    rebuildDatabase: mocks.rebuildDatabase,
  },
}));

const SAMPLE_SETTINGS: AppSettings = { ...DEFAULT_SETTINGS };

const SAMPLE_SITES = {
  sites: [
    {
      hostname: 'bilibili.com',
      settings: { enabled: true, mode: 'full-adaptation' as const, firstQuestionPending: false },
    },
    {
      hostname: 'example.com',
      settings: {
        enabled: true,
        mode: 'basic-web' as const,
        firstQuestionPending: false,
        pageLoadTrigger: true,
        scrollTrigger: false,
      },
    },
  ],
};

function renderOptions() {
  return render(<OptionsApp />);
}

describe('OptionsApp — Issue #10', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getAppSettings.mockReset();
    mocks.setAppSettings.mockReset();
    mocks.resetAppSettings.mockReset();
    mocks.getSiteState.mockReset();
    mocks.enableSite.mockReset();
    mocks.disableSite.mockReset();
    mocks.updateSiteSettings.mockReset();
    mocks.addCustomSite.mockReset();
    mocks.listSites.mockReset();
    mocks.removeSite.mockReset();
    mocks.exportData.mockReset();
    mocks.importData.mockReset();
    mocks.clearLearningProgress.mockReset();
    mocks.clearAllData.mockReset();
    mocks.rebuildDatabase.mockReset();

    mocks.getAppSettings.mockResolvedValue({ ...SAMPLE_SETTINGS });
    mocks.listSites.mockResolvedValue({ sites: [] });
    mocks.getSiteState.mockResolvedValue({
      hostname: 'example.com',
      enabled: false,
      mode: 'unsupported',
      firstQuestionPending: false,
    });
    mocks.enableSite.mockResolvedValue(undefined);
    mocks.disableSite.mockResolvedValue(undefined);
    mocks.updateSiteSettings.mockResolvedValue(undefined);
    mocks.addCustomSite.mockResolvedValue(undefined);
    mocks.setAppSettings.mockImplementation(async (s: AppSettings) => s);
    mocks.resetAppSettings.mockResolvedValue({ ...DEFAULT_SETTINGS });
    mocks.removeSite.mockResolvedValue({ released: false });
    mocks.clearLearningProgress.mockResolvedValue(undefined);
    mocks.clearAllData.mockResolvedValue({ ok: true, errors: [], warnings: [] });
    mocks.rebuildDatabase.mockResolvedValue({ ok: true, errors: [], warnings: [] });
    permissionsContains.mockReset().mockResolvedValue(true);
    permissionsRequest.mockReset().mockResolvedValue(true);
    permissionsRemove.mockReset().mockResolvedValue(true);

    // 模拟 URL.createObjectURL / revokeObjectURL
    class TestURL extends NativeURL {}
    Object.defineProperties(TestURL, {
      createObjectURL: { value: vi.fn(() => 'blob:test') },
      revokeObjectURL: { value: vi.fn() },
    });
    vi.stubGlobal('URL', TestURL);

    vi.stubGlobal('chrome', {
      permissions: {
        contains: permissionsContains,
        request: permissionsRequest,
        remove: permissionsRemove,
      },
    });

    // jsdom 未实现 File.prototype.text()，用 FileReader polyfill
    if (typeof File.prototype.text !== 'function') {
      File.prototype.text = function (): Promise<string> {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsText(this);
        });
      };
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ── AC1：学习设置 ──────────────────────────────────────

  it('加载后显示所有学习设置字段（AC1）', async () => {
    renderOptions();

    await waitFor(() => {
      expect(screen.getByText('学习设置')).toBeInTheDocument();
    });

    // 词库选择
    expect(screen.getByRole('button', { name: '当前词库：日常高频' })).toBeInTheDocument();
    // 学习水平
    expect(screen.getByRole('button', { name: '学习水平：一般' })).toBeInTheDocument();
    // 每日新词上限
    expect(screen.getByDisplayValue('5')).toBeInTheDocument();
    // 默认冷却
    expect(screen.getAllByDisplayValue('2').length).toBeGreaterThan(0);
    // 连续跳过降频
    expect(screen.getByDisplayValue('5, 15, 60')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: '连续跳过自动降频' })).toBeChecked();
    // 长视频定时学习间隔
    expect(screen.getByDisplayValue('10')).toBeInTheDocument();
  });

  it('修改设置后点击保存调用 setAppSettings（AC1 / AC3）', async () => {
    mocks.setAppSettings.mockResolvedValue({ ...SAMPLE_SETTINGS, dailyNewWordLimit: 20 });

    renderOptions();
    await waitFor(() => {
      expect(screen.getByText('保存设置')).toBeInTheDocument();
    });

    // 修改每日新词上限
    const limitInput = screen.getByDisplayValue('5');
    fireEvent.change(limitInput, { target: { value: '20' } });

    // 保存
    fireEvent.click(screen.getByText('保存设置'));

    await waitFor(() => {
      expect(mocks.setAppSettings).toHaveBeenCalledTimes(1);
    });
    const saved = mocks.setAppSettings.mock.calls[0]![0] as AppSettings;
    expect(saved.dailyNewWordLimit).toBe(20);
  });

  it('点击恢复默认调用 resetAppSettings', async () => {
    renderOptions();
    await waitFor(() => {
      expect(screen.getByText('恢复默认')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('恢复默认'));

    await waitFor(() => {
      expect(mocks.resetAppSettings).toHaveBeenCalledTimes(1);
    });
  });

  it('恢复默认后重新读取失败时不把当前显示状态报告为成功', async () => {
    mocks.getAppSettings
      .mockResolvedValueOnce({ ...SAMPLE_SETTINGS })
      .mockRejectedValueOnce(new Error('重新读取失败'))
      .mockResolvedValue({ ...DEFAULT_SETTINGS });
    renderOptions();
    await screen.findByText('恢复默认');

    fireEvent.click(screen.getByText('恢复默认'));
    await screen.findByText(/加载失败：重新读取失败/);
    expect(
      screen.getByText('默认设置已恢复，但重新读取失败；当前显示状态未确认'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText('重试'));

    await screen.findByText('默认设置已恢复，但重新读取失败；当前显示状态未确认');
    expect(screen.queryByText('已恢复默认设置')).not.toBeInTheDocument();
  });

  it('长视频定时学习关闭时间隔输入框禁用', async () => {
    renderOptions();
    await waitFor(() => {
      expect(screen.getByText('长视频定时学习间隔（分钟）')).toBeInTheDocument();
    });

    const intervalInput = screen.getByDisplayValue('10') as HTMLInputElement;
    expect(intervalInput.disabled).toBe(true);
  });

  // ── AC2：网站管理 ────────────────────────────────────────

  it('手动添加 HTTPS 网站后申请精确 hostname 权限并刷新列表（Issue #16）', async () => {
    permissionsContains.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mocks.listSites.mockResolvedValueOnce({ sites: [] }).mockResolvedValueOnce({
      sites: [
        {
          hostname: 'example.com',
          settings: {
            enabled: true,
            mode: 'basic-web' as const,
            firstQuestionPending: true,
          },
        },
      ],
    });

    renderOptions();

    const input = await screen.findByRole('textbox', { name: '网站地址' });
    fireEvent.change(input, { target: { value: ' https://Example.COM/learn?q=1 ' } });
    fireEvent.click(screen.getByRole('button', { name: '添加网站' }));

    await waitFor(() => {
      expect(chrome.permissions.request).toHaveBeenCalledWith({
        origins: ['https://example.com/*'],
      });
      expect(mocks.addCustomSite).toHaveBeenCalledWith('example.com');
      expect(screen.getByText('example.com')).toBeInTheDocument();
    });
  });

  it('添加默认已启用的专属网站时物化记录并刷新列表', async () => {
    mocks.getSiteState.mockResolvedValue({
      hostname: 'www.youtube.com',
      enabled: true,
      mode: 'full-adaptation',
      firstQuestionPending: true,
    });
    mocks.listSites.mockResolvedValueOnce({ sites: [] }).mockResolvedValueOnce({
      sites: [
        {
          hostname: 'youtube.com',
          settings: {
            enabled: true,
            mode: 'full-adaptation' as const,
            firstQuestionPending: true,
          },
        },
      ],
    });

    renderOptions();

    const input = await screen.findByRole('textbox', { name: '网站地址' });
    fireEvent.change(input, { target: { value: 'https://www.youtube.com/watch?v=x' } });
    fireEvent.click(screen.getByRole('button', { name: '添加网站' }));

    await waitFor(() => {
      expect(mocks.enableSite).toHaveBeenCalledWith('www.youtube.com');
      expect(screen.getByText('youtube.com')).toBeInTheDocument();
    });
  });

  it('权限被撤销时与 Popup 一致显示未启用和需要权限', async () => {
    permissionsContains.mockResolvedValue(false);
    mocks.listSites.mockResolvedValue({
      sites: [
        {
          hostname: 'example.com',
          settings: {
            enabled: true,
            mode: 'basic-web' as const,
            firstQuestionPending: false,
          },
        },
      ],
    });

    renderOptions();

    const hostname = await screen.findByText('example.com');
    const row = hostname.closest('.bingeup-site-row');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('未启用')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('需要权限')).toBeInTheDocument();
  });

  it('非 HTTPS 地址显示拒绝原因且不申请权限', async () => {
    renderOptions();

    const input = await screen.findByRole('textbox', { name: '网站地址' });
    fireEvent.change(input, { target: { value: 'http://example.com/page' } });
    fireEvent.click(screen.getByRole('button', { name: '添加网站' }));

    expect(await screen.findByText('仅支持普通 HTTPS 网站。')).toBeInTheDocument();
    expect(permissionsRequest).not.toHaveBeenCalled();
  });

  it('非法地址显示校验原因且不读取或写入站点', async () => {
    renderOptions();

    const input = await screen.findByRole('textbox', { name: '网站地址' });
    fireEvent.change(input, { target: { value: 'not a valid host /' } });
    fireEvent.click(screen.getByRole('button', { name: '添加网站' }));

    expect(await screen.findByText('请输入有效的网站地址。')).toBeInTheDocument();
    expect(mocks.getSiteState).not.toHaveBeenCalled();
    expect(mocks.addCustomSite).not.toHaveBeenCalled();
  });

  it('重复添加已有权限的自定义网站时提示已启用且不重复授权或写入', async () => {
    mocks.getSiteState.mockResolvedValue({
      hostname: 'example.com',
      enabled: true,
      mode: 'basic-web',
      firstQuestionPending: false,
    });
    mocks.listSites.mockResolvedValue({
      sites: [
        {
          hostname: 'example.com',
          settings: {
            enabled: true,
            mode: 'basic-web' as const,
            firstQuestionPending: false,
          },
        },
      ],
    });
    renderOptions();

    const input = await screen.findByRole('textbox', { name: '网站地址' });
    fireEvent.change(input, { target: { value: 'example.com' } });
    fireEvent.click(screen.getByRole('button', { name: '添加网站' }));

    expect(await screen.findByText('网站 example.com 已启用')).toBeInTheDocument();
    expect(permissionsRequest).not.toHaveBeenCalled();
    expect(mocks.addCustomSite).not.toHaveBeenCalled();
  });

  it('拒绝网站权限时显示失败原因且不写入站点', async () => {
    permissionsContains.mockResolvedValue(false);
    permissionsRequest.mockResolvedValue(false);
    renderOptions();

    const input = await screen.findByRole('textbox', { name: '网站地址' });
    fireEvent.change(input, { target: { value: 'example.com' } });
    fireEvent.click(screen.getByRole('button', { name: '添加网站' }));

    expect(await screen.findByText('未授予访问权限，无法加入该网站。')).toBeInTheDocument();
    expect(mocks.addCustomSite).not.toHaveBeenCalled();
  });

  it('站点写入失败时显示错误并撤销本次新授予的精确权限', async () => {
    permissionsContains.mockResolvedValue(false);
    mocks.addCustomSite.mockRejectedValue(new Error('storage 不可用'));
    renderOptions();

    const input = await screen.findByRole('textbox', { name: '网站地址' });
    fireEvent.change(input, { target: { value: 'example.com' } });
    fireEvent.click(screen.getByRole('button', { name: '添加网站' }));

    expect(await screen.findByText('加入失败：storage 不可用')).toBeInTheDocument();
    expect(permissionsRemove).toHaveBeenCalledWith({
      origins: ['https://example.com/*'],
    });
  });

  it('显示已配置的网站列表与兼容模式（AC2）', async () => {
    mocks.listSites.mockResolvedValue(SAMPLE_SITES);

    renderOptions();
    await waitFor(() => {
      expect(screen.getByText('bilibili.com')).toBeInTheDocument();
    });

    expect(screen.getByText('example.com')).toBeInTheDocument();
    expect(screen.getByText('完整适配')).toBeInTheDocument();
    expect(screen.getByText('基础网页')).toBeInTheDocument();
  });

  it('基础网页模式显示触发开关（AC2）', async () => {
    mocks.listSites.mockResolvedValue(SAMPLE_SITES);

    renderOptions();
    await waitFor(() => {
      expect(screen.getByText('example.com')).toBeInTheDocument();
    });

    expect(screen.getByText('页面加载触发')).toBeInTheDocument();
    expect(screen.getByText('滚动触发')).toBeInTheDocument();
  });

  it('已配置网站可以关闭并在保存后刷新状态', async () => {
    mocks.listSites.mockResolvedValueOnce(SAMPLE_SITES).mockResolvedValueOnce({
      sites: SAMPLE_SITES.sites.map((entry) =>
        entry.hostname === 'bilibili.com'
          ? { ...entry, settings: { ...entry.settings, enabled: false } }
          : entry,
      ),
    });

    renderOptions();
    const host = await screen.findByText('bilibili.com');
    const row = host.closest('.bingeup-site-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: '关闭网站' }));

    await waitFor(() => {
      expect(mocks.disableSite).toHaveBeenCalledWith('bilibili.com');
      expect(screen.getByText('已关闭网站 bilibili.com')).toBeInTheDocument();
    });
  });

  it('基础网页模式的页面加载与滚动触发可以独立保存', async () => {
    mocks.listSites.mockResolvedValue(SAMPLE_SITES);

    renderOptions();
    const host = await screen.findByText('example.com');
    const row = host.closest('.bingeup-site-row') as HTMLElement;
    const pageLoad = within(row).getByRole('checkbox', { name: '页面加载触发' });
    const scroll = within(row).getByRole('checkbox', { name: '滚动触发' });

    expect(pageLoad).toBeEnabled();
    expect(scroll).toBeEnabled();
    fireEvent.click(pageLoad);
    fireEvent.click(scroll);

    await waitFor(() => {
      expect(mocks.updateSiteSettings).toHaveBeenNthCalledWith(
        1,
        'example.com',
        expect.objectContaining({ pageLoadTrigger: false, scrollTrigger: false }),
      );
      expect(mocks.updateSiteSettings).toHaveBeenNthCalledWith(
        2,
        'example.com',
        expect.objectContaining({ pageLoadTrigger: true, scrollTrigger: true }),
      );
    });
  });

  it('点击删除网站调用 removeSite（AC2 / AC5）', async () => {
    mocks.listSites.mockResolvedValue(SAMPLE_SITES);
    mocks.removeSite.mockResolvedValue({ released: false });

    renderOptions();
    await waitFor(() => {
      expect(screen.getByText('bilibili.com')).toBeInTheDocument();
    });

    // bilibili.com 对应的删除按钮
    const deleteButtons = screen.getAllByText('删除');
    fireEvent.click(deleteButtons[0]!);

    await waitFor(() => {
      expect(mocks.removeSite).toHaveBeenCalledTimes(1);
    });
    expect(mocks.removeSite.mock.calls[0]![0]).toBe('bilibili.com');
  });

  // ── AC4：数据管理 ────────────────────────────────────────

  it('点击导出数据调用 exportData（AC4）', async () => {
    // jsdom 未实现 blob URL 导航，stub 掉 anchor.click 避免噪声日志
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const payload: Partial<ExportPayload> = {
      version: 1,
      exportedAt: 0,
      authoritativeState: {} as never,
      data: {} as never,
    };
    mocks.exportData.mockResolvedValue(payload);

    renderOptions();
    await waitFor(() => {
      expect(screen.getByText('导出数据')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('导出数据'));

    await waitFor(() => {
      expect(mocks.exportData).toHaveBeenCalledTimes(1);
    });
    // 验证下载锚点被触发（已 stub 避免 jsdom 导航噪声）
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('清除学习进度需要二次确认（AC4）', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    renderOptions();
    await waitFor(() => {
      expect(screen.getByText('清除学习进度')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('清除学习进度'));

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledTimes(1);
    });
    // 用户取消时不应调用清除
    expect(mocks.clearLearningProgress).not.toHaveBeenCalled();
  });

  it('确认后清除学习进度调用 clearLearningProgress（AC4）', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderOptions();
    await waitFor(() => {
      expect(screen.getByText('清除学习进度')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('清除学习进度'));

    await waitFor(() => {
      expect(mocks.clearLearningProgress).toHaveBeenCalledTimes(1);
    });
  });

  it('清除全部数据需要二次确认（AC4）', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    renderOptions();
    await waitFor(() => {
      expect(screen.getByText('清除全部数据')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('清除全部数据'));

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledTimes(1);
    });
    expect(mocks.clearAllData).not.toHaveBeenCalled();
  });

  it('确认后清除全部数据调用 clearAllData（AC4）', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderOptions();
    await waitFor(() => {
      expect(screen.getByText('清除全部数据')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('清除全部数据'));

    await waitFor(() => {
      expect(mocks.clearAllData).toHaveBeenCalledTimes(1);
    });
  });

  it('导入数据先校验再写入：非法 payload 显示错误不调用 reload（AC4）', async () => {
    const importResult: ImportResult = {
      ok: false,
      errors: ['不支持的备份版本：999'],
      warnings: [],
    };
    mocks.importData.mockResolvedValue(importResult);

    renderOptions();
    await waitFor(() => {
      expect(screen.getByText('导入数据')).toBeInTheDocument();
    });

    // 模拟文件选择
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([JSON.stringify({ version: 999 })], 'backup.json', {
      type: 'application/json',
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(mocks.importData).toHaveBeenCalledTimes(1);
    });
    // 导入失败时不应显示成功通知
    await waitFor(() => {
      expect(screen.getByText(/导入失败/)).toBeInTheDocument();
    });
  });

  it('导入合法数据后显示成功通知（AC4）', async () => {
    const importResult: ImportResult = { ok: true, errors: [], warnings: [] };
    mocks.importData.mockResolvedValue(importResult);

    renderOptions();
    await waitFor(() => {
      expect(screen.getByText('导入数据')).toBeInTheDocument();
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([JSON.stringify({ version: 1 })], 'backup.json', {
      type: 'application/json',
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(mocks.importData).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByText('数据导入成功')).toBeInTheDocument();
    });
  });

  it('数据库加载失败时先提供重试，并仅在明确确认后执行重建', async () => {
    mocks.getAppSettings.mockRejectedValueOnce(new Error('数据库打开失败'));
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderOptions();
    await screen.findByText(/加载失败：数据库打开失败/);

    fireEvent.click(screen.getByText('清除本地数据并重建'));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.rebuildDatabase).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('本地数据已清除并重建')).toBeInTheDocument());
  });

  it('非数据库加载错误不提供破坏性重建入口', async () => {
    mocks.getAppSettings.mockRejectedValueOnce(new Error('权限查询失败'));
    renderOptions();
    await screen.findByText(/加载失败：权限查询失败/);
    expect(screen.queryByText('清除本地数据并重建')).not.toBeInTheDocument();
    expect(screen.getByText('重试')).toBeInTheDocument();
  });
});
