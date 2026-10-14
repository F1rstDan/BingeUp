# BingeUp × Animal Island UI 迁移：M0 基线与依赖锁定

工单：#37（父 issue #36）｜决策记录：docs/adr/0005-adopt-animal-island-ui.md｜执行计划：docs/BingeUp_Animal_Island_UI_Codex_迁移实施计划.md

- 工作分支：codex/ticket-37-m0，从集成分支 feat/animal-island-ui-migration 切出
- 起点 commit：86fe48e131a0585162cf5fe4c38ef803fca1cc4b（集成分支与 origin 上的 tip 相同）
- 扩展版本：0.0.1；构建目标 chrome-mv3 与 edge-mv3
- ADR 0005 与迁移实施计划已随起点提交 86fe48e 入库

## 1. 环境

| 项 | 值 |
| --- | --- |
| 操作系统 | Microsoft Windows 11 专业版 10.0.26200 |
| Node / npm | v24.13.0 / 11.6.2 |
| 浏览器（E2E） | Playwright 1.61.1，Chromium 153.0.8010.12（ms-playwright chromium-1243，chrome-win64） |
| 采集时间 | 2026-10-14 15:30–16:00（Asia/Shanghai） |

## 2. 依赖锁定

安装前复核最新稳定版，结果与 ADR 0005 的预期一致：

| 命令 | 结果 |
| --- | --- |
| npm view animal-island-ui version | 2.2.1 |
| npm view animal-island-ui peerDependencies | react >=17.0.0；react-dom >=17.0.0；classnames ^2.5.1 |
| npm view naive-icons dist-tags | latest = 1.6.0（^1.6.0 无更高版本） |

安装结果（写入 package.json 与 package-lock.json）：

- dependencies.animal-island-ui = "2.2.1"（npm install --save-exact 精确锁定）
- dependencies.naive-icons = "^1.6.0"（解析并安装 1.6.0，声明为直接依赖）
- classnames 作为 animal-island-ui 的 peer 依赖由 npm 自动安装：
  npm ls 输出 animal-island-ui@2.2.1 ├── classnames@2.5.1、└── naive-icons@1.6.0 deduped；
  lockfile 中 node_modules/classnames 标记 "peer": true
- 未新增其他依赖；package-lock.json 已更新并随后续提交入库

lockfile 中与本迁移无关、但由 npm 自动完成的元数据归一化（无版本变化）：

- packages[""].version 由陈旧的 0.1.0 同步为 package.json 的 0.0.1
- @types/react、csstype 条目的 "dev": true 变为 "devOptional": true（naive-icons 的 optional peer 引起）

## 3. 构建产物基线

执行命令：

```powershell
npm run build
npm run build:edge
npm run zip
npm run zip -- -b edge
node scripts/measure-bundle-baseline.mjs
```

结果（Chrome 与 Edge 产物数字一致）：

| 指标 | 值 |
| --- | --- |
| 解包体积（.output/chrome-mv3） | 3,580,581 B（3.58 MB），34 个文件 |
| 解包体积（.output/edge-mv3） | 3,580,581 B（3.58 MB），34 个文件 |
| 压缩包 | bingeup-0.0.1-chrome.zip 1,213,403 B；bingeup-0.0.1-edge.zip 1,213,403 B |
| Popup 入口闭包 | 166,685 B（9 个文件，含共享分块） |
| content script | content-scripts/content.js 208,173 B（无独立 CSS 文件） |

Popup 入口闭包明细（Chrome 产物）：

| 文件 | 字节 |
| --- | --- |
| chunks/popup-CIjZxdWN.js | 12,932 |
| chunks/design-tokens-Cu7EBkgq.js | 140,594 |
| chunks/message-client-pe9yjbHL.js | 2,938 |
| chunks/FeedbackLink-Bb2FSGLx.js | 2,512 |
| chunks/supported-sites-C9CvW3d0.js | 212 |
| chunks/onboarding-service-B1_Llq0I.js | 218 |
| chunks/level-up-mascot-D06_YP8x.js | 60 |
| assets/design-tokens-DY46YKh1.css | 2,132 |
| assets/popup-DFyh5JX7.css | 5,087 |

补充说明：

- chunks/design-tokens-*.js（140.6 KB）是 Popup 入口加载的最大 JS 分块。
- 当前安装包内没有字体文件（界面使用系统字体）。assets/level-up-mascot-*.png 为 671.17 KB 吉祥物图。
- dictionaries/words.json（1.96 MB）与 dictionaries/decks.json（416.85 KB）是词库数据，不属于 UI 资源。
- M1 起引入 animal-island-ui 样式与约 3.4 MB 本地字体后，用 scripts/measure-bundle-baseline.mjs 复测同一组指标并记录差值。

## 4. 遮罩进入延迟（合成站点，非真实站点）

方法：加载真实 MV3 产物（Playwright --load-extension .output/chrome-mv3），用 page.route 把 https://www.bilibili.com/video/BV1M0BASELINE 兑现为极简合成页（1280×720 的 .bpx-player-container + 无源 video 元素），由真实内容脚本自然触发遮罩。页面内以 addInitScript 记录 performance.now()：

- bootMs：文档开始 → #bingeup-overlay-host 插入
- renderMs：宿主插入 → .bingeup-card 可见（尺寸大于 0；跨 Shadow Root 用独立 MutationObserver 加 100ms 轮询检测）
- 合计：文档开始 → 遮罩卡片可见

