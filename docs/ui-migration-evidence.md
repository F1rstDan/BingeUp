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

## M2 Popup 完整迁移与基础模块

工单：#39（父 issue #36）｜决策记录：docs/adr/0005-adopt-animal-island-ui.md｜分支：codex/ticket-39-m2-popup-complete（从集成分支 tip 42d5979 切出）

### 1. 改动概览

共享基础模块（新增，src/ui/island/；测试缝①）：

- IslandPage：页面外壳，渲染 <main>，可选可访问名称；IslandSection：区块容器，渲染带可见二级标题的 <section aria-labelledby>，标题行右侧提供操作插槽；IslandFooter：页脚，使用原版 Divider type="thin" 分隔并显式 role="contentinfo"。
- island-theme.css：--island-* 语义别名层。每个别名都通过 var() 桥接 animal-island-ui 在 :root 声明的 --animal-* 运行时令牌（兜底值取库 2.2.1 默认值，只用于库样式尚未生效的瞬间）；不新增颜色，不覆盖库令牌。
- island-layout.css：只做排布、间距与文字层级，颜色一律使用别名，不写死色值。
- 从 @/ui/island 入口导入时自动引入两份 CSS；只封装业务布局与语义，不重造库组件，供 #40/#41/#42 直接引用；与 M4 的 shadow-styles.ts / IslandShadowPreview.tsx 同目录但互不依赖。

Popup 完整迁移（src/ui/popup/PopupApp.tsx、src/entrypoints/popup/popup.css）：

- 标题栏：设置入口从齿轮 Unicode 字符改为原版 Button type="text" + naive-icons SettingsIcon（aria-label/title 仍为“设置”，点击语义不变）。
- 站点状态卡：自绘彩色圆点改为 naive-icons 状态图标（可学习 CheckCircle、暂停 Pause、需权限 AlertTriangle、不可用 Ban、待启用 Play），颜色使用 island 状态色；补上“不可用”独立色调。
- 今日学习：改用 IslandSection（二级标题 + 原版文字按钮“统计”），删除旧 “›” 字符与自绘文本按钮；7 个指标卡改用 island 底色与文字令牌，删除绿/粉着色类。
- 降级/加载失败/受保护/需权限状态卡与操作通知：由旧自绘块改为原版 Card；错误与提示文字改用 island 文案色与 error 色。
- 反馈页脚：FeedbackLink 改用 IslandFooter + island-link（原版分隔线；文案、href 与 target=_blank 语义不变）。该组件同时被设置页页脚使用，设置页页脚随之变为 island 样式，设置页正文迁移仍属 #41。
- popup.css 只保留布局职责：全部色值改用 --island-* 别名，删除旧蓝粉类（bingeup-popup-settings、bingeup-text-button、bingeup-block*、bingeup-site-dot*、bingeup-metric-green/-pink、bingeup-visually-hidden 等）。全局旧令牌（src/ui/styles/design-tokens.css）按范围要求未删除，仍由 #46 清理。
- 未改：消息链路、暂停/倒计时状态逻辑、站点判定、OverlayAction、用户可见文案语义、dev-tools 行为与生产排除规则。

### 2. 测试覆盖变化

- tests/unit/popup/PopupApp.test.tsx：新增 2 个用例（设置入口调用 chrome.runtime.openOptionsPage；“统计”在扩展页打开 stats.html），既有用例全部保留，未弱化断言。
- tests/unit/ui/island.test.tsx（新增，渲染测试）：主区域、区块 aria-labelledby 与标题语义、操作插槽、页脚 contentinfo、追加类名。
- tests/unit/ui/island-theme.test.ts（新增，静态规则）：island 布局 CSS 与 popup.css 不含 --bingeup 旧令牌与写死色值；别名层只桥接 --animal-*（只扫描 #39 自己引入的 CSS，不涉及 M4 的 Shadow 样式模块）。
- 测试规模（合并 M4 前，M2 分支）：44 文件 / 809 用例 → 46 文件 / 817 用例。

### 3. 截图（docs/assets/migration-m2/）

| 文件 | 状态 |
| --- | --- |
| popup-learnable-320.png / popup-learnable-340.png / popup-learnable-420.png | 可学习：图标状态卡 + Switch + 今日学习指标 + 原版按钮 + island 页脚 |
| popup-learnable-zoom200.png | 可学习，200% 缩放等效（物理 640px 宽） |
| popup-paused-340.png | 全局暂停：暂停图标 + Tag“已暂停” + 恢复倒计时 + 禁用开始学习 |
| popup-needs-permission-340.png | 需权限：警告图标 + 域名 Card + 禁用开始学习 |
| popup-join-site-340.png | 未加入 HTTPS 网站：不可用图标 + 原版“加入当前网站” |
| popup-degraded-340.png | 无活动标签页降级（error 色文案） |
| popup-protected-340.png | 受保护页面（chrome://settings/） |

复现命令（默认跳过，采集会覆盖同名 PNG）：

```powershell
$env:CAPTURE_M2='1'; npx playwright test e2e/migration-m2.spec.ts
```

采集运行时记录（.output/migration-m2-capture.json）：Nunito 与 Noto Sans SC 均 loaded；6 个字体响应全部为 chrome-extension:// 本地资源；320/340/420 与 200% 缩放均无横向溢出；console error 0、pageerror 0、失败请求 0。

### 4. 体积对比（M1 → M2，合并 M4 前的 M2 分支；Chrome 与 Edge 数字一致）

| 指标 | M1（#38） | M2（本次） | 差值 |
| --- | --- | --- | --- |
| 解包体积 | 7,601,617 B（47 文件） | 7,608,731 B（48 文件） | +7,114 B |
| 压缩包 zip | 4,855,896 B | 4,857,701 B | +1,805 B |
| Popup 入口闭包 | 308,756 B（9 文件） | 315,708 B（10 文件） | +6,952 B |
| content script | 208,173 B | 208,173 B | 0 |

Popup 闭包明细：popup JS 29,315 → 32,440 B（+3,125，新增 naive-icons 图标与 island 组件）；FeedbackLink JS 2,512 → 5,193 B（+2,681，引入原版 Divider 与 island 模块）；新增 FeedbackLink CSS 分块 2,368 B（island 主题与布局样式）；popup CSS 130,287 → 129,065 B（-1,222，旧样式清零）；design-tokens JS/CSS 不变。范围外成本（字体）与 M1 相同。

### 5. 门禁执行记录（合并 M4 前的 M2 分支）

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | npm run typecheck | 通过（退出码 0） |
| 单元/集成测试 | npm test | 通过（46 文件、817 用例） |
| Lint | npm run lint | 通过（退出码 0） |
| Chrome 构建 | npm run build | 通过（含 verify-content-script-manifest.mjs、verify-dev-tools-production.mjs） |
| Edge 构建 | npm run build:edge | 通过（同上） |
| 打包 | npm run zip / npm run zip -- -b edge | 通过（体积见第 4 节） |
| 浏览器 E2E（既有用例） | npm run test:e2e | 7 通过 / 18 跳过（人工占位 5 + M0 采集 3 + M1 采集 5 + M2 采集 5） |
| M2 采集 | $env:CAPTURE_M2='1'; npx playwright test e2e/migration-m2.spec.ts | 5 通过 |

### 6. 未验证项

| 项 | 原因 |
| --- | --- |
| 真实工具栏点击打开的 Popup（activeTab 上下文）与真实状态切换 | 与 M0/M1 相同：无头环境无法驱动浏览器工具栏；采集以受控上下文替换进入各状态，业务链路未改 |
| 真实浏览器 200% 缩放 | 用 CDP 设备指标做布局等效模拟，非浏览器缩放设置本身 |
| Edge 真实浏览器人工矩阵 | 仅验证 edge-mv3 构建产物 |
| 设置页页脚随 FeedbackLink 变为 island 样式后的全页视觉 | 设置页整体迁移属 #41，本轮只验证链接语义与渲染（含 e2e 反馈入口用例） |
| naive-icons 图标在深色系统主题、高倍缩放下的人工观感 | 本轮仅产物浅色截图 |
| 真实站点行为回归 | 本轮未改站点适配、触发/冷却、遮罩与学习链路；维持 M0 的人工矩阵口径 |

### 7. 复现步骤

```powershell
git checkout codex/ticket-39-m2-popup-complete
npm install
npx wxt prepare   # 生成 .wxt/tsconfig.json（未入库，vitest 与 tsc 依赖它）
npm run typecheck; npm test; npm run lint
npm run build; npm run build:edge
npm run zip; npm run zip -- -b edge
node scripts/measure-bundle-baseline.mjs
npm run test:e2e
$env:CAPTURE_M2='1'; npx playwright test e2e/migration-m2.spec.ts
```

