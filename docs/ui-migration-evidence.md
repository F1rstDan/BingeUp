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

## M1 Popup 垂直切片

工单：#38（父 issue #36）｜决策记录：docs/adr/0005-adopt-animal-island-ui.md｜分支：codex/ticket-38-m1-popup-slice（从集成分支 tip 2844b82 切出）

### 1. 改动概览

- `src/entrypoints/popup/main.tsx`：入口新增 `import 'animal-island-ui/style'`（Popup 入口恰好一次；全仓库当前唯一导入点），页面可正常加载。
- `src/ui/popup/PopupApp.tsx`：站点状态区与主操作区换为原版组件（animal-island-ui 2.2.1），组件样式全部来自库产物，未覆盖库组件的颜色/圆角/阴影：
  - Card：站点状态外壳（羊皮纸底）；Tag：状态徽标（可学习/已暂停/待启用/不可用/需权限，size=small、soft）。
  - Switch：网站启用开关（受控；`aria-label` 沿用“开启/关闭当前网站”动作语义；onChange 仍走既有 `messageClient.setSiteEnabled` 链路）。
  - Button：加入当前网站（primary/small）、暂停 10 分钟 / 暂停今天 / 今天恢复（default/block）、开始学习（primary/large/block，禁用入口同款）、暂停倒计时（default/block）。
  - 站点判定、暂停/倒计时状态逻辑、消息链路、用户可见文案与 `OverlayAction` 语义均未改；其余区域（标题栏、今日学习、状态卡、反馈）保留旧样式（本工单明确允许混合）。
  - 备注：库 2.2.1 的 `type="primary"` 即奶油底 3D 堆叠按钮（薄荷色只用于 danger/ghost 变体），切片与原版一致，未自创主题。
- `src/entrypoints/popup/popup.css`：切片布局（`.bingeup-site-card/.bingeup-site-status-row/.bingeup-site-control` 等）与画布底色切换为原版米白；旧泛型 `button` 规则收敛为只作用于未迁移的两个按钮（标题栏设置、统计入口），避免覆盖原版组件的胶囊圆角/堆叠阴影；删除随切片下线的旧类（站点徽标、加入按钮、开始学习箭头等）。未改组件内边距/圆角/阴影。
- `vitest.config.ts`：`server.deps.inline` 内联 animal-island-ui（其 dist/es 以 `.module.css` 副作用导入样式，默认外置时 Node 直接加载 .css 报未知扩展名）。
- `tests/unit/popup/PopupApp.test.tsx`：仅做组件替换导致的断言更新（按钮→开关、`aria-checked`、Tag 文案；暂停倒计时的按钮身份断言改为 role 查询），未弱化行为断言；测试规模不变（44 文件 / 809 用例）。未改全局旧设计令牌文件（M6 才删）。

### 2. 字体与 CSP（e2e 实测）

采集加载真实 MV3 产物（`--load-extension`），在 Popup 页监听 console、pageerror 与网络请求：

| 项 | 结果 |
| --- | --- |
| 字体家族 | Nunito 与 Noto Sans SC 均进入 loaded（`document.fonts`；`check('14px Nunito')`、`check('14px "Noto Sans SC"')` 均为 true） |
| 字体请求 | 5 个 woff2 响应 200，URL 全部为 `chrome-extension://<id>/assets/...`（无远程字体） |
| CSP / 控制台 | console error 0、pageerror 0、失败请求 0 |

产物内字体：9 个 woff2（3 个中文子集约 1.14–1.17 MB，3 个 Noto 拉丁约 13.3 KB，3 个 Nunito 约 16 KB）；Popup CSS 内 `@font-face` 9 条，URL 均为扩展本地相对路径。

### 3. 320–420px 与 200% 缩放（无横向溢出）

采集断言 `document.documentElement.scrollWidth ≤ clientWidth`：

