import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button, Card, Switch, Tag, type TagColor } from 'animal-island-ui';
import {
  AlertTriangleIcon,
  BanIcon,
  CheckCircleIcon,
  PauseIcon,
  PlayIcon,
  SettingsIcon,
  type IconComponent,
} from 'naive-icons';
import mascotUrl from '@/assets/level-up-mascot.png';
import { messageClient } from '@/messaging/message-client';
import {
  derivePopupState,
  type PopupCompatibilityLevel,
  type PopupDisplayState,
} from '@/popup/popup-state';
import { endOfToday, PAUSE_TEN_MINUTES_MS } from '@/pause/pause-rules';
import type {
  ContentMessage,
  PopupLearningStats,
  StartLearningFailureReason,
  StartLearningResponse,
} from '@/messaging/messages';
import { addWebsite } from '@/sites/site-access';
import { hasExactHttpsPermission } from '@/sites/site-permission';
import { FeedbackLink } from '@/ui/FeedbackLink';
import { IslandPage, IslandSection } from '@/ui/island';

/**
 * 开发工具只在开发服务器的 Popup 中加载。
 * 生产构建通过 import.meta.env.DEV 消除这个分支，避免把开发 UI 与消息词串带入包。
 */
const DevTools = import.meta.env.DEV
  ? lazy(() =>
      import('@/ui/popup/DevTools').then(({ DevTools: component }) => ({ default: component })),
    )
  : null;

function DevToolsSlot(): JSX.Element | null {
  if (DevTools === null) return null;
  return (
    <Suspense fallback={null}>
      <DevTools />
    </Suspense>
  );
}

/**
 * Popup 面板（Issue #9 AC3 / AC4 / AC5 / Issue #21 AC3/AC6 / 工单 #39 M2 完整迁移）。
 *
 * AC3：显示当前域名、启用状态与兼容等级。
 * AC4：暂停 10 分钟 / 暂停今天 / 恢复当前全局暂停 / 开始连续学习 / 设置 / 统计。
 * AC5：受保护页面、缺少权限时提供可理解状态而非静默失败。
 * Issue #21 AC3/AC6：未完成安装引导不阻止 Popup 显示正常网站状态与控制。
 * 工单 #39：全部可见区域采用 Animal Island UI 原版视觉（图标来自 naive-icons），
 * 页面外壳与区块复用 @/ui/island 基础模块；消息链路与业务判定保持不变。
 */

const COMPATIBILITY_LABELS: Record<PopupCompatibilityLevel, string> = {
  'full-adaptation': '完整适配',
  'generic-video': '通用视频',
  'basic-web': '基础网页',
  unsupported: '不支持',
  protected: '受保护页面',
  'needs-permission': '需要权限',
};

interface PopupContext {
  hostname: string;
  url: string;
  tabId: number | null;
}

type PopupSiteStatusTone = 'ready' | 'paused' | 'warning' | 'blocked' | 'inactive';
type PopupPauseMode = 'none' | 'ten-minutes' | 'today';

function PopupHeader(): JSX.Element {
  return (
    <header className="bingeup-header">
      <div className="bingeup-brand" aria-label="刷刷升级">
        <img className="bingeup-brand-mascot" src={mascotUrl} alt="" aria-hidden="true" />
        <strong>刷刷升级</strong>
      </div>
      <Button
        type="text"
        size="small"
        aria-label="设置"
        title="设置"
        icon={<SettingsIcon size={18} color="currentColor" />}
        onClick={() => void chrome.runtime.openOptionsPage()}
      />
    </header>
  );
}

function popupSiteStatusTone(state: PopupDisplayState): PopupSiteStatusTone {
  if (state.globallyPaused) return 'paused';
  if (state.enabled) return 'ready';
  if (state.compatibilityLevel === 'needs-permission') return 'warning';
  if (state.compatibilityLevel === 'unsupported') return 'blocked';
  return 'inactive';
}