### 8. 合并集成分支（含 M4 Shadow DOM PoC）后的复测

本工单推送前已合并集成分支（559776a，含工单 #43 M4 Shadow DOM 样式与字体 PoC）。合并后复测（Chrome 与 Edge 数字一致）：

| 指标 | M0 | M1（#38） | M4 分支（仅 M0+M4） | 合并后（M0+M1+M4+M2） |
| --- | --- | --- | --- | --- |
| 解包体积 | 3,580,581 B（34 文件） | 7,601,617 B（47 文件） | 7,282,192 B（43 文件） | 11,310,342 B（57 文件） |
| 压缩包 zip | 1,213,403 B | 4,855,896 B | 4,807,098 B | 8,451,396 B |
| content script | 208,173 B | 208,173 B | 346,395 B | 346,395 B |
| Popup 入口闭包 | 166,685 B | 308,756 B | 166,685 B | 315,708 B |

M2 增量与合并前一致：相对 M4 合并态（11,303,228 B / 56 文件 / zip 8,449,591 B）增加 +7,114 B、1 个文件与 +1,805 B zip；Popup 入口闭包 315,708 B 与合并前 M2 相同（M4 未改动页面入口）。合并后门禁复测：typecheck 通过；npm test 47 文件 / 831 用例通过；lint 通过；Chrome/Edge 构建通过（含 M4 新增的 verify-island-shadow-assets.mjs）；npm run test:e2e 8 通过 / 18 跳过；M2 采集 5 通过，且重新采集的截图与合并前字节一致。

相关提交（分支 codex/ticket-39-m2-popup-complete）：

1. 新增 island 共享页面基础模块（IslandPage/IslandSection/IslandFooter、主题别名层、布局 CSS 与测试）
2. Popup 完整原版化并清零旧蓝粉样式（标题栏/状态卡/今日学习/反馈页脚、单测更新与 M2 采集脚本）
3. 新增 M2 Popup 完整迁移证据文档与截图

## M3a 安装引导迁移

工单：#40（父 issue #36）｜决策记录：docs/adr/0005-adopt-animal-island-ui.md｜分支：codex/ticket-40-m3a-onboarding（从集成分支 tip e69640f 切出）

### 1. 改动概览

- `src/ui/onboarding/OnboardingApp.tsx`：欢迎、学习设置（水平与词库）、网站启用与完成状态全部换为 animal-island-ui 2.2.1 原版组件（Card/Radio/Checkbox/Button/Title），页面外壳与区块复用 @/ui/island 共享基础模块；未新增引导步骤。
  - 欢迎区：吉祥物 + 原版 Title 飘带（外层 h1 保留一级标题语义）+ 说明文案。
  - 学习设置：IslandSection + Card；水平与词库使用原版 Radio，选项沿用“名称 + 说明”两行文案；每组用 fieldset/legend 保留组标题语义（库 Radio 无 aria-label 透传，fieldset 是等效且标准的做法）。
  - 网站选择：原版 Checkbox 保持多选与 checkbox 角色语义，默认选中哔哩哔哩与 YouTube。
  - 完成状态：原版 Card + Title + Button；提交失败的错误信息改用 Card + island error 色。
  - 未改：messageClient.completeOnboarding 调用与提交内容（hostnames/deckId/selfRatedLevel）、阶段流转与全部可见文案语义；本页迁移前没有图标字符，迁移未新增图标需求。
- `src/entrypoints/onboarding/main.tsx`：入口新增 `import 'animal-island-ui/style'`（本入口恰好一次）。
- `src/entrypoints/onboarding/onboarding.css`：全量重写为布局职责，颜色只用 --island-* 语义别名，旧蓝粉类清零；页面宽度 min(100% - 32px, 560px) 居中。
- `scripts/measure-bundle-baseline.mjs`：新增 onboarding 入口闭包指标（只追加字段，既有输出不变）。
- `e2e/migration-m3a.spec.ts`：新增采集脚本（默认跳过）。
- 未改：全局旧令牌 src/ui/styles/design-tokens.css（#46 清理）、@/ui/island 既有导出签名、依赖与锁文件。

### 2. 测试覆盖变化

- `tests/unit/onboarding/OnboardingApp.test.tsx`：标题断言改为“一级标题 + 品牌名”；默认选中断言改为按角色与名称查询 radio 的选中态（不再绑定 input[value] 实现细节）；新增“结构语义”2 例（main 地标与命名区块、完成页 main 与关闭按钮）；网站/水平/词库的选择与提交语义用例保持原样。
- `tests/unit/ui/island-theme.test.ts`：新增 onboarding.css 静态规则（不引用 --bingeup、无写死色值）。
- 规模：47 文件 / 834 用例（M2 合并态记录为 831，本次 +3）。

### 3. 截图（docs/assets/migration-m3a/）

| 文件 | 状态 |
| --- | --- |
| onboarding-select-760.png / onboarding-select-560.png / onboarding-select-360.png | 首屏默认状态：吉祥物 + Title 飘带 + 学习设置 Card（水平/词库 Radio）+ 默认支持网站 Card（Checkbox）+ 原版主按钮 |
| onboarding-select-zoom200.png | 200% 缩放等效（CDP：CSS 视口 360、DSF 2 → 物理 720），无横向溢出 |
| onboarding-focus-level-radio.png | 键盘 Tab 落点（当前选中的水平单选）的黄色焦点轮廓 |
| onboarding-focus-primary-button.png | Tab 到主按钮、过渡结束后的薄荷焦点轮廓 |
| onboarding-done-760.png | 完成状态：Card + Title 飘带 + 默认按钮“关闭” |

复现命令（该 spec 默认跳过，不参与 npm run test:e2e 的常规执行；采集会覆盖同名 PNG）：

```powershell
$env:CAPTURE_M3A='1'; npx playwright test e2e/migration-m3a.spec.ts
```

采集运行时记录（.output/migration-m3a-capture.json）：

- 字体：Nunito 与 Noto Sans SC 均 loaded；6 个字体响应全部为 chrome-extension:// 本地资源。
- 控制台：console error 0、pageerror 0、失败请求 0。
- 宽度：760/560/360 与缩放等效（360 @ DSF2）均 scrollWidth == clientWidth，无横向溢出。
- 键盘：首个 Tab 落在当前选中的水平单选（roving tabindex）；ArrowDown 切换到下一档并保持焦点；焦点轮廓为原版样式——单选 rgb(245,195,28)（黄）2px、主按钮 rgb(25,200,185)（薄荷）2px（按钮带 transition: all，读取在过渡结束后进行）。
- 完成状态：默认选择（两站启用、水平一般、词库日常高频）提交后进入完成页，文案与迁移前一致。

采集脚本在打开引导页前先访问设置页做首启预热：安装后后台会自动打开引导页（onInstalled），首启直接导航会偶发 ERR_ABORTED；该处理只影响采集脚本，与产品行为无关。

### 4. 体积对比（M2 合并态 → M3a，合并集成分支前；Chrome 与 Edge 数字一致）

| 指标 | M2 合并态（起点 e69640f） | M3a（本分支） | 差值 |
| --- | --- | --- | --- |
| 解包体积 | 11,310,342 B（57 文件） | 11,314,284 B（58 文件） | +3,942 B |
| 压缩包 zip | 8,451,396 B | 8,453,840 B | +2,444 B |
| Onboarding 入口闭包 | 161,015 B（9 文件） | 302,582 B（11 文件） | +141,567 B |
| Popup 入口闭包 | 315,708 B（10 文件） | 315,856 B（11 文件） | +148 B |
| content script | 346,395 B | 346,395 B | 0 |

明细：引导页 JS 5,256 → 11,259 B（+6,003，原版 Radio/Checkbox/Title 运行时代码）；island 模块与库公共代码改为共享分块（island 5,720 B、库分块 6,579 B），供 Popup 与引导页共用；库样式成为独立共享分块 126,298 B（迁移前内联在 Popup CSS 129,065 B 中），引导页引用共享分块不新增字节；页面自身 CSS 4,059 → 1,656 B（旧样式清零）。解包净增 3,942 B，zip 净增 2,444 B。

