import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createIslandShadowStyles,
  registerIslandFontFaces,
  transformIslandShadowCss,
  type IslandFontFaceDescriptor,
} from '@/ui/island/shadow-styles';

/**
 * M4 Shadow DOM 样式装载模块（工单 #43）。
 *
 * 公开契约：输入库构建产物 CSS，输出可直接注入 ShadowRoot 的字符串。
 * - 仅把 :root 令牌声明段受控映射为 :host；
 * - 字体 url() 重写为 chrome-extension 绝对 URL；
 * - 结果缓存，重复取用不重复解析。
 */

const require = createRequire(import.meta.url);
/** 库发布产物本身就是构建结果：与构建期内联导入的是同一份 CSS 文件。 */
const LIBRARY_CSS = readFileSync(require.resolve('animal-island-ui/style'), 'utf8');

const toExtensionUrl = (assetPath: string): string => 'chrome-extension://test-id/' + assetPath;

describe('transformIslandShadowCss — 令牌映射（:root 到 :host）', () => {
  it('只把库 CSS 的 :root 令牌声明段映射为 :host，其余选择器保持原样', () => {
    const output = transformIslandShadowCss(LIBRARY_CSS, toExtensionUrl);

    expect(output).toContain(':host{--animal-primary-color: #19c8b9;');
    expect(output).toContain('--animal-font-family: Nunito, "Noto Sans SC"');
    expect(output).not.toContain(':root{');
    expect(output.match(/:host\{/g) ?? []).toHaveLength(1);

    // 令牌段整体保留 + 原 reset 规则原样保留。
    expect(output).toContain('--animal-border-radius-lg: 24px;');
    expect(output).toContain('*,*:before,*:after{box-sizing:border-box}');
    expect(output).toContain('[class^=animal-]{');
  });

  it('含普通声明的 :root 块不属于令牌段，保持原样', () => {
    const css = ':root{color:red}.a{margin:0}';
    expect(transformIslandShadowCss(css, toExtensionUrl)).toBe(css);
  });

  it('顶层规则列表结构以外的内容不丢失', () => {
    const css = '@media (min-width:100px){.a{color:red}}:root{--t:1}.b{color:blue}';
    expect(transformIslandShadowCss(css, toExtensionUrl)).toBe(
      '@media (min-width:100px){.a{color:red}}:host{--t:1}.b{color:blue}',
    );
  });
});

describe('transformIslandShadowCss — 字体 url() 重写', () => {
  it('库 CSS 的相对字体路径重写为 chrome-extension 绝对 URL', () => {
    const output = transformIslandShadowCss(LIBRARY_CSS, toExtensionUrl);

    expect(output).toContain(
      'url("chrome-extension://test-id/files/nunito-latin-500-normal.78b3b3a4.woff2")',
    );
    expect(output).toContain(
      'url("chrome-extension://test-id/files/noto-sans-sc-chinese-simplified-700-normal.6e0a7691.woff2")',
    );
    expect(output).not.toMatch(/url\("?files\//);
  });

  it('data: URI 与片段引用保持原样', () => {
    const output = transformIslandShadowCss(LIBRARY_CSS, toExtensionUrl);

    expect(output.match(/data:image\/svg\+xml/g) ?? []).toHaveLength(
      LIBRARY_CSS.match(/data:image\/svg\+xml/g)?.length ?? 0,
    );
    expect(output).toContain('url(#animal-modal-clip)');
    expect(output).not.toContain('chrome-extension://test-id/#animal-modal-clip');
  });

  it('Vite 构建产物形态（根相对路径、有引号与无引号）同样被重写', () => {
    const built = [
      '@font-face{font-family:Nunito;src:url(/assets/nunito-latin-500-normal.78b3b3a4-EugFkASW.woff2) format("woff2")}',
      ".x{background:url('/assets/scene.svg')}",
      '.y{background:url("https://example.com/remote.woff2")}',
      '.z{background:url(./assets/rel.svg)}',
    ].join('');

    const output = transformIslandShadowCss(built, toExtensionUrl);

    expect(output).toContain(
      'url("chrome-extension://test-id/assets/nunito-latin-500-normal.78b3b3a4-EugFkASW.woff2")',
    );
    expect(output).toContain('url("chrome-extension://test-id/assets/scene.svg")');
    expect(output).toContain('url("chrome-extension://test-id/assets/rel.svg")');
    expect(output).toContain('url("https://example.com/remote.woff2")');
  });
});

describe('createIslandShadowStyles — 注入缓存', () => {
  it('首次调用解析一次，后续命中缓存不再解析', () => {
    const resolveUrl = vi.fn(toExtensionUrl);
    const styles = createIslandShadowStyles({ css: LIBRARY_CSS, toExtensionUrl: resolveUrl });

    const first = styles.getCss();
    const callsAfterFirst = resolveUrl.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const second = styles.getCss();

    expect(second).toBe(first);
    expect(resolveUrl.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe('createIslandShadowStyles — 字体清单（FontFace API 注册用）', () => {
  it('从库 CSS 与寒蝉半圆体提取 10 个字体描述，src 重写为 chrome-extension 绝对 URL', () => {
    const styles = createIslandShadowStyles({ css: LIBRARY_CSS, toExtensionUrl });
    const faces = styles.getFontFaces();

    expect(faces).toHaveLength(10);
    const nunito = faces.find((face) => face.family === 'Nunito' && face.weight === '500');
    expect(nunito).toEqual({
      family: 'Nunito',
      style: 'normal',
      weight: '500',
      display: 'swap',
      source:
        'url("chrome-extension://test-id/files/nunito-latin-500-normal.78b3b3a4.woff2") format("woff2")',
    });
    expect(faces.every((face) => face.source.includes('chrome-extension://test-id/'))).toBe(true);
    expect(faces.find((face) => face.family === 'ChillRoundM')?.source).toContain(
      'chrome-extension://test-id/fonts/ChillRoundM.otf',
    );
  });

  it('缓存：getBundle 之后 getCss 与 getFontFaces 复用同一份结果', () => {
    const styles = createIslandShadowStyles({ css: LIBRARY_CSS, toExtensionUrl });
    expect(styles.getFontFaces()).toBe(styles.getFontFaces());
    expect(styles.getCss()).toBe(styles.getBundle().css);
  });
});

describe('registerIslandFontFaces — FontFace API 注册', () => {
  const descriptors: IslandFontFaceDescriptor[] = [
    {
      family: 'Nunito',
      style: 'normal',
      weight: '500',
      display: 'swap',
      source: 'url("chrome-extension://test-id/files/nunito.woff2") format("woff2")',
    },
  ];

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (document as unknown as { fonts?: unknown }).fonts;
  });

  it('注册进 document.fonts，并按文档幂等', () => {
    interface FakeFace {
      family: string;
      source: string;
      options?: { weight?: string; display?: string; style?: string };
    }
    const added: FakeFace[] = [];
    class FakeFontFace implements FakeFace {
      family: string;
      source: string;
      options?: { weight?: string; display?: string; style?: string };
      constructor(
        family: string,
        source: string,
        options?: { weight?: string; display?: string; style?: string },
      ) {
        this.family = family;
        this.source = source;
        this.options = options;
      }
    }
    vi.stubGlobal('FontFace', FakeFontFace);
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { add: (face: FakeFace) => added.push(face) },
    });

    registerIslandFontFaces(descriptors);

    expect(added).toHaveLength(1);
    expect(added[0]?.family).toBe('Nunito');
    expect(added[0]?.source).toBe(
      'url("chrome-extension://test-id/files/nunito.woff2") format("woff2")',
    );
    expect(added[0]?.options?.weight).toBe('500');

    registerIslandFontFaces(descriptors);
    expect(added).toHaveLength(1);
  });
});
