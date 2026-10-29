import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { OptionsApp } from '@/ui/options/OptionsApp';
import { DEFAULT_SETTINGS } from '@/settings/defaults';
import type { AppSettings, StorageDiagnostics } from '@/types';
import type { ExportPayload, ImportResult } from '@/storage/data-transfer';

const NativeURL = globalThis.URL;

const mocks = vi.hoisted(() => ({
  getAppSettings: vi.fn(),
  setAppSettings: vi.fn(),
  resetAppSettings: vi.fn(),
  getSiteState: vi.fn(),
  enableSite: vi.fn(),
  disableSite: vi.fn(),
  setSiteEnabled: vi.fn(),
  updateSiteTriggers: vi.fn(),
  addCustomSite: vi.fn(),
  listSites: vi.fn(),
  removeSite: vi.fn(),
  exportData: vi.fn(),
  importData: vi.fn(),
  clearLearningProgress: vi.fn(),
  clearAllData: vi.fn(),
  rebuildDatabase: vi.fn(),
  getStorageDiagnostics: vi.fn(),
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
    setSiteEnabled: mocks.setSiteEnabled,
    updateSiteTriggers: mocks.updateSiteTriggers,
    addCustomSite: mocks.addCustomSite,
    listSites: mocks.listSites,
    removeSite: mocks.removeSite,
    exportData: mocks.exportData,
    importData: mocks.importData,
    clearLearningProgress: mocks.clearLearningProgress,
    clearAllData: mocks.clearAllData,
    rebuildDatabase: mocks.rebuildDatabase,
    getStorageDiagnostics: mocks.getStorageDiagnostics,
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

const SAMPLE_DIAGNOSTICS: StorageDiagnostics = {
  extensionId: 'test-extension',
  extensionVersion: '0.0.1',
  databaseName: 'bingeup',
  databaseVersion: 1,
  databaseOpen: true,
  startup: {
    startedAt: 1_700_000_000_000,
    databaseOpenedAt: 1_700_000_000_100,
    databaseVersion: 1,
    readAt: 1_700_000_001_000,
    counts: { cards: 18, reviewLogs: 13, sessionLogs: 20, behaviorEvents: 2, words: 0, decks: 0 },
    cardStages: { shortTerm: 2, longTerm: 5, selfReported: 11, other: 0 },
    restoredFromSnapshot: false,
    snapshotPresent: true,
    snapshotSavedAt: 1_700_000_002_000,
    snapshotMode: 'full',
    snapshotCards: 18,
    lastSelfReportAt: 1_700_000_001_500,
    lastSelfReportWordId: 'w-ask',
  },
  current: {
    readAt: 1_700_000_010_000,
    counts: { cards: 18, reviewLogs: 13, sessionLogs: 20, behaviorEvents: 2, words: 0, decks: 0 },
    cardStages: { shortTerm: 2, longTerm: 5, selfReported: 11, other: 0 },
  },
  snapshot: {
    present: true,
    savedAt: 1_700_000_002_000,
    mode: 'full',
    counts: { cards: 18, reviewLogs: 13, sessionLogs: 20, behaviorEvents: 2, words: 0, decks: 0 },
  },
  history: [
    {
      startedAt: 1_700_000_000_000,
      readAt: 1_700_000_001_000,
      counts: { cards: 18, reviewLogs: 13, sessionLogs: 20, behaviorEvents: 2, words: 0, decks: 0 },
      cardStages: { shortTerm: 2, longTerm: 5, selfReported: 11, other: 0 },
      restoredFromSnapshot: false,
      snapshotPresent: true,
      snapshotSavedAt: 1_700_000_002_000,
      lastSelfReportAt: 1_700_000_001_500,
      lastSelfReportWordId: 'w-ask',
    },
  ],
};

function renderOptions() {
  return render(<OptionsApp />);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** 渲染设置页并切换到指定分区（工单 #41 M3b：三个分区由原版 Tabs 承载）。 */
async function renderOptionsAndOpenTab(name: '学习设置' | '网站管理' | '数据管理'): Promise<void> {
  renderOptions();
  fireEvent.click(await screen.findByRole('tab', { name }));
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
    mocks.setSiteEnabled.mockReset();
    mocks.updateSiteTriggers.mockReset();
    mocks.addCustomSite.mockReset();
    mocks.listSites.mockReset();
    mocks.removeSite.mockReset();
    mocks.exportData.mockReset();
    mocks.importData.mockReset();
    mocks.clearLearningProgress.mockReset();
    mocks.clearAllData.mockReset();
    mocks.rebuildDatabase.mockReset();
    mocks.getStorageDiagnostics.mockReset();

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
    mocks.setSiteEnabled.mockResolvedValue(undefined);
    mocks.updateSiteTriggers.mockResolvedValue(undefined);
    mocks.addCustomSite.mockResolvedValue(undefined);
    mocks.setAppSettings.mockImplementation(async (s: AppSettings) => s);
    mocks.resetAppSettings.mockResolvedValue({ ...DEFAULT_SETTINGS });
    mocks.removeSite.mockResolvedValue({ released: false });
    mocks.clearLearningProgress.mockResolvedValue(undefined);
    mocks.clearAllData.mockResolvedValue({ ok: true, errors: [], warnings: [] });
    mocks.rebuildDatabase.mockResolvedValue({ ok: true, errors: [], warnings: [] });
    mocks.getStorageDiagnostics.mockResolvedValue(SAMPLE_DIAGNOSTICS);
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
      tabs: {
        create: vi.fn().mockResolvedValue(undefined),
      },
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://test-id${path}`),
      },
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

  it('点击查看学习统计在新标签页打开扩展统计页面', async () => {
    renderOptions();

    const button = await screen.findByRole('button', { name: '查看学习统计' });
    expect(button.querySelector('svg')).not.toBeNull();
    expect(button).toHaveAttribute('title', '在新页面打开学习统计');
    fireEvent.click(button);

    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test-id/stats.html',
    });
  });

  // ── AC1：学习设置 ──────────────────────────────────────

  it('加载后显示所有学习设置字段（AC1）', async () => {
    renderOptions();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: '学习设置' })).toBeInTheDocument();
    });

    // 词库与学习水平：原版受控 Select（combobox）直接显示当前值文本
    expect(screen.getByRole('combobox', { name: '当前词库' })).toHaveTextContent('日常高频');
    expect(screen.getByRole('combobox', { name: '学习水平' })).toHaveTextContent('一般');
    expect(screen.getByRole('combobox', { name: '朗读音色' })).toHaveTextContent('Microsoft Zira');
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

  it('下拉选择使用原版受控 Select：点击选项更新显示并在保存时写回（AC1）', async () => {
    renderOptions();

    const deckSelect = await screen.findByRole('combobox', { name: '当前词库' });
    expect(deckSelect).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(deckSelect);
    expect(deckSelect).toHaveAttribute('aria-expanded', 'true');
    const deckOption = await screen.findByRole('option', { name: '四级' });
    fireEvent.click(deckOption);

    expect(deckSelect).toHaveTextContent('四级');
    expect(deckSelect).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => {
      expect(mocks.setAppSettings).toHaveBeenCalledTimes(1);
    });
    const saved = mocks.setAppSettings.mock.calls[0]![0] as AppSettings;
    expect(saved.selectedDeckId).toBe('deck-cet4');
  });

  it('所选词库的描述在 Select 下方可见并随选择更新（工单 #47）', async () => {
    renderOptions();

    const deckSelect = await screen.findByRole('combobox', { name: '当前词库' });
    expect(screen.getByText('基于现代英语语料库词频排序的高频常用词汇')).toBeInTheDocument();

    fireEvent.click(deckSelect);
    const deckOption = await screen.findByRole('option', { name: '四级' });
    fireEvent.click(deckOption);

    expect(screen.getByText('大学英语四级考试（CET-4）核心词汇')).toBeInTheDocument();
    expect(screen.queryByText('基于现代英语语料库词频排序的高频常用词汇')).not.toBeInTheDocument();
  });

  it('可选择本地英语朗读音色并保存，在线语音不出现在列表', async () => {
    const speak = vi.fn();
    class FakeUtterance {
      voice: SpeechSynthesisVoice | null = null;
      lang = '';
      rate = 1;
      volume = 1;
      constructor(readonly text: string) {}
    }
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    vi.stubGlobal('speechSynthesis', {
      getVoices: () => [
        {
          name: 'Microsoft Zira - English (United States)',
          lang: 'en-US',
          localService: true,
        },
        {
          name: 'Microsoft David - English (United States)',
          lang: 'en-US',
          localService: true,
        },
        {
          name: 'Microsoft Aria Online (Natural) - English (United States)',
          lang: 'en-US',
          localService: false,
        },
      ],
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      cancel: vi.fn(),
      resume: vi.fn(),
      speak,
    });
    renderOptions();

    const voiceSelect = await screen.findByRole('combobox', { name: '朗读音色' });
    expect(voiceSelect).toHaveTextContent('Microsoft Zira');
    fireEvent.click(voiceSelect);
    expect(screen.queryByRole('option', { name: /Aria Online/ })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('option', { name: /Microsoft David/ }));

    fireEvent.click(screen.getByRole('button', { name: '试听朗读音色' }));
    expect(speak).toHaveBeenCalledTimes(1);
    expect((speak.mock.calls[0]![0] as FakeUtterance).voice?.name).toContain('David');

    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(mocks.setAppSettings).toHaveBeenCalledTimes(1));
    const saved = mocks.setAppSettings.mock.calls[0]![0] as AppSettings;
    expect(saved.speechVoiceName).toBe('Microsoft David - English (United States)');
  });

  it('下拉选择支持键盘：方向键移动、Enter 选中、Escape 关闭并返回触发区', async () => {
    renderOptions();

    const levelSelect = await screen.findByRole('combobox', { name: '学习水平' });
    levelSelect.focus();

    fireEvent.keyDown(levelSelect, { key: 'ArrowDown' });
    const listbox = await screen.findByRole('listbox');
    expect(levelSelect).toHaveAttribute('aria-activedescendant');
    expect(within(listbox).getByRole('option', { name: '一般' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    fireEvent.keyDown(levelSelect, { key: 'ArrowDown' });
    fireEvent.keyDown(levelSelect, { key: 'Enter' });

    expect(levelSelect).toHaveTextContent('进阶');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    fireEvent.keyDown(levelSelect, { key: 'ArrowDown' });
    await screen.findByRole('listbox');
    fireEvent.keyDown(levelSelect, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(levelSelect).toHaveFocus();
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

  it('保存成功提示可以手动关闭', async () => {
    renderOptions();
    await screen.findByRole('button', { name: '保存设置' });

    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await screen.findByText('设置已保存');

    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    expect(screen.queryByText('设置已保存')).not.toBeInTheDocument();
  });

  it('恢复默认需要二次确认，确认后调用 resetAppSettings', async () => {
    renderOptions();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '恢复默认' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/确定要恢复默认学习设置吗/)).toBeInTheDocument();
    expect(mocks.resetAppSettings).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: '恢复默认' }));

    await waitFor(() => {
      expect(mocks.resetAppSettings).toHaveBeenCalledTimes(1);
    });
  });

  it('取消恢复默认不调用 resetAppSettings', async () => {
    renderOptions();
    await screen.findByRole('button', { name: '恢复默认' });

    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.resetAppSettings).not.toHaveBeenCalled();
  });

  it('恢复默认后重新读取失败时不把当前显示状态报告为成功', async () => {
    mocks.getAppSettings
      .mockResolvedValueOnce({ ...SAMPLE_SETTINGS })
      .mockRejectedValueOnce(new Error('重新读取失败'))
      .mockResolvedValue({ ...DEFAULT_SETTINGS });
    renderOptions();
    await screen.findByRole('button', { name: '恢复默认' });

    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '恢复默认' }));
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

    await renderOptionsAndOpenTab('网站管理');

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

    await renderOptionsAndOpenTab('网站管理');

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

    await renderOptionsAndOpenTab('网站管理');

    const hostname = await screen.findByText('example.com');
    const row = hostname.closest('.bingeup-site-row');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('未启用')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('需要权限')).toBeInTheDocument();
  });

  it('非 HTTPS 地址显示拒绝原因且不申请权限', async () => {
    await renderOptionsAndOpenTab('网站管理');

    const input = await screen.findByRole('textbox', { name: '网站地址' });
    fireEvent.change(input, { target: { value: 'http://example.com/page' } });
    fireEvent.click(screen.getByRole('button', { name: '添加网站' }));

    expect(await screen.findByText('仅支持普通 HTTPS 网站。')).toBeInTheDocument();
    expect(permissionsRequest).not.toHaveBeenCalled();
  });

  it('非法地址显示校验原因且不读取或写入站点', async () => {
    await renderOptionsAndOpenTab('网站管理');

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
    await renderOptionsAndOpenTab('网站管理');

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
    await renderOptionsAndOpenTab('网站管理');

    const input = await screen.findByRole('textbox', { name: '网站地址' });
    fireEvent.change(input, { target: { value: 'example.com' } });
    fireEvent.click(screen.getByRole('button', { name: '添加网站' }));

    expect(await screen.findByText('未授予访问权限，无法加入该网站。')).toBeInTheDocument();
    expect(mocks.addCustomSite).not.toHaveBeenCalled();
  });

  it('站点写入失败时显示错误并撤销本次新授予的精确权限', async () => {
    permissionsContains.mockResolvedValue(false);
    mocks.addCustomSite.mockRejectedValue(new Error('storage 不可用'));
    await renderOptionsAndOpenTab('网站管理');

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

    await renderOptionsAndOpenTab('网站管理');
    await waitFor(() => {
      expect(screen.getByText('bilibili.com')).toBeInTheDocument();
    });

    expect(screen.getByText('example.com')).toBeInTheDocument();
    expect(screen.getByText('完整适配')).toBeInTheDocument();
    expect(screen.getByText('基础网页')).toBeInTheDocument();
  });

  it('基础网页模式显示触发开关（AC2）', async () => {
    mocks.listSites.mockResolvedValue(SAMPLE_SITES);

    await renderOptionsAndOpenTab('网站管理');
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

    await renderOptionsAndOpenTab('网站管理');
    const host = await screen.findByText('bilibili.com');
    const row = host.closest('.bingeup-site-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('switch', { name: '启用 bilibili.com' }));

    await waitFor(() => {
      expect(mocks.setSiteEnabled).toHaveBeenCalledWith('bilibili.com', false);
      expect(screen.getByText('已关闭网站 bilibili.com')).toBeInTheDocument();
    });
  });

  it('基础网页模式的页面加载与滚动触发可以独立保存', async () => {
    mocks.listSites.mockResolvedValue(SAMPLE_SITES);

    await renderOptionsAndOpenTab('网站管理');
    const host = await screen.findByText('example.com');
    const row = host.closest('.bingeup-site-row') as HTMLElement;
    const pageLoad = within(row).getByRole('switch', { name: '页面加载触发' });
    const scroll = within(row).getByRole('switch', { name: '滚动触发' });

    expect(pageLoad).toBeEnabled();
    expect(scroll).toBeEnabled();
    fireEvent.click(pageLoad);
    fireEvent.click(scroll);

    await waitFor(() => {
      expect(mocks.updateSiteTriggers).toHaveBeenNthCalledWith(1, 'example.com', {
        pageLoadTrigger: false,
      });
      expect(mocks.updateSiteTriggers).toHaveBeenNthCalledWith(2, 'example.com', {
        scrollTrigger: true,
      });
    });
  });

  it('点击删除网站调用 removeSite（AC2 / AC5）', async () => {
    mocks.listSites.mockResolvedValue(SAMPLE_SITES);
    mocks.removeSite.mockResolvedValue({ released: false });

    await renderOptionsAndOpenTab('网站管理');
    await waitFor(() => {
      expect(screen.getByText('bilibili.com')).toBeInTheDocument();
    });

    // bilibili.com 对应的删除按钮
    const deleteButtons = screen.getAllByRole('button', { name: '删除' });
    fireEvent.click(deleteButtons[0]!);

    await waitFor(() => {
      expect(mocks.removeSite).toHaveBeenCalledTimes(1);
    });
    expect(mocks.removeSite.mock.calls[0]![0]).toBe('bilibili.com');
  });

  // ── AC4：数据管理 ────────────────────────────────────────

  it('正常首屏和网站分区不预取诊断，首次进入数据分区才读取', async () => {
    renderOptions();
    await screen.findByRole('tab', { name: '学习设置' });
    await waitFor(() => expect(mocks.getAppSettings).toHaveBeenCalled());
    expect(mocks.getStorageDiagnostics).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: '网站管理' }));
    await Promise.resolve();
    expect(mocks.getStorageDiagnostics).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: '数据管理' }));
    await waitFor(() => expect(mocks.getStorageDiagnostics).toHaveBeenCalledTimes(1));
  });

  it('手动刷新和重新进入数据分区都会读取最新诊断', async () => {
    await renderOptionsAndOpenTab('数据管理');
    await waitFor(() => expect(mocks.getStorageDiagnostics).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() => expect(mocks.getStorageDiagnostics).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('tab', { name: '学习设置' }));
    fireEvent.click(screen.getByRole('tab', { name: '数据管理' }));
    await waitFor(() => expect(mocks.getStorageDiagnostics).toHaveBeenCalledTimes(3));
  });

  it('主加载失败时仍会在错误分支读取诊断', async () => {
    mocks.getAppSettings.mockRejectedValueOnce(new Error('数据库打开失败'));
    renderOptions();

    expect(await screen.findByText(/加载失败：数据库打开失败/)).toBeInTheDocument();
    await waitFor(() => expect(mocks.getStorageDiagnostics).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('存档读取状态')).toBeInTheDocument();
  });

  it('两个诊断请求逆序结束只更新最新结果并正确结束 loading', async () => {
    const first = deferred<StorageDiagnostics>();
    const second = deferred<StorageDiagnostics>();
    mocks.getStorageDiagnostics
      .mockReset()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    renderOptions();
    fireEvent.click(await screen.findByRole('tab', { name: '数据管理' }));
    await waitFor(() => expect(mocks.getStorageDiagnostics).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: '读取中…' })).toBeDisabled();

    fireEvent.click(screen.getByRole('tab', { name: '学习设置' }));
    fireEvent.click(screen.getByRole('tab', { name: '数据管理' }));
    await waitFor(() => expect(mocks.getStorageDiagnostics).toHaveBeenCalledTimes(2));

    second.resolve({ ...SAMPLE_DIAGNOSTICS, extensionId: 'latest-extension' });
    expect(await screen.findByText(/latest-extension · v/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新' })).toBeEnabled());

    first.reject(new Error('旧请求失败'));
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新' })).toBeEnabled());
    expect(screen.queryByText('旧请求失败')).not.toBeInTheDocument();
    expect(screen.getByText(/latest-extension · v/)).toBeInTheDocument();
  });

  it('数据管理展示启动读取、当前记录和自动快照状态', async () => {
    await renderOptionsAndOpenTab('数据管理');

    await waitFor(() => expect(mocks.getStorageDiagnostics).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('存档读取状态')).toBeInTheDocument();
    expect(screen.getByText('启动已读取到存档')).toBeInTheDocument();
    expect(screen.getAllByText(/卡 18 · 日志 13 · 会话 20 · 事件 2/).length).toBeGreaterThan(0);
    expect(screen.getByText('未使用快照')).toBeInTheDocument();
    expect(screen.getAllByText('自报认识 11 · 短期 2 · 长期 5').length).toBeGreaterThan(0);
    expect(screen.getByText(/w-ask/)).toBeInTheDocument();
    expect(screen.getByText(/完整 · 卡 18 张/)).toBeInTheDocument();
    expect(screen.getByText('最近启动记录')).toBeInTheDocument();
  });

  it('当前记录少于启动读取时给出丢档警告', async () => {
    mocks.getStorageDiagnostics.mockResolvedValue({
      ...SAMPLE_DIAGNOSTICS,
      current: {
        readAt: 1_700_000_010_000,
        counts: { cards: 3, reviewLogs: 2, sessionLogs: 1, behaviorEvents: 2, words: 0, decks: 0 },
      },
    });

    await renderOptionsAndOpenTab('数据管理');
    expect(await screen.findByText('当前数据少于启动读取')).toBeInTheDocument();
  });

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

    await renderOptionsAndOpenTab('数据管理');
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

  it('清除学习进度需要原版 Modal 二次确认，取消不执行（AC4）', async () => {
    await renderOptionsAndOpenTab('数据管理');
    fireEvent.click(await screen.findByRole('button', { name: '清除学习进度' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/确定要清除所有学习进度吗/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.clearLearningProgress).not.toHaveBeenCalled();
  });

  it('确认后清除学习进度调用 clearLearningProgress（AC4）', async () => {
    await renderOptionsAndOpenTab('数据管理');
    fireEvent.click(await screen.findByRole('button', { name: '清除学习进度' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '清除学习进度' }));

    await waitFor(() => {
      expect(mocks.clearLearningProgress).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('清除全部数据需要二次确认（AC4）', async () => {
    await renderOptionsAndOpenTab('数据管理');
    fireEvent.click(await screen.findByRole('button', { name: '清除全部数据' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/确定要清除全部本地数据吗/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.clearAllData).not.toHaveBeenCalled();
  });

  it('确认后清除全部数据调用 clearAllData（AC4）', async () => {
    await renderOptionsAndOpenTab('数据管理');
    fireEvent.click(await screen.findByRole('button', { name: '清除全部数据' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '清除全部数据' }));

    await waitFor(() => {
      expect(mocks.clearAllData).toHaveBeenCalledTimes(1);
    });
  });

  it('导入数据先校验再写入：非法 payload 显示错误不调用 reload（AC4）', async () => {
    const importResult: ImportResult = {
      ok: false,
      errors: ['备份格式无效'],
      warnings: [],
    };
    mocks.importData.mockResolvedValue(importResult);

    await renderOptionsAndOpenTab('数据管理');
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
      const feedback = screen.getByRole('alert');
      expect(feedback).toHaveTextContent(/导入失败/);
      expect(feedback.querySelector('[class*="animal-tag"]')).not.toBeNull();
    });
  });

  it('导入合法数据后显示成功通知（AC4）', async () => {
    const importResult: ImportResult = { ok: true, errors: [], warnings: [] };
    mocks.importData.mockResolvedValue(importResult);

    await renderOptionsAndOpenTab('数据管理');
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
      const feedback = screen.getByRole('status');
      expect(feedback).toHaveTextContent('数据导入成功');
      expect(feedback.querySelector('[class*="animal-tag"]')).not.toBeNull();
      expect(screen.getByRole('button', { name: '导入数据' }).nextElementSibling).toBe(feedback);
    });
  });

  it('导入非 JSON 文件时显示就地错误提示', async () => {
    await renderOptionsAndOpenTab('数据管理');
    await waitFor(() => {
      expect(screen.getByText('导入数据')).toBeInTheDocument();
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['{not-json'], 'broken.json', { type: 'application/json' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      const feedback = screen.getByRole('alert');
      expect(feedback).toHaveTextContent('导入失败：文件不是有效的 JSON');
      expect(feedback.querySelector('[class*="animal-tag"]')).not.toBeNull();
    });
    expect(mocks.importData).not.toHaveBeenCalled();
  });

  it('数据库加载失败时先提供重试，并仅在两步确认后执行重建', async () => {
    mocks.getAppSettings.mockRejectedValueOnce(new Error('数据库打开失败'));
    renderOptions();
    await screen.findByText(/加载失败：数据库打开失败/);

    fireEvent.click(screen.getByRole('button', { name: '清除本地数据并重建' }));

    const firstDialog = await screen.findByRole('dialog');
    expect(within(firstDialog).getByText(/重建会永久删除全部本地用户数据/)).toBeInTheDocument();

    fireEvent.click(within(firstDialog).getByRole('button', { name: '继续' }));
    await screen.findByText(/最后确认：永久清除本地用户数据并重建/);

    const secondDialog = screen.getByRole('dialog');
    fireEvent.click(within(secondDialog).getByRole('button', { name: '确定执行' }));

    await waitFor(() => expect(mocks.rebuildDatabase).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('本地数据已清除并重建')).toBeInTheDocument());
  });

  it('重建第一步取消时不执行重建', async () => {
    mocks.getAppSettings.mockRejectedValueOnce(new Error('数据库打开失败'));
    renderOptions();
    await screen.findByText(/加载失败：数据库打开失败/);

    fireEvent.click(screen.getByRole('button', { name: '清除本地数据并重建' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.rebuildDatabase).not.toHaveBeenCalled();
  });

  it('非数据库加载错误不提供破坏性重建入口', async () => {
    mocks.getAppSettings.mockRejectedValueOnce(new Error('权限查询失败'));
    renderOptions();
    await screen.findByText(/加载失败：权限查询失败/);
    expect(screen.queryByText('清除本地数据并重建')).not.toBeInTheDocument();
    expect(screen.getByText('重试')).toBeInTheDocument();
  });
});