| 场景 | scrollWidth / clientWidth |
| --- | --- |
| 视口 320px | 320 / 320 |
| 视口 340px | 340 / 340 |
| 视口 420px | 420 / 420 |
| 200% 缩放等效（CDP 设备指标：CSS 视口 320、deviceScaleFactor 2，物理 640） | 320 / 320 |

布局调整（页面侧，未动组件）：`html, body` 保持 340px 并加 `max-width: 100%`（移除原 `min-width: 320px`），切片行内使用 `min-width: 0` 与 `overflow-wrap: anywhere`，长域名与说明文本换行不撑宽。

### 4. 截图（docs/assets/migration-m1/）

| 文件 | 状态 |
| --- | --- |
| popup-learnable-340.png / popup-learnable-320.png / popup-learnable-420.png | 可学习：Card + Tag“可学习” + Switch 开启 + 原版主操作按钮 |
| popup-learnable-zoom200.png | 可学习，200% 缩放等效（物理 640px 宽） |
| popup-paused-340.png | 全局暂停：Tag“已暂停” + 倒计时“恢复 10:00” + 禁用开始学习 |
| popup-needs-permission-340.png | 需权限：Card + Tag“需权限” + 禁用入口 |
| popup-join-site-340.png | HTTPS 未加入站点：原版 primary“加入当前网站” |
| popup-degraded-340.png | 无活动标签页降级状态 |
| popup-protected-340.png | 受保护页面（chrome://settings/） |

复现命令（该 spec 默认跳过，不参与 npm run test:e2e 的常规执行；采集会覆盖同名 PNG）：

```powershell
$env:CAPTURE_M1='1'; npx playwright test e2e/migration-m1.spec.ts
```

采集说明（e2e/migration-m1.spec.ts）：仅在采集页内替换 `chrome.tabs.query` 与 `chrome.permissions.contains` 以进入各状态；站点启用/暂停等仍通过真实后台消息准备，渲染使用真实构建产物。采集结果同时写入 `.output/migration-m1-capture.json`。

### 5. 体积对比（M0 → M1；Chrome 与 Edge 数字一致）

| 指标 | M0（#37） | M1（本次） | 差值 |
| --- | --- | --- | --- |
| 解包体积 | 3,580,581 B（34 文件） | 7,601,617 B（47 文件） | +4,021,036 B |
| 压缩包 zip | 1,213,403 B | 4,855,896 B | +3,642,493 B |
| Popup 入口闭包 | 166,685 B（9 文件） | 308,756 B（9 文件） | +142,071 B |
| content script | 208,173 B | 208,173 B | 0 |

Popup 闭包明细变化：popup JS 12,932 → 29,315 B；popup CSS 5,087 → 130,287 B（新增库样式约 126 KB）；design-tokens JS 140,594 → 141,082 B；design-tokens CSS 2,132 B 不变。新增字体合计约 3.49 MB；另有库样式引用的 4 个场景 SVG（约 315 KB，属包内 CSS 资产）。content script 字节数不变。

### 6. 门禁执行记录

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | npm run typecheck | 通过（退出码 0） |
| 单元/集成测试 | npm test | 通过（44 个测试文件、809 个用例） |
| Lint | npm run lint | 通过（退出码 0） |
| Chrome 构建 | npm run build | 通过（含 verify-content-script-manifest.mjs、verify-dev-tools-production.mjs） |
| Edge 构建 | npm run build:edge | 通过 |
| 打包 | npm run zip / npm run zip -- -b edge | 通过（体积见第 5 节） |
| 浏览器 E2E（既有用例） | npx playwright test | 7 通过 / 13 跳过（含 M1 采集默认跳过 5 项） |
| M1 切片采集 | $env:CAPTURE_M1='1'; npx playwright test e2e/migration-m1.spec.ts | 5 通过 |

### 7. 未验证项

