import islandCss from 'animal-island-ui/dist/index.css?raw';

/**
 * M4 Shadow DOM 样式与字体装载（工单 #43）。
 *
 * 内容脚本看不到宿主页样式，也用不到扩展页面的 :root 令牌；本模块把
 * animal-island-ui 的发布 CSS（构建期经 Vite 的 ?raw 查询内联为字符串）转换成可直接
 * 注入 ShadowRoot 的字符串，并产出需要以 FontFace API 注册的字体清单：
 *
 * - 只把顶层 :root 令牌声明段受控映射为 :host。这里使用项目内的小型受控扫描器
 *   （按字符串/注释/括号配对处理），既不把 postcss 打进内容脚本，也不做整表正则替换；
 * - 字体等相对资源 url() 重写为 chrome.runtime.getURL 的 chrome-extension 绝对路径；
 *   data: URI 与 #fragment 引用保持原样。字体文件由 wxt.config.ts 的 build:publicAssets
 *   按库内相对路径 files/ 原样复制到产物，并在最小范围的 web_accessible_resources 中声明；
 * - 实测：Chromium 不加载 ShadowRoot 内声明的 @font-face（连字体请求都不会发出），
 *   因此字体必须以 FontFace API 注册到 document.fonts（registerIslandFontFaces）；
 *   注入样式里保留同构的 @font-face 规则，作为对支持该行为的实现的向前兼容；
 * - 选用 ?raw 而非 ?inline 的原因（实测）：WXT 以 Vite lib/IIFE 模式构建 content script，
 *   lib 模式会把 ?inline CSS 引用的字体资产强制 base64 内联（assetsInlineLimit 无效，
 *   实测 content.js 由 208 KB 膨胀到 5.1 MB，且每次注入 ShadowRoot 的样式多达约 4.6 MB）；
 *   ?raw 保持字体为独立文件、按需加载，样式串仅约 126 KB；
 * - 结果缓存：首次注入解析一次，重复打开遮罩不重复解析。
 */

export interface IslandShadowStyleDeps {
  /** 构建期处理后的库 CSS 字符串。 */
  css: string;
  /** 扩展内相对资源路径（已去掉前导 ./ 或 /）到 chrome-extension 绝对 URL。 */
  toExtensionUrl: (assetPath: string) => string;
}

/** 需要以 FontFace API 注册的字体描述（src 已重写为 chrome-extension 绝对 URL）。 */
export interface IslandFontFaceDescriptor {
  family: string;
  style: string;
  weight: string;
  display: string;
  /** FontFace 构造器可用的 src 值，如 url("chrome-extension://...") format("woff2")。 */
  source: string;
}

export interface IslandShadowStyleBundle {
  /** 可直接注入 ShadowRoot 的 CSS 字符串。 */
  css: string;
  /** Chromium 不读取 ShadowRoot 内 @font-face，需另行注册到 document.fonts 的字体。 */
  fontFaces: IslandFontFaceDescriptor[];
}

export interface IslandShadowStyles {
  /** 返回可注入 CSS 与字体清单（带缓存）。 */
  getBundle(): IslandShadowStyleBundle;
  /** 返回可直接注入 ShadowRoot 的 CSS 字符串（带缓存）。 */
  getCss(): string;
  /** 返回需以 FontFace API 注册的字体清单（带缓存）。 */
  getFontFaces(): IslandFontFaceDescriptor[];
}

/** 跳过字符串字面量，返回结束引号之后的下标。 */
function skipString(css: string, from: number): number {
  const quote = css[from];
  let index = from + 1;
  while (index < css.length) {
    const char = css[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === quote) return index + 1;
    index += 1;
  }
  return css.length;
}

/** 跳过注释，返回注释结束之后的下标。 */
function skipComment(css: string, from: number): number {
  const end = css.indexOf('*/', from + 2);
  return end === -1 ? css.length : end + 2;
}

/** 找到下一个未处于字符串或注释中的 { 下标。 */
function findNextOpenBrace(css: string, from: number): number {
  let index = from;
  while (index < css.length) {
    const char = css[index]!;
    if (char === '"' || char === "'") {
      index = skipString(css, index);
      continue;
    }
    if (char === '/' && css[index + 1] === '*') {
      index = skipComment(css, index);
      continue;
    }
    if (char === '{') return index;
    index += 1;
  }
  return -1;
}