### 5. 门禁执行记录（合并集成分支前）

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | npm run typecheck | 通过（退出码 0） |
| 单元/集成测试 | npm test | 通过（47 文件、834 用例） |
| Lint | npm run lint | 通过（退出码 0，含新增 e2e 采集脚本） |
| Chrome 构建 | npm run build | 通过（含 verify-content-script-manifest.mjs、verify-dev-tools-production.mjs、verify-island-shadow-assets.mjs） |
| Edge 构建 | npm run build:edge | 通过（同上） |
| 打包 | npm run zip / npm run zip -- -b edge | 通过（体积见第 4 节） |
| 浏览器 E2E（既有用例） | npm run test:e2e | 8 通过 / 21 跳过（人工占位 5 + M0 采集 3 + M1 采集 5 + M2 采集 5 + M3a 采集 3） |
| M3a 采集 | $env:CAPTURE_M3A='1'; npx playwright test e2e/migration-m3a.spec.ts | 3 通过 |

### 6. 未验证项

| 项 | 原因 |
| --- | --- |
| 首次安装自动打开引导页路径的人工观感 | 无头环境直接打开 onboarding.html；onInstalled 行为本身未改，采集脚本以设置页预热规避首启竞态 |
| Edge 真机人工矩阵 | 仅验证 edge-mv3 构建产物 |
| 深色系统主题与强制大字体的人工观感 | 仅产物浅色截图（与 M2 相同口径） |
| 真实浏览器 200% 缩放 | 用 CDP 设备指标做布局等效模拟（与 M1/M2 口径一致） |

### 7. 复现步骤

```powershell
git checkout codex/ticket-40-m3a-onboarding
npm install
npx wxt prepare
npm run typecheck; npm test; npm run lint
npm run build; npm run build:edge
npm run zip; npm run zip -- -b edge
node scripts/measure-bundle-baseline.mjs
npm run test:e2e
$env:CAPTURE_M3A='1'; npx playwright test e2e/migration-m3a.spec.ts
```

### 8. 合并集成分支（含 M3c 统计页迁移）后的复测

本工单推送前已合并集成分支（59b0d1f，含工单 #42 M3c 学习统计页迁移；合并提交 10a9d34）。合并后复测（Chrome 与 Edge 数字一致）：

| 指标 | 基线 e69640f | M3a 分支（合并前） | 合并后（含 M3c） |
| --- | --- | --- | --- |
| 解包体积 | 11,310,342 B（57 文件） | 11,314,284 B（58 文件） | 11,316,599 B（58 文件） |
| 压缩包 zip | 8,451,396 B | 8,453,840 B | 8,455,734 B |
| Onboarding 入口闭包 | 161,015 B（9 文件） | 302,582 B（11 文件） | 302,568 B（10 文件） |
| Popup 入口闭包 | 315,708 B（10 文件） | 315,856 B（11 文件） | 315,970 B（11 文件） |
| content script | 346,395 B | 346,395 B | 346,395 B |

合并后的分块重组（island 样式并入 design-tokens 分块、公共代码分块改名）不改变页面加载内容：引导页仍加载库样式（126,298 B 共享分块）与 island 样式和交互脚本，产物内检索确认两者均在。合并后门禁复测：typecheck 通过；npm test 48 文件 / 841 用例通过；lint 通过；Chrome/Edge 构建通过（含三个校验脚本）；npm run test:e2e 8 通过 / 23 跳过（含 M3c 采集 2 项默认跳过）；M3a 采集 3 通过，并按合并后产物重新采集截图（6 个文件与合并前字节差 −2,417 至 −98 B，属渲染噪声；onboarding-done-760.png 字节一致）。

相关提交（分支 codex/ticket-40-m3a-onboarding）：

1. 安装引导全量原版化并清零旧蓝粉样式（工单 #40）
2. 新增 M3a 引导页采集脚本与引导入口闭包测量（工单 #40）
3. 新增 M3a 安装引导迁移证据文档与截图（工单 #40）

## M3b 设置页迁移

工单：#41（父 issue #36）｜决策记录：docs/adr/0005-adopt-animal-island-ui.md｜分支：codex/ticket-41-m3b-options（从集成分支 tip e69640f 切出）

### 1. 改动概览

设置页（src/ui/options/OptionsApp.tsx、src/entrypoints/options/options.css、src/entrypoints/options/main.tsx）：

- 入口新增恰好一次的原版样式导入 `animal-island-ui/style`（与 Popup/Stats 一致）；全局旧令牌（design-tokens.css）未删除，属工单 #46。
- 页面外壳改用 island 共享基础模块（IslandPage）；学习设置、网站管理、数据管理三个分区改用原版 Tabs（方向键/Home/End 切换与 tabpanel 语义随库提供）。
- 控件全部原版化：Switch（拼写题、连续跳过自动降频、长视频定时学习、站点启用、基础网页两种触发）、Input（数字/文本）、Card（分区与站点行）、Button（保存/恢复默认/添加网站/导出/导入/删除/清除/重试）、Tag（站点状态与兼容模式徽标）。
- 自绘下拉替换评估：读锁定版 2.2.1 类型声明与小抄后确认可直接替换——`options` 为 `{key,label}[]`、`value` 与 `onChange` 使用 key，与旧组件逐项映射；库内实现为 APG combobox/listbox（aria-expanded/aria-controls/aria-activedescendant、方向键/Home/End/Enter/Escape、点击外部关闭）。旧组件支持词库描述插槽，原版 Select 无描述位，词库说明不再在下拉内展示；这是替换评估中唯一的能力差异。评估结论：删除自绘 DropdownSelect 与其样式，直接使用原版受控 Select。
- 危险数据操作确认：window.confirm 改为原版 Modal（扩展独立页面允许；variant="game"、typewriter={false}、maskClosable={false}）。清除学习进度与清除全部数据各一次确认；重建数据库保留原有两步确认（“继续” → “最后确认/确定执行”）。确认文案与原 window.confirm 文案一致；确认后仍走原有清除/重建调用链与通知，原子恢复语义不变。关闭打字机是刻意选择：确认弹窗需要完整风险文案立即可读（typewriter 为库官方属性，不是视觉改造）。
- options.css 只保留布局职责：颜色/圆角/间距一律改用 --island-* 语义别名（桥接库 --animal-* 令牌），旧蓝粉类清零；旧蓝粉令牌文件与其导入按范围保留。
- 未改：消息链路、站点触发保存链路、保存/恢复默认/导出/导入/清除/重建的行为与通知文案、词库数据与设置字段语义。

### 2. Tabs 集成适配（页面级布局，理由与范围）

| 适配 | 原因 | 实现 |
| --- | --- | --- |
| 放开 Tabs 容器 overflow | 库容器默认 overflow:hidden 会裁剪 Select 侧边下拉面板（面板是组件根节点的绝对定位子元素） | .bingeup-options .bingeup-tabs { overflow: visible; }，并把表头两角按容器内圆角补齐 |
| 窄视口下拉改为触发区下方 | 库按视口空间决定面板在触发区左右侧展开；≤540px 时两侧都没有约 200px 空间，面板会越出视口 | @media (max-width: 540px) 内用 [role='listbox'] 稳定角色选择器以 !important 覆盖内联定位（仅位置，不改颜色与形状） |
| ≤400px 收紧表头内边距 | 极窄视口三个标签会折行成两行 | 仅调整 tablist/tab 的 padding、gap 与字号 |

以上均为布局适配；未改库组件的颜色、圆角、阴影与动效。

### 3. 测试覆盖变化

- tests/unit/options/OptionsApp.test.tsx：27 → 30 用例。更新因组件替换变化的查询（combobox/option/switch/tab/dialog + within 限定作用域），新增：原版受控 Select 点击选择后随保存写回、键盘方向键/Enter/Escape 交互、Modal 取消不执行清除、两步确认后重建、重建第一步取消不执行；原有行为断言全部保留，未弱化。
- tests/unit/options/DropdownSelect.test.tsx：随自绘组件删除；下拉选择与键盘交互断言迁移到页面级（OptionsApp）后保留。
- tests/unit/ui/island-theme.test.ts：追加设置页样式静态规则（不含 --bingeup 旧令牌与写死颜色）。
- e2e/options.spec.ts：断言改为角色与可访问名称（spinbutton/combobox/switch/tab）；新增「学习水平原版 Select 修改并保存」「键盘切换分区」「Modal Escape 取消、确认执行、滚动锁定与焦点恢复」。
- e2e/migration-m3b.spec.ts（新增，默认跳过）：M3b 采集脚本。
- 测试规模：M3b 分支（合并 M3c 前）46 文件 / 831 用例（删自绘组件 1 个文件 4 个用例，新增 OptionsApp 3 个与静态规则 1 个用例）；合并 M3c 后 47 文件 / 838 用例。