| 项 | 原因 |
| --- | --- |
| 真实工具栏点击打开的 Popup（activeTab 上下文）与真实状态切换 | 无头环境无法驱动浏览器工具栏；采集以受控上下文替换进入各状态，业务链路未改 |
| 真实浏览器 200% 缩放 | 用 CDP 设备指标做布局等效模拟（CSS 视口 320 / DSF 2），非浏览器缩放设置本身 |
| Edge 真实浏览器人工矩阵 | 仅验证 edge-mv3 构建产物 |
| Popup 未迁移区域（标题栏、今日学习、状态卡、反馈入口）的原版化 | 本工单允许混合，M2 处理；切片内库组件自身的 focus-visible 规则（按钮薄荷、开关黄色）生效 |
| 真实站点行为回归 | 本次未改站点适配、触发/冷却、遮罩与学习链路；维持 M0 的人工矩阵口径 |

### 8. 复现步骤

```powershell
git checkout codex/ticket-38-m1-popup-slice
npm install
npm run typecheck; npm test; npm run lint
npm run build; npm run build:edge
npm run zip; npm run zip -- -b edge
node scripts/measure-bundle-baseline.mjs
$env:CAPTURE_M1='1'; npx playwright test e2e/migration-m1.spec.ts
```

相关提交（分支 codex/ticket-38-m1-popup-slice）：

1. Popup 入口导入原版样式，以原版 Button/Card/Tag/Switch 替换站点状态区与主操作区
2. 更新 Popup 单元测试匹配原版组件，内联库依赖并新增 M1 切片采集脚本
3. 新增 M1 Popup 垂直切片证据文档与截图

## M4 Shadow DOM PoC

工单：#43（父 issue #36）｜分支：codex/ticket-43-m4-shadow-poc（从集成分支 tip 2844b82 切出）｜执行时间：2026-10-14。

M4 为视频遮罩打通库样式与字体的 Shadow DOM 管线：只做实验渲染（临时开关控制的预览宿主），不改真实学习流程，可整体回滚。

### 1. 交付物

- **样式装载模块** `src/ui/island/shadow-styles.ts`：构建期以 Vite 的 `?raw` 查询把库发布 CSS 内联为字符串，运行时受控解析后产出"可直接注入 ShadowRoot 的 CSS 字符串"与字体清单：
  - 只把顶层 `:root{--animal-*}` 令牌声明段映射为 `:host`（项目内小型受控扫描器，处理字符串/注释/括号配对；不把 postcss 打进内容脚本，也不做整表正则替换）；
  - 相对资源 `url()` 重写为 `chrome.runtime.getURL` 的 chrome-extension 绝对路径（`data:` 与 `#fragment` 原样保留）；
  - 提取 `@font-face` 描述，由 `registerIslandFontFaces` 以 FontFace API 注册进 `document.fonts`（按文档幂等）；
  - 结果模块级缓存，首次注入解析一次；重复打开遮罩不重复解析、不重复注册。
- **PoC 预览组件** `src/ui/island/IslandShadowPreview.tsx`：原版 Card + Button 样例，局部样式用 `bingeup-` 前缀。
- **OverlayController 实验路径**：新增 `openIslandPreview(target, mode)`，与真实遮罩共用宿主创建、`display:block`、矩形刷新与清理机制；`bootstrap.ts` 新增临时的扩展内部消息 `ISLAND_POC_PREVIEW` / `ISLAND_POC_CLOSE`（仅扩展上下文可达，页面无法触发；M5 迁移后随 PoC 一并删除）。
- **构建期字体资产**：`wxt.config.ts` 的 `build:publicAssets` 钩子把库内 9 个 woff2 按库内相对路径复制到产物 `files/<name>.woff2`；`web_accessible_resources` 新增 `files/*.woff2`，matches 仅内容脚本支持站点（`*://*.bilibili.com/*`、`*://*.youtube.com/*`）。
- **构建产物校验** `scripts/verify-island-shadow-assets.mjs`：字体文件齐全（9 个、≥3 MB）、内容脚本内联 CSS 保留 `files/` 相对路径、无 base64 内联字体、无 Google Fonts/CDN 引用、WAR 范围正确；随 `npm run build` / `npm run build:edge` 执行。

