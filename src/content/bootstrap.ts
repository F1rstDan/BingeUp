import { BilibiliAdapter } from '@/adapters/bilibili';
import { YouTubeAdapter } from '@/adapters/youtube';
import { GenericVideoAdapter } from '@/adapters/generic-video';
import { BasicWebAdapter } from '@/adapters/basic-web';
import { detectSiteCapability } from '@/adapters/generic-video/detection';
import type { VideoSiteAdapter } from '@/adapters/types';
import { OverlayController } from '@/content/overlay-controller';
import {
  ContentController,
  type CooldownStore,
  type PauseStatePort,
  type SiteStatePort,
} from '@/content/content-controller';
import { showEnablePrompt } from '@/content/enable-prompt';
import { shouldShowEnablePrompt } from '@/onboarding/onboarding-service';
import { adaptHtmlVideo } from '@/video/playback-controller';
import { messageClient } from '@/messaging/message-client';
import type { CooldownState, InteractionOutcome, SiteSettings, VideoChangeEvent } from '@/types';
import { LearningService } from '@/learning/learning-service';
import { BuiltInWordBank } from '@/dictionary/built-in-word-bank';
import { CardRepository } from '@/storage/repositories/card-repository';
import { ReviewLogRepository } from '@/storage/repositories/review-log-repository';
import { SessionLogRepository } from '@/storage/repositories/session-log-repository';
import { openDatabase } from '@/storage/database';
import { DATABASE_NAME, MIGRATIONS } from '@/storage/migrations';
import { isGloballyPaused } from '@/pause/pause-rules';

/**
 * 消息驱动的冷却存储：Content 通过 background 读写共享冷却状态。
 * 冷却规则在 background service worker 中计算（单一来源）。
 */
export class MessageCooldownStore implements CooldownStore {
  async get(): Promise<CooldownState> {
    return messageClient.getCooldownStatus();
  }

  async recordOutcome(outcome: InteractionOutcome): Promise<void> {
    if (outcome === 'submitted') {
      await messageClient.completeQuestion();
    } else {
      await messageClient.skipQuestion();
    }
  }
}

/** 内容侧主动学习的全局暂停检查。 */
export class MessagePauseState implements PauseStatePort {
  async isGloballyPaused(): Promise<boolean> {
    const { globalPausedUntil } = await messageClient.getGlobalPauseStatus();
    return isGloballyPaused(globalPausedUntil, Date.now());
  }
}

/** 消息驱动的站点状态端口。 */
export class MessageSiteState implements SiteStatePort {
  private cached: SiteSettings | null = null;

  constructor(private readonly hostname: string) {}

  private async fetch(): Promise<SiteSettings> {
    if (this.cached !== null) return this.cached;
    this.cached = await messageClient.getSiteState(this.hostname);
    return this.cached;
  }

  async isFirstQuestionPending(): Promise<boolean> {
    const site = await this.fetch();
    return site.enabled && site.firstQuestionPending;
  }

  async markFirstQuestionHandled(): Promise<void> {
    this.cached = await messageClient.markFirstQuestionHandled(this.hostname);
  }
}

/**
 * 专属网站适配器注册表：按顺序匹配，首个匹配者生效（Issue #3 / #4）。
 */
const OFFICIAL_ADAPTERS: VideoSiteAdapter[] = [new BilibiliAdapter(), new YouTubeAdapter()];

/**
 * 启动内容侧核心闭环（M0/M4/M6 串联 + Issue #6 学习服务 + Issue #11 自定义网站）。
 *
 * 官方站点（Bilibili/YouTube）：使用专属适配器，host_permissions 在 manifest 中声明。
 * 自定义站点（Issue #11）：用户从 Popup 主动加入后，按能力检测选择通用视频或基础网页适配器。
 */
export async function bootstrapContent(): Promise<void> {
  const hostname = location.hostname;

  // 1. 尝试官方适配器
  const officialAdapter = OFFICIAL_ADAPTERS.find((a) => a.matches(location));
  if (officialAdapter) {
    return bootstrapOfficialSite(officialAdapter, hostname);
  }

  // 2. 自定义站点（Issue #11）
  return bootstrapCustomSite(hostname);
}

/** 官方站点启动流程：专属适配器 + 启用提示。 */
async function bootstrapOfficialSite(adapter: VideoSiteAdapter, hostname: string): Promise<void> {
  const site = await messageClient.getSiteState(hostname);
  if (!site.enabled) {
    console.info('[BingeUp] 内容脚本未启动：网站已暂停', hostname);
    // AC2：跳过引导后，在受支持但未启用的网站上显示有限启用提示。
    const data = await messageClient.getPopupData(hostname);
    if (shouldShowEnablePrompt(site, data.onboardingCompleted)) {
      showEnablePrompt(hostname, {
        onEnable: async () => {
          await messageClient.enableSite(hostname);
        },
        onDismiss: async () => {
          await messageClient.recordPromptDecline(hostname);
        },
      });
    }
    return;
  }
  console.info('[BingeUp] 内容脚本已启动，等待有效主视频', { hostname, adapter: adapter.id });
  try {
    await startController(adapter, hostname);
  } catch (error) {
    // 专属规则失效时，不让单一页面把学习流程卡死：依次尝试通用视频和基础网页。
    console.error('[BingeUp] 专属适配启动失败，正在降级', { hostname, adapter: adapter.id, error });
    await startOfficialFallbackController(hostname, site);
  }
}