词库经预热（先在扩展页调用 LEARNING_GET_NEXT 完成首次加载，返回 new-word-presentation）。

| 采样 | bootMs | renderMs | 合计 |
| --- | --- | --- | --- |
| 1 | 102 | 17 | 120 |
| 2 | 112 | 20 | 132 |
| 3 | 124 | 16 | 140 |
| 4 | 127 | 15 | 142 |

边界说明：这是扩展已加载、页面 DOM 极简、词库已预热条件下的首屏自然触发成本，不含真实站点（B 站/YouTube）的页面规模、媒体加载与注入时机差异，也不含页面加载触发/滚动触发等自定义站点路径。真实站点数字列为待人工基线（见第 6 节）。可作为 M4/M5 迁移 Shadow DOM 时"宿主插入到卡片可见"（15–20ms 量级）的对照。

## 5. 旧界面截图基线

本次自动采集（docs/assets/migration-baseline/，PNG，单个 12–149 KB）：

| 文件 | 内容 |
| --- | --- |
| popup.png | Popup 直接打开：无 activeTab 的"无法获取当前标签页"降级状态 |
| onboarding.png | 安装引导首屏（学习水平、词库、默认支持网站、完成引导） |
| options.png | 设置页完整页面（学习设置、网站管理、数据管理、页脚反馈入口） |
| stats.png | 统计页完整页面（概览、今日学习、学习卡状态、近 7 日趋势等） |
| overlay-synthetic.png | 遮罩"认识新词"卡片（合成页面，含"非真实站点"说明） |
| enable-prompt-synthetic.png | 页面启用提示卡片（合成页面，含"非真实站点"说明） |

复现命令（该 spec 默认跳过，不参与 npm run test:e2e 的常规执行；采集会覆盖同名 PNG）：

```powershell
$env:CAPTURE_BASELINE='1'; npx playwright test e2e/migration-baseline.spec.ts
```

仓库中已有的迁移前截图（起点提交已在库，作为补充证据；拍摄时间与作者未知）：

| 文件 | 内容 |
| --- | --- |
| docs/assets/screenshot/插件面板-01.png | Popup 在真实站点、可学习状态（自动截图无法复现 activeTab 状态） |
| docs/assets/screenshot/视频内-认识新词-01.png | 真实 B 站页面遮罩：认识新词 |
| docs/assets/screenshot/视频内-答对了-01.png | 真实 B 站页面遮罩：答对反馈 |
| docs/assets/screenshot/视频内-答错了-01.png | 真实 B 站页面遮罩：答错反馈 |
| docs/assets/screenshot/填空题-01.png | 题目卡（遮罩内题面） |
| docs/assets/screenshot/安装使用引导-01.webp | 安装引导（内容与本次自动采集的 onboarding.png 一致） |

覆盖关系：本次自动截图补齐 Popup 降级态、Onboarding、Options、Stats 与合成页面上的遮罩与启用提示；Popup 真实状态、真实站点遮罩与启用提示由既有截图和人工验收矩阵覆盖。

## 6. 未验证项（待人工基线）

| 项 | 原因 |
| --- | --- |
| 真实 B 站/YouTube 上的遮罩呈现与交互 | 无真实站点环境。合成页面只覆盖 DOM 结构与遮罩渲染路径，不覆盖站点适配、媒体加载、全屏、竖屏、SPA 切换与广告过滤 |
| 启用提示在真实站点的出现、拒绝与二次提示（上限 2 次） | 同上；合成页面已验证提示可渲染 |
| 浏览器原生权限弹窗（加入自定义网站） | 无头环境无法可靠驱动原生对话框（既有 e2e/site-scenarios.spec.ts 亦为 skip） |
| Popup 在真实活动标签页下的状态 | 直接打开 popup.html 不具备 activeTab 上下文 |
| Edge 浏览器人工矩阵 | 本次仅验证 edge-mv3 构建产物，未在真实 Edge 中手测 |
| 遮罩进入延迟的真实站点数字 | 见第 4 节边界说明 |

## 7. 质量门禁执行记录

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | npm run typecheck | 通过（退出码 0） |
| 单元/集成测试 | npm test | 通过（44 个测试文件、809 个用例，13.7 s） |
| Lint | npm run lint | 通过（退出码 0，含新增 e2e 与 scripts 文件） |
| Chrome 构建 | npm run build | 通过（含 verify-content-script-manifest.mjs、verify-dev-tools-production.mjs 校验） |
| Edge 构建 | npm run build:edge | 通过（同上，edge-mv3） |
| 打包 | npm run zip / npm run zip -- -b edge | 通过（体积见第 3 节） |
| 浏览器 E2E（既有用例） | npm run test:e2e | 7 通过 / 8 跳过（5 个站点人工占位，3 个基线采集默认跳过） |

## 8. 复现步骤

```powershell
git checkout codex/ticket-37-m0
npm install
npm run typecheck; npm test; npm run lint
npm run build; npm run build:edge
npm run zip; npm run zip -- -b edge
node scripts/measure-bundle-baseline.mjs
$env:CAPTURE_BASELINE='1'; npx playwright test e2e/migration-baseline.spec.ts
```

相关提交（分支 codex/ticket-37-m0）：

1. 锁定 animal-island-ui 2.2.1 与 naive-icons ^1.6.0，更新锁文件
2. 新增基线截图采集测试与构建体积测量脚本
3. 新增 M0 迁移基线证据文档与旧界面截图
