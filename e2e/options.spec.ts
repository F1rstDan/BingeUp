import { test, expect, pageUrl } from './fixtures';

/**
 * 设置页 E2E（Issue #27；工单 #41 M3b 原版组件迁移）。
 *
 * 验证设置页可渲染、可修改并持久化（刷新后仍生效），覆盖“Popup/设置操作”验收面。
 * 数据经由 background service worker 写入 IndexedDB，因此这是端到端的真实读写路径。
 * M3b 起分区由原版 Tabs 承载、控件为标准角色（combobox/switch/spinbutton），
 * 断言改用角色与可访问名称定位。
 */

test.describe('设置页', () => {
  test('修改每日新词上限后保存并在刷新后保持', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(pageUrl(extensionId, 'options.html'));

    await expect(page.getByRole('heading', { name: '刷刷升级 — 设置' })).toBeVisible();

    const dailyLimit = page.getByRole('spinbutton', { name: '每日新词上限' });
    await expect(dailyLimit).toBeVisible();

    await dailyLimit.fill('7');
    await page.getByRole('button', { name: '保存设置' }).click();
    await expect(page.getByText('设置已保存')).toBeVisible();

    await page.reload();
    const dailyLimitAfterReload = page.getByRole('spinbutton', { name: '每日新词上限' });
    await expect(dailyLimitAfterReload).toHaveValue('7');

    await page.close();
  });

  test('学习水平通过原版受控 Select 修改并保存', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(pageUrl(extensionId, 'options.html'));

    const levelSelect = page.getByRole('combobox', { name: '学习水平' });
    await expect(levelSelect).toContainText('一般');

    await levelSelect.click();
    await page.getByRole('option', { name: '进阶' }).click();
    await expect(levelSelect).toContainText('进阶');

    await page.getByRole('button', { name: '保存设置' }).click();
    await expect(page.getByText('设置已保存')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('combobox', { name: '学习水平' })).toContainText('进阶');

    await page.close();
  });

  test('键盘可在分区之间切换（原版 Tabs）', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(pageUrl(extensionId, 'options.html'));

    await page.getByRole('tab', { name: '学习设置' }).click();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: '网站管理' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('button', { name: '添加网站' })).toBeVisible();

    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: '数据管理' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('button', { name: '导出数据' })).toBeVisible();

    await page.close();
  });

  test('清除数据确认使用原版 Modal：Escape 取消、确认后执行', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(pageUrl(extensionId, 'options.html'));
    await page.getByRole('tab', { name: '数据管理' }).click();

    // 打开确认弹窗：焦点进入对话框，页面滚动被锁定
    const trigger = page.getByRole('button', { name: '清除学习进度' });
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('确定要清除所有学习进度吗');
    await expect(dialog.getByRole('button', { name: '取消' })).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');

    // Escape 取消：关闭对话框、恢复滚动与焦点，且不执行清除
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    await expect(trigger).toBeFocused();

    // 再次打开并确认：执行真实清除链路并给出通知
    await trigger.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '清除学习进度' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText('学习进度已清除')).toBeVisible();

    await page.close();
  });

  test('页脚提供反馈入口', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(pageUrl(extensionId, 'options.html'));
    const link = page.getByRole('link', { name: '反馈问题或建议' });
    await expect(link).toBeVisible();
    expect(await link.getAttribute('href')).toContain('github.com/F1rstDan/BingeUp/issues/new');
    await page.close();
  });
});
