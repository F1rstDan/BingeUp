import { test, expect, pageUrl } from './fixtures';

/**
 * 设置页 E2E（Issue #27）。
 *
 * 验证设置页可渲染、可修改并持久化（刷新后仍生效），覆盖“Popup/设置操作”验收面。
 * 数据经由 background service worker 写入 IndexedDB，因此这是端到端的真实读写路径。
 */
test.describe('设置页', () => {
  test('修改每日新词上限后保存并在刷新后保持', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(pageUrl(extensionId, 'options.html'));

    await expect(page.getByRole('heading', { name: '刷刷升级 — 设置' })).toBeVisible();

    const dailyLimit = page
      .locator('.bingeup-field', { hasText: '每日新词上限' })
      .getByRole('spinbutton');
    await expect(dailyLimit).toBeVisible();

    await dailyLimit.fill('7');
    await page.getByRole('button', { name: '保存设置' }).click();
    await expect(page.getByText('设置已保存')).toBeVisible();

    await page.reload();
    const dailyLimitAfterReload = page
      .locator('.bingeup-field', { hasText: '每日新词上限' })
      .getByRole('spinbutton');
    await expect(dailyLimitAfterReload).toHaveValue('7');

    await page.close();
  });

  test('页脚提供反馈入口', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(pageUrl(extensionId, 'options.html'));
    const link = page.getByRole('link', { name: '反馈问题或建议' });
    await expect(link).toBeVisible();
    expect(await link.getAttribute('href')).toContain(
      'github.com/F1rstDan/BingeUp/issues/new',
    );
    await page.close();
  });
});
