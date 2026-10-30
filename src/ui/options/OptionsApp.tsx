import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Card, Input, Modal, Select, Switch, Tabs, Tag, Title } from 'animal-island-ui';
import { ExternalLinkIcon, VolumeHighIcon } from '@hugeicons/core-free-icons';
import { HugeIcon } from '@/ui/icons/HugeIcon';
import { messageClient } from '@/messaging/message-client';
import { BUILT_IN_DECKS } from '@/dictionary/built-in/decks';
import { addWebsite } from '@/sites/site-access';
import { hasExactHttpsPermission } from '@/sites/site-permission';
import {
  DEFAULT_SPEECH_VOICE_NAME,
  compareSpeechVoices,
  isLocalEnglishVoice,
} from '@/settings/speech-voice';
import { FeedbackLink } from '@/ui/FeedbackLink';
import { IslandPage } from '@/ui/island';
import type {
  AppSettings,
  SelfRatedLevel,
  SiteSettings,
  StorageCardStages,
  StorageCounts,
  StorageDiagnostics,
  StorageHealthIssue,
  StorageHealthStatus,
  StorageMetaRecord,
  StorageStartupRecord,
} from '@/types';
import type { ImportResult } from '@/storage/data-transfer';

/**
 * 设置页（Issue #10；工单 #41 M3b 原版迁移）。三个分区（原版 Tabs）：
 * - 学习设置：词库、学习水平、每日新词上限、拼写题、默认冷却、长视频定时学习、跳过降频（AC1）
 * - 网站管理：查看并管理每个已启用网站的状态、兼容模式与基础网页触发选项（AC2）
 * - 数据管理：导出 / 导入 / 清除学习进度 / 清除全部数据（AC4）
 *
 * AC3 由 background 的 normalizeAppSettings 保证（保存即校验自动修正，无需重启）。
 * AC5 由 background 的 REMOVE_SITE 处理程序保证（删除自定义网站时释放可选权限）。
 *
 * M3b（工单 #41）：全部控件使用 animal-island-ui 原版组件（Tabs/Switch/Select/Input/
 * Card/Button），自绘下拉被原版受控 Select 替换；危险数据操作的二次确认由
 * window.confirm 改为原版 Modal（仅扩展独立页面使用），清除、导入导出与原子恢复的
 * 调用链、用户可见文案与通知语义保持不变。
 */

const LEVEL_LABELS: Record<SelfRatedLevel, string> = {
  beginner: '初学',
  intermediate: '一般',
  advanced: '进阶',
};

const MODE_LABELS: Record<SiteSettings['mode'], string> = {
  'full-adaptation': '完整适配',
  'generic-video': '通用视频',
  'basic-web': '基础网页',
  unsupported: '不支持',
};

interface SiteEntry {
  hostname: string;
  settings: SiteSettings;
  hasHostPermission: boolean;
}

interface LoadError {
  message: string;
  databaseUnavailable: boolean;
}

/** 危险数据操作的确认请求（原版 Modal 承载）。 */
interface ConfirmRequest {
  title: string;
  message: string;
  /** 确认按钮文案（动作名）。 */
  okLabel: string;
  onConfirm: () => void;
}

interface NoticeMessage {
  id: number;
  text: string;
  /** 失败或状态未确认的提示不自动关闭，避免用户错过关键信息。 */
  persistent: boolean;
}

interface ImportFeedback {
  tone: 'info' | 'success' | 'error';
  text: string;
}

type OptionsTab = 'learning' | 'sites' | 'data';

const NOTICE_AUTO_DISMISS_MS = 6000;

function useSpeechVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const synth = window.speechSynthesis;
    const update = () => {
      setVoices(synth.getVoices().filter(isLocalEnglishVoice));
    };
    update();
    synth.addEventListener?.('voiceschanged', update);
    return () => synth.removeEventListener?.('voiceschanged', update);
  }, []);
  return voices;
}

