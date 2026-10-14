import type { Page } from '@playwright/test';

/**
 * 遮罩进入延迟采样方法（工单 #37 引入；工单 #47 抽取为共享实现）。
 *
 * 页面内在 addInitScript 中以 performance.now() 记录：
 * - docStart：文档开始；
 * - hostAt：#bingeup-overlay-host 插入；
 * - overlayAt：.bingeup-card 可见（尺寸大于 0；跨 Shadow Root 用独立 MutationObserver
 *   加 100ms 轮询检测）；
 * - tSend：手动触发（START_CONTINUOUS_LEARNING）发送时刻，仅回退路径使用。
 *
 * migration-baseline.spec.ts（M0 基线）与 migration-m6b-latency.spec.ts（工单 #47 复测）
 * 共用本实现；页面上下文中的状态挂在 window.__bingeupOverlayTiming 上。
 */

export interface OverlayTiming {
  docStart: number;
  tSend: number | null;
  hostAt: number | null;
  overlayAt: number | null;
}

/** 在页面加载前安装延迟采样探针。 */
export async function installOverlayTiming(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state: OverlayTiming = {
      docStart: performance.now(),
      tSend: null,
      hostAt: null,
      overlayAt: null,
    };
    (window as unknown as { __bingeupOverlayTiming?: OverlayTiming }).__bingeupOverlayTiming =
      state;

    const cardVisible = () => {
      const host = document.getElementById('bingeup-overlay-host');
      const card = host?.shadowRoot?.querySelector('.bingeup-card');
      if (!card) return false;
      const rect = card.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const check = () => {
      if (state.overlayAt !== null) return true;
      if (state.hostAt === null && document.getElementById('bingeup-overlay-host')) {
        state.hostAt = performance.now();
      }
      if (!cardVisible()) return false;
      state.overlayAt = performance.now();
      return true;
    };
    // MutationObserver 不会跨越 Shadow Root 边界：宿主出现后必须单独观察 shadowRoot。
    let shadowObserver: MutationObserver | null = null;
    let lightObserver: MutationObserver | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    const cleanup = () => {
      if (poll !== null) clearInterval(poll);
      lightObserver?.disconnect();
      shadowObserver?.disconnect();
    };
    const maybeDone = () => {
      if (check()) cleanup();
    };
    const attachShadowObserver = () => {
      const shadow = document.getElementById('bingeup-overlay-host')?.shadowRoot;
      if (shadow && !shadowObserver) {
        shadowObserver = new MutationObserver(maybeDone);
        shadowObserver.observe(shadow, { childList: true, subtree: true });
      }
      maybeDone();
    };
    const arm = () => {
      lightObserver = new MutationObserver(attachShadowObserver);
      lightObserver.observe(document.documentElement, { childList: true, subtree: true });
      attachShadowObserver();
    };
    poll = setInterval(() => {
      attachShadowObserver();
      maybeDone();
    }, 100);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', arm, { once: true });
    } else {
      arm();
    }
  });
}

/** 读取当前页面的延迟采样状态；未安装时返回 null。 */
export async function readOverlayTiming(page: Page): Promise<OverlayTiming | null> {
  return page.evaluate(() => {
    const state = (window as unknown as { __bingeupOverlayTiming?: OverlayTiming })
      .__bingeupOverlayTiming;
    return state ? { ...state } : null;
  });
}

/** 手动回退路径：记录发送时刻（仅在自然触发失败时使用）。 */
export async function markOverlayTimingSend(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = (window as unknown as { __bingeupOverlayTiming?: OverlayTiming })
      .__bingeupOverlayTiming;
    if (state) state.tSend = performance.now();
  });
}

/** 等待遮罩卡片可见（overlayAt 有值）；超时返回 false。 */
export async function waitForOverlayCard(page: Page, timeout: number): Promise<boolean> {
  return page
    .waitForFunction(
      () => {
        const state = (window as unknown as { __bingeupOverlayTiming?: OverlayTiming })
          .__bingeupOverlayTiming;
        return state?.overlayAt !== null && state?.overlayAt !== undefined;
      },
      undefined,
      { timeout },
    )
    .then(() => true)
    .catch(() => false);
}
