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
        <div className="bingeup-title">刷刷升级</div>
        <p className="bingeup-hint">{error}</p>
      </div>
    );
  }

  if (state === null || ctx === null) {
    return (
      <div className="bingeup-popup">
        <div className="bingeup-title">刷刷升级</div>
        <p className="bingeup-hint">加载中…</p>
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
        <div className="bingeup-title">刷刷升级</div>
        <p className="bingeup-hint">
          当前为浏览器受保护页面（{ctx.url}），刷刷升级无法在此运行。
        </p>
      </div>
    );
  }

  // AC5：引导未完成
  if (state.compatibilityLevel === 'not-onboarding') {
    return (
      <div className="bingeup-popup">
        <div className="bingeup-title">刷刷升级</div>
        <p className="bingeup-hint">尚未完成安装引导。</p>
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
        <div className="bingeup-title">刷刷升级</div>
        <div className="bingeup-section">
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

  return (
    <div className="bingeup-popup">
      <div className="bingeup-title">刷刷升级</div>

      {/* AC3：状态显示 */}
      <div className="bingeup-section">
        <div className="bingeup-row">
          <span className="bingeup-label">域名</span>
          <span className="bingeup-value">{state.hostname}</span>
        </div>
        <div className="bingeup-row">
          <span className="bingeup-label">启用状态</span>
          <span
            className={
              'bingeup-value ' +
              (state.enabled ? 'bingeup-status-ok' : 'bingeup-status-off')
            }
          >
            {state.enabled ? '已启用' : '未启用'}
          </span>
        </div>
        <div className="bingeup-row">
          <span className="bingeup-label">兼容等级</span>
          <span className="bingeup-value">{COMPATIBILITY_LABELS[state.compatibilityLevel]}</span>
        </div>
        <div className="bingeup-row">
          <span className="bingeup-label">覆盖方式</span>
          <span className="bingeup-value">
            {state.overlayMode ? OVERLAY_MODE_LABELS[state.overlayMode] ?? '—' : '—'}
          </span>
        </div>
        <div className="bingeup-row">
          <span className="bingeup-label">可控制视频</span>
          <span
            className={
              'bingeup-value ' +
              (state.canControlVideo ? 'bingeup-status-ok' : 'bingeup-status-warn')
            }
          >
            {state.canControlVideo ? '是' : '否'}
          </span>
        </div>
        {state.globallyPaused && (
          <div className="bingeup-row">
            <span className="bingeup-label">全局状态</span>
            <span className="bingeup-value bingeup-status-warn">已暂停</span>
          </div>
        )}
      </div>

      <div className="bingeup-divider" />

      {/* AC4：暂停控制 / Issue #11：加入当前网站 */}
      <div className="bingeup-actions">
        {state.canAddCustomSite ? (
          <button
            className="bingeup-btn-primary bingeup-btn-full"
            onClick={() => void handleAddCustomSite(ctx.hostname, onReload, onNotice)}
          >
            加入当前网站
          </button>
        ) : state.enabled ? (
          <button
            className="bingeup-btn-danger"
            onClick={() => void handleDisable(ctx.hostname, onReload)}
          >
            暂停当前网站
          </button>
        ) : state.showEnablePrompt ? (
          <button
            className="bingeup-btn-primary"
            onClick={() => void handleEnable(ctx.hostname, onReload)}
          >
            开启当前网站
          </button>
        ) : (
          <button
            className="bingeup-btn-primary"
            onClick={() => void handleEnable(ctx.hostname, onReload)}
          >
            启用当前网站
          </button>
        )}

        {state.globallyPaused ? (
          <button
            className="bingeup-btn-secondary"
            onClick={() => void handleResumeAll(onReload)}
          >
            恢复全部
          </button>
        ) : (
          <>
            <button
              className="bingeup-btn-secondary"
              onClick={() => void handlePauseAll(onReload)}
            >
              暂停全部
            </button>
            <button
              className="bingeup-btn-secondary bingeup-btn-full"
              onClick={() => void handlePauseToday(onReload)}
            >
              暂停今天
            </button>
          </>
        )}
      </div>

      <div className="bingeup-divider" />

      {/* AC4：入口按钮 */}
      <div className="bingeup-actions">
        {notice !== null && (
          <p className="bingeup-hint">{notice}</p>
        )}
        <button
          className="bingeup-btn-primary bingeup-btn-full"
          disabled={!state.canControlVideo || state.globallyPaused}
          onClick={() => void handleStartContinuousLearning(ctx.tabId, onNotice)}
        >
          开始连续学习
        </button>
        <button
          className="bingeup-btn-secondary"
          onClick={() => void chrome.runtime.openOptionsPage()}
        >
          设置
        </button>
        <button
          className="bingeup-btn-secondary"
          onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('/stats.html') })}
        >
          统计
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
