import { useCallback, useEffect, useState } from 'react';
import { messageClient } from '@/messaging/message-client';
import {
  derivePopupState,
  type PopupCompatibilityLevel,
  type PopupDisplayState,
} from '@/popup/popup-state';
import type { ContentMessage } from '@/messaging/messages';

/**
 * Popup 面板（Issue #9 AC3 / AC4 / AC5）。
 *
 * AC3：显示当前域名、启用状态、兼容等级、覆盖方式、是否能控制视频。
 * AC4：暂停当前网站 / 暂停全部 / 暂停今天 / 恢复全部 / 开始连续学习 / 设置 / 统计。
 * AC5：受保护页面、未完成引导、缺少权限时提供可理解状态而非静默失败。
 */

const COMPATIBILITY_LABELS: Record<PopupCompatibilityLevel, string> = {
  'full-adaptation': '完整适配',
  'generic-video': '通用视频',
  'basic-web': '基础网页',
  unsupported: '不支持',
  protected: '受保护页面',
  'needs-permission': '需要权限',
  'not-onboarding': '未完成引导',
};

const OVERLAY_MODE_LABELS: Record<string, string> = {
  'video-region': '视频区域',
  'full-page': '全屏覆盖',
};

interface PopupContext {
  hostname: string;
  url: string;
  tabId: number | null;
}

type PopupSiteStatusTone = 'ready' | 'paused' | 'warning' | 'inactive';
type PopupRuntimeTone = 'ready' | 'paused' | 'limited' | 'inactive';

function PopupHeader(): JSX.Element {
  return (
    <header className="bingeup-header">
      <div className="bingeup-brand" aria-label="刷刷升级">
        <span className="bingeup-brand-mark" aria-hidden="true">
          <i className="bingeup-brand-eye left" />
          <i className="bingeup-brand-eye right" />
          <i className="bingeup-brand-mouth" />
        </span>
        <strong>刷刷升级</strong>
      </div>
      <button
        className="bingeup-popup-settings"
        aria-label="设置"
        title="设置"
        onClick={() => void chrome.runtime.openOptionsPage()}
      >
        <span className="bingeup-visually-hidden">设置</span>
        <span aria-hidden="true">⚙</span>
      </button>
    </header>
  );
}

function popupSiteStatusTone(state: PopupDisplayState): PopupSiteStatusTone {
  if (state.globallyPaused) return 'paused';
  if (state.enabled) return 'ready';
  if (state.compatibilityLevel === 'needs-permission') return 'warning';
  return 'inactive';
}

function popupSiteBadge(state: PopupDisplayState): string {
  if (state.globallyPaused) return '已暂停';
  if (state.enabled) return '可学习';
  if (state.canAddCustomSite) return '可加入';
  if (state.compatibilityLevel === 'needs-permission') return '需权限';
  return '待启用';
}

function popupRuntimeStatus(state: PopupDisplayState): {
  tone: PopupRuntimeTone;
  label: string;
  description: string;
  badge: string;
} {
  if (state.globallyPaused) {
    return {
      tone: 'paused',
      label: '全局暂停中',
      description: '恢复全部后，才会继续出现学习界面。',
      badge: '暂停',
    };
  }
  if (!state.enabled) {
    return {
      tone: 'inactive',
      label: '网站未启用',
      description: '启用当前网站后即可在视频间隙学习。',
      badge: '待处理',
    };
  }
  if (state.canControlVideo) {
    return {
      tone: 'ready',
      label: '可以开始学习',
      description: '当前页面已准备好连续学习。',
      badge: '就绪',
    };
  }
  return {
    tone: 'limited',
    label: '基础网页模式',
    description: '学习界面可用，但插件不会控制视频。',
    badge: '有限支持',
  };
}

export function PopupApp(): JSX.Element {
  const [state, setState] = useState<PopupDisplayState | null>(null);
  const [ctx, setCtx] = useState<PopupContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) {
        setError('无法获取当前标签页');
        return;
      }
      let hostname: string;
      try {
        hostname = new URL(tab.url).hostname;
      } catch {
        hostname = '';
      }
      const data = await messageClient.getPopupData(hostname);
      const hasHostPermission = await chromePermissionsContains(hostname);
      const display = derivePopupState({
        hostname,
        url: tab.url,
        site: data.site,
        onboardingCompleted: data.onboardingCompleted,
        globalPausedUntil: data.globalPausedUntil,
        hasHostPermission,
        now: Date.now(),
      });
      setState(display);
      setCtx({ hostname, url: tab.url, tabId: tab.id ?? null });
      setError(null);
    } catch (e) {
      setError(`加载失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error !== null) {
    return (
      <div className="bingeup-popup">
        <PopupHeader />
        <div className="bingeup-state-card">
          <p className="bingeup-hint bingeup-error">{error}</p>
        </div>
      </div>
    );
  }

  if (state === null || ctx === null) {
    return (
      <div className="bingeup-popup">
        <PopupHeader />
        <div className="bingeup-state-card">
          <p className="bingeup-hint">加载中…</p>
        </div>
      </div>
    );
  }

  return <PopupView state={state} ctx={ctx} notice={notice} onReload={load} onNotice={setNotice} />;
}

/** 检查当前站点是否已获得浏览器主机权限。 */
async function chromePermissionsContains(hostname: string): Promise<boolean> {
  if (!hostname) return false;
  try {
    return await chrome.permissions.contains({ origins: [`*://${hostname}/*`] });
  } catch {
    // 权限 API 不可用时 fail-open：假定已有权限，避免阻塞用户操作。
    return true;
  }
}

