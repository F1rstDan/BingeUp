import { test } from './fixtures';

/**
 * 站点相关场景（Issue #27）——占位并说明为何交由人工验收矩阵覆盖。
 *
 * 以下场景依赖：真实 HTTPS 支持站点（Bilibili/YouTube）、宿主页内容脚本注入，
 * 以及 chrome.permissions.request 触发的浏览器原生权限弹窗。无头 E2E 无法可靠地
 * 驱动原生权限对话框，也不宜在自动化中依赖第三方线上站点，因此这些场景在
 * docs/beta-acceptance-matrix.md 中以人工矩阵逐项记录证据。
 *
 * 保留为 skip 用例，使覆盖意图在测试报告中可见，并与人工矩阵一一对应。
 */
test.describe('站点相关场景（人工矩阵覆盖）', () => {
  test.skip('默认支持网站在真实 Bilibili/YouTube 上的启用状态', () => {
    // 见 docs/beta-acceptance-matrix.md：Bilibili / YouTube 矩阵。
  });

  test.skip('视频区域遮罩（full-adaptation）在支持站点上的呈现与恢复', () => {
    // 见 docs/beta-acceptance-matrix.md：遮罩与恢复。
  });

  test.skip('全网页遮罩（basic-web）在自定义站点上的呈现与恢复', () => {
    // 见 docs/beta-acceptance-matrix.md：自定义网站矩阵。
  });

  test.skip('无视频主动学习在支持站点上的触发', () => {
    // 见 docs/beta-acceptance-matrix.md：无视频主动学习。
  });

  test.skip('权限拒绝：原生权限弹窗被拒后的可理解状态', () => {
    // 需驱动浏览器原生权限对话框，无头 E2E 无法覆盖；见人工矩阵：权限拒绝 / 删除权限。
  });
});