### 2. 实测验证矩阵

| 验证项 | 方式 | 结果 |
| --- | --- | --- |
| `?inline` 在 WXT/Vite 8 的可用性与副作用 | 探针构建 + 真实构建 | 路径可用，但 **WXT 的 content script 走 Vite lib/IIFE 模式，lib 模式强制把字体资产 base64 内联**（`assetsInlineLimit` 无效）：content.js 由 208 KB 膨胀到 5.1 MB，注入样式约 4.6 MB。不可接受，改用 `?raw` + 构建期字体资产（受控方案） |
| `?raw` + `build:publicAssets` 管线 | 真实构建 + verify 脚本（Chrome/Edge） | 9 个 woff2 复制到 `files/`（3,563,300 B），content.js 346,395 B（+138,222 B） |
| `:root` 令牌声明段 → `:host` 受控映射 | 集成测试（输入真实库 CSS） | 输出含 `:host{--animal-primary-color …}`；无顶层 `:root{`；reset（`*{box-sizing}`、`[class^=animal-]`）保留 |
| reset 不影响宿主页 | e2e：页面元素 box-sizing/font-family/颜色/行高、文档滚动高度前后一致；light DOM 无 `animal-` 节点；head/body 无新增 | 通过 |
| 字体 `url()` 重写与 WAR 生效 | 集成测试 + 构建校验 + e2e | e2e 观测到 `chrome-extension://<id>/files/*.woff2` 200 响应；WAR 匹配仅支持站点 |
| Chromium 对 ShadowRoot 内 `@font-face` 的行为 | 最小实验（独立 Playwright 探针，非仓库存档） | **Chromium 不加载 ShadowRoot 内声明的 @font-face**：不发起字体请求，`document.fonts` 中不出现该字体；字体必须以 FontFace API 注册到 `document.fonts`（本次采用的等效实现） |
| 遮罩内原版 Button/Card 真实计算样式 | e2e（真实 Chromium + 真实 MV3 产物） | 主按钮：圆角 50px、背景 `#f8f8f0`、文字 `#794f27`、3D 阴影含 `#bdaea0 0 5px`、字体族含 Nunito/Noto Sans SC；小按钮高度 32px（`--animal-height-sm` 令牌，证明令牌映射生效）、字号 12px；Card：背景 `#f7f3df`、圆角 20px、字重 500 |
| 字体真实加载 | e2e：`document.fonts` 中 Nunito 与 Noto Sans SC 进入 `loaded`（中文子集走 chinese-simplified woff2） | 通过 |
| 宿主契约（display:block、根节点铺满、矩形刷新） | 既有 overlay-controller 单测 + 新增预览用例（fixed 宿主与播放器矩形一致） | 通过；真实遮罩既有测试未改动 |
| 重复打开/销毁无重复注入或泄漏 | 单测：重复打开仅 1 个宿主、close 后断开连接、无 document 级 style、无 body 新增节点；e2e 同断言 | 通过 |
| 注入缓存 | 集成测试：解析与资源解析只在首次调用发生 | 通过 |
| 无 CSP 报错 | e2e 控制台监听（`Refused to load` / `Content Security Policy`），合成页 | 无报错；真实站点 CSP 未验证（见第 4 节） |
| 门禁 | typecheck / npm test / lint / build / build:edge / e2e | 全绿：typecheck 通过；45 个测试文件、823 个用例；lint 通过；Chrome/Edge 构建（含新校验脚本）通过；e2e 8 通过 / 8 跳过（跳过为既有采集与人工矩阵占位） |

### 3. go/no-go 结论

**go（附带管线修正）**：库样式与字体可以在 Shadow DOM 内可靠工作，可以进入 M5 的遮罩全量迁移。管线在实测中做了两处必要修正：

