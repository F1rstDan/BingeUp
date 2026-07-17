import { test, expect, pageUrl } from './fixtures';

/**
 * 统计页 E2E（Issue #27）。
 *
 * 验证统计页作为扩展内部页面能正常打开并渲染，不因缺少数据而空白或报错。
 */
test.describe('统计页', () => {
  test('渲染统计页标题', async ({ context, extensionId }) => {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(pageUrl(extensionId, 'stats.html'));
    await expect(page.getByRole('heading', { name: '学习统计', level: 1 })).toBeVisible();
    expect(errors).toEqual([]);

    await page.close();
  });
});
