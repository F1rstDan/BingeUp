import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * island 基础模块与 Popup 样式的静态规则（工单 #39，测试缝①：静态校验）。
 *
 * 布局 CSS 不引用旧蓝粉令牌（--bingeup-*），也不写死颜色；
 * 别名层只通过 var() 桥接 animal-island-ui 的 --animal-* 运行时令牌。
 */
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/;

function readProjectFile(relativePath: string): string {
  // 不用 new URL 静态模式：Vite 会把它改写为基于页面源的资源 URL（jsdom 下不可用）；
  // 字符串拼接可绕开静态分析，保持相对测试文件解析。
  return readFileSync(fileURLToPath(new URL('../../../' + relativePath, import.meta.url)), 'utf8');
}

describe('island 主题衔接静态规则', () => {
  it('island-layout.css 不含旧令牌与写死颜色', () => {
    const css = readProjectFile('src/ui/island/island-layout.css');
    expect(css).not.toContain('--bingeup');
    expect(css).not.toMatch(HEX_COLOR);
  });

  it('island-theme.css 的每个别名都桥接 --animal-* 令牌', () => {
    const css = readProjectFile('src/ui/island/island-theme.css');
    expect(css).not.toContain('--bingeup');
    const declarations = css.match(/--island-[a-z-]+:\s*[^;]+;/g) ?? [];
    expect(declarations.length).toBeGreaterThan(0);
    for (const declaration of declarations) {
      expect(declaration).toMatch(/--island-[a-z-]+:\s*var\(\s*--animal-[a-z-]+,[\s\S]+?\);/);
    }
  });

  it('Popup 页面样式不引用旧蓝粉令牌与写死颜色', () => {
    const css = readProjectFile('src/entrypoints/popup/popup.css');
    expect(css).not.toContain('--bingeup');
    expect(css).not.toMatch(HEX_COLOR);
  });

  it('设置页样式不引用旧蓝粉令牌与写死颜色（M3b）', () => {
    const css = readProjectFile('src/entrypoints/options/options.css');
    expect(css).not.toContain('--bingeup');
    expect(css).not.toMatch(HEX_COLOR);
  });

  it('统计页样式不引用旧蓝粉令牌与写死颜色', () => {
    const css = readProjectFile('src/entrypoints/stats/stats.css');
    expect(css).not.toContain('--bingeup');
    expect(css).not.toMatch(HEX_COLOR);
  });
});
