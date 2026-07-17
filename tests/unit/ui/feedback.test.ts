import { describe, expect, it } from 'vitest';
import { buildFeedbackUrl } from '@/ui/feedback';

/**
 * Beta 反馈入口（Issue #27）：构造预填的 GitHub Issues 新建链接。
 */
describe('buildFeedbackUrl', () => {
  it('指向本仓库的 GitHub Issues 新建页面', () => {
    const url = new URL(buildFeedbackUrl('0.1.0', 'UA'));
    expect(url.origin + url.pathname).toBe('https://github.com/F1rstDan/BingeUp/issues/new');
  });

  it('预填标题、待分流标签，并把版本与 UA 写入正文', () => {
    const params = new URL(buildFeedbackUrl('1.2.3', 'Mozilla/5.0 Test')).searchParams;
    expect(params.get('title')).toBe('[Beta 反馈] ');
    expect(params.get('labels')).toBe('needs-triage');
    const body = params.get('body') ?? '';
    expect(body).toContain('扩展版本：1.2.3');
    expect(body).toContain('Mozilla/5.0 Test');
    expect(body).toContain('复现步骤');
  });

  it('对特殊字符做 URL 编码，产出合法链接', () => {
    const url = buildFeedbackUrl('0.1.0', 'UA/1.0 (Windows NT 10.0; Win64; x64) & more');
    expect(() => new URL(url)).not.toThrow();
    expect(url).not.toContain(' ');
  });
});