1. **CSS 导入方式 `:inline` → `:raw`**：`:inline` 可用，但 WXT 的 content script 构建（Vite lib/IIFE 模式）会把字体强制 base64 内联，导致 content.js 5.1 MB、单次注入样式约 4.6 MB；`:raw` + `build:publicAssets` 让字体保持独立文件、按需加载（样式串约 126 KB）。
2. **字体注册方式 CSS `@font-face` → FontFace API**：Chromium 不处理 ShadowRoot 内声明的 `@font-face`；以 `document.fonts` 注册 FontFace（src 为 chrome-extension 绝对 URL）后，shadow 内文字可正常使用字体（e2e 实测 loaded）。注入样式里的 `@font-face` 规则保留，作为对支持该行为的实现的向前兼容。

已知管线限制（PoC 范围内接受，M5 处理）：

- 字体加载依赖宿主页 CSP 放行 chrome-extension 资源（真实站点未验证，见第 4 节）。
- 临时预览与学习遮罩共用控制器槽位：预览打开会顶掉已打开的学习遮罩（仅扩展内部测试/开发开关，页面不可触发）。

### 4. 未验证项（真实站点手测项）

| 项 | 原因 | 建议手测 |
| --- | --- | --- |
| 真实 B 站/YouTube 页面 CSP 下的字体加载 | 无真实站点环境；合成页无 CSP | 打开遮罩后 DevTools 确认无 CSP 报错，`document.fonts` 中 Nunito/Noto Sans SC 为 loaded |
| 真实站点上遮罩布局、全屏、竖屏、缩放与预览宿主一致性 | 同上 | 沿用人工验收矩阵 |
| 遮罩进入延迟在 content script 由 208 KB 增至 346 KB 后的变化 | 未测 | 在 M5 复测 M0 的进入延迟口径 |
| Edge 真机字体与样式 | 仅验证 edge-mv3 构建产物 | 人工矩阵 |
| 字体子集加载时机（中文子集按需加载）对首屏的影响 | 仅合成页观测 | 真实站点网络面板确认 |

### 5. 体积影响（vs M0 基线 3,580,581 B / 1,213,403 B zip）

| 指标 | 基线 | M4 后 | 差值 |
| --- | --- | --- | --- |
| 解包体积（34 → 43 个文件） | 3,580,581 B | 7,282,192 B | +3,701,611 B（其中字体 3,563,300 B） |
| 压缩包 zip | 1,213,403 B | 4,807,098 B | +3,593,695 B |
| content script（content.js） | 208,173 B | 346,395 B | +138,222 B（约 126 KB 库 CSS 字符串 + 字体注册代码） |
| Popup 入口闭包 | 166,685 B | 166,685 B | 0（未动页面） |

### 6. 复现命令

```powershell
git checkout codex/ticket-43-m4-shadow-poc
npm install
npx wxt prepare
npm run typecheck; npm test; npm run lint
npm run build; npm run build:edge
npm run zip; npm run zip -- -b edge
node scripts/measure-bundle-baseline.mjs
npx playwright test e2e/island-shadow-poc.spec.ts
```

### 7. 回滚说明

本工单的改动面（`src/ui/island/`、OverlayController 预览方法、bootstrap 临时消息、wxt.config 字体资产与 WAR、vitest 配置内联项、构建校验脚本）均可整体回滚：`git revert` M4 提交即可恢复 M0 行为；M5 正式迁移时删除 `ISLAND_POC_*` 临时开关与预览组件，保留样式装载模块与字体管线。

### 8. 合并集成分支（含 M1）后的复测与字体双份说明

本工单推送前已合并集成分支（42d5979，含工单 #38 M1 Popup 垂直切片）。合并后复测（Chrome 与 Edge 数字一致）：

| 指标 | M0 | M1（#38 记录） | M4 分支（仅 M0+M4） | 合并后（M0+M1+M4） |
| --- | --- | --- | --- | --- |
| 解包体积 | 3,580,581 B（34 文件） | 7,601,617 B（47 文件） | 7,282,192 B（43 文件） | 11,303,228 B（56 文件） |
| 压缩包 zip | 1,213,403 B | 4,855,896 B | 4,807,098 B | 8,449,591 B |
| content script | 208,173 B | 208,173 B | 346,395 B | 346,395 B |
| Popup 入口闭包 | 166,685 B | 308,756 B | 166,685 B | 308,756 B |