/** 状态图标一律来自 naive-icons，颜色跟随所在行的 island 状态色。 */
const SITE_STATUS_ICONS: Record<PopupSiteStatusTone, IconComponent> = {
  ready: CheckCircleIcon,
  paused: PauseIcon,
  warning: AlertTriangleIcon,
  blocked: BanIcon,
  inactive: PlayIcon,
};

function popupSiteBadge(state: PopupDisplayState): string {
  if (state.globallyPaused) return '已暂停';
  if (state.enabled) return '可学习';
  if (state.compatibilityLevel === 'unsupported') return '不可用';
  if (state.compatibilityLevel === 'needs-permission') return '需权限';
  return '待启用';
}

/** 站点状态 Tag 颜色：保持暖色/薄荷原版观感，不用旧蓝粉。 */
function popupSiteTagColor(state: PopupDisplayState): TagColor {
  if (state.globallyPaused) return 'app-yellow';
  if (state.enabled) return 'app-teal';
  if (state.compatibilityLevel === 'unsupported') return 'app-red';
  return 'default';
}

function popupCapabilitySummary(state: PopupDisplayState): string {
  const overlay =
    state.overlayMode === 'video-region'
      ? '视频区域覆盖'
      : state.overlayMode === 'full-page'
        ? '全页覆盖'
        : '无学习遮罩';
  return `${overlay} · ${state.canControlVideo ? '可控制视频' : '不控制视频'}`;
}

function startLearningUnavailableReason(
  state: PopupDisplayState,
  isPaused: boolean,
): string | null {
  if (state.canAddCustomSite) return '请先加入当前网站。';
  if (state.compatibilityLevel === 'unsupported') return '当前网站不支持学习。';
  if (!state.enabled) return '请先启用当前网站。';
  if (isPaused) return '全局暂停期间无法开始学习。';
  return null;
}

interface PopupSiteStatusCardProps {
  tone: PopupSiteStatusTone;
  hostname: string;
  statusLine: ReactNode;
  capabilityLine?: string;
  badge?: { text: string; color: TagColor };
  control?: ReactNode;
}

/**
 * 站点状态卡片：原版 Card 承载状态，naive-icons 状态图标 + Tag 徽标 + Button/Switch 操作。
 * 只做布局与文案组装，站点判定与消息链路仍在 PopupView 中。
 */
function PopupSiteStatusCard({
  tone,
  hostname,
  statusLine,
  capabilityLine,
  badge,
  control,
}: PopupSiteStatusCardProps): JSX.Element {
  const StatusIcon = SITE_STATUS_ICONS[tone];
  return (
    <section className="bingeup-site-status" aria-label="当前网站状态">
      <Card className="bingeup-site-card">
        <div className="bingeup-site-status-row">
          <span className={`bingeup-site-icon bingeup-site-icon-${tone}`} aria-hidden="true">
            <StatusIcon size={18} color="currentColor" />
          </span>
          <div className="bingeup-site-copy">
            <strong>{hostname}</strong>
            <span>{statusLine}</span>
            {capabilityLine !== undefined && <span>{capabilityLine}</span>}
          </div>
          <div className="bingeup-site-control">
            {badge !== undefined && (
              <Tag size="small" color={badge.color}>
                {badge.text}
              </Tag>
            )}
            {control}
          </div>
        </div>
      </Card>
    </section>
  );
}

function DisabledStartLearning({ reason }: { reason: string }): JSX.Element {
  return (
    <div className="bingeup-actions">
      <Button type="primary" size="large" block disabled aria-describedby="bingeup-start-reason">
        开始学习
      </Button>
      <p id="bingeup-start-reason" className="bingeup-hint">
        {reason}
      </p>
    </div>
  );
}

function popupPauseMode(until: number, now: number): PopupPauseMode {
  if (until <= now) return 'none';
  if (until === endOfToday(now)) return 'today';
  if (until - now <= PAUSE_TEN_MINUTES_MS) return 'ten-minutes';
  return 'none';
}

