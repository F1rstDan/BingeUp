import { test, expect } from './fixtures';

/**
 * 扩展加载与品牌信息（Issue #27）。
 *
 * 验证真实 MV3 扩展能被 Chromium 加载、service worker 注册，且 manifest 携带
 * 完整品牌信息（名称、版本、四档图标）。
 */
test.describe('MV3 扩展加载', () => {
  test('service worker 注册且能解析扩展 ID', async ({ extensionId }) => {
    expect(extensionId).toMatch(/^[a-p]{32}$/);
  });

  test('manifest 携带名称、版本与四档图标', async ({ serviceWorker }) => {
    const manifest = await serviceWorker.evaluate(() => chrome.runtime.getManifest());
    expect(manifest.name).toBe('刷刷升级');
    expect(manifest.version).toBeTruthy();
    expect(manifest.icons).toMatchObject({
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    });
    expect(manifest.action?.default_icon).toBeTruthy();
  });

  test('图标资源已随扩展打包并可读取', async ({ serviceWorker }) => {
    // 图标未列入 web_accessible_resources（无需被宿主页 fetch），
    // 因此从扩展自身 SW 上下文读取，验证四档图标确实打进安装包。
    const results = await serviceWorker.evaluate(async () => {
      const sizes = [16, 32, 48, 128];
      const out: { size: number; ok: boolean; type: string; bytes: number }[] = [];
      for (const size of sizes) {
        const response = await fetch(chrome.runtime.getURL(`icon/${size}.png`));
        const blob = await response.blob();
        out.push({ size, ok: response.ok, type: blob.type, bytes: blob.size });
      }
      return out;
    });
    for (const result of results) {
      expect(result.ok, `icon/${result.size}.png 应可读取`).toBe(true);
      expect(result.type).toContain('image/png');
      expect(result.bytes).toBeGreaterThan(0);
    }
  });
});