已知重复（合并后出现，M4 不单独引入）：M1 的页面入口由 Vite 正常打包，把 9 个 woff2 发射为 `assets/<name>-<hash>.woff2`（页面相对 URL）；M4 的内容脚本走 Vite lib/IIFE 模式，不能复用这组发射结果（lib 模式会把字体 base64 内联），因此按库内相对路径另行复制到 `files/` 并在 WAR 中开放。两套字体同时存在于产物中，约 3.4 MB 重复；无重复时 zip 预计约 4.9 MB（≈ M1 的 4.86 MB）。合并期评估过 `?no-inline` 导入：lib 模式下它发射为无哈希根路径文件，仍无法与页面资产同名去重。建议在 M5/M6 统一字体资产交付路径（一处发射、两处共用）；本工单保持两条路径各自独立、可分别回归。

## M6a 附属提示迁移

工单：#45（父 issue #36）｜分支：codex/ticket-45-m6a-notices（从集成分支 tip 559776a 切出）｜执行时间：2026-10-14。

启用提示与播放恢复提示完成原版化：两者都改用 M4 阴影管线（工单 #43：库样式令牌映射到 `:host` + FontFace 字体注册），各自拥有独立 ShadowRoot 与自身作用域宿主；启用提示的可见控件使用库原版 `Card`/`Button`，播放恢复提示按原版通知规范以 `var(--animal-*)` 令牌实现局部呈现（Portal 组件仍禁止在内容脚本使用）。宿主页无全局样式注入，行为语义（启用/暂不/已启用刷新提示/失败恢复/单一横幅；`role=status`/6 秒消失/`pointer-events: none`/恢复行为本身）保持不变。

### 1. 交付物

- **启用提示** `src/content/enable-prompt.tsx`（原 `.ts` 重命名）：React + 原版 `Card`/`Button` 在独立 ShadowRoot 内渲染，宿主只承担 `fixed` 定位（内联样式，light DOM 为空）；保留启用、暂不、已启用后「请刷新」提示、失败恢复按钮、单一横幅约束与全部回调语义。
- **播放恢复提示** `src/content/playback-recovery-notice.ts`：独立 ShadowRoot + 同一管线；容器以 `var(--animal-*)` 令牌上色（`--animal-bg-color` 羊皮纸底、`--animal-text-color` 暖棕文字、`--animal-border-color` 2px 边框、18px 圆角、`--animal-shadow-base` 阴影），不硬编码颜色；宿主 `pointer-events: none` 保证不拦截播放器。
- **单元测试**：`tests/unit/content/enable-prompt.test.ts`（新增 7 例）与 `tests/unit/content/playback-recovery-notice.test.ts`（重写 3 例），覆盖公开回调语义、单一横幅、6 秒消失与计时器替换、ShadowRoot 隔离（light DOM 为空、无 document 级 style、无 `animal-` 节点）与管线标记（`:host` 令牌、无 `:root`、字体 chrome-extension 绝对 URL）。
- **e2e** `e2e/island-notices.spec.ts`（新增，默认运行；截图采集用 `CAPTURE_M6A=1`）：真实 MV3 产物 + 合成 Bilibili 页面，覆盖原版计算样式、字体本地加载、启用/暂不/已启用交互、拒绝计数持久化，以及真实「视频未能自动继续」流程下的恢复提示呈现、命中测试穿透、6 秒消失与无泄漏/无 CSP 报错。

### 2. 实测验证矩阵