interface PopupViewProps {
  state: PopupDisplayState;
  ctx: PopupContext;
  notice: string | null;
  onReload: () => Promise<void>;
  onNotice: (msg: string | null) => void;
}

function PopupView({ state, ctx, notice, onReload, onNotice }: PopupViewProps): JSX.Element {
  // AC5：受保护页面
  if (state.isProtectedPage) {
    return (
      <div className="bingeup-popup">
        <PopupHeader />
        <div className="bingeup-state-card">
          <strong className="bingeup-state-title">当前页面不可用</strong>
          <p className="bingeup-hint">
            当前为浏览器受保护页面（{ctx.url}），刷刷升级无法在此运行。
          </p>
        </div>
      </div>
    );
  }

  // AC5：引导未完成
  if (state.compatibilityLevel === 'not-onboarding') {
    return (
      <div className="bingeup-popup">
        <PopupHeader />
        <div className="bingeup-state-card">
          <strong className="bingeup-state-title">先完成安装引导</strong>
          <p className="bingeup-hint">尚未完成安装引导。</p>
        </div>
        <button
          className="bingeup-btn-primary bingeup-btn-full"
          onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('/onboarding.html') })}
        >
          开始引导
        </button>
      </div>
    );
  }

  // AC5：缺少主机权限
  if (state.compatibilityLevel === 'needs-permission') {
    return (
      <div className="bingeup-popup">
        <PopupHeader />
        <div className="bingeup-site-status bingeup-site-status-warning">
          <i className="bingeup-site-dot" />
          <div className="bingeup-site-copy">
            <strong>{state.hostname}</strong>
            <span>未启用 · 需要权限</span>
          </div>
          <span className="bingeup-site-badge bingeup-site-badge-warning">需权限</span>
        </div>
        <div className="bingeup-state-card">
          <div className="bingeup-row">
            <span className="bingeup-label">域名</span>
            <span className="bingeup-value">{state.hostname}</span>
          </div>
          <p className="bingeup-hint">
            当前网站缺少主机权限，请在扩展管理页授予访问权限后刷新页面。
          </p>
        </div>
      </div>
    );
  }

  const siteStatusTone = popupSiteStatusTone(state);
  const runtimeStatus = popupRuntimeStatus(state);

  return (
    <div className="bingeup-popup">
      <PopupHeader />

      {/* AC3：当前网站状态 */}
      <section className={`bingeup-site-status bingeup-site-status-${siteStatusTone}`} aria-label="当前网站状态">
        <i className="bingeup-site-dot" />
        <div className="bingeup-site-copy">
          <strong>{state.hostname || '当前页面'}</strong>
          <span>
            <b>{state.globallyPaused ? '已暂停' : state.enabled ? '已启用' : '未启用'}</b>
            {' · '}
            <span>{COMPATIBILITY_LABELS[state.compatibilityLevel]}</span>
          </span>
        </div>
        <span className="bingeup-site-badge">{popupSiteBadge(state)}</span>
      </section>

      <section className="bingeup-block" aria-labelledby="bingeup-capability-title">
        <div className="bingeup-block-head">
          <strong id="bingeup-capability-title">网站能力</strong>
          <button
            className="bingeup-text-button"
            aria-label="查看统计"
            onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('/stats.html') })}
          >
            统计
          </button>
        </div>
        <div className="bingeup-metrics">
          <div className="bingeup-metric">
            <strong>
              {Array.from(COMPATIBILITY_LABELS[state.compatibilityLevel]).map((character, index) => (
                <span className="bingeup-metric-value-part" key={`${character}-${index}`}>
                  {character}
                </span>
              ))}
            </strong>
            <span>兼容等级</span>
          </div>
          <div className="bingeup-metric bingeup-metric-green">
            <strong>{state.overlayMode ? OVERLAY_MODE_LABELS[state.overlayMode] ?? '—' : '—'}</strong>
            <span>覆盖方式</span>
          </div>
          <div className="bingeup-metric bingeup-metric-pink">
            <strong>{state.canControlVideo ? '是' : '否'}</strong>
            <span>视频控制</span>
          </div>
        </div>
      </section>

      <section className="bingeup-block" aria-labelledby="bingeup-runtime-title">
        <div className="bingeup-block-head">
          <strong id="bingeup-runtime-title">当前状态</strong>
          <span className="bingeup-block-meta">{state.enabled ? '网站已加入' : '等待操作'}</span>
        </div>
        <div className="bingeup-runtime-row">
          <div>
            <strong>{runtimeStatus.label}</strong>
            <span>{runtimeStatus.description}</span>
          </div>
          <span className={`bingeup-runtime-pill bingeup-runtime-pill-${runtimeStatus.tone}`}>
            {runtimeStatus.badge}
          </span>
        </div>
      </section>

      {/* AC4：暂停控制 / Issue #11：加入当前网站 */}
      <div className="bingeup-actions">
        {notice !== null && (
          <p className="bingeup-hint bingeup-notice" role="status">{notice}</p>
        )}
        {state.canAddCustomSite ? (
          <button
            className="bingeup-btn-primary bingeup-btn-full"
            onClick={() => void handleAddCustomSite(ctx.hostname, onReload, onNotice)}
          >
            加入当前网站
          </button>
        ) : state.enabled ? (
          <button
            className="bingeup-btn-danger bingeup-btn-full"
            onClick={() => void handleDisable(ctx.hostname, onReload)}
          >
            暂停当前网站
          </button>
        ) : state.showEnablePrompt ? (
          <button
            className="bingeup-btn-primary bingeup-btn-full"
            onClick={() => void handleEnable(ctx.hostname, onReload)}
          >
            开启当前网站
          </button>
        ) : (
          <button
            className="bingeup-btn-primary bingeup-btn-full"
            onClick={() => void handleEnable(ctx.hostname, onReload)}
          >
            启用当前网站
          </button>
        )}

        {state.globallyPaused ? (
          <button
            className="bingeup-btn-secondary bingeup-btn-full"
            onClick={() => void handleResumeAll(onReload)}
          >
            恢复全部
          </button>
        ) : (
          <div className="bingeup-pause-row">
            <button
              className="bingeup-btn-secondary"
              onClick={() => void handlePauseAll(onReload)}
            >
              暂停全部
            </button>
            <button
              className="bingeup-btn-secondary"
              onClick={() => void handlePauseToday(onReload)}
            >
              暂停今天
            </button>
          </div>
        )}

        {/* AC4：入口按钮 */}
        <button
          className="bingeup-btn-primary bingeup-btn-full bingeup-start-action"
          disabled={!state.canControlVideo || state.globallyPaused}
          onClick={() => void handleStartContinuousLearning(ctx.tabId, onNotice)}
        >
          开始连续学习
        </button>
      </div>
    </div>
  );
}