### 4. 键盘、焦点与窄宽度（真实 MV3 产物 e2e 实测）

| 项 | 结果 |
| --- | --- |
| 字体 | Nunito 与 Noto Sans SC 均 loaded；7 个字体响应全部为 chrome-extension:// 本地资源 |
| 控制台 | console error 0、pageerror 0、失败请求 0 |
| 横向溢出 | 1280 / 420 / 360 / 320 与 200% 缩放等效（CSS 视口 640）均为 scrollWidth = clientWidth |
| Select 面板（320px 打开） | 面板完整位于视口内（x=58、宽 88、右缘 146 ≤ 320），无横向溢出 |
| Modal | 打开时 body overflow=hidden、焦点落入对话框（取消按钮）；Escape/取消关闭后滚动恢复、焦点回到触发按钮 |
| 键盘 | Tabs 方向键/Home/End 切换（e2e）；Select ArrowDown/Enter/Escape（单测）；Switch 为原生按钮，Space/Enter 可用（库实现） |

### 5. 截图（docs/assets/migration-m3b/）

| 文件 | 状态 |
| --- | --- |
| options-learning-1280.png | 学习设置：Tabs + 原版 Select/Switch/Input/Card/Button |
| options-learning-420.png / -360.png / -320.png | 窄宽度：表头单行、字段堆叠、无横向溢出 |
| options-select-open-320.png | 320px 打开原版 Select：面板在触发区下方、完整可见 |
| options-learning-zoom200.png | 200% 缩放等效（CSS 视口 640px）：行布局、无溢出 |
| options-sites-1280.png | 网站管理：站点 Card + Tag + 启用 Switch + 触发开关 + 删除 |
| options-data-1280.png | 数据管理：导出/导入 + 危险清除按钮 |
| options-modal-clear-1280.png | 原版 Modal（game 外框）：标题、确认文案、取消/危险确认按钮 |

复现命令（默认跳过，采集会覆盖同名 PNG）：

```powershell
$env:CAPTURE_M3B='1'; npx playwright test e2e/migration-m3b.spec.ts
```

采集运行时记录（.output/migration-m3b-capture.json）：字体与溢出数字见上表；采集在截图前等待库入场动效结束（tabpanel 淡入 0.25s、Modal 缩放 0.3s、下拉淡入 0.2s），避免截图停留在动画起始帧。200% 缩放等效以 CSS 视口 640px 直接设定，不再与 Playwright 视口模拟混用 CDP 设备指标（混用会导致合成尺寸与布局不一致，本次复核后改为纯视口设定）。

### 6. 体积对比（Chrome 与 Edge 数字一致）

M3b 分支 vs 其基线 e69640f：

| 指标 | 基线（e69640f） | M3b 分支 | 差值 |
| --- | --- | --- | --- |
| 解包体积 | 11,310,342 B（57 文件） | 11,318,976 B（57 文件） | +8,634 B |
| 压缩包 zip | 8,451,396 B | 8,455,376 B | +3,980 B |
| content script | 346,395 B | 346,395 B | 0 |
| Popup 入口闭包 | 315,708 B | 315,729 B | +21 B |
| Options 入口闭包 | 未单独测量 | 331,993 B（9 文件） | —（测量脚本本次补充该指标，只增字段） |

合并 M3c（59b0d1f）后复测：

| 指标 | 合并后（含 M3c） |
| --- | --- |
| 解包体积 | 11,319,624 B（58 文件） |
| 压缩包 zip | 8,457,252 B |
| content script | 346,395 B |
| Popup 入口闭包 | 315,821 B |
| Options 入口闭包 | 332,261 B |

说明：设置页引入库样式后，Vite 把库 CSS/JS 合并为跨入口共享 chunk（如 FeedbackLink-*.css 128,665 B 同时服务 Popup/Stats/Options，不重复计入安装包）；Options 入口闭包包含该共享分块、design-tokens 分块与页面自身分块。合并后重新采集：8/9 张截图字节一致，options-select-open-320.png 因下拉面板动画时序有微小差异（SHA 不同，画面内容一致）。

### 7. 门禁执行记录

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | npm run typecheck | 通过（退出码 0） |
| 单元/集成测试 | npm test | M3b 分支 46 文件 / 831 用例通过；合并 M3c 后 47 文件 / 838 用例通过 |
| Lint | npm run lint | 通过（退出码 0） |
| Chrome 构建 | npm run build | 通过（含 verify-content-script-manifest / verify-dev-tools-production / verify-island-shadow-assets） |
| Edge 构建 | npm run build:edge | 通过（同上） |
| 打包 | npm run zip / npm run zip -- -b edge | 通过（体积见第 6 节） |
| 浏览器 E2E（既有用例） | npx playwright test | M3b 分支 11 通过 / 21 跳过；合并 M3c 后 11 通过 / 23 跳过（跳过为既有采集与人工矩阵占位） |
| M3b 采集 | $env:CAPTURE_M3B='1'; npx playwright test e2e/migration-m3b.spec.ts | 3 通过（合并后复测同样通过） |

### 8. 未验证项

| 项 | 原因 |
| --- | --- |
| 真实浏览器（非 headless）下的过渡观感（Modal 缩放/遮罩、Tabs 淡入） | 采集为 headless 渲染；过渡由库 CSS 决定，未人工比对 |
| 浏览器真实 200% 缩放设置 | 以 CSS 视口 640px 作布局等效，非浏览器缩放设置本身（本次未采集 DSF 2 截图） |
| 浏览器“字体大小/最小字号”偏好下的大字体 | 库与页面均以 px 为尺寸单位，未单独模拟该偏好 |
| Edge 真实浏览器人工矩阵 | 仅验证 edge-mv3 构建产物（与 Chrome 字节一致） |
| 屏幕阅读器真机朗读抽查 | 可访问名称与角色由单测/e2e 覆盖，未做真机朗读 |
| 词库描述信息 | 原版 Select 无描述插槽，词库说明不再在下拉内展示（替换评估结论，见第 1 节）；工单 #47 已恢复为 Select 下方辅助文本（见 M6b 第 6 节） |

### 9. 复现步骤

```powershell
git checkout codex/ticket-41-m3b-options
npm install
npx wxt prepare
npm run typecheck; npm test; npm run lint
npm run build; npm run build:edge
npm run zip; npm run zip -- -b edge
node scripts/measure-bundle-baseline.mjs
npx playwright test
$env:CAPTURE_M3B='1'; npx playwright test e2e/migration-m3b.spec.ts
```

相关提交（分支 codex/ticket-41-m3b-options）：

1. 设置页迁移到 Animal Island 原版组件（工单 #41）
2. 合并集成分支 feat/animal-island-ui-migration（含 M3c 统计页迁移）
3. 新增 M3b 设置页迁移证据与截图（工单 #41）

## M3c 学习统计迁移

工单：#42（父 issue #36）｜决策记录：docs/adr/0005-adopt-animal-island-ui.md｜分支：codex/ticket-42-m3c-stats（从集成分支 tip e69640f 切出）

### 1. 改动概览

统计页（src/ui/stats/StatsApp.tsx、src/entrypoints/stats/stats.css、src/entrypoints/stats/main.tsx）：

- 页面外壳与区块复用 island 共享基础模块（IslandPage / IslandSection）；入口新增恰好一次的原版样式导入 `animal-island-ui/style`，导入顺序与 Popup 一致。
- 概览 4 个指标卡改为原版 Card；今日学习明细、近 7 日趋势、默认支持网站、全期长期复习表现改为原版 Card 承载的明细行（文案与行顺序不变）。
- 当前学习卡状态：自绘堆叠条 + 图例改为每阶段一行「原版 Tag（阶段色）+ 数量 + 原版 Progress（占全部学习卡的占比）」；空状态改用原版虚线 Card，文案不变（“还没有学习卡”）。
- 全期长期复习“正确率”改用原版 Progress（infoFormat 保留 “—/x%” 文案）；周对比两列改为原版 Card。
- 页面内容按原版 Tabs 分为「今日 / 趋势 / 网站」三个标签：统计口径、数值与空/非空状态不变，未引入打卡、游戏等级或虚构进度。
- stats.css 只保留布局职责：颜色一律使用 --island-* 语义别名，旧蓝粉类清零；Tabs 按钮补原版黄色焦点环（库内 Tabs 未定义 focus-visible，否则会落到 design-tokens.css 的旧蓝色焦点环）。全局旧令牌（design-tokens.css）未删除，属工单 #46。
- 未改：StatsService 统计口径、数据库读取链路、Popup/后台消息、任何业务语义。

### 2. 测试覆盖变化

