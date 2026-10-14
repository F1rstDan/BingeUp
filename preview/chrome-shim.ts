import { DEMO_DEV_DECK_SUMMARY, DEMO_DEV_SNAPSHOT, makeDemoNewWordItem } from './demo-data';
import { previewAssetUrl } from './font-assets';

/**
 * 预览站的 window.chrome 垫片。
 *
 * 让扩展页面组件（PopupApp、FeedbackLink、DevTools 等）在普通网页环境直接运行：
 * - tabs.query 返回当前「活动标签页」场景（预览页按状态切换）；
 * - tabs.create / tabs.sendMessage / runtime.openOptionsPage 提供最小可观察行为；
 * - runtime.getURL 把 files/<name>.woff2 映射到预览站可访问的字体地址（供真实
 *   Shadow DOM 管线里的 FontFace 注册使用），其余路径返回同源 URL；
 * - runtime.sendMessage 只应答开发工具消息（Popup 开发态会加载 DevTools 面板），
 *   其余消息返回错误载荷，与真实 send 的失败形态一致；
 * - permissions 使用内存中的已授权域名集合，供「需权限」等状态切换。
 */

export interface PreviewTabScenario {
  id: number;
  url: string;
}

let activeTabScenario: PreviewTabScenario | null = {
  id: 101,
  url: 'https://www.bilibili.com/video/BV1xx411c7mD',
};

// 默认已授权：两个默认支持站点（含带子域的精确 hostname 与设置页使用的规范 hostname）。
// 自定义站点（如 example.com）保持未授权，用于「需权限」状态与网站管理的权限提示。
const grantedHostnames = new Set<string>([
  'bilibili.com',
  'www.bilibili.com',
  'youtube.com',
  'www.youtube.com',
]);

/** 切换 chrome.tabs.query 返回的活动标签页；null 表示“无活动标签页”。 */
export function setActiveTabScenario(tab: PreviewTabScenario | null): void {
  activeTabScenario = tab === null ? null : { ...tab };
}

export function grantPreviewOrigin(hostname: string): void {
  grantedHostnames.add(hostname);
}

export function revokePreviewOrigin(hostname: string): void {
  grantedHostnames.delete(hostname);
}

function hostnameFromOriginPattern(pattern: string): string {
  return pattern.replace(/^[a-z]+:\/\//i, '').replace(/\/\*$/, '');
}

function isDevToolsMessage(message: unknown): { readonly handled: true; value: unknown } | null {
  if (typeof message !== 'object' || message === null) return null;
  const type = (message as { type?: unknown }).type;
  switch (type) {
    case 'DEV_GET_DECK_SUMMARY':
      return { handled: true, value: DEMO_DEV_DECK_SUMMARY };
    case 'DEV_GET_DATA_SNAPSHOT':
      return { handled: true, value: DEMO_DEV_SNAPSHOT };
    case 'DEV_PREPARE_CARD':
      return { handled: true, value: { ok: true, item: makeDemoNewWordItem() } };
    default:
      return null;
  }
}

// 内存版 chrome.storage.local（预览页不依赖持久化；LocalSettingsStore 的运行时
// 状态读写只在真实扩展里发生，这里保证 API 存在即可）。
const storageValues = new Map<string, unknown>();

const chromeShim = {
  runtime: {
    getURL(path: string): string {
      const normalized = path.replace(/^\//, '');
      if (normalized.startsWith('files/')) return previewAssetUrl(normalized);
      if (normalized === '') return `${location.origin}/`;
      return `${location.origin}/${normalized}`;
    },
    getManifest(): { version: string } {
      return { version: '0.0.1-preview' };
    },
    openOptionsPage(): void {
      console.info(
        '[preview] chrome.runtime.openOptionsPage()（预览页不跳转，请直接查看下方设置页区块）',
      );
    },
    // 返回 Promise 的形态与扩展内一致（预览站不使用回调式 API）。
    sendMessage(message: unknown): Promise<unknown> {
      const devToolsResponse = isDevToolsMessage(message);
      if (devToolsResponse !== null) return Promise.resolve(devToolsResponse.value);
      const type = (message as { type?: unknown } | null)?.type;
      console.info('[preview] chrome.runtime.sendMessage（未实现的消息）', type);
      return Promise.resolve({ __bingeupError: `预览环境未实现的消息：${String(type)}` });
    },
  },
  tabs: {
    query(): Promise<PreviewTabScenario[]> {
      return Promise.resolve(activeTabScenario === null ? [] : [{ ...activeTabScenario }]);
    },
    create(createProperties: { url?: string }): Promise<{ id: number }> {
      console.info('[preview] chrome.tabs.create', createProperties.url);
      return Promise.resolve({ id: 900 });
    },
    // 内容脚本消息：预览页没有内容脚本。
    // - DEV_PING 返回 ok，让开发工具面板进入“页面已就绪”；
    // - DEV_SHOW_CARD 返回失败原因，展示真实失败文案；
    // - START_CONTINUOUS_LEARNING 返回“上下文不可用”，展示 Popup 的降级提示。
    sendMessage(tabId: number, message: unknown): Promise<unknown> {
      const type = (message as { type?: unknown } | null)?.type;
      console.debug('[preview] chrome.tabs.sendMessage', tabId, type);
      if (type === 'DEV_PING') return Promise.resolve({ ok: true });
      if (type === 'DEV_SHOW_CARD') return Promise.resolve({ ok: false, reason: 'failed' });
      if (type === 'START_CONTINUOUS_LEARNING') {
        return Promise.resolve({ ok: false, reason: 'context-unavailable' });
      }
      return Promise.resolve(undefined);
    },
  },
  permissions: {
    contains(details: { origins?: string[] }): Promise<boolean> {
      const origins = details.origins ?? [];
      return Promise.resolve(
        origins.length > 0 &&
          origins.every((origin) => grantedHostnames.has(hostnameFromOriginPattern(origin))),
      );
    },
    request(details: { origins?: string[] }): Promise<boolean> {
      for (const origin of details.origins ?? [])
        grantedHostnames.add(hostnameFromOriginPattern(origin));
      return Promise.resolve(true);
    },
    remove(details: { origins?: string[] }): Promise<boolean> {
      for (const origin of details.origins ?? [])
        grantedHostnames.delete(hostnameFromOriginPattern(origin));
      return Promise.resolve(true);
    },
  },
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>> {
        return Promise.resolve(storageValues.has(key) ? { [key]: storageValues.get(key) } : {});
      },
      set(items: Record<string, unknown>): Promise<void> {
        for (const [key, value] of Object.entries(items)) storageValues.set(key, value);
        return Promise.resolve();
      },
      remove(key: string): Promise<void> {
        storageValues.delete(key);
        return Promise.resolve();
      },
    },
  },
};

/** 安装垫片（在预览页入口最先导入，早于任何组件调用 chrome）。 */
export function installChromeShim(): void {
  (globalThis as { chrome?: unknown }).chrome = chromeShim;
}

installChromeShim();