export function OptionsApp(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [sites, setSites] = useState<SiteEntry[]>([]);
  const [activeTab, setActiveTab] = useState<OptionsTab>('learning');
  const [siteInput, setSiteInput] = useState('');
  const [siteAdding, setSiteAdding] = useState(false);
  const [notice, setNotice] = useState<NoticeMessage | null>(null);
  const [importFeedback, setImportFeedback] = useState<ImportFeedback | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<LoadError | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [diagnostics, setDiagnostics] = useState<StorageDiagnostics | null>(null);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const diagnosticsRequestId = useRef(0);
  const speechVoices = useSpeechVoices();

  const showNotice = useCallback((message: string | null) => {
    if (message === null) {
      setNotice(null);
      return;
    }
    setNotice((current) => ({
      id: (current?.id ?? 0) + 1,
      text: message,
      persistent: message.includes('失败') || message.includes('未确认'),
    }));
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);

  const load = useCallback(async () => {
    try {
      const [appSettings, siteList] = await Promise.all([
        messageClient.getAppSettings(),
        messageClient.listSites(),
      ]);
      const sitesWithPermissions = await Promise.all(
        siteList.sites.map(async (entry) => ({
          ...entry,
          hasHostPermission: await hasExactHttpsPermission(entry.hostname),
        })),
      );
      setSettings(appSettings);
      setSites(sitesWithPermissions);
      setError(null);
      return true;
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      setError({
        message: `加载失败：${detail}`,
        databaseUnavailable: detail.includes('数据库打开失败') || detail.includes('数据库不可用'),
      });
      return false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshDiagnostics = useCallback(async () => {
    const requestId = ++diagnosticsRequestId.current;
    setDiagnosticsLoading(true);
    try {
      const nextDiagnostics = await messageClient.getStorageDiagnostics();
      if (requestId !== diagnosticsRequestId.current) return;
      setDiagnostics(nextDiagnostics);
      setDiagnosticsError(null);
    } catch (e) {
      if (requestId !== diagnosticsRequestId.current) return;
      setDiagnosticsError(e instanceof Error ? e.message : String(e));
    } finally {
      if (requestId === diagnosticsRequestId.current) setDiagnosticsLoading(false);
    }
  }, []);

  const diagnosticsNeeded = activeTab === 'data' || error !== null;
  useEffect(() => {
    if (!diagnosticsNeeded) {
      diagnosticsRequestId.current += 1;
      return undefined;
    }
    void refreshDiagnostics();
    return () => {
      diagnosticsRequestId.current += 1;
    };
  }, [diagnosticsNeeded, refreshDiagnostics]);

  useEffect(() => {
    if (notice === null || notice.persistent) return undefined;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const closeConfirm = useCallback(() => setConfirm(null), []);
  const acceptConfirm = useCallback(() => {
    if (confirm === null) return;
    const { onConfirm } = confirm;
    setConfirm(null);
    onConfirm();
  }, [confirm]);

  const requestClearProgress = useCallback(() => {
    setConfirm({
      title: '清除学习进度',
      message:
        '确定要清除所有学习进度吗？此操作不可撤销，将删除全部学习卡、复习日志与学习会话及其统计，但保留设置与词库。',
      okLabel: '清除学习进度',
      onConfirm: () => void handleClearProgress(load, showNotice),
    });
  }, [load, showNotice]);

  const requestReset = useCallback(() => {
    setConfirm({
      title: '恢复默认学习设置',
      message:
        '确定要恢复默认学习设置吗？词库、学习水平、每日新词上限、拼写题与冷却等设置会恢复默认值；学习进度与网站设置不会删除。',
      okLabel: '恢复默认',
      onConfirm: () => void handleReset(load, showNotice),
    });
  }, [load, showNotice]);

  const requestClearAll = useCallback(() => {
    setConfirm({
      title: '清除全部数据',
      message:
        '确定要清除全部本地数据吗？此操作不可撤销，将删除所有学习数据、设置与词库，恢复到初始状态。',
      okLabel: '清除全部数据',
      onConfirm: () => void handleClearAll(load, showNotice),
    });
  }, [load, showNotice]);

  const requestRebuildDatabase = useCallback(() => {
    setConfirm({
      title: '清除本地数据并重建',
      message:
        '重建会永久删除全部本地用户数据。请先确认你已经尝试过“重试”，并关闭了其他刷刷升级页面。是否继续？',
      okLabel: '继续',
      onConfirm: () => {
        // 保持原有的两步确认语义：第一步确认后仍需“最后确认”才执行重建。
        setConfirm({
          title: '最后确认',
          message: '最后确认：永久清除本地用户数据并重建，且无法撤销。确定执行吗？',
          okLabel: '确定执行',
          onConfirm: () => void handleRebuildDatabase(load, showNotice, setError),
        });
      },
    });
  }, [load, showNotice]);

  const confirmModal = (
    <Modal
      open={confirm !== null}
      variant="game"
      title={confirm?.title}
      typewriter={false}
      maskClosable={false}
      onClose={closeConfirm}
      footer={
        <>
          <Button onClick={closeConfirm}>取消</Button>
          <Button type="primary" danger onClick={acceptConfirm}>
            {confirm?.okLabel ?? '确定'}
          </Button>
        </>
      }
    >
      <p className="bingeup-confirm-message">{confirm?.message}</p>
    </Modal>
  );

  const noticeToast =
    notice === null ? null : (
      <div className="bingeup-toast">
        <p className="bingeup-notice-text" role="status">
          {notice.text}
        </p>
        <button
          type="button"
          className="bingeup-toast-close"
          aria-label="关闭提示"
          onClick={dismissNotice}
        >
          ×
        </button>
      </div>
    );

  if (error !== null) {
    return (
      <IslandPage className="bingeup-options" label="刷刷升级设置">
        <h1 className="bingeup-title">
          <Title size="large">刷刷升级 — 设置</Title>
        </h1>
        <Card className="bingeup-card">
          <p className="bingeup-error">{error.message}</p>
          <div className="bingeup-actions">
            <Button type="primary" onClick={() => void load()}>
              重试
            </Button>
            {error.databaseUnavailable && (
              <Button danger onClick={requestRebuildDatabase}>
                清除本地数据并重建
              </Button>
            )}
          </div>
        </Card>
        {(diagnostics !== null || diagnosticsError !== null) && (
          <StorageDiagnosticsCard
            diagnostics={diagnostics}
            error={diagnosticsError}
            loading={diagnosticsLoading}
            onRefresh={() => void refreshDiagnostics()}
          />
        )}
        {noticeToast}
        {confirmModal}
      </IslandPage>
    );
  }

  if (settings === null) {
    return (
      <IslandPage className="bingeup-options" label="刷刷升级设置">
        <h1 className="bingeup-title">
          <Title size="large">刷刷升级 — 设置</Title>
        </h1>
        <Card className="bingeup-card">
          <p className="bingeup-hint">加载中…</p>
        </Card>
      </IslandPage>
    );
  }

  const selectedDeck = BUILT_IN_DECKS.find((deck) => deck.id === settings.selectedDeckId);
  const voiceOptions = [...speechVoices]
    .sort((a, b) => compareSpeechVoices(a, b, settings.speechVoiceName))
    .map((voice) => ({ key: voice.name, label: `${voice.name}（${voice.lang}）` }));
  if (!voiceOptions.some((option) => option.key === settings.speechVoiceName)) {
    voiceOptions.unshift({
      key: settings.speechVoiceName,
      label:
        settings.speechVoiceName === DEFAULT_SPEECH_VOICE_NAME
          ? `${DEFAULT_SPEECH_VOICE_NAME}（默认）`
          : `${settings.speechVoiceName}（当前不可用）`,
    });
  }
  const previewSpeechVoice = (): void => {
    const synth = typeof window === 'undefined' ? undefined : window.speechSynthesis;
    if (!synth || speechVoices.length === 0 || typeof SpeechSynthesisUtterance === 'undefined') {
      showNotice('没有可用的本地英语语音');
      return;
    }
    const voice = [...speechVoices].sort((a, b) =>
      compareSpeechVoices(a, b, settings.speechVoiceName),
    )[0];
    if (!voice) {
      showNotice('没有可用的本地英语语音');
      return;
    }
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance('Hello. This is the selected reading voice.');
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = 1;
    utterance.volume = 1;
    try {
      synth.resume();
    } catch {
      // 某些环境没有 resume；继续尝试 speak。
    }
    synth.speak(utterance);
    showNotice(`正在试听：${voice.name}`);
  };
  const learningPanel = (
    <Card className="bingeup-card">
      {/* AC1：学习设置 */}
      <Field label="当前词库">
        <div className="bingeup-deck-control">
          <div className="bingeup-select">
            <Select
              aria-label="当前词库"
              value={settings.selectedDeckId}
              options={BUILT_IN_DECKS.map((deck) => ({ key: deck.id, label: deck.name }))}
              onChange={(selectedDeckId) => setSettings({ ...settings, selectedDeckId })}
            />
          </div>
          {selectedDeck && <p className="bingeup-deck-description">{selectedDeck.description}</p>}
        </div>
      </Field>

      <Field label="学习水平">
        <div className="bingeup-select">
          <Select
            aria-label="学习水平"
            value={settings.selfRatedLevel}
            options={(Object.keys(LEVEL_LABELS) as SelfRatedLevel[]).map((level) => ({
              key: level,
              label: LEVEL_LABELS[level],
            }))}
            onChange={(selfRatedLevel) =>
              setSettings({ ...settings, selfRatedLevel: selfRatedLevel as SelfRatedLevel })
            }
          />
        </div>
      </Field>

      <Field label="每日新词上限">
        <Input
          className="bingeup-input"
          type="number"
          min={0}
          max={100}
          aria-label="每日新词上限"
          value={settings.dailyNewWordLimit}
          onChange={(e) => setSettings({ ...settings, dailyNewWordLimit: Number(e.target.value) })}
        />
      </Field>

      <Field label="拼写题（连续学习模式）">
        <Switch
          aria-label="拼写题（连续学习模式）"
          checked={settings.spellingEnabled}
          onChange={(checked) => setSettings({ ...settings, spellingEnabled: checked })}
        />
      </Field>

      <Field label="默认冷却（分钟）">
        <Input
          className="bingeup-input"
          type="number"
          min={1}
          aria-label="默认冷却（分钟）"
          value={settings.defaultCooldownMinutes}
          onChange={(e) =>
            setSettings({ ...settings, defaultCooldownMinutes: Number(e.target.value) })
          }
        />
      </Field>

      <Field label="连续跳过降频（分钟，逗号分隔）">
        <Input
          className="bingeup-input"
          type="text"
          aria-label="连续跳过降频（分钟，逗号分隔）"
          value={settings.consecutiveSkipCooldowns.join(', ')}
          onChange={(e) =>
            setSettings({
              ...settings,
              consecutiveSkipCooldowns: e.target.value
                .split(',')
                .map((s) => Number(s.trim()))
                .filter((n) => Number.isFinite(n) && n > 0),
            })
          }
        />
      </Field>

      <Field label="连续跳过自动降频">
        <Switch
          aria-label="连续跳过自动降频"
          checked={settings.consecutiveSkipSlowdownEnabled}
          onChange={(checked) =>
            setSettings({ ...settings, consecutiveSkipSlowdownEnabled: checked })
          }
        />
      </Field>

      <Field label="长视频定时学习">
        <Switch
          aria-label="长视频定时学习"
          checked={settings.longVideoTimedLearningEnabled}
          onChange={(checked) =>
            setSettings({ ...settings, longVideoTimedLearningEnabled: checked })
          }
        />
      </Field>

      <Field label="长视频定时学习间隔（分钟）">
        <Input
          className="bingeup-input"
          type="number"
          min={1}
          aria-label="长视频定时学习间隔（分钟）"
          disabled={!settings.longVideoTimedLearningEnabled}
          value={settings.longVideoIntervalMinutes}
          onChange={(e) =>
            setSettings({ ...settings, longVideoIntervalMinutes: Number(e.target.value) })
          }
        />
      </Field>

      <div className="bingeup-field bingeup-voice-field">
        <div className="bingeup-voice-label">
          <span className="bingeup-field-label">朗读音色</span>
          <p className="bingeup-deck-description">
            默认 Microsoft Zira；仅列出设备本地英语语音，保证离线可用。
          </p>
        </div>
        <div className="bingeup-field-control bingeup-voice-control">
          <div className="bingeup-select">
            <Select
              aria-label="朗读音色"
              value={settings.speechVoiceName}
              options={voiceOptions}
              onChange={(speechVoiceName) => setSettings({ ...settings, speechVoiceName })}
            />
          </div>
          <Button
            className="bingeup-voice-preview"
            type="default"
            size="small"
            icon={<HugeIcon icon={VolumeHighIcon} size={16} />}
            aria-label="试听朗读音色"
            title="试听朗读音色"
            disabled={speechVoices.length === 0}
            onClick={previewSpeechVoice}
          />
        </div>
      </div>

      <div className="bingeup-actions bingeup-learning-actions">
        <Button
          icon={<HugeIcon icon={ExternalLinkIcon} size={15} />}
          title="在新页面打开学习统计"
          onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('/stats.html') })}
        >
          查看学习统计
        </Button>
        <div className="bingeup-learning-save-actions">
          <Button onClick={requestReset}>恢复默认</Button>
          <Button type="primary" onClick={() => void handleSave(settings, load, showNotice)}>
            保存设置
          </Button>
        </div>
      </div>
    </Card>
  );

  const sitesPanel = (
    <div className="bingeup-panel">
      {/* AC2：网站管理 */}
      <Card className="bingeup-card">
        <form
          className="bingeup-site-add"
          onSubmit={(event) => {
            event.preventDefault();
            void handleAddWebsite(siteInput, load, setSiteInput, setSiteAdding, showNotice);
          }}
        >
          <label className="bingeup-field-label" htmlFor="bingeup-site-address">
            网站地址
          </label>
          <div className="bingeup-site-add-controls">
            <Input
              id="bingeup-site-address"
              className="bingeup-input"
              type="text"
              value={siteInput}
              placeholder="example.com 或 https://example.com"
              onChange={(event) => setSiteInput(event.target.value)}
            />
            <Button type="primary" htmlType="submit" loading={siteAdding} disabled={siteAdding}>
              {siteAdding ? '正在添加…' : '添加网站'}
            </Button>
          </div>
        </form>
      </Card>
      {sites.length === 0 ? (
        <p className="bingeup-hint">暂无已配置的网站。在引导页或 Popup 中启用网站后此处会显示。</p>
      ) : (
        <div className="bingeup-site-list">
          {sites.map((entry) => (
            <SiteRow
              key={entry.hostname}
              entry={entry}
              onEnabledChange={() => void handleSiteEnabledChange(entry, load, showNotice)}
              onTriggersChange={(triggers) =>
                void handleSiteTriggersChange(entry.hostname, triggers, load, showNotice)
              }
              onRemove={() => void handleRemoveSite(entry.hostname, load, showNotice)}
            />
          ))}
        </div>
      )}
    </div>
  );

  const dataPanel = (
    <div className="bingeup-panel">
      <Card className="bingeup-card">
        {/* AC4：数据管理 */}
        <p className="bingeup-hint">
          恢复默认只重置学习设置；清除学习进度会删除学习卡、复习日志和学习会话；清除全部数据还会删除网站设置和本地词库。
        </p>
        <div className="bingeup-actions">
          <Button type="primary" onClick={() => void handleExport(showNotice)}>
            导出数据
          </Button>
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            aria-describedby={importFeedback === null ? undefined : 'bingeup-import-feedback'}
          >
            {importing ? '正在导入…' : '导入数据'}
          </Button>
          {importFeedback !== null && (
            <div
              id="bingeup-import-feedback"
              className="bingeup-import-status"
              role={importFeedback.tone === 'error' ? 'alert' : 'status'}
              aria-live={importFeedback.tone === 'error' ? 'assertive' : 'polite'}
            >
              <Tag
                size="medium"
                variant="soft"
                color={
                  importFeedback.tone === 'success'
                    ? 'app-green'
                    : importFeedback.tone === 'error'
                      ? 'app-red'
                      : 'app-teal'
                }
              >
                {importFeedback.text}
              </Tag>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="bingeup-file-input"
            onChange={(e) => void handleImport(e, load, setImportFeedback, setImporting)}
          />
        </div>
        <div className="bingeup-actions">
          <Button danger onClick={requestClearProgress}>
            清除学习进度
          </Button>
          <Button danger onClick={requestClearAll}>
            清除全部数据
          </Button>
        </div>
      </Card>
      <StorageDiagnosticsCard
        diagnostics={diagnostics}
        error={diagnosticsError}
        loading={diagnosticsLoading}
        onRefresh={() => void refreshDiagnostics()}
      />
    </div>
  );

  return (
    <IslandPage className="bingeup-options" label="刷刷升级设置">
      <h1 className="bingeup-title">
        <Title size="large">刷刷升级 — 设置</Title>
      </h1>

      <Tabs
        className="bingeup-tabs"
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as OptionsTab)}
        items={[
          { key: 'learning', label: '学习设置', children: learningPanel },
          { key: 'sites', label: '网站管理', children: sitesPanel },
          { key: 'data', label: '数据管理', children: dataPanel },
        ]}
      />

      <FeedbackLink />
      {noticeToast}
      {confirmModal}
    </IslandPage>
  );
}

// ─── 子组件 ──────────────────────────────────────────────

type DiagnosticTagColor = 'app-green' | 'app-yellow' | 'app-red' | 'app-teal';

function formatDiagnosticTime(value: number | undefined): string {
  if (value === undefined) return '—';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function formatDiagnosticCounts(counts: StorageCounts | undefined): string {
  if (counts === undefined) return '—';
  return `卡 ${counts.cards} · 复习日志 ${counts.reviewLogs} · 会话 ${counts.sessionLogs} · 行为事件 ${counts.behaviorEvents} · 单词 ${counts.words} · 词库 ${counts.decks}`;
}

function formatStorageMeta(meta: StorageMetaRecord | undefined): string {
  if (meta === undefined) return '—';
  return `修订 ${meta.revision} · 代次 ${meta.generation} · ${meta.pendingBackup ? '待备份' : '已备份'}`;
}

function formatStorageCommitTime(meta: StorageMetaRecord | undefined): string {
  if (meta === undefined || meta.committedAt <= 0) return '—';
  return formatDiagnosticTime(meta.committedAt);
}

function formatStorageStamp(stamp: { generation: string; revision: number } | undefined): string {
  if (stamp === undefined) return '—';
  return `修订 ${stamp.revision} · 代次 ${stamp.generation}`;
}

function formatHealthStatus(status: StorageHealthStatus): {
  text: string;
  color: DiagnosticTagColor;
} {
  if (status === 'isolated') return { text: '已隔离', color: 'app-red' };
  if (status === 'attention') return { text: '需要关注', color: 'app-yellow' };
  return { text: '健康', color: 'app-green' };
}

function formatHealthIssue(issue: StorageHealthIssue): string {
  if (issue.code === 'storage-count-decreased') {
    return `${issue.message}（当前 ${issue.currentCount} / 健康值 ${issue.healthyCount}）`;
  }
  if (issue.code === 'card-count-decreased') {
    return `${issue.message}（当前 ${issue.currentCards} / 健康值 ${issue.healthyCards}）`;
  }
  if (issue.code === 'card-identities-changed') {
    return `${issue.message}（缺失 ${issue.missingCardIds.length} / 新增 ${issue.addedCardIds.length}）`;
  }
  if (issue.code === 'orphan-review-logs') {
    return `${issue.message}（${issue.count} 条）`;
  }
  if (issue.code === 'pending-operation') {
    return `${issue.message}（${issue.operation}，${formatDiagnosticTime(issue.startedAt)}）`;
  }
  if (issue.code === 'restore-failed') {
    return `${issue.message}（${formatDiagnosticTime(issue.failedAt)}）`;
  }
  if (issue.code === 'snapshot-validation-failed' && issue.errors.length > 0) {
    return `${issue.message}（${issue.errors.join('；')}）`;
  }
  return issue.message;
}

function formatCardStages(stages: StorageCardStages | undefined): string {
  if (stages === undefined) return '—';
  const other = stages.other > 0 ? ` · 其他 ${stages.other}` : '';
  return `自报认识 ${stages.selfReported} · 短期 ${stages.shortTerm} · 长期 ${stages.longTerm}${other}`;
}

function learningRecordTotal(counts: StorageCounts | undefined): number {
  if (counts === undefined) return 0;
  return counts.cards + counts.reviewLogs + counts.sessionLogs + counts.behaviorEvents;
}

function formatSnapshotMode(mode: 'full' | 'compact' | undefined): string {
  return mode === 'compact' ? '精简' : '完整';
}

function StorageDiagnosticsCard({
  diagnostics,
  error,
  loading,
  onRefresh,
}: {
  diagnostics: StorageDiagnostics | null;
  error: string | null;
  loading: boolean;
  onRefresh: () => void;
}): JSX.Element {
  const startup = diagnostics?.startup ?? null;
  const startupTotal = learningRecordTotal(startup?.counts);
  const currentTotal = learningRecordTotal(diagnostics?.current?.counts);
  const databaseError = diagnostics?.databaseOpenError ?? startup?.databaseOpenError;
  const fewerThanStartup = startupTotal > 0 && currentTotal < startupTotal;
  const snapshotSaveError =
    startup?.snapshotSaveError !== undefined &&
    (startup.snapshotSaveErrorAt ?? 0) >= (diagnostics?.snapshot.savedAt ?? 0)
      ? startup.snapshotSaveError
      : undefined;
  const lastSelfReport = diagnostics?.history.find(
    (record) => record.lastSelfReportAt !== undefined,
  );
  const storageMeta = diagnostics?.current?.storageMeta;
  const healthStatus =
    diagnostics?.health === undefined ? undefined : formatHealthStatus(diagnostics.health.status);
  const diagnosticErrors: Array<{ label: string; message: string }> = [];
  if (databaseError !== undefined)
    diagnosticErrors.push({ label: '数据库打开', message: databaseError });
  if (diagnostics?.currentError !== undefined) {
    diagnosticErrors.push({ label: '当前存档读取', message: diagnostics.currentError });
  }
  if (diagnostics?.current?.storageMetaError !== undefined) {
    diagnosticErrors.push({
      label: '数据库元数据',
      message: diagnostics.current.storageMetaError,
    });
  }
  if (startup?.restoreError !== undefined) {
    diagnosticErrors.push({ label: '快照恢复', message: startup.restoreError });
  }
  if (snapshotSaveError !== undefined) {
    diagnosticErrors.push({ label: '快照保存', message: snapshotSaveError });
  }
  if (diagnostics?.healthError !== undefined) {
    diagnosticErrors.push({ label: '健康检查', message: diagnostics.healthError });
  }

  let statusText = '尚无启动记录';
  let statusColor: DiagnosticTagColor = 'app-teal';
  if (diagnostics?.health?.status === 'isolated') {
    statusText = '存档健康检查已隔离';
    statusColor = 'app-red';
  } else if (diagnostics?.health?.status === 'attention') {
    statusText = '存档健康检查需要关注';
    statusColor = 'app-yellow';
  } else if (databaseError !== undefined) {
    statusText = '数据库打开失败';
    statusColor = 'app-red';
  } else if (startup?.restoredFromSnapshot) {
    statusText = '启动时使用了快照恢复';
    statusColor = 'app-green';
  } else if (startup?.readAt !== undefined && startupTotal > 0) {
    statusText = '启动已读取到存档';
    statusColor = 'app-green';
  } else if (startup?.readAt !== undefined) {
    statusText = '启动时存档为空';
    statusColor = 'app-teal';
  } else if (startup !== null) {
    statusText = '启动读取未完成';
    statusColor = 'app-yellow';
  }

  return (
    <Card className="bingeup-card bingeup-diagnostics">
      <div className="bingeup-diagnostics-header">
        <Title size="small">存档读取状态</Title>
        <Button onClick={onRefresh} disabled={loading}>
          {loading ? '读取中…' : '刷新'}
        </Button>
      </div>
      <p className="bingeup-hint">
        用于确认扩展启动时是否读到本地存档、是否触发了快照恢复，以及最近一次保存的时间。
      </p>
      {error !== null && (
        <p className="bingeup-error" role="alert">
          诊断读取失败：{error}
        </p>
      )}
      {diagnostics === null && !loading && error === null && (
        <p className="bingeup-hint">尚未读取存档状态。</p>
      )}
      {diagnostics !== null && (
        <>
          <div className="bingeup-diagnostics-tags" aria-live="polite">
            <Tag size="small" variant="soft" color={statusColor}>
              {statusText}
            </Tag>
            {startup?.restoredFromSnapshot && (
              <Tag size="small" variant="soft" color="app-green">
                已使用快照
              </Tag>
            )}
            {healthStatus !== undefined && (
              <Tag size="small" variant="soft" color={healthStatus.color}>
                {healthStatus.text}
              </Tag>
            )}
            {fewerThanStartup && (
              <Tag size="small" variant="soft" color="app-red">
                当前数据少于启动读取
              </Tag>
            )}
          </div>
          <dl className="bingeup-diagnostics-grid">
            <div className="bingeup-diagnostics-row">
              <dt>扩展</dt>
              <dd>
                {diagnostics.extensionId} · v{diagnostics.extensionVersion}
              </dd>
            </div>
            <div className="bingeup-diagnostics-row">
              <dt>数据库</dt>
              <dd>
                {diagnostics.databaseName} v{diagnostics.databaseVersion} ·{' '}
                {diagnostics.databaseOpen ? '当前已打开' : '当前未打开'}
                {databaseError !== undefined && ` · ${databaseError}`}
              </dd>
            </div>
            <div className="bingeup-diagnostics-row">
              <dt>健康状态</dt>
              <dd>
                {diagnostics.health === undefined
                  ? diagnostics.healthError === undefined
                    ? '—'
                    : '健康检查失败'
                  : `${formatHealthStatus(diagnostics.health.status).text} · ${formatDiagnosticTime(diagnostics.health.checkedAt)} · ${diagnostics.health.issues.length} 个问题`}
              </dd>
            </div>
            <div className="bingeup-diagnostics-row">
              <dt>最近数据库提交</dt>
              <dd>{formatStorageCommitTime(storageMeta)}</dd>
            </div>
            <div className="bingeup-diagnostics-row">
              <dt>数据库修订</dt>
              <dd>{formatStorageMeta(storageMeta)}</dd>
            </div>
            <div className="bingeup-diagnostics-row">
              <dt>最近快照成功</dt>
              <dd>
                {diagnostics.snapshot.present
                  ? formatDiagnosticTime(diagnostics.snapshot.savedAt)
                  : '尚无成功快照'}
              </dd>
            </div>
            <div className="bingeup-diagnostics-row">
              <dt>快照修订</dt>
              <dd>{formatStorageStamp(diagnostics.snapshot.storage)}</dd>
            </div>
            <div className="bingeup-diagnostics-row">
              <dt>后台启动</dt>
              <dd>{formatDiagnosticTime(startup?.startedAt)}</dd>
            </div>
            <div className="bingeup-diagnostics-row">
              <dt>恢复前计数</dt>
              <dd>{formatDiagnosticCounts(startup?.restoreBeforeCounts)}</dd>
            </div>
            <div className="bingeup-diagnostics-row">
              <dt>恢复后计数</dt>
              <dd>{formatDiagnosticCounts(startup?.restoreAfterCounts)}</dd>
            </div>
            <div className="bingeup-diagnostics-row">
              <dt>启动读取</dt>
              <dd>
                {formatDiagnosticTime(startup?.readAt)} · {formatDiagnosticCounts(startup?.counts)}
              </dd>
            </div>
            <div className="bingeup-diagnostics-row">
              <dt>当前读取</dt>
              <dd>
                {formatDiagnosticTime(diagnostics.current?.readAt)} ·{' '}
                {formatDiagnosticCounts(diagnostics.current?.counts)}
                {diagnostics.currentError !== undefined && ` · ${diagnostics.currentError}`}
                {diagnostics.current?.storageMetaError !== undefined &&
                  ` · DB 元数据：${diagnostics.current.storageMetaError}`}
              </dd>
            </div>
            <div className="bingeup-diagnostics-row">
              <dt>快照计数</dt>
              <dd>{formatDiagnosticCounts(diagnostics.snapshot.counts)}</dd>
            </div>
            <div className="bingeup-diagnostics-row">
              <dt>启动卡状态</dt>
              <dd>{formatCardStages(startup?.cardStages)}</dd>
            </div>
            <div className="bingeup-diagnostics-row">
              <dt>当前卡状态</dt>
              <dd>{formatCardStages(diagnostics.current?.cardStages)}</dd>
            </div>
            <div className="bingeup-diagnostics-row">
              <dt>自动恢复</dt>
              <dd>
                {startup?.restoredFromSnapshot ? '已使用快照恢复' : '未使用快照'}
                {startup?.restoreError !== undefined && ` · ${startup.restoreError}`}
              </dd>
            </div>
            <div className="bingeup-diagnostics-row">
              <dt>最近自报</dt>
              <dd>
                {lastSelfReport?.lastSelfReportAt === undefined
                  ? '—'
                  : `${formatDiagnosticTime(lastSelfReport.lastSelfReportAt)} · ${lastSelfReport.lastSelfReportWordId ?? '—'}`}
              </dd>
            </div>
            <div className="bingeup-diagnostics-row">
              <dt>自动快照</dt>
              <dd>
                {diagnostics.snapshot.present
                  ? `${formatSnapshotMode(diagnostics.snapshot.mode)} · ${formatDiagnosticTime(diagnostics.snapshot.savedAt)}`
                  : '无'}
              </dd>
            </div>
          </dl>
          {diagnostics.health !== undefined && diagnostics.health.issues.length > 0 && (
            <div className="bingeup-diagnostics-history-block">
              <Title size="small">健康检查问题</Title>
              <ul className="bingeup-diagnostics-history">
                {diagnostics.health.issues.map((issue, index) => (
                  <li key={`${issue.code}-${index}`}>
                    <span>{formatHealthIssue(issue)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {diagnosticErrors.length > 0 && (
            <div className="bingeup-diagnostics-history-block">
              <Title size="small">错误原因</Title>
              <ul className="bingeup-diagnostics-history">
                {diagnosticErrors.map((entry, index) => (
                  <li key={`${entry.label}-${index}`}>
                    <span className="bingeup-diagnostics-history-time">{entry.label}</span>
                    <span>{entry.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="bingeup-diagnostics-history-block">
            <Title size="small">最近启动记录</Title>
            {diagnostics.history.length === 0 ? (
              <p className="bingeup-hint">暂无启动记录。</p>
            ) : (
              <ul className="bingeup-diagnostics-history">
                {diagnostics.history.slice(0, 5).map((record: StorageStartupRecord, index) => (
                  <li key={`${record.startedAt}-${index}`}>
                    <span className="bingeup-diagnostics-history-time">
                      {formatDiagnosticTime(record.startedAt)}
                    </span>
                    <span>{formatDiagnosticCounts(record.counts)}</span>
                    {(record.restoreBeforeCounts !== undefined ||
                      record.restoreAfterCounts !== undefined) && (
                      <span>
                        恢复前 {formatDiagnosticCounts(record.restoreBeforeCounts)} → 恢复后{' '}
                        {formatDiagnosticCounts(record.restoreAfterCounts)}
                      </span>
                    )}
                    {record.restoredFromSnapshot && (
                      <Tag size="small" variant="soft" color="app-green">
                        快照恢复
                      </Tag>
                    )}
                    {record.databaseOpenError !== undefined && (
                      <Tag size="small" variant="soft" color="app-red">
                        数据库失败
                      </Tag>
                    )}
                    {record.restoreError !== undefined && (
                      <span className="bingeup-error">恢复失败：{record.restoreError}</span>
                    )}
                    {record.snapshotSaveError !== undefined && (
                      <span className="bingeup-error">快照失败：{record.snapshotSaveError}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="bingeup-field">
      <span className="bingeup-field-label">{label}</span>
      <div className="bingeup-field-control">{children}</div>
    </div>
  );
}

function SiteRow({
  entry,
  onEnabledChange,
  onTriggersChange,
  onRemove,
}: {
  entry: SiteEntry;
  onEnabledChange: () => void;
  onTriggersChange: (triggers: Pick<SiteSettings, 'pageLoadTrigger' | 'scrollTrigger'>) => void;
  onRemove: () => void;
}): JSX.Element {
  const { hostname, settings, hasHostPermission } = entry;
  const needsPermission = settings.mode !== 'unsupported' && !hasHostPermission;
  const effectivelyEnabled = settings.enabled && !needsPermission;
  return (
    <Card className="bingeup-site-row">
      <div className="bingeup-site-info">
        <span className="bingeup-site-host">{hostname}</span>
        <Tag size="small" color={effectivelyEnabled ? 'app-teal' : 'default'}>
          {effectivelyEnabled ? '已启用' : '未启用'}
        </Tag>
        <Tag size="small" color={needsPermission ? 'app-yellow' : 'default'}>
          {needsPermission ? '需要权限' : MODE_LABELS[settings.mode]}
        </Tag>
      </div>
      {settings.mode === 'basic-web' && (
        <div className="bingeup-site-triggers">
          <span className="bingeup-site-trigger">
            <Switch
              size="small"
              checked={settings.pageLoadTrigger ?? true}
              aria-label="页面加载触发"
              onChange={(checked) => onTriggersChange({ pageLoadTrigger: checked })}
            />
            页面加载触发
          </span>
          <span className="bingeup-site-trigger">
            <Switch
              size="small"
              checked={settings.scrollTrigger ?? true}
              aria-label="滚动触发"
              onChange={(checked) => onTriggersChange({ scrollTrigger: checked })}
            />
            滚动触发
          </span>
        </div>
      )}
      <div className="bingeup-site-controls">
        <Switch
          aria-label={`启用 ${hostname}`}
          checked={settings.enabled}
          onChange={() => onEnabledChange()}
        />
        <Button size="small" danger onClick={onRemove}>
          删除
        </Button>
      </div>
    </Card>
  );
}

// ─── 动作处理 ──────────────────────────────────────────────

async function handleSave(
  settings: AppSettings,
  onReload: () => Promise<unknown>,
  onNotice: (msg: string | null) => void,
): Promise<void> {
  try {
    await messageClient.setAppSettings(settings);
    await onReload();
    onNotice('设置已保存');
  } catch (e) {
    onNotice(`保存失败：${e instanceof Error ? e.message : String(e)}`);
  }
}

async function handleReset(
  onReload: () => Promise<boolean>,
  onNotice: (msg: string | null) => void,
): Promise<void> {
  try {
    await messageClient.resetAppSettings();
    if (!(await onReload())) {
      onNotice('默认设置已恢复，但重新读取失败；当前显示状态未确认');
      return;
    }
    onNotice('已恢复默认设置');
  } catch (e) {
    onNotice(`恢复失败：${e instanceof Error ? e.message : String(e)}`);
  }
}

async function handleSiteEnabledChange(
  entry: SiteEntry,
  onReload: () => Promise<unknown>,
  onNotice: (msg: string | null) => void,
): Promise<void> {
  try {
    await messageClient.setSiteEnabled(entry.hostname, !entry.settings.enabled);
    onNotice(`${entry.settings.enabled ? '已关闭' : '已开启'}网站 ${entry.hostname}`);
    await onReload();
  } catch (error) {
    onNotice(`网站状态更新失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleSiteTriggersChange(
  hostname: string,
  triggers: Pick<SiteSettings, 'pageLoadTrigger' | 'scrollTrigger'>,
  onReload: () => Promise<unknown>,
  onNotice: (msg: string | null) => void,
): Promise<void> {
  try {
    await messageClient.updateSiteTriggers(hostname, triggers);
    await onReload();
    onNotice(`已保存网站 ${hostname} 的触发设置`);
  } catch (error) {
    onNotice(`触发设置保存失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleRemoveSite(
  hostname: string,
  onReload: () => Promise<unknown>,
  onNotice: (msg: string | null) => void,
): Promise<void> {
  try {
    await messageClient.removeSite(hostname);
    await onReload();
    onNotice(`已删除网站 ${hostname}`);
  } catch (e) {
    onNotice(`删除失败：${e instanceof Error ? e.message : String(e)}`);
  }
}

async function handleAddWebsite(
  input: string,
  onReload: () => Promise<unknown>,
  onInputChange: (value: string) => void,
  onAddingChange: (adding: boolean) => void,
  onNotice: (msg: string | null) => void,
): Promise<void> {
  onAddingChange(true);
  try {
    const result = await addWebsite(input);
    if (!result.ok) {
      onNotice(result.message);
      return;
    }
    onInputChange('');
    await onReload();
    if (result.status === 'already-enabled') {
      onNotice(`网站 ${result.hostname} 已启用`);
    } else if (result.status === 'permission-restored') {
      onNotice(`已恢复网站 ${result.hostname} 的访问权限`);
    } else {
      onNotice(`已添加网站 ${result.hostname}`);
    }
  } finally {
    onAddingChange(false);
  }
}

async function handleExport(onNotice: (msg: string | null) => void): Promise<void> {
  try {
    const payload = await messageClient.exportData();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bingeup-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onNotice('数据已导出');
  } catch (e) {
    onNotice(`导出失败：${e instanceof Error ? e.message : String(e)}`);
  }
}

async function handleImport(
  e: React.ChangeEvent<HTMLInputElement>,
  onReload: () => Promise<boolean>,
  onFeedback: (feedback: ImportFeedback | null) => void,
  onImportingChange: (importing: boolean) => void,
): Promise<void> {
  const file = e.target.files?.[0];
  if (!file) return;
  onImportingChange(true);
  onFeedback({ tone: 'info', text: `正在导入 ${file.name}…` });
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const result: ImportResult = await messageClient.importData(payload);
    if (result.ok) {
      if (!(await onReload())) {
        onFeedback({
          tone: 'error',
          text: '权威数据已恢复，但重新读取失败；当前显示状态未确认',
        });
        return;
      }
      onFeedback({
        tone: result.warnings.length > 0 ? 'info' : 'success',
        text:
          result.warnings.length > 0 ? `数据已恢复；${result.warnings.join('；')}` : '数据导入成功',
      });
    } else {
      onFeedback({ tone: 'error', text: `导入失败：${result.errors.join('；')}` });
    }
  } catch (err) {
    onFeedback({
      tone: 'error',
      text:
        err instanceof SyntaxError
          ? '导入失败：文件不是有效的 JSON'
          : `导入失败：${err instanceof Error ? err.message : String(err)}`,
    });
  } finally {
    onImportingChange(false);
    // 重置 input 以允许重复导入同一文件
    e.target.value = '';
  }
}

async function handleClearProgress(
  onReload: () => Promise<boolean>,
  onNotice: (msg: string | null) => void,
): Promise<void> {
  try {
    await messageClient.clearLearningProgress();
    if (!(await onReload())) {
      onNotice('学习进度已清除，但重新读取失败；当前显示状态未确认');
      return;
    }
    onNotice('学习进度已清除');
  } catch (e) {
    onNotice(`清除失败：${e instanceof Error ? e.message : String(e)}`);
  }
}

async function handleClearAll(
  onReload: () => Promise<boolean>,
  onNotice: (msg: string | null) => void,
): Promise<void> {
  try {
    const result = await messageClient.clearAllData();
    if (!(await onReload())) {
      onNotice(
        result.ok
          ? '权威数据已清除，但重新读取失败；当前显示状态未确认'
          : `清除失败：${result.errors.join('；')}`,
      );
      return;
    }
    if (!result.ok) {
      onNotice(`清除失败：${result.errors.join('；')}`);
    } else {
      onNotice(
        result.warnings.length > 0
          ? `权威数据已清除；${result.warnings.join('；')}`
          : '全部数据已清除',
      );
    }
  } catch (e) {
    onNotice(`清除失败：${e instanceof Error ? e.message : String(e)}`);
  }
}

async function handleRebuildDatabase(
  onReload: () => Promise<boolean>,
  onNotice: (msg: string | null) => void,
  onError: (error: LoadError | null) => void,
): Promise<void> {
  try {
    const result = await messageClient.rebuildDatabase();
    if (!(await onReload())) {
      onNotice('本地数据已重建，但重新读取失败；请再次重试，当前状态未确认');
      return;
    }
    onError(null);
    onNotice(
      result.warnings.length > 0
        ? `本地数据已清除并重建；${result.warnings.join('；')}`
        : '本地数据已清除并重建',
    );
  } catch (error) {
    onNotice(`重建失败：${error instanceof Error ? error.message : String(error)}`);
  }
}