- tests/unit/stats/StatsApp.test.tsx（新增，测试缝①）：6 个用例覆盖默认「今日」标签的概览/明细/卡状态、空状态（“还没有学习卡” + 概览零值）、非空状态（Tag + 3 条 Progress 的 aria-valuenow 50/25/25）、「趋势」标签（近 7 日行、周对比、全期正确率 67% 与 progressbar）、「网站」标签（已启用/已关闭 + 连续启用天数）、数据库不可用时的加载失败状态。
- tests/unit/ui/island-theme.test.ts：追加统计页样式静态规则用例（stats.css 不含 --bingeup 旧令牌与写死颜色）。
- e2e/stats.spec.ts：未改（h1「学习统计」保留，断言继续通过）。
- 测试规模：47 文件 / 831 用例 → 48 文件 / 838 用例。

### 3. 截图（docs/assets/migration-m3c/）

| 文件 | 状态 |
| --- | --- |
| stats-empty-today.png | 空状态「今日」：零值概览 + 明细“—” + 虚线卡“还没有学习卡” |
| stats-empty-today-narrow.png | 空状态「今日」，480px 窄宽度 + 键盘焦点：无横向溢出，激活标签显示原版黄色焦点环 |
| stats-empty-trend.png | 空状态「趋势」：近 7 日零值、周对比 0/0、全期 0 与“—” |
| stats-seeded-today.png | 非空「今日」：概览 5/6/2/6、今日学习 10 行、卡状态 Tag+Progress（7/4/2） |
| stats-seeded-trend.png | 非空「趋势」：近 7 日、周对比（本周 9 · 78% / 上周 6 · 67%）、全期正确率 67% |
| stats-seeded-sites.png | 非空「网站」：bilibili 已启用 · 连续启用 5 天；youtube 已关闭 · 连续启用 0 天 |

复现命令（默认跳过，采集会覆盖同名 PNG）：

```powershell
$env:CAPTURE_M3C='1'; npx playwright test e2e/migration-m3c.spec.ts
```

采集运行时记录（.output/migration-m3c-capture.json）：Nunito 与 Noto Sans SC 均 loaded；字体响应全部为 chrome-extension:// 本地资源（空状态 7 个响应）；console error 0、pageerror 0、失败请求 0；1120px 与 480px 视口均无横向溢出；键盘 Tab 落在激活标签（●今日）上。采集脚本在截图前强制一帧并等待过渡结束（headless 下无帧时 CSS 过渡会停在起始值，导致 Tab 高亮滞后）；非空数据经真实消息链路完成引导/站点启用后直接写入 IndexedDB（仅采集用，统计读取与聚合链路不变）。

### 4. 体积对比（M2 合并态 e69640f → 本次；Chrome 与 Edge 数字一致）

| 指标 | 基线（e69640f） | M3c | 差值 |
| --- | --- | --- | --- |
| 解包体积 | 11,310,342 B（57 文件） | 11,313,022 B（59 文件） | +2,680 B |
| 压缩包 zip | 8,451,396 B | 8,453,981 B | +2,585 B |
| content script | 346,395 B | 346,395 B | 0 |
| Popup 入口闭包 | 315,708 B | 315,924 B | +216 B |
| Stats 入口闭包 | 177,277 B（8 文件） | 321,623 B（11 文件） | +144,346 B |

说明：统计页入口首次引入原版样式与组件后，Vite 将库 CSS/JS 改为跨入口共享 chunk（dist-*.css 126,298 B、dist-*.js 10,766 B、island-*.js 2,994 B），Popup 闭包内原来的 popup.css（129,065 B）随之拆分为共享库样式 + 页面样式（2,768 B）。因此 Stats 入口闭包增幅主要来自与 Popup 共用的共享 chunk（不重复计入安装包）；包级净增仅 +2,680 B（统计页 JS +2,415 B 与新增小文件）。

### 5. 门禁执行记录

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | npm run typecheck | 通过（退出码 0） |
| 单元/集成测试 | npm test | 通过（48 文件、838 用例） |
| Lint | npm run lint | 通过（退出码 0） |
| Chrome 构建 | npm run build | 通过（含 verify-content-script-manifest / verify-dev-tools-production / verify-island-shadow-assets） |
| Edge 构建 | npm run build:edge | 通过（同上） |
| 打包 | npm run zip / npm run zip -- -b edge | 通过（体积见第 4 节） |
| 浏览器 E2E（既有用例） | npx playwright test | 8 通过 / 20 跳过（新增 2 个 M3c 采集默认跳过） |
| M3c 采集 | $env:CAPTURE_M3C='1'; npx playwright test e2e/migration-m3c.spec.ts | 2 通过 |

### 6. 未验证项

| 项 | 原因 |
| --- | --- |
| 真实浏览器（非 headless）下的 Tab 切换过渡观感 | 采集在 headless 下以帧预热补齐；真实浏览器过渡由库 CSS 决定，未人工比对 |
| 统计页数据长期积累后的观感（大量学习卡、长日期文案） | 采集使用固定种子数据（13 张卡、15 条日志） |
| 浏览器真实 200% 缩放 | 未采集缩放截图；仅验证 1120px 与 480px 视口 |
| Edge 真实浏览器人工矩阵 | 仅验证 edge-mv3 构建产物（与 Chrome 字节一致） |
| 中文字体子集在统计页的按需加载时机 | 仅记录 document.fonts 状态（Nunito 与 Noto Sans SC loaded） |

### 7. 复现步骤

```powershell
git checkout codex/ticket-42-m3c-stats
npm install
npx wxt prepare
npm run typecheck; npm test; npm run lint
npm run build; npm run build:edge
npm run zip; npm run zip -- -b edge
node scripts/measure-bundle-baseline.mjs
npx playwright test
$env:CAPTURE_M3C='1'; npx playwright test e2e/migration-m3c.spec.ts
```

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

## M5 视频遮罩全量迁移

工单：#44（父 issue #36）｜分支：codex/ticket-44-m5-overlay（从集成分支 tip 559776a 切出）｜执行时间：2026-10-14。

### 1. 交付概览

- `src/ui/overlay/OverlayApp.tsx`：全部状态迁移为原版视觉——新词展示、选择题、拼写题、答题反馈（答对/答错）、连续学习徽标与上一题反馈、评分纠正。主卡使用库 `Card`（羊皮纸底）；操作使用库 `Button`（primary/default/dashed）；拼写输入使用库 `Input`；连续徽标使用库 `Tag`；结果与选中图标使用 naive-icons（`CheckIcon` / `CheckCircleIcon` / `XCircleIcon`），替换原 ✓/✗ Unicode 符号。选项行与已知状态区为本项目局部呈现组件，只以 `var(--animal-*)` 令牌着色。
- `src/content/overlay-controller.tsx`：真实学习遮罩接入 M4 管线——`getIslandShadowStyleBundle()`（:root 令牌 → :host 映射 + chrome-extension 字体 URL 重写，`?raw` 方案）与 `registerIslandFontFaces()`（FontFace API，按文档幂等）。ShadowRoot 样式分三段注入：`reset`（`:host { all: initial }`）→ 库发布 CSS → 遮罩 shell；shell 只承担布局与自定义元素的令牌着色，不覆盖库组件的颜色/圆角/阴影。遮罩底层使用原版 mask 令牌 `var(--animal-mask-bg)`（实测 rgba(0, 0, 0, 0.35)）。
- 卡片滚动与可见性：`.bingeup-overlay` 保持绝对定位铺满宿主（absolute + inset 0 + grid 居中，padding 15px）；卡片 `width: min(470px, 100%)`、`max-height: 100%`、`overflow-y: auto`、`overscroll-behavior: contain`，内容超出时只在卡片内部滚动。
- 删除 M4 临时路径：`src/ui/island/IslandShadowPreview.tsx`、`OverlayController.openIslandPreview`、`ISLAND_POC_PREVIEW` / `ISLAND_POC_CLOSE` 扩展内部消息与 bootstrap 监听及相关测试钩子。
- 错误边界回退界面迁移为原版 `Card` / `Button` 与 `AlertCircleIcon`（`OverlayErrorFallback`），并补充单元测试。
- 动效：库组件自带 `--animal-motion-duration-base`（0.25s）与 `cubic-bezier(0.4, 0, 0.2, 1)`；自定义选项行使用 `--animal-motion-duration-fast`（0.15s）与同一缓动，并在 `prefers-reduced-motion: reduce` 下关闭过渡。