| 验证项 | 方式 | 结果 |
| --- | --- | --- |
| 启用提示原版计算样式 | e2e：主按钮圆角 50px、背景 `rgb(248, 248, 240)`、文字 `rgb(121, 79, 39)`、3D 阴影 `rgb(189, 174, 160) 0 5px`；Card 背景 `rgb(247, 243, 223)`、圆角 20px；字体族含 Nunito/Noto Sans SC | 通过 |
| 播放恢复提示原版样式 | e2e：背景 `rgb(248, 248, 240)`、文字 `rgb(121, 79, 39)`、圆角 18px、边框 `rgb(220, 216, 209)`、字体族含 Nunito | 通过 |
| 字体本地加载 | e2e：页面 woff2 请求全部为 `chrome-extension://`；Nunito 进入 loaded | 通过 |
| Shadow 隔离与宿主页无泄漏 | 单测 + e2e：宿主 `textContent` 为空；无 document 级 style；light DOM 无 `[class^="animal-"]` 节点；body 子元素数不变 | 通过 |
| 不拦截播放器交互 | e2e：提示中心 `elementFromPoint` 命中页面元素（DIV）且不在提示宿主内（`pointer-events: none`） | 通过 |
| 行为语义不变 | 单测 + e2e：启用/暂不/已启用「知道了」、启用失败恢复、单一横幅；拒绝计数经真实后台持久化为 1；6 秒自动消失；恢复流程代码未改动 | 通过 |
| 无 CSP 报错 | e2e 控制台监听（合成页） | 无报错；真实站点 CSP 未验证（见第 4 节） |
| 门禁 | typecheck / npm test / lint / build / build:edge / e2e | typecheck 通过；46 个测试文件、832 个用例全过；lint 通过（0 warning）；Chrome/Edge 构建（含既有校验脚本）通过；e2e 11 通过 / 13 跳过（跳过为既有人工矩阵与采集占位） |

### 3. 截图证据（合成 Bilibili 页面）

| 场景 | 文件 |
| --- | --- |
| 启用提示（初始询问态） | `docs/assets/migration-m6a/enable-prompt.png` |
| 启用提示（已启用/请刷新态） | `docs/assets/migration-m6a/enable-prompt-enabled.png` |
| 播放恢复提示（真实恢复失败流程） | `docs/assets/migration-m6a/playback-recovery-notice.png` |

采集命令：`$env:CAPTURE_M6A='1'; npx playwright test e2e/island-notices.spec.ts`（需先 `npm run build`）。

### 4. 未验证项（真实站点手测项）

| 项 | 原因 | 建议手测 |
| --- | --- | --- |
| 真实 B 站/YouTube CSP 下的提示样式注入 | 合成页无 CSP（与 M4 相同限制） | 触发提示后确认无 CSP 报错、样式与字体正常 |
| 真实站点上提示与播放器控件的叠加表现 | 合成页无真实播放器控件 | 人工验收矩阵：暂停/恢复、全屏、缩放、多标签 |
| Edge 真机字体与样式 | 仅验证 edge-mv3 构建产物 | 人工矩阵 |

### 5. 体积影响（vs M4 合并后基线）

| 指标 | M4 合并后 | M6a 后 | 差值 |
| --- | --- | --- | --- |
| 解包体积（56 文件） | 11,303,228 B | 11,302,738 B | −490 B |
| 压缩包 zip | 8,449,591 B | 8,449,527 B | −64 B |
| content script（content.js） | 346,395 B | 345,905 B | −490 B |
| Popup 入口闭包 | 308,756 B | 308,756 B | 0（未动页面） |

启用提示由内联蓝粉自绘样式改为库原版组件（React/库代码本就在内容脚本内），净减来自删除旧提示 CSS。

### 6. 复现命令

```powershell
git checkout codex/ticket-45-m6a-notices
npm install
npx wxt prepare
npm run typecheck; npm test; npm run lint
npm run build; npm run build:edge
npx playwright test e2e/island-notices.spec.ts
$env:CAPTURE_M6A='1'; npx playwright test e2e/island-notices.spec.ts
node scripts/measure-bundle-baseline.mjs
```
