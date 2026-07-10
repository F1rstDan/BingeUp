import { BilibiliAdapter } from '@/adapters/bilibili';
import { OverlayController } from '@/content/overlay-controller';
import { ContentController, type CooldownStore, type SiteStatePort } from '@/content/content-controller';
import { adaptHtmlVideo } from '@/video/playback-controller';
import { messageClient } from '@/messaging/message-client';
import type { CooldownState, InteractionOutcome, SiteSettings, VideoChangeEvent } from '@/types';

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
 * 启动内容侧核心闭环（M0/M4/M6 串联）。
 * 仅在站点已启用且适配器匹配时挂载控制器；否则什么都不做。
 */
export async function bootstrapContent(): Promise<void> {
  const hostname = location.hostname;
  const site = await messageClient.getSiteState(hostname);
  if (!site.enabled) {
    return;
  }

  const bilibili = new BilibiliAdapter();
  if (!bilibili.matches(location)) {
    return;
  }
  // 把完整 VideoSiteAdapter 适配为控制器需要的窄端口。
  const adapter = {
    onVideoChange: (handler: (event: VideoChangeEvent) => void) =>
      bilibili.observePageChanges(handler),
  };

  const overlay = new OverlayController();
  const controller = new ContentController({
    adapter,
    overlay,
    cooldownStore: new MessageCooldownStore(),
    siteState: new MessageSiteState(hostname),
    clock: { now: () => Date.now() },
    videoPortFor: (video) => adaptHtmlVideo(video),
  });
  controller.start();
}
