import { test, expect, pageUrl } from './fixtures';

/**
 * Popup 面板 E2E（Issue #27）。
 *
 * Popup 作为扩展内部页面直接打开时不具备 activeTab 上下文（无 tabs 权限，拿不到活动标签
 * URL），会进入“无法获取当前标签页”的可理解降级状态。此处验证 Popup 能挂载并渲染
 * 可理解的状态与固定控件（标题栏“设置”入口），而不是空白或抛错崩溃。
 *
 * 依赖真实 activeTab 的完整站点状态（可学习 / 需权限 / 遮罩等）由人工验收矩阵覆盖，
 * 反馈入口的 E2E 断言见 options.spec.ts（设置页页脚）。
 */
test.describe('Popup 面板', () => {
  test('直接打开时挂载并渲染可理解的降级状态', async ({ context, extensionId }) => {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(pageUrl(extensionId, 'popup.html'));

    // 标题栏“设置”入口在所有状态下都渲染，证明 Popup 已挂载。
    await expect(page.getByRole('button', { name: '设置' })).toBeVisible();
    // 无 activeTab 时给出可理解提示，而非空白。
    await expect(page.getByText('无法获取当前标签页')).toBeVisible();
    expect(errors).toEqual([]);

    await page.close();
  });
});