// ─── 动作处理 ──────────────────────────────────────────────

async function handleAddCustomSite(
  hostname: string,
  onReload: () => Promise<void>,
  onNotice: (msg: string | null) => void,
): Promise<void> {
  // Issue #11 AC1：用户主动加入当前网站。先请求可选主机权限，再启用站点。
  try {
    const granted = await chrome.permissions.request({
      origins: [`*://${hostname}/*`, `*://*.${hostname}/*`],
    });
    if (!granted) {
      onNotice('未授予访问权限，无法加入当前网站。');
      return;
    }
    await messageClient.addCustomSite(hostname);
    onNotice('已加入当前网站，请刷新页面以启用学习。');
    await onReload();
  } catch (e) {
    onNotice(`加入失败：${e instanceof Error ? e.message : String(e)}`);
  }
}

async function handleDisable(hostname: string, onReload: () => Promise<void>): Promise<void> {
  await messageClient.disableSite(hostname);
  await onReload();
}

async function handleEnable(hostname: string, onReload: () => Promise<void>): Promise<void> {
  await messageClient.enableSite(hostname);
  await onReload();
}

async function handlePauseAll(onReload: () => Promise<void>): Promise<void> {
  await messageClient.pauseAll();
  await onReload();
}

async function handlePauseToday(onReload: () => Promise<void>): Promise<void> {
  await messageClient.pauseToday(Date.now());
  await onReload();
}

async function handleResumeAll(onReload: () => Promise<void>): Promise<void> {
  await messageClient.resumeAll();
  await onReload();
}

async function handleStartContinuousLearning(
  tabId: number | null,
  onNotice: (msg: string | null) => void,
): Promise<void> {
  if (tabId === null) return;
  const message: ContentMessage = { type: 'START_CONTINUOUS_LEARNING' };
  try {
    await chrome.tabs.sendMessage(tabId, message);
    window.close();
  } catch {
    // AC5：内容脚本未注入（如未刷新或不受支持页面）时提供可理解状态，而非静默失败。
    onNotice('无法开始连续学习，请刷新当前页面后重试。');
  }
}