/** 找到与 openIndex 处 { 配对的 } 下标；缺失时返回 css.length。 */
function findBlockEnd(css: string, openIndex: number): number {
  let depth = 0;
  let index = openIndex;
  while (index < css.length) {
    const char = css[index]!;
    if (char === '"' || char === "'") {
      index = skipString(css, index);
      continue;
    }
    if (char === '/' && css[index + 1] === '*') {
      index = skipComment(css, index);
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }
  return css.length;
}

/** 按顶层分号拆分声明，忽略字符串、注释与括号内的分号。 */
function splitDeclarations(content: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let index = 0;
  let depth = 0;
  while (index < content.length) {
    const char = content[index]!;
    if (char === '"' || char === "'") {
      index = skipString(content, index);
      continue;
    }
    if (char === '/' && content[index + 1] === '*') {
      index = skipComment(content, index);
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ';' && depth === 0) {
      parts.push(content.slice(start, index));
      start = index + 1;
    }
    index += 1;
  }
  parts.push(content.slice(start));
  return parts;
}

/** 解析声明块为属性名到属性值（保留原始值文本）。 */
function parseDeclarations(content: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const raw of splitDeclarations(content)) {
    const separator = raw.indexOf(':');
    if (separator === -1) continue;
    const name = raw.slice(0, separator).trim().toLowerCase();
    if (name === '') continue;
    declarations.set(name, raw.slice(separator + 1).trim());
  }
  return declarations;
}

/** 声明块是否全部由自定义属性（--name: value）组成。 */
function isCustomPropertyBlock(content: string): boolean {
  let sawCustomProperty = false;
  for (const declaration of splitDeclarations(content)) {
    const trimmed = declaration.trim();
    if (trimmed === '') continue;
    if (!trimmed.startsWith('--')) return false;
    sawCustomProperty = true;
  }
  return sawCustomProperty;
}

/** 选择器列表是否整体就是 :root。 */
function isRootSelector(selector: string): boolean {
  const parts = selector.split(',');
  return parts.length > 0 && parts.every((part) => part.trim() === ':root');
}

/** 只把顶层 :root 令牌声明段映射为 :host，其余内容逐段原样保留。 */
function mapRootTokensToHost(css: string): string {
  let result = '';
  let cursor = 0;
  while (cursor < css.length) {
    const open = findNextOpenBrace(css, cursor);
    if (open === -1) {
      result += css.slice(cursor);
      break;
    }
    const selector = css.slice(cursor, open);
    const closeIndex = findBlockEnd(css, open);
    const end = closeIndex < css.length ? closeIndex + 1 : css.length;
    const block = css.slice(open, end);
    if (
      closeIndex < css.length &&
      isRootSelector(selector) &&
      isCustomPropertyBlock(css.slice(open + 1, closeIndex))
    ) {
      result += ':host' + block;
    } else {
      result += selector + block;
    }
    cursor = end;
  }
  return result;
}

const ABSOLUTE_URL_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

interface UrlToken {
  target: string;
  end: number;
}

