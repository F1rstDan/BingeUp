import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Card, Input, Modal, Select, Switch, Tabs, Tag, Title } from 'animal-island-ui';
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
import type { AppSettings, SelfRatedLevel, SiteSettings } from '@/types';
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
  const [siteInput, setSiteInput] = useState('');
  const [siteAdding, setSiteAdding] = useState(false);
  const [notice, setNotice] = useState<NoticeMessage | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

      <Field label="朗读音色">
        <div className="bingeup-deck-control">
          <div className="bingeup-select">
            <Select
              aria-label="朗读音色"
              value={settings.speechVoiceName}
              options={voiceOptions}
              onChange={(speechVoiceName) => setSettings({ ...settings, speechVoiceName })}
            />
          </div>
          <p className="bingeup-deck-description">
            默认 Microsoft Zira；仅列出设备本地英语语音，保证离线可用。
          </p>
        </div>
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

      <div className="bingeup-actions bingeup-learning-actions">
        <Button
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
    <Card className="bingeup-card">
      {/* AC4：数据管理 */}
      <p className="bingeup-hint">
        恢复默认只重置学习设置；清除学习进度会删除学习卡、复习日志和学习会话；清除全部数据还会删除网站设置和本地词库。
      </p>
      <div className="bingeup-actions">
        <Button type="primary" onClick={() => void handleExport(showNotice)}>
          导出数据
        </Button>
        <Button onClick={() => fileInputRef.current?.click()}>导入数据</Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="bingeup-file-input"
          onChange={(e) => void handleImport(e, load, showNotice)}
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
  );

  return (
    <IslandPage className="bingeup-options" label="刷刷升级设置">
      <h1 className="bingeup-title">
        <Title size="large">刷刷升级 — 设置</Title>
      </h1>

      <Tabs
        className="bingeup-tabs"
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
  onNotice: (msg: string | null) => void,
): Promise<void> {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const result: ImportResult = await messageClient.importData(payload);
    if (result.ok) {
      if (!(await onReload())) {
        onNotice('权威数据已恢复，但重新读取失败；当前显示状态未确认');
        return;
      }
      onNotice(
        result.warnings.length > 0 ? `数据已恢复；${result.warnings.join('；')}` : '数据导入成功',
      );
    } else {
      onNotice(`导入失败：${result.errors.join('；')}`);
    }
  } catch (err) {
    onNotice(`导入失败：${err instanceof Error ? err.message : String(err)}`);
  }
  // 重置 input 以允许重复导入同一文件
  e.target.value = '';
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
