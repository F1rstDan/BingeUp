import { BilibiliAdapter } from '@/adapters/bilibili';
import { YouTubeAdapter } from '@/adapters/youtube';
import type { VideoSiteAdapter } from '@/adapters/types';
import { OverlayController } from '@/content/overlay-controller';
import { ContentController, type CooldownStore, type SiteStatePort } from '@/content/content-controller';
import { showEnablePrompt } from '@/content/enable-prompt';
import { shouldShowEnablePrompt } from '@/onboarding/onboarding-service';
import { adaptHtmlVideo } from '@/video/playback-controller';
import { messageClient } from '@/messaging/message-client';
import type { CooldownState, InteractionOutcome, SiteSettings, VideoChangeEvent } from '@/types';
import { LearningService } from '@/learning/learning-service';
import { BuiltInWordBank } from '@/dictionary/built-in-word-bank';
import { CardRepository } from '@/storage/repositories/card-repository';
import { ReviewLogRepository } from '@/storage/repositories/review-log-repository';
import { openDatabase } from '@/storage/database';
import { MIGRATIONS } from '@/storage/migrations';

const DB_NAME = 'bingeup';

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
 * 专属网站适配器注册表：按顺序匹配，首个匹配者生效。
 * 通用视频与基础网页适配器在后续 Issue 引入后追加到末尾。
 */
const OFFICIAL_ADAPTERS: VideoSiteAdapter[] = [new BilibiliAdapter(), new YouTubeAdapter()];

/**
 * 启动内容侧核心闭环（M0/M4/M6 串联 + Issue #6 学习服务）。
 * 仅在站点已启用且存在匹配的专属适配器时挂载控制器；否则什么都不做。
 */
export async function bootstrapContent(): Promise<void> {
  const hostname = location.hostname;
  const adapter = OFFICIAL_ADAPTERS.find((a) => a.matches(location));
  if (!adapter) {
    console.info('[BingeUp] 内容脚本未启动：当前页面不受支持', hostname);
    return;
  }
  const site = await messageClient.getSiteState(hostname);
  if (!site.enabled) {
    console.info('[BingeUp] 内容脚本未启动：网站已暂停', hostname);
    // AC2：跳过引导后，在受支持但未启用的网站上显示有限启用提示。
    // 引导未完成或拒绝次数已达上限时不显示，避免干扰首次安装体验。
    const data = await messageClient.getPopupData(hostname);
    if (shouldShowEnablePrompt(site, data.onboardingCompleted)) {
      showEnablePrompt(hostname, {
        onEnable: async () => {
          // 启用站点；host_permissions 已在 manifest 中声明，无需额外请求权限。
          // 启用后不立即启动控制器，需刷新或新开页面（AC2）。
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

  // 把完整 VideoSiteAdapter 适配为控制器需要的窄端口。
  // getCurrentVideoEvent 复用适配器的主视频检测逻辑，供主动连续学习入口查询当前视频（AC4）。
  const adapterPort = {
    onVideoChange: (handler: (event: VideoChangeEvent) => void) =>
      adapter.observePageChanges(handler),
    getCurrentVideoEvent(): VideoChangeEvent | null {
      const video = adapter.findPrimaryVideo();
      if (!video) return null;
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
  const db = await openDatabase(DB_NAME, MIGRATIONS);
  const learningService = new LearningService({
    cards: new CardRepository(db),
    logs: new ReviewLogRepository(db),
    words: new BuiltInWordBank(),
    clock: { now: () => Date.now() },
  });

  const overlay = new OverlayController();
  const controller = new ContentController({
    adapter: adapterPort,
    overlay,
    cooldownStore: new MessageCooldownStore(),
    siteState: new MessageSiteState(hostname),
    clock: { now: () => Date.now() },
    videoPortFor: (video) => adaptHtmlVideo(video),
    learningService,
  });
  controller.start();

  // Popup → Content 消息：主动触发连续学习（AC4）。
  // 通过 chrome.tabs.sendMessage 发送，在内容侧用 chrome.runtime.onMessage 接收。
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'START_CONTINUOUS_LEARNING') {
      void controller.startContinuousLearning().then((ok) => {
        sendResponse({ ok });
      });
      return true; // 异步响应
    }
    return false;
  });
}