零行为变化：OverlayAction 语义、快捷键（1–4 / A–D / Enter / Shift+Enter / Escape）、评分纠正、暂停/恢复与恢复保护、遮罩几何契约（host display:block、根节点铺满、目标矩形刷新）均未改动。

### 2. 单元/集成测试更新

- `tests/unit/ui/OverlayApp.test.tsx`：选中状态查询改为 `aria-pressed` 并断言选中图标存在；✓/✗ 文本断言改为 naive-icons SVG 存在性；删除冻结 CSS 类名的断言。其余行为断言保持原强度。
- `tests/unit/content/overlay-controller.test.ts`：M4 预览用例改为真实遮罩用例——库样式注入（:host 令牌、chrome-extension 字体 URL、无 :root、无旧玻璃/旧令牌）、字体注册幂等、无宿主文档泄漏、重复打开单宿主与清理、目标矩形刷新；新增 `OverlayErrorFallback` 用例。
- `tests/unit/content/bootstrap.test.ts`：删除 PoC 消息断言与预览组件 mock；启动诊断用例用最小库模块占位，避免每个 `vi.resetModules()` 用例重新求值完整组件图（避免全量测试下的超时）。

### 3. e2e 验证矩阵（合成 Bilibili 页面，真实 MV3 产物）

`e2e/overlay-island-migration.spec.ts`（替代 M4 的 `e2e/island-shadow-poc.spec.ts`；自然触发或 `START_CONTINUOUS_LEARNING` 回退打开真实遮罩）：

| 验证项 | 结果 |
| --- | --- |
| 宿主机契约 | fixed 宿主 `display:block`、`box-sizing:border-box`，矩形与播放器一致 | 通过 |
| ShadowRoot 计算样式 | Card rgb(247, 243, 223) / 20px 圆角 / 500 字重；Button 50px 胶囊、`transition 0.25s cubic-bezier(0.4, 0, 0.2, 1)`；:host 令牌 `--animal-primary-color` = #19c8b9 | 通过 |
| 遮罩底层 | `.bingeup-overlay` 背景 rgba(0, 0, 0, 0.35)（mask 令牌）；`backdrop-filter: none`，无旧玻璃风格 | 通过 |
| 字体 | Nunito 与 Noto Sans SC 进入 loaded；woff2 响应全部为 `chrome-extension://` 且 200 | 通过 |
| 宿主页副作用 | head/body 计数、探针样式、文档滚动高度前后一致；light DOM 无 `animal-*` 节点 | 通过 |
| 16:9 / 9:16 布局 | 卡片完整落在播放器矩形内 | 通过 |
| 小窗滚动 | 卡片 scrollHeight > clientHeight（样例 310 > 170）；滚轮只滚动卡片（scrollTop > 0）而 window.scrollY 保持 0；滚到末端后继续滚仍为 0（overscroll-behavior: contain） | 通过 |
| Escape 退出 | 遮罩宿主移除，页面 DOM 恢复 | 通过 |
| CSP / 控制台 | 无 CSP / Refused to load 报错，无 pageerror | 通过 |

命令：`npx playwright test e2e/overlay-island-migration.spec.ts`。

### 4. 截图（docs/assets/migration-m5/）

| 文件 | 状态 |
| --- | --- |
| overlay-16x9.png | 新词展示（合成页自然触发的单题模式） |
| overlay-16x9-new-word.png | 连续模式新词展示（含"连续学习"徽标） |
| overlay-16x9-question.png | 选择题（连续学习 + 选项 + 快捷键提示） |
| overlay-16x9-question+feedback.png | 上一题反馈（答错 + 图标 + 正确答案）与下一题 |
| overlay-9x16.png | 9:16 竖屏播放器内的卡片 |
| overlay-small.png | 小窗内卡片（内部滚动，内容未溢出播放器） |

复现命令（采集会覆盖同名 PNG，并写入 `.output/migration-m5-capture.json`）：

```powershell
$env:CAPTURE_M5='1'; npx playwright test e2e/overlay-island-migration.spec.ts
```

### 5. 体积对比（M5 vs M4 合并后）

| 指标 | M4（合并后，#43） | M5 | 差值 |
| --- | --- | --- | --- |
| 解包体积 | 11,303,228 B（56 文件） | 11,311,851 B（56 文件） | +8,623 B |
| 压缩包（Chrome/Edge 一致） | 8,449,591 B | 8,451,472 B | +1,881 B |
| content script | 346,395 B | 355,018 B | +8,623 B |
| Popup 入口闭包 | 308,756 B | 308,756 B | 0 |

增量来自遮罩 shell CSS、OverlayApp 的库组件代码与 naive-icons 引用（gzip 后约 1.9 KB）。字体双份（`assets/` 与 `files/`）为 M4 已知问题，去重属 #46，本工单未处理。

### 6. 门禁执行记录

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | npm run typecheck | 通过（退出码 0） |
| 单元/集成测试 | npm test | 通过（45 个测试文件、825 个用例） |
| Lint | npm run lint | 通过（退出码 0） |
| Chrome 构建 | npm run build（含三个校验脚本） | 通过 |
| Edge 构建 | npm run build:edge | 通过 |
| 浏览器 E2E | npx playwright test | 10 通过 / 13 跳过 / 0 失败 |
| M5 截图采集 | $env:CAPTURE_M5='1'; npx playwright test e2e/overlay-island-migration.spec.ts | 3 通过 |
| 体积复测 | node scripts/measure-bundle-baseline.mjs | 见第 5 节 |

### 7. 未验证项

| 项 | 原因 |
| --- | --- |
| 真实 B 站/YouTube 上的遮罩呈现（宿主页 CSP 下的字体加载、全屏、竖屏、窗口缩放、真实视频暂停/恢复） | 无真实站点环境；沿用人工验收矩阵 |
| Edge 真机字体与样式 | 仅验证 edge-mv3 构建产物 |
| 错误边界在真实渲染异常下的触发 | 回退界面由单测覆盖；OverlayApp 正常路径无法受控注入渲染异常，未做 e2e 触发 |
| 字体子集按需加载对首屏的影响 | 仅合成页观测；真实站点网络面板由人工确认 |

### 8. 复现步骤

```powershell
git checkout codex/ticket-44-m5-overlay
npm install
npx wxt prepare
npm run typecheck; npm test; npm run lint
npm run build; npm run build:edge
npm run zip; npm run zip -- -b edge
node scripts/measure-bundle-baseline.mjs
npx playwright test
$env:CAPTURE_M5='1'; npx playwright test e2e/overlay-island-migration.spec.ts
```

### 9. 合并集成分支（含 M2）后的复测

本工单推送前已合并集成分支（e69640f，含工单 #39 M2 Popup 完整迁移与共享页面基础模块）。合并后复测（Chrome 与 Edge 数字一致）：

| 指标 | 集成分支（M0+M1+M4+M2） | 合并后（M0+M1+M4+M2+M5） | 差值 |
| --- | --- | --- | --- |
| 解包体积 | 11,310,342 B（57 文件） | 11,318,965 B（57 文件） | +8,623 B |
| 压缩包 zip | 8,451,396 B | 8,453,277 B | +1,881 B |
| content script | 346,395 B | 355,018 B | +8,623 B |
| Popup 入口闭包 | 315,708 B | 315,708 B | 0 |

合并后门禁复测：typecheck 通过；npm test 47 文件 / 833 用例通过；lint 通过；Chrome/Edge 构建通过（含三个校验脚本）；npm run test:e2e 10 通过 / 18 跳过 / 0 失败。M5 增量与合并前一致（只影响内容脚本），M2 的 Popup 与共享模块未受本工单影响；M5 截图已用合并后产物重新采集并提交（截图内容随当前抽到的单词变化，仅作证据，不作像素比对基线）。

相关提交（分支 codex/ticket-44-m5-overlay）：

1. 遮罩迁移为 Animal Island 原版视觉并删除 M4 预览路径
2. 重构 M4 PoC e2e 为真实遮罩迁移验证并采集 M5 截图
3. 补充 M5 迁移证据与体积数据

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
| 门禁 | typecheck / npm test / lint / build / build:edge / e2e | 本分支复测（合并集成分支前）：typecheck 通过；46 个测试文件、832 个用例全过；lint 通过（0 warning）；Chrome/Edge 构建（含既有校验脚本）通过；e2e 11 通过 / 13 跳过（跳过为既有人工矩阵与采集占位）。合并 M2 后的最终复测见第 7 节 |

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