function formatCountdown(until: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((until - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

export function PopupApp(): JSX.Element {
  const [state, setState] = useState<PopupDisplayState | null>(null);
  const [ctx, setCtx] = useState<PopupContext | null>(null);
  const [stats, setStats] = useState<PopupLearningStats | undefined>(undefined);
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
      const hasHostPermission = await hasExactHttpsPermission(hostname);
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
      setStats(data.stats);
      setError(null);
    } catch (e) {
      setError(`加载失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const updatePauseState = useCallback((globalPausedUntil: number) => {
    setState((current) =>
      current === null
        ? current
        : {
            ...current,
            globalPausedUntil,
            globallyPaused: globalPausedUntil > Date.now(),
          },
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error !== null) {
    return (
      <IslandPage className="bingeup-popup">
        <PopupHeader />
        <Card className="bingeup-state-card">
          <p className="bingeup-hint bingeup-error">{error}</p>
        </Card>
        <DevToolsSlot />
      </IslandPage>
    );
  }

  if (state === null || ctx === null) {
    return (
      <IslandPage className="bingeup-popup">
        <PopupHeader />
        <Card className="bingeup-state-card">
          <p className="bingeup-hint">加载中…</p>
        </Card>
        <DevToolsSlot />
      </IslandPage>
    );
  }

  return (
    <PopupView
      state={state}
      ctx={ctx}
      stats={stats}
      notice={notice}
      onReload={load}
      onPauseStateChange={updatePauseState}
      onNotice={setNotice}
    />
  );
}

interface PopupViewProps {
  state: PopupDisplayState;
  ctx: PopupContext;
  stats: PopupLearningStats | undefined;
  notice: string | null;
  onReload: () => Promise<void>;
  onPauseStateChange: (globalPausedUntil: number) => void;
  onNotice: (msg: string | null) => void;
}

function PopupView({
  state,
  ctx,
  stats,
  notice,
  onReload,
  onPauseStateChange,
  onNotice,
}: PopupViewProps): JSX.Element {
  const [clockNow, setClockNow] = useState(() => Date.now());
  const pauseMode = popupPauseMode(state.globalPausedUntil, clockNow);
  const applyPauseStateChange = useCallback(
    (globalPausedUntil: number) => {
      // 暂停截止时间在后台响应时生成；同步刷新基准时间，避免几毫秒误差被判成无限期暂停。
      setClockNow(Date.now());
      onPauseStateChange(globalPausedUntil);
    },
    [onPauseStateChange],
  );

  useEffect(() => {
    if (pauseMode !== 'ten-minutes' && pauseMode !== 'today') return undefined;
    let reloadRequested = false;
    const timer = window.setInterval(() => {
      const nextNow = Date.now();
      setClockNow(nextNow);
      if (nextNow >= state.globalPausedUntil && !reloadRequested) {
        reloadRequested = true;
        void onReload();
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [onReload, pauseMode, state.globalPausedUntil]);

  // AC5：受保护页面
  if (state.isProtectedPage) {
    return (
      <IslandPage className="bingeup-popup">
        <PopupHeader />
        <Card className="bingeup-state-card">
          <strong className="bingeup-state-title">当前页面不可用</strong>
          <p className="bingeup-hint">
            当前为浏览器受保护页面（{ctx.url}），刷刷升级无法在此运行。
          </p>
        </Card>
        <DisabledStartLearning reason="当前页面不支持学习。" />
        <DevToolsSlot />
      </IslandPage>
    );
  }

  // Issue #21 AC3/AC6：未完成安装引导不再阻止 Popup 显示正常网站状态。
  // 受保护页面之外的所有页面都按正常状态展示，引导状态只作为信息字段保留。

  // AC5：缺少主机权限
  if (state.compatibilityLevel === 'needs-permission') {
    return (
      <IslandPage className="bingeup-popup">
        <PopupHeader />
        <PopupSiteStatusCard
          tone="warning"
          hostname={state.hostname}
          statusLine="未启用 · 需要权限"
          badge={{ text: '需权限', color: 'app-yellow' }}
        />
        <Card className="bingeup-state-card">
          <div className="bingeup-row">
            <span className="bingeup-label">域名</span>
            <span className="bingeup-value">{state.hostname}</span>
          </div>
          <p className="bingeup-hint">
            当前网站缺少主机权限，请在扩展管理页授予访问权限后刷新页面。
          </p>
          <p className="bingeup-hint">需要权限 · 无学习遮罩 · 不控制视频</p>
        </Card>
        <DisabledStartLearning reason="请先授予当前网站访问权限。" />
        <DevToolsSlot />
      </IslandPage>
    );
  }

  const isPaused = pauseMode !== 'none';
  const displayState =
    state.globallyPaused === isPaused ? state : { ...state, globallyPaused: isPaused };
  const siteStatusTone = popupSiteStatusTone(displayState);
  const startUnavailableReason = startLearningUnavailableReason(displayState, isPaused);
  const siteControl = displayState.canAddCustomSite ? (
    <Button
      size="small"
      type="primary"
      onClick={() => void handleAddCustomSite(ctx.hostname, onReload, onNotice)}
    >
      加入当前网站
    </Button>
  ) : displayState.compatibilityLevel !== 'unsupported' ? (
    <Switch
      checked={displayState.enabled}
      aria-label={displayState.enabled ? '关闭当前网站' : '开启当前网站'}
      onChange={(checked) =>
        void handleSiteEnabledChange(ctx.hostname, checked, onReload, onNotice)
      }
    />
  ) : null;

  return (
    <IslandPage className="bingeup-popup">
      <PopupHeader />

      {/* AC3：当前网站状态 */}
      <PopupSiteStatusCard
        tone={siteStatusTone}
        hostname={displayState.hostname || '当前页面'}
        statusLine={
          <>
            <b>
              {displayState.globallyPaused ? '已暂停' : displayState.enabled ? '已启用' : '未启用'}
            </b>
            {' · '}
            <span>{COMPATIBILITY_LABELS[displayState.compatibilityLevel]}</span>
          </>
        }
        capabilityLine={popupCapabilitySummary(displayState)}
        badge={
          displayState.canAddCustomSite
            ? undefined
            : { text: popupSiteBadge(displayState), color: popupSiteTagColor(displayState) }
        }
        control={siteControl}
      />

      <IslandSection
        title="今日学习"
        actions={
          <Button
            type="text"
            size="small"
            aria-label="查看统计"
            onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('/stats.html') })}
          >
            统计
          </Button>
        }
      >
        <div className="bingeup-metrics">
          <div className="bingeup-metric">
            <strong>{stats?.today.completedQuestions ?? '—'}</strong>
            <span>今日自然完成题目</span>
          </div>
          <div className="bingeup-metric">
            <strong>{stats?.today.reviewedWords ?? '—'}</strong>
            <span>今日复习词</span>
          </div>
          <div className="bingeup-metric">
            <strong>{stats?.today.newWords ?? '—'}</strong>
            <span>今日新词</span>
          </div>
          <div className="bingeup-metric">
            <strong>{stats?.today.continuousSessions ?? '—'}</strong>
            <span>今日连续学习次数</span>
          </div>
          <div className="bingeup-metric">
            <strong>{stats?.today.continuousQuestions ?? '—'}</strong>
            <span>今日连续完成题目</span>
          </div>
          <div className="bingeup-metric">
            <strong>{stats?.today.longTermCompleted ?? '—'}</strong>
            <span>今日长期复习题目</span>
          </div>
          <div className="bingeup-metric">
            <strong>
              {stats?.today.longTermAccuracy === undefined || stats.today.longTermCompleted === 0
                ? '—'
                : `${Math.round(stats.today.longTermAccuracy * 100)}%`}
            </strong>
            <span>今日长期复习正确率</span>
          </div>
        </div>
      </IslandSection>

      {/* AC4：暂停控制 / Issue #11：加入当前网站 */}
      <div className="bingeup-actions">
        {notice !== null && (
          <Card className="bingeup-notice">
            <p className="bingeup-notice-text" role="status">
              {notice}
            </p>
          </Card>
        )}
        <div className="bingeup-pause-row">
          <Button
            block
            onClick={() =>
              void handlePauseTenMinutes(pauseMode === 'ten-minutes', applyPauseStateChange)
            }
          >
            {pauseMode === 'ten-minutes'
              ? `恢复 ${formatCountdown(state.globalPausedUntil, clockNow)}`
              : '暂停 10 分钟'}
          </Button>
          <Button
            block
            onClick={() => void handlePauseToday(pauseMode === 'today', applyPauseStateChange)}
          >
            {pauseMode === 'today' ? '今天恢复' : '暂停今天'}
          </Button>
        </div>

        {/* AC4：入口按钮 */}
        <Button
          type="primary"
          size="large"
          block
          disabled={startUnavailableReason !== null}
          aria-describedby={startUnavailableReason === null ? undefined : 'bingeup-start-reason'}
          onClick={() => void handleStartContinuousLearning(ctx.tabId, onNotice)}
        >
          开始学习
        </Button>
        {startUnavailableReason !== null && (
          <p id="bingeup-start-reason" className="bingeup-hint">
            {startUnavailableReason}
          </p>
        )}
      </div>

      <DevToolsSlot />
      <FeedbackLink />
    </IslandPage>
  );
}

// ─── 动作处理 ──────────────────────────────────────────────

async function handleAddCustomSite(
  hostname: string,
  onReload: () => Promise<void>,
  onNotice: (msg: string | null) => void,
): Promise<void> {
  const result = await addWebsite(hostname);
  if (!result.ok) {
    onNotice(result.message);
    return;
  }
  onNotice(
    result.status === 'already-enabled'
      ? '当前网站已启用。'
      : '已加入当前网站，请刷新页面以启用学习。',
  );
  await onReload();
}

async function handleSiteEnabledChange(
  hostname: string,
  nextEnabled: boolean,
  onReload: () => Promise<void>,
  onNotice: (msg: string | null) => void,
): Promise<void> {
  try {
    await messageClient.setSiteEnabled(hostname, nextEnabled);
    onNotice(nextEnabled ? '已开启当前网站。' : '已关闭当前网站。');
    await onReload();
  } catch (error) {
    onNotice(`网站状态更新失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handlePauseTenMinutes(
  isPaused: boolean,
  onPauseStateChange: (globalPausedUntil: number) => void,
): Promise<void> {
  const response = isPaused
    ? await messageClient.resumeGlobalPause()
    : await messageClient.pauseTenMinutes();
  onPauseStateChange(response.globalPausedUntil);
}

async function handlePauseToday(
  isPaused: boolean,
  onPauseStateChange: (globalPausedUntil: number) => void,
): Promise<void> {
  const response = isPaused
    ? await messageClient.resumeGlobalPause()
    : await messageClient.pauseToday(Date.now());
  onPauseStateChange(response.globalPausedUntil);
}

async function handleStartContinuousLearning(
  tabId: number | null,
  onNotice: (msg: string | null) => void,
): Promise<void> {
  if (tabId === null) return;
  const message: ContentMessage = { type: 'START_CONTINUOUS_LEARNING' };
  try {
    const response = (await chrome.tabs.sendMessage(tabId, message)) as
      StartLearningResponse | undefined;
    if (response?.ok) {
      window.close();
      return;
    }
    onNotice(startLearningFailureMessage(response?.reason));
  } catch {
    // AC5：内容脚本未注入（如未刷新或不受支持页面）时提供可理解状态，而非静默失败。
    onNotice('无法开始学习：页面尚未就绪，请刷新当前页面后重试。');
  }
}

function startLearningFailureMessage(reason?: StartLearningFailureReason): string {
  switch (reason) {
    case 'globally-paused':
      return '全局暂停期间无法开始学习。';
    case 'interaction-active':
      return '当前已有学习界面。';
    case 'context-unavailable':
      return '当前页面尚未准备好学习上下文。';
    case 'no-learning-content':
      return '暂无可学习内容。';
    case 'failed':
      return '无法开始学习，请稍后重试。';
    default:
      return '无法开始学习：页面尚未就绪，请刷新当前页面后重试。';
  }
}
