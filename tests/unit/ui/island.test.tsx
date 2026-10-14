import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IslandFooter, IslandPage, IslandSection } from '@/ui/island';

/**
 * island 基础模块（工单 #39，测试缝①：组件渲染）。
 *
 * 断言对外语义：主区域、按标题命名的区块、操作插槽与页脚地标；
 * 不冻结内部结构，后续页面直接复用该 API。
 */
describe('island 基础模块', () => {
  it('渲染主区域、带标题的区块与页脚', () => {
    render(
      <IslandPage label="测试面板">
        <IslandSection title="今日学习" actions={<button type="button">统计</button>}>
          <p>指标</p>
        </IslandSection>
        <IslandFooter>
          <a href="https://example.com/issues">反馈问题或建议</a>
        </IslandFooter>
      </IslandPage>,
    );

    expect(screen.getByRole('main', { name: '测试面板' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '今日学习' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '今日学习' })).toBeInTheDocument();
    expect(screen.getByText('指标')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '统计' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '反馈问题或建议' })).toHaveAttribute(
      'href',
      'https://example.com/issues',
    );
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('多个区块各自按标题命名，互不覆盖', () => {
    render(
      <IslandPage>
        <IslandSection title="学习设置">A</IslandSection>
        <IslandSection title="网站管理">B</IslandSection>
      </IslandPage>,
    );

    expect(screen.getByRole('region', { name: '学习设置' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '网站管理' })).toBeInTheDocument();
  });

  it('区块与页脚支持追加类名，标题行可省略操作区', () => {
    render(
      <IslandPage className="test-extra">
        <IslandSection title="无操作区" className="section-extra">
          <p>内容</p>
        </IslandSection>
      </IslandPage>,
    );

    const region = screen.getByRole('region', { name: '无操作区' });
    expect(region).toHaveClass('island-section', 'section-extra');
    expect(screen.getByRole('main').className).toContain('test-extra');
  });
});