| 指标 | M4 合并后基线 | M6a 最终（合并 M2 后） | 差值 |
| --- | --- | --- | --- |
| 解包体积 | 11,303,228 B（56 文件） | 11,309,852 B（57 文件） | +6,624 B |
| 压缩包 zip | 8,449,591 B | 8,451,332 B | +1,741 B |
| content script（content.js） | 346,395 B | 345,905 B | −490 B |
| Popup 入口闭包 | 308,756 B | 315,708 B | +6,952 B |

本分支单独的 M6a 改动净减 content.js 490 B（合并前实测）：启用提示由内联蓝粉自绘样式改为库原版组件（React/库代码本就在内容脚本内），差量被删除的旧提示 CSS 抵消。解包体积与 Popup 闭包的其余增量来自合并 M2（新共享页面基础模块与 Popup 完整迁移），不属于本工单改动面。

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

### 7. 合并集成分支（含 M2）后的复测

推送前已合并集成分支最新 tip e69640f（合并工单 #39：M2 Popup 完整迁移与共享页面基础模块），合并提交为「Merge branch 'feat/animal-island-ui-migration' into codex/ticket-45-m6a-notices」。证据文档冲突为双方尾部追加，已解决为 M2 小节在前、M6a 小节在后。合并后复测：

| 验证项 | 结果 |
| --- | --- |
| typecheck / lint | 通过（0 warning） |
| npm test | 48 个测试文件、840 个用例全过 |
| build / build:edge | 通过（含 WXT 构建与三个校验脚本） |
| e2e（29 用例，含 M2 采集占位） | 11 通过 / 18 跳过（跳过为 M2/M6a 与既有采集、人工矩阵占位） |
| 体积（Chrome，合并后） | 解包 11,309,852 B（57 文件）；zip 8,451,332 B；content.js 345,905 B；Popup 闭包 315,708 B |

## M6b 迁移清理、许可与文档收尾

工单：#46（父 issue #36）｜决策记录：docs/adr/0005-adopt-animal-island-ui.md｜分支：codex/ticket-46-m6b-cleanup（从集成分支 tip ae12164 切出）｜执行时间：2026-10-14。

### 1. 改动概览

- **旧视觉清零**：删除 `src/ui/styles/design-tokens.css`（旧蓝粉令牌与自绘按钮/状态/页脚样式）与 `src/ui/styles/shadow-design.ts`（已无使用者）；新增 `src/ui/styles/base.css`，只保留与视觉体系无关的元素级基础样式（html/body 外边距、正文字体、指针状态、reduced-motion；颜色只引用库 --animal-* 令牌）。popup / onboarding / options / stats / dev-tools 五个入口改为导入 base.css。
- **dev-tools 页面迁移**：`src/entrypoints/dev-tools/{main.tsx,dev-tools.css}` 与 `src/ui/popup/dev-tools.css` 改用 island 主题别名（--island-* → --animal-*）；开发数据页入口新增恰好一次的原版样式导入。该页面仍不进入生产构建，既有校验脚本保持通过。
- **字体交付统一（补充验收项）**：`wxt.config.ts` 新增构建期 Vite 插件（vite:build:extendConfig），把 animal-island-ui 发布 CSS 的字体 URL 改写为 /files/ 公共路径；Vite 不再发射 assets/<hash>.woff2，扩展页面与遮罩 ShadowRoot 共用 build:publicAssets 复制的一份 files/ 字体。插件只作用于生产构建，dev 服务器行为保持原样。
- **测试**：`tests/unit/ui/island-theme.test.ts` 新增「旧视觉清零」静态规则——src 全目录不含 --bingeup / bingeup-btn- / bingeup-status-，两个旧样式文件不存在，dev-tools 两份样式不含旧令牌与写死色值。
- **文档与许可**：ADR 0005 勘误与更新（Modal 支持 variant（`default` / `game`）、Modal/Drawer/Image 预览用 createPortal 与 Notification 新建 React Root 的准确表述、字体体积实测、计划文档不一致清单）；新增 `THIRD-PARTY-NOTICES.md`（animal-island-ui / naive-icons 的 MIT 全文与版权声明、Nunito / Noto Sans SC 的 OFL-1.1 全文与来源）；README 更新 showcase 拼图与 hero / workflow 插画（island 配色）并在 License 节引用第三方声明；`docs/beta-acceptance-matrix.md` 增补 UI 验收项（G8 统一原版视觉、G9 字体离线加载）与自动化覆盖清单；本证据文档按 M0→M6a 重排并修复「+## M3b」先导记号（重排前后非空行数一致：797）。
- **脚本**：`scripts/measure-bundle-baseline.mjs` 新增 Stats 入口闭包指标（只追加字段）；`scripts/verify-island-shadow-assets.mjs` 新增单一字体交付断言（assets/ 下不得出现 woff2；页面 CSS 必须引用 /files/ 公共路径），随 build / build:edge 执行。

### 2. 字体去重（工单 #46 补充验收）

| 指标 | 去重前（集成分支 ae12164 构建） | 去重后 | 差值 |
| --- | --- | --- | --- |
| 解包体积 | 11,330,134 B（57 文件） | 7,765,057 B（48 文件） | −3,565,077 B |
| 压缩包 zip（Chrome/Edge 一致） | 8,459,721 B | 4,892,913 B | −3,566,808 B |

- 去重前：页面 CSS 引用的 9 个 woff2 被 Vite 发射为 assets/<name>-<hash>.woff2（合计 3,563,300 B），与内容脚本使用的 files/ 副本（同为 3,563,300 B）重复；其余差额约 1.7 KB 来自 base.css 替换 design-tokens.css 的分块缩减。
- 去重后产物实测（Chrome/Edge 相同）：assets/ 下 0 个 woff2；files/ 保留 9 个（合计 3,563,300 B）；页面共享 CSS 分块与 content script 内联 CSS 均引用 /files/ 路径；content.js 字节数与去重前一致（353,351 B）。
- 单一交付路径已纳入构建校验：verify-island-shadow-assets.mjs 同时断言 assets/ 无 woff2 与页面 CSS 引用 /files/ 路径，Chrome/Edge 构建均通过。
- 页面运行时复测（真实 MV3 产物 + 采集脚本）：Popup 的 Nunito 与 Noto Sans SC 均进入 loaded；6 个字体响应全部为 chrome-extension:// 本地资源；console error 0、pageerror 0、失败请求 0；重新采集的 9 张 M2 截图与合并态逐字节一致。

### 3. 最终体积（vs M0 基线，Chrome 与 Edge 数字一致）

| 指标 | M0（#37） | M6b 最终 | 差值 |
| --- | --- | --- | --- |
| 解包体积 | 3,580,581 B（34 文件） | 7,765,057 B（48 文件） | +4,184,476 B |
| 压缩包 zip | 1,213,403 B | 4,892,913 B | +3,679,510 B |
| Popup 入口闭包 | 166,685 B（9 文件） | 314,268 B | +147,583 B |
| Options 入口闭包 | ——（M0 未测；M3b 起 331,993 B） | 330,709 B | — |
| Onboarding 入口闭包 | ——（M0 未测；M3a 起 302,582 B） | 300,890 B | — |
| Stats 入口闭包 | ——（M0 未测；M3c 起 321,623 B） | 319,971 B | — |
| content script | 208,173 B | 353,351 B | +145,178 B |

说明：最终体积已含去重后的单份字体（3,563,300 B）与全部界面（Popup / 引导 / 设置 / 统计 / 视频遮罩 / 附属提示）的库样式与组件代码；去重前双份字体使解包一度达到 11.33 MB（M3a 合并态）。Options / Onboarding / Stats 入口闭包指标分别自 M3b / M3a / M6b 起记录。

### 4. 门禁执行记录

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | npm run typecheck | 通过（退出码 0） |
| 单元/集成测试 | npm test | 通过（48 文件、856 用例） |
| Lint | npm run lint | 通过（退出码 0） |
| Chrome 构建 | npm run build | 通过（含 verify-content-script-manifest / verify-dev-tools-production / verify-island-shadow-assets 三个校验脚本） |
| Edge 构建 | npm run build:edge | 通过（同上） |
| 打包 | npm run zip / npm run zip -- -b edge | 通过（bingeup-0.0.1-chrome.zip 与 -edge.zip 均为 4,892,913 B） |
| 浏览器 E2E | npx playwright test | 16 通过 / 26 跳过 / 0 失败（跳过为人工矩阵占位与采集脚本默认跳过） |
| 字体与界面复测 | $env:CAPTURE_M2='1'; npx playwright test e2e/migration-m2.spec.ts | 5 通过（字体加载、无横向溢出、无控制台错误断言随采集实测；截图与合并态字节一致） |
| 体积复测 | node scripts/measure-bundle-baseline.mjs | 见第 2、3 节 |

