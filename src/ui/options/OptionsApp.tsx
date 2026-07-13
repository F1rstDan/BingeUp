import { useCallback, useEffect, useRef, useState } from 'react';
import { messageClient } from '@/messaging/message-client';
import { BUILT_IN_DECKS } from '@/dictionary/built-in/decks';
import { addWebsite } from '@/sites/site-access';
import { hasExactHttpsPermission } from '@/sites/site-permission';
import { DropdownSelect } from '@/ui/options/DropdownSelect';
import type { AppSettings, SelfRatedLevel, SiteSettings } from '@/types';
import type { ImportResult } from '@/storage/data-transfer';

/**
 * 设置页（Issue #10）。四个区域：
 * - 学习设置：词库、学习水平、每日新词上限、拼写题、默认冷却、长视频定时学习、跳过降频（AC1）
 * - 网站管理：查看并管理每个已启用网站的状态、兼容模式与基础网页触发选项（AC2）
 * - 数据管理：导出 / 导入 / 清除学习进度 / 清除全部数据（AC4）
 *
 * AC3 由 background 的 normalizeAppSettings 保证（保存即校验自动修正，无需重启）。
 * AC5 由 background 的 REMOVE_SITE 处理程序保证（删除自定义网站时释放可选权限）。
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

export function OptionsApp(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [sites, setSites] = useState<SiteEntry[]>([]);
  const [siteInput, setSiteInput] = useState('');
  const [siteAdding, setSiteAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  if (error !== null) {
    return (
      <div className="bingeup-options">
        <h1>刷刷升级 — 设置</h1>
        <p className="bingeup-error">{error.message}</p>
        {notice && (
          <p className="bingeup-notice" role="status">
            {notice}
          </p>
        )}
        <div className="bingeup-actions">
          <button className="bingeup-btn-primary" onClick={() => void load()}>
            重试
          </button>
          {error.databaseUnavailable && (
            <button
              className="bingeup-btn-danger"
              onClick={() => void handleRebuildDatabase(load, setNotice, setError)}
            >
              清除本地数据并重建
            </button>
          )}
        </div>
      </div>
    );
  }

  if (settings === null) {
    return (
      <div className="bingeup-options">
        <h1>刷刷升级 — 设置</h1>
        <p className="bingeup-hint">加载中…</p>
      </div>
    );
  }

  return (
    <div className="bingeup-options">
      <h1>刷刷升级 — 设置</h1>

      {notice && (
        <p className="bingeup-notice" role="status">
          {notice}
        </p>
      )}

      {/* AC1：学习设置 */}
      <SettingsSection title="学习设置">
        <Field label="当前词库">
          <DropdownSelect
            id="bingeup-deck-select"
            ariaLabel="当前词库"
            value={settings.selectedDeckId}
            options={BUILT_IN_DECKS.map((deck) => ({
              value: deck.id,
              label: deck.name,
              description: deck.description,
            }))}
            onChange={(selectedDeckId) => setSettings({ ...settings, selectedDeckId })}
          />
        </Field>

        <Field label="学习水平">
          <DropdownSelect
            id="bingeup-level-select"
            ariaLabel="学习水平"
            value={settings.selfRatedLevel}
            options={(Object.keys(LEVEL_LABELS) as SelfRatedLevel[]).map((level) => ({
              value: level,
              label: LEVEL_LABELS[level],
            }))}
            onChange={(selfRatedLevel) => setSettings({ ...settings, selfRatedLevel })}
          />
        </Field>

        <Field label="每日新词上限">
          <input
            type="number"
            min={0}
            max={100}
            value={settings.dailyNewWordLimit}
            onChange={(e) =>
              setSettings({ ...settings, dailyNewWordLimit: Number(e.target.value) })
            }
          />
        </Field>

        <Field label="拼写题（连续学习模式）">
          <input
            type="checkbox"
            role="switch"
            aria-label="拼写题（连续学习模式）"
            checked={settings.spellingEnabled}
            onChange={(e) => setSettings({ ...settings, spellingEnabled: e.target.checked })}
          />
        </Field>

        <Field label="默认冷却（分钟）">
          <input
            type="number"
            min={1}
            value={settings.defaultCooldownMinutes}
            onChange={(e) =>
              setSettings({ ...settings, defaultCooldownMinutes: Number(e.target.value) })
            }
          />
        </Field>

        <Field label="连续跳过降频（分钟，逗号分隔）">
          <input
            type="text"
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

        <Field label="长视频定时学习">
          <input
            type="checkbox"
            role="switch"
            aria-label="长视频定时学习"
            checked={settings.longVideoTimedLearningEnabled}
            onChange={(e) =>
              setSettings({ ...settings, longVideoTimedLearningEnabled: e.target.checked })
            }
          />
        </Field>

        <Field label="长视频定时学习间隔（分钟）">
          <input
            type="number"
            min={1}
            value={settings.longVideoIntervalMinutes}
            disabled={!settings.longVideoTimedLearningEnabled}
            onChange={(e) =>
              setSettings({ ...settings, longVideoIntervalMinutes: Number(e.target.value) })
            }
          />
        </Field>

        <div className="bingeup-actions">
          <button
            className="bingeup-btn-primary"
            onClick={() => void handleSave(settings, load, setNotice)}
          >
            保存设置
          </button>
          <button
            className="bingeup-btn-secondary"
            onClick={() => void handleReset(load, setNotice)}
          >
            恢复默认
          </button>
        </div>
      </SettingsSection>

      {/* AC2：网站管理 */}
      <SettingsSection title="网站管理">
        <form
          className="bingeup-site-add"
          onSubmit={(event) => {
            event.preventDefault();
            void handleAddWebsite(siteInput, load, setSiteInput, setSiteAdding, setNotice);
          }}
        >
          <label htmlFor="bingeup-site-address">网站地址</label>
          <div className="bingeup-site-add-controls">
            <input
              id="bingeup-site-address"
              type="text"
              value={siteInput}
              placeholder="example.com 或 https://example.com"
              onChange={(event) => setSiteInput(event.target.value)}
            />
            <button className="bingeup-btn-primary" type="submit" disabled={siteAdding}>
              {siteAdding ? '正在添加…' : '添加网站'}
            </button>
          </div>
        </form>
        {sites.length === 0 ? (
          <p className="bingeup-hint">
            暂无已配置的网站。在引导页或 Popup 中启用网站后此处会显示。
          </p>
        ) : (
          <div className="bingeup-site-list">
            {sites.map((entry) => (
              <SiteRow
                key={entry.hostname}
                entry={entry}
                onRemove={() => void handleRemoveSite(entry.hostname, load, setNotice)}
              />
            ))}
          </div>
        )}
      </SettingsSection>

      {/* AC4：数据管理 */}
      <SettingsSection title="数据管理">
        <p className="bingeup-hint">
          恢复默认只重置学习设置；清除学习进度会删除学习卡、复习日志和学习会话；清除全部数据还会删除网站设置和本地词库。
        </p>
        <div className="bingeup-actions">
          <button className="bingeup-btn-primary" onClick={() => void handleExport(setNotice)}>
            导出数据
          </button>
          <button className="bingeup-btn-secondary" onClick={() => fileInputRef.current?.click()}>
            导入数据
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="bingeup-file-input"
            onChange={(e) => void handleImport(e, load, setNotice)}
          />
        </div>
        <div className="bingeup-actions">
          <button
            className="bingeup-btn-danger"
            onClick={() => void handleClearProgress(load, setNotice)}
          >
            清除学习进度
          </button>
          <button
            className="bingeup-btn-danger"
            onClick={() => void handleClearAll(load, setNotice)}
          >
            清除全部数据
          </button>
        </div>
      </SettingsSection>
    </div>
  );
}