/** 专属适配无法启动时的安全降级链：通用视频 → 基础网页。 */
async function startOfficialFallbackController(
  hostname: string,
  site: SiteSettings,
): Promise<void> {
  try {
    if (detectSiteCapability() === 'generic-video') {
      await startController(new GenericVideoAdapter(), hostname);
      return;
    }
  } catch (error) {
    console.error('[BingeUp] 通用视频降级失败，继续使用基础网页模式', { hostname, error });
  }

  await startController(
    new BasicWebAdapter({
      pageLoadTrigger: site.pageLoadTrigger ?? true,
      scrollTrigger: site.scrollTrigger ?? true,
    }),
    hostname,
  );
}

/**
 * 自定义站点启动流程（Issue #11）。
 *
 * AC1：未授权（未启用 / unsupported）站点不注入正式学习交互。
 * AC4：能力检测——重新检测并在模式变化时回写，识别失败降级为基础网页模式。
 */
async function bootstrapCustomSite(hostname: string): Promise<void> {
  const site = await messageClient.getSiteState(hostname);

  // AC1：未启用或不支持的站点不启动控制器。
  if (!site.enabled || site.mode === 'unsupported') {
    console.info('[BingeUp] 内容脚本未启动：自定义站点未启用或不支持', hostname);
    return;
  }

  // AC4：能力检测——重新检测当前页面的实际能力，并在模式变化时回写。
  const detectedMode = detectSiteCapability();
  if (detectedMode !== site.mode) {
    await messageClient.updateSiteMode(hostname, detectedMode);
  }

  // 根据检测到的模式创建适配器。
  let adapter: VideoSiteAdapter | null = null;
  if (detectedMode === 'generic-video') {
    adapter = new GenericVideoAdapter();
  } else if (detectedMode === 'basic-web') {
    adapter = new BasicWebAdapter({
      pageLoadTrigger: site.pageLoadTrigger ?? true,
      scrollTrigger: site.scrollTrigger ?? true,
    });
  }

  if (!adapter) {
    console.info('[BingeUp] 内容脚本未启动：无法确定适配器', hostname);
    return;
  }

  console.info('[BingeUp] 内容脚本已启动（自定义站点）', {
    hostname,
    adapter: adapter.id,
    mode: detectedMode,
  });
  await startController(adapter, hostname);
}

/**
 * 把完整 VideoSiteAdapter 适配为控制器需要的窄端口，初始化学习服务并启动控制器。
 *
 * getCurrentLearningContext 复用适配器的主视频检测逻辑；基础网页模式则返回
 * video=null 的文档根上下文，供插件面板主动启动全网页学习界面（Issue #16）。
 */
async function startController(adapter: VideoSiteAdapter, hostname: string): Promise<void> {
  const adapterPort = {
    onVideoChange: (handler: (event: VideoChangeEvent) => void) =>
      adapter.observePageChanges(handler),
    getCurrentLearningContext(): VideoChangeEvent | null {
      const video = adapter.findPrimaryVideo();
      if (!video) {
        if (adapter.id !== 'basic-web') return null;
        return {
          identity: `basic-web:manual:${location.href}:${Date.now()}`,
          video: null,
          overlayTarget: document.documentElement,
          overlayMode: 'full-page',
        };
      }
      if (adapter.isAdvertisement(video) || adapter.isPreview(video)) return null;
      const identity = adapter.getVideoIdentity(video);
      if (!identity) return null;
      return {
        identity,
        video,
        overlayTarget: adapter.getOverlayTarget(video),
        overlayMode: adapter.getOverlayMode(),
      };
    },
  };

  // 初始化学习服务（IDB 仓库 + 内置词库）。
  const db = await openDatabase(DATABASE_NAME, MIGRATIONS);
  const appSettings = await messageClient.getAppSettings();
  const learningService = new LearningService({
    cards: new CardRepository(db),
    logs: new ReviewLogRepository(db),
    words: new BuiltInWordBank(),
    clock: { now: () => Date.now() },
    dailyNewWordLimit: appSettings.dailyNewWordLimit,
    selectedDeckId: appSettings.selectedDeckId,
    selfRatedLevel: appSettings.selfRatedLevel,
  });

  const overlay = new OverlayController();
  const controller = new ContentController({
    adapter: adapterPort,
    overlay,
    cooldownStore: new MessageCooldownStore(),
    pauseState: new MessagePauseState(),
    siteState: new MessageSiteState(hostname),
    clock: { now: () => Date.now() },
    videoPortFor: (video) => adaptHtmlVideo(video),
    learningService,
    sessionLogger: new SessionLogRepository(db),
    spellingEnabled: appSettings.spellingEnabled,
  });
  controller.start();

  // Popup → Content 消息：主动触发连续学习（AC4）。
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'START_CONTINUOUS_LEARNING') {
      void controller
        .startContinuousLearning()
        .then((result) => {
          sendResponse(result);
        })
        .catch((error) => {
          console.error('[BingeUp] 主动学习启动失败', error);
          sendResponse({ ok: false, reason: 'failed' });
        });
      return true; // 异步响应
    }
    return false;
  });
}