### 5. 未验证项汇总

- 本工单新增未验证项：wxt dev 开发模式未在浏览器中实测（字体公共路径插件只作用于生产构建，dev 路径未改动，行为与合并前一致）；README 与文档改动不涉及运行时。
- 跨阶段常驻未验证项（各阶段小节另列，长期有效）：真实 B 站 / YouTube 上的遮罩、启用提示与恢复提示呈现（宿主页 CSP 下的字体加载、全屏 / 竖屏 / 窗口缩放、真实视频暂停与恢复）；Edge 真机人工矩阵（各阶段仅验证 edge-mv3 产物）；浏览器原生权限弹窗；真实浏览器 200% 缩放、系统字体大小偏好与深色主题下的人工观感；屏幕阅读器真机朗读；错误边界在真实渲染异常下的 e2e 触发；遮罩进入延迟在真实站点的数字。
- README 新 showcase 素材说明：遮罩与启用提示两张来自合成 Bilibili 测试页（已裁掉「非真实站点」说明条），其余来自扩展页面真实构建产物；hero / workflow 为手工维护的示意插画（island 配色重绘）。以上均仅作展示与证据，不作为像素比对基线。

### 6. 代码审查修复记录（工单 #47）

工单：#47（两轴代码审查修复）｜分支：codex/review-fixes（从集成分支 tip 7a7c3f6 切出）｜执行时间：2026-10-14。

#### 6.1 修复项与证据

1. **反馈链接最小交互圆角（硬违规）**：`src/ui/island/island-layout.css` 的 `.island-link` 圆角由写死的 `6px` 改为 `var(--island-radius-sm)`（桥接 `--animal-border-radius-sm`，实测 16px）。该别名满足 ADR 0005 的 12px 最小交互圆角，也满足本文件「圆角一律使用 --island-* 别名」的既有约定；圆角只作用于键盘焦点环的轮廓，链接无背景与边框。证据：全量单测通过；CAPTURE_M2 复采的 9 张 Popup 截图与合并态逐字节一致（`docs/assets/migration-m2/` 无 diff）。焦点环未出现在截图中，其像素表现未做截图比对。
2. **遮罩反馈按钮组重复（判断项）**：`OverlayApp.tsx` 新增 `FeedbackActions` 展示组件（禁用状态与「继续」处理函数由参数注入），选择与拼写反馈阶段的重复按钮组改为调用它。按钮文案、快捷键提示、禁用逻辑、role / aria-label 与 OverlayAction 发出序列均不变；OverlayApp 既有单测未改动、全绿（全量 48 文件 857 用例通过）。
3. **设置页词库描述可见（Spec 缺项）**：`OptionsApp.tsx` 在「当前词库」Select 下方渲染所选词库 `description`（`BUILT_IN_DECKS` 查找；用 `--island-text-color-secondary` / `--island-font-size-sm` 着色，不覆盖库组件样式；窄视口随字段列铺满）。新增 OptionsApp 单测「所选词库的描述在 Select 下方可见并随选择更新」。M3b 记录的「唯一能力差异」消除；描述仍不在下拉面板内部展示（库组件能力边界不变）。
4. **M4/M5 遮罩进入延迟复测（Spec 缺项）**：采样方法抽取为 `e2e/overlay-timing.ts`（原 M0 脚本内联实现，行为不变）；新增 `e2e/migration-m6b-latency.spec.ts`，在最终构建上复测 6 次，见 6.2。M0 采集脚本改用共享实现后已复跑验证，并修正启用提示用例的过期选择器（M6a 起卡片类名为 `.bingeup-enable-prompt-card`）；复跑产生的截图改动已恢复为历史存档，未入库。

截图口径：M3b 截图未随本次改动重采。重采核验时发现学习面板按钮渲染与历史存档存在既存差异（与本次修复无关、来源未归因），且 360 / 420 两档截图存在逐次字节差异；为避免把无关漂移引入本分支，M3b 存档保持原样。本项以单测为证据；描述行的可见性已在临时采集中目视确认，320 / 360 / 420 / 640 视口均无横向溢出（scrollWidth = clientWidth）。

#### 6.2 遮罩进入延迟（合成站点，与 M0 同口径）

采样条件与 M0 相同：真实 MV3 产物、合成 Bilibili 页面（1280×720 播放器）、词库预热、首屏自然触发；两轮各 3 次（每轮独立浏览器）。

| 轮次 | 采样 | bootMs（文档开始→宿主插入） | renderMs（宿主插入→卡片可见） | 合计（文档开始→卡片可见） |
| --- | --- | --- | --- | --- |
| 1 | 1 | 138 | 27 | 165 |
| 1 | 2 | 130 | 26 | 155 |
| 1 | 3 | 130 | 34 | 164 |
| 2 | 1 | 134 | 29 | 163 |
| 2 | 2 | 144 | 27 | 171 |
| 2 | 3 | 130 | 25 | 155 |

对比 M0 基线（#37，4 次采样）：

| 指标 | M0 基线 | M6b 复测（6 次） | 差值 |
| --- | --- | --- | --- |
| bootMs | 102–127（中位 118） | 130–144（中位 132） | 中位 +14 |
| renderMs | 15–20（中位 16.5） | 25–34（中位 27） | 中位 +10.5 |
| 合计 | 120–142（中位 136） | 155–171（中位 163.5） | 中位 +27.5（约 +20%） |

说明：6 次全部为自然触发（无手动回退、无失败）。合计为 docStart→overlayAt 的直接取整，个别行与 boot+render 之和差 1 ms（取整）。数值高于 M0 的方向与迁移后引入库组件、Shadow DOM 与本地字体后的首帧成本增加一致，未做逐项归因；真实站点的延迟数字仍未验证（见 6.5）。

#### 6.3 体积复测（vs #46 记录）

| 指标 | #46 记录 | #47 复测 | 差值 |
| --- | --- | --- | --- |
| 解包体积 | 7,765,057 B（48 文件） | 7,765,206 B（48 文件） | +149 B |
| 压缩包 zip（Chrome/Edge 一致） | 4,892,913 B | 4,893,051 B | +138 B |
| content script | 353,351 B | 353,034 B | −317 B |
| Popup 入口闭包 | 314,268 B | 314,288 B | +20 B |
| Options 入口闭包 | 330,709 B | 331,175 B | +466 B |
| Onboarding 入口闭包 | 300,890 B | 300,910 B | +20 B |
| Stats 入口闭包 | 319,971 B | 319,991 B | +20 B |

说明：content script 减小来自反馈按钮组去重；Options 闭包增加来自词库描述与配套样式；其余为共享分块的微小幅差。指标口径与 #46 相同（`scripts/measure-bundle-baseline.mjs`）。

#### 6.4 门禁执行记录（#47，代码冻结于提交 96f5677）

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | npm run typecheck | 通过（退出码 0） |
| 单元/集成测试 | npm test | 通过（48 文件、857 用例） |
| Lint | npm run lint | 通过（退出码 0） |
| Chrome 构建 | npm run build | 通过（含 verify-content-script-manifest / verify-dev-tools-production / verify-island-shadow-assets 三个校验脚本） |
| Edge 构建 | npm run build:edge | 通过（同上） |
| 打包 | npm run zip / npm run zip -- -b edge | 通过（见 6.3） |
| 浏览器 E2E | npx playwright test | 16 通过 / 27 跳过 / 0 失败（新增 M6b 延迟用例默认跳过） |
| M2 复采比对 | $env:CAPTURE_M2='1'; npx playwright test e2e/migration-m2.spec.ts | 5 通过；截图与合并态逐字节一致 |
| M6b 延迟采集 | $env:CAPTURE_M6B_LATENCY='1'; npx playwright test e2e/migration-m6b-latency.spec.ts（两轮） | 通过；数值见 6.2 |
| M0 脚本复跑 | $env:CAPTURE_BASELINE='1'; npx playwright test e2e/migration-baseline.spec.ts | 通过；基线截图已恢复为历史存档 |

#### 6.5 未验证项（如实保留）

- 真实 B 站 / YouTube 手测证据仍缺失：本修复未在真实站点验证遮罩、启用提示与恢复提示的呈现；6.2 的延迟数字均为合成站点口径，不代表真实站点。
- 浏览器「字体大小 / 最小字号」偏好未测；系统字体大小偏好、深色主题、200% 缩放的人工观感与屏幕阅读器真机朗读同样保持未验证。
- 以上与 M6b 第 5 节（未验证项汇总）一致；本次修复未新增真机人工验证，也未改变上述未验证状态。
