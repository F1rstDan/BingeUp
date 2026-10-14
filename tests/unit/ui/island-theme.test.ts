import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * island 基础模块与 Popup 样式的静态规则（工单 #39，测试缝①：静态校验）。
 *
 * 布局 CSS 不引用旧蓝粉令牌（--bingeup-*），也不写死颜色；
 * 别名层只通过 var() 桥接 animal-island-ui 的 --animal-* 运行时令牌；
 * 工单 #46 起追加“旧视觉清零”规则：src 下不再出现旧令牌/旧自绘类，
 * 旧样式文件（design-tokens.css / shadow-design.ts）已删除，
 * 开发数据页与 Popup 开发工具样式同样只使用 island 令牌。
 */
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/;

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function listFilesUnder(relativeDir: string): string[] {
  const files: string[] = [];
  const stack = [resolve(projectRoot, relativeDir)];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else files.push(relative(projectRoot, full).replaceAll('\\', '/'));
    }
  }
  return files;
}

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

  it('Onboarding 页面样式不引用旧蓝粉令牌与写死颜色（工单 #40）', () => {
    const css = readProjectFile('src/entrypoints/onboarding/onboarding.css');
    expect(css).not.toContain('--bingeup');
    expect(css).not.toMatch(HEX_COLOR);
  });

  it('统计页样式不引用旧蓝粉令牌与写死颜色', () => {
    const css = readProjectFile('src/entrypoints/stats/stats.css');
    expect(css).not.toContain('--bingeup');
    expect(css).not.toMatch(HEX_COLOR);
  });
});

describe('旧视觉清零（工单 #46）', () => {
  it('src 下不再出现旧蓝粉令牌与旧自绘按钮/状态类', () => {
    const offenders: string[] = [];
    for (const file of listFilesUnder('src')) {
      const content = readProjectFile(file);
      for (const pattern of ['--bingeup', 'bingeup-btn-', 'bingeup-status-']) {
        if (content.includes(pattern)) offenders.push(`${file}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('旧样式文件 design-tokens.css 与 shadow-design.ts 已删除', () => {
    expect(existsSync(join(projectRoot, 'src/ui/styles/design-tokens.css'))).toBe(false);
    expect(existsSync(join(projectRoot, 'src/ui/styles/shadow-design.ts'))).toBe(false);
  });

  it('开发数据页样式不引用旧令牌与写死颜色', () => {
    const css = readProjectFile('src/entrypoints/dev-tools/dev-tools.css');
    expect(css).not.toContain('--bingeup');
    expect(css).not.toMatch(HEX_COLOR);
  });

  it('Popup 开发工具样式不引用旧令牌与写死颜色', () => {
    const css = readProjectFile('src/ui/popup/dev-tools.css');
    expect(css).not.toContain('--bingeup');
    expect(css).not.toMatch(HEX_COLOR);
  });
});