// ─── 子组件 ──────────────────────────────────────────────

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="bingeup-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="bingeup-field">
      <label className="bingeup-field-label">{label}</label>
      <div className="bingeup-field-control">{children}</div>
    </div>
  );
}

function SiteRow({ entry, onRemove }: { entry: SiteEntry; onRemove: () => void }): JSX.Element {
  const { hostname, settings, hasHostPermission } = entry;
  const needsPermission = settings.mode !== 'unsupported' && !hasHostPermission;
  const effectivelyEnabled = settings.enabled && !needsPermission;
  return (
    <div className="bingeup-site-row">
      <div className="bingeup-site-info">
        <span className="bingeup-site-host">{hostname}</span>
        <span
          className={
            'bingeup-badge ' + (effectivelyEnabled ? 'bingeup-badge-ok' : 'bingeup-badge-off')
          }
        >
          {effectivelyEnabled ? '已启用' : '未启用'}
        </span>
        <span className="bingeup-badge">
          {needsPermission ? '需要权限' : MODE_LABELS[settings.mode]}
        </span>
      </div>
      {settings.mode === 'basic-web' && (
        <div className="bingeup-site-triggers">
          <label>
            <input type="checkbox" checked={settings.pageLoadTrigger ?? true} disabled />
            页面加载触发
          </label>
          <label>
            <input type="checkbox" checked={settings.scrollTrigger ?? true} disabled />
            滚动触发
          </label>
        </div>
      )}
      <button className="bingeup-btn-danger bingeup-btn-sm" onClick={onRemove}>
        删除
      </button>
    </div>
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
  if (
    !window.confirm(
      '确定要清除所有学习进度吗？此操作不可撤销，将删除全部学习卡、复习日志与学习会话及其统计，但保留设置与词库。',
    )
  ) {
    return;
  }
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
  if (
    !window.confirm(
      '确定要清除全部本地数据吗？此操作不可撤销，将删除所有学习数据、设置与词库，恢复到初始状态。',
    )
  ) {
    return;
  }
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
  if (
    !window.confirm(
      '重建会永久删除全部本地用户数据。请先确认你已经尝试过“重试”，并关闭了其他刷刷升级页面。是否继续？',
    )
  )
    return;
  if (!window.confirm('最后确认：永久清除本地用户数据并重建，且无法撤销。确定执行吗？')) return;
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
