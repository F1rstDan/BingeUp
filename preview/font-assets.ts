/**
 * animal-island-ui 字体资产解析（预览站专用）。
 *
 * 库发布 CSS 的 @font-face 使用相对路径 url("files/<name>.woff2")。扩展构建把路径
 * 改写为 /files/ 公共路径；预览站则把同一批字体以 ?url 交给 Vite 处理（dev 服务器
 * 直接服务，构建时发射为带 hash 的资产），供 Shadow DOM 注入样式与 chrome 垫片的
 * runtime.getURL 共同使用。
 */

const fontModules = import.meta.glob<string>('@island-fonts/*.woff2', {
  eager: true,
  query: '?url',
  import: 'default',
});

const FONT_URL_BY_NAME = new Map<string, string>();
for (const [path, url] of Object.entries(fontModules)) {
  const name = path.split('/').pop();
  if (name !== undefined) FONT_URL_BY_NAME.set(name, url);
}

/** 资产路径（如 files/nunito-latin-500-normal.<hash>.woff2）→ 浏览器可访问的 URL。 */
export function previewAssetUrl(assetPath: string): string {
  const name = assetPath.split('/').pop() ?? assetPath;
  return FONT_URL_BY_NAME.get(name) ?? assetPath;
}