/** 解析 url(...) 记号；start 指向 u。无法受控解析时返回 null，调用方保持原文。 */
function parseUrlToken(css: string, start: number): UrlToken | null {
  const length = css.length;
  let index = start + 4;
  const skipWhitespace = (): void => {
    while (index < length && /\s/.test(css[index]!)) index += 1;
  };
  skipWhitespace();
  if (index >= length) return null;
  const first = css[index]!;
  if (first === '"' || first === "'") {
    const targetEnd = skipString(css, index);
    if (targetEnd > length || css[targetEnd - 1] !== first) return null;
    const target = css.slice(index + 1, targetEnd - 1);
    index = targetEnd;
    skipWhitespace();
    if (css[index] !== ')') return null;
    return { target, end: index + 1 };
  }
  const close = css.indexOf(')', index);
  if (close === -1) return null;
  const raw = css.slice(index, close);
  if (/["'();{}]/.test(raw)) return null;
  return { target: raw.trim(), end: close + 1 };
}

/** 相对资源路径重写为扩展绝对 URL；绝对 URL、data: 与 #fragment 返回 null。 */
function toExtensionUrlOrNull(
  target: string,
  toExtensionUrl: (assetPath: string) => string,
): string | null {
  const trimmed = target.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return null;
  if (ABSOLUTE_URL_PATTERN.test(trimmed)) return null;
  const assetPath = trimmed.replace(/^\.?\//, '');
  if (assetPath === '') return null;
  return toExtensionUrl(assetPath);
}

/** 逐个 url() 记号重写相对资源路径，保持其余文本原样。 */
function rewriteAssetUrls(css: string, toExtensionUrl: (assetPath: string) => string): string {
  let result = '';
  let index = 0;
  while (index < css.length) {
    const char = css[index]!;
    if (char === '"' || char === "'") {
      const end = skipString(css, index);
      result += css.slice(index, end);
      index = end;
      continue;
    }
    if (char === '/' && css[index + 1] === '*') {
      const end = skipComment(css, index);
      result += css.slice(index, end);
      index = end;
      continue;
    }
    if ((char === 'u' || char === 'U') && css.slice(index, index + 4).toLowerCase() === 'url(') {
      const token = parseUrlToken(css, index);
      if (token !== null) {
        const rewritten = toExtensionUrlOrNull(token.target, toExtensionUrl);
        result += rewritten === null ? css.slice(index, token.end) : 'url("' + rewritten + '")';
        index = token.end;
        continue;
      }
    }
    result += char;
    index += 1;
  }
  return result;
}

/** 把库构建 CSS 转换为 ShadowRoot 可注入字符串（令牌映射 + 字体路径重写）。 */
export function transformIslandShadowCss(
  css: string,
  toExtensionUrl: (assetPath: string) => string,
): string {
  return rewriteAssetUrls(mapRootTokensToHost(css), toExtensionUrl);
}

/** 收集顶层 @font-face 描述，src 重写为 chrome-extension 绝对 URL。 */
export function collectIslandFontFaces(
  css: string,
  toExtensionUrl: (assetPath: string) => string,
): IslandFontFaceDescriptor[] {
  const faces: IslandFontFaceDescriptor[] = [];
  let cursor = 0;
  while (cursor < css.length) {
    const open = findNextOpenBrace(css, cursor);
    if (open === -1) break;
    const selector = css.slice(cursor, open);
    const closeIndex = findBlockEnd(css, open);
    if (closeIndex >= css.length) break;
    if (selector.trim().toLowerCase() === '@font-face') {
      const declarations = parseDeclarations(css.slice(open + 1, closeIndex));
      const family = declarations.get('font-family');
      const src = declarations.get('src');
      if (family !== undefined && src !== undefined) {
        faces.push({
          family: family.replace(/^["']|["']$/g, ''),
          style: declarations.get('font-style') ?? 'normal',
          weight: declarations.get('font-weight') ?? 'normal',
          display: declarations.get('font-display') ?? 'auto',
          source: rewriteAssetUrls(src, toExtensionUrl),
        });
      }
    }
    cursor = closeIndex + 1;
  }
  return faces;
}

/** 解析库构建 CSS，产出注入样式串与字体清单（单次解析）。 */
export function buildIslandShadowStyleBundle(
  css: string,
  toExtensionUrl: (assetPath: string) => string,
): IslandShadowStyleBundle {
  return {
    css: transformIslandShadowCss(css, toExtensionUrl),
    fontFaces: collectIslandFontFaces(css, toExtensionUrl),
  };
}

/** 带缓存的样式装载器；依赖可注入，便于测试与替换资源解析方式。 */
export function createIslandShadowStyles(deps: IslandShadowStyleDeps): IslandShadowStyles {
  let cached: IslandShadowStyleBundle | null = null;
  const load = (): IslandShadowStyleBundle =>
    (cached ??= buildIslandShadowStyleBundle(deps.css, deps.toExtensionUrl));
  return {
    getBundle: load,
    getCss: () => load().css,
    getFontFaces: () => load().fontFaces,
  };
}

let defaultStyles: IslandShadowStyles | null = null;

function getDefaultStyles(): IslandShadowStyles {
  defaultStyles ??= createIslandShadowStyles({
    css: islandCss,
    toExtensionUrl: (assetPath) => chrome.runtime.getURL(assetPath),
  });
  return defaultStyles;
}

/** 内容脚本默认实例：构建期内联库 CSS + chrome.runtime.getURL，模块级缓存一次解析。 */
export function getIslandShadowStyleBundle(): IslandShadowStyleBundle {
  return getDefaultStyles().getBundle();
}

const registeredDocuments = new WeakSet<Document>();

/**
 * 以 FontFace API 把字体注册进 document.fonts。
 *
 * Chromium 不加载 ShadowRoot 内声明的 @font-face；document.fonts 中的字体可被文档
 * 任意树（含 Shadow DOM）的文字使用。按文档幂等；重复打开遮罩不会重复注册。
 */
export function registerIslandFontFaces(fontFaces: readonly IslandFontFaceDescriptor[]): void {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return;
  if (document.fonts === undefined) return;
  if (registeredDocuments.has(document)) return;
  registeredDocuments.add(document);
  for (const face of fontFaces) {
    try {
      document.fonts.add(
        new FontFace(face.family, face.source, {
          style: face.style,
          weight: face.weight,
          // 描述来自对已知库 CSS 的受控解析，取值受 FontDisplay 约束。
          display: face.display as FontDisplay,
        }),
      );
    } catch (error) {
      console.error('[BingeUp] 字体注册失败', face.family, error);
    }
  }
}
