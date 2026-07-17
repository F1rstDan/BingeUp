/**
 * Beta 反馈入口（Issue #27）。
 *
 * 仅提供一个预填的 GitHub Issues 新建链接：不建设账号、远程行为分析或任何埋点。
 * 反馈信息完全由用户在打开的 GitHub 页面上自行填写与提交。
 */

/** 本仓库 GitHub Issues 新建地址。 */
const NEW_ISSUE_URL = 'https://github.com/F1rstDan/BingeUp/issues/new';

/** 反馈正文模板：引导用户提供可复现所需的最小信息。 */
function feedbackBody(extensionVersion: string, userAgent: string): string {
  return [
    '<!-- 感谢参与 Beta 测试。请尽量补充以下信息，方便我们复现。 -->',
    '',
    '## 问题描述',
    '',
    '',
    '## 复现步骤',
    '1. ',
    '2. ',
    '3. ',
    '',
    '## 期望结果',
    '',
    '',
    '## 实际结果',
    '',
    '',
    '## 环境',
    `- 扩展版本：${extensionVersion}`,
    `- 浏览器 / UA：${userAgent}`,
    '- 测试页面：',
  ].join('\n');
}

/**
 * 构造预填的 GitHub Issues 新建链接。
 *
 * @param extensionVersion 当前扩展版本（来自 manifest）。
 * @param userAgent 浏览器 UA，便于定位浏览器与版本。
 */
export function buildFeedbackUrl(extensionVersion: string, userAgent: string): string {
  const params = new URLSearchParams({
    title: '[Beta 反馈] ',
    body: feedbackBody(extensionVersion, userAgent),
    labels: 'needs-triage',
  });
  return `${NEW_ISSUE_URL}?${params.toString()}`;
}
