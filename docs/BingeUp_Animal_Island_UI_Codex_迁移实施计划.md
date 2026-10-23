# BingeUp × Animal Island UI：Codex 渐进式完整视觉迁移实施计划

> 历史存档（迁移已完成）：本文记录 2026 年 10 月的迁移计划与执行步骤，仅用于追溯；不是当前实现说明，也不是 AI Agent 必读上下文。当前长期决策见 [ADR 0005](./adr/0005-adopt-animal-island-ui.md)。

版本：v1.0（2026-10-09）

目标仓库：<https://github.com/F1rstDan/BingeUp>，基线 `main@0a5677f289c8e56eefacf85401df4d6d643f4d23`（开始开发时应重新核对 HEAD）。

UI 来源：<https://github.com/guokaigdg/animal-island-ui>，研究基线 `main@b20e6bf8b712282bd7b01933cba584ebd322b6eb`，组件库 `animal-island-ui@2.1.1`；Skill：`skills/animal-island-ui-style/SKILL.md`。版本在实施中应精确锁定，并验证最终 lockfile。

> 本文是基于两仓库 2026-10-09 实际源码整理的迁移计划，而非完成声明。不得把尚未做过的构建、兼容性验证写成“通过”。

## 0. 决策及边界

**产品决策：** BingeUp 的所有面向用户的界面采用 Animal Island UI 原版视觉语言：奶油/羊皮纸底色、薄荷绿主色、暖棕色文字、50px 胶囊按钮/输入框、原版设计 token、Nunito + Noto Sans SC、原版 3D 交互与温和动画。保留品牌名称「刷刷升级」、必要的品牌 Logo/吉祥物，但取消旧蓝粉配色，不创造新主题。颜色数值和 Props 以固定版本源码和官方设计系统为准。

**技术决策：** 优先复用 npm 组件库，而不是复制它整个仓库；WXT / React 18 / TypeScript / MV3 架构不变。扩展独立页面直接导入库的样式和组件；嵌入第三方网站的内容脚本保持独立的 Shadow DOM、定位器和播放恢复控制，仅在通过样式/资源隔离 PoC 之后使用 npm 组件。Overlay 上遇到不能安全复用的复杂 Portal 组件时，自行按原版规范实现局部呈现组件，但不能宣称直接使用了原版组件。

**禁止顺便修改：** 视频站点适配器、触发/冷却规则、页面权限策略、FSRS、新词/复习顺序、学习数据库和备份格式、浏览器进度恢复、学习操作的业务语义、Chrome/Edge 构建方式。任何不得不改的非视觉行为须单独 ADR、测试和审查。

**当前仓库事实：** BingeUp `package.json` 是 React 18.3.1、WXT 0.20.27、Tailwind 3.4.3；`src/entrypoints/{popup,onboarding,options,stats}/main.tsx` 各自引入 `src/ui/styles/design-tokens.css`；`src/content/overlay-controller.tsx` 用固定定位 host + ShadowRoot + 内联 `OVERLAY_CSS` + React Root；`src/ui/styles/shadow-design.ts` 提供 Shadow DOM token。真实站点 E2E 有跳过项，见 `e2e/site-scenarios.spec.ts` 和 `docs/beta-acceptance-matrix.md`。

**组件库事实：** `animal-island-ui@2.1.1` 的 package exports 包括 `.`、`./style` 和 `./dist/index.css`，CSS 由 Less 编译成静态包；`src/styles/themes/default.less` 在 `:root` 注册 `--animal-*`；字体打入组件库产物；`Modal`、`Drawer` 用 `createPortal(..., document.body)`；`Notification` 在 `document.body` 创建新 React Root；`Drawer` 可能修改 body 子节点；`Select` 是受控组件（options/value/onChange），且其定位依赖视口。

## 1. 必须先读的资料（Codex 执行前）

BingeUp：`AGENTS.md`、`CONTEXT.md`、`README.md`、`src/content/overlay-controller.tsx`、`src/ui/overlay/OverlayApp.tsx`、`src/ui/styles/{design-tokens.css,shadow-design.ts}`、`src/entrypoints/*/main.tsx`、`src/entrypoints/*/*.css`、`src/ui/{popup/PopupApp.tsx,options/OptionsApp.tsx,onboarding/OnboardingApp.tsx,stats/StatsApp.tsx}`、`wxt.config.ts`、`docs/overlay-layout-regression-lessons.md`、`docs/beta-acceptance-matrix.md`、`e2e/*.spec.ts`、有关单元测试。

Animal Island UI：`skills/animal-island-ui-style/SKILL.md`、`skills/animal-island-ui-style/references/react-project.md`、`references/components/*.md`、`docs/design-system/{README.md,design-tokens.md,design-rules.md,css-variables.md}`、`src/styles/{index.less,themes/default.less,fonts.less}`、`src/components/{Button,Card,Select,Modal,Drawer,Notification,Tooltip}/*`、`package.json`、`LICENSE`。若 Skill、参考文档、实际 TypeScript 类型有差异，以**锁定 npm 版本的类型声明和组件源码**为实现依据，差异写入迁移记录。

## 2. 视觉合约与组件复用矩阵

### 2.1 视觉合约

1. 使用原版薄荷主色 `#19c8b9`、暖棕字色、米白与羊皮纸背景；新的样式全部引用现有 `--animal-*` 正确变量，不把 standalone HTML 的短名变量误当成 npm 组件运行时变量。编译后真实 token 以 `src/styles/themes/default.less` 定义为准。
2. 主要操作用原版 `Button type="primary"`，只有 Primary/Danger Primary 有堆叠 3D 阴影；普通按钮不复制厚阴影；Card 默认无厚悬浮阴影。
3. 按钮、输入框使用 50px 胶囊圆角；最小交互圆角 12px。避免直接复用旧 `.bingeup-btn-primary` / 蓝色焦点环的样式。
4. 字体 Nunito + Noto Sans SC，仅用**本地打包资产**，不能通过 Google Fonts/CDN 在扩展运行时动态加载。必要时预加载中文子集，但需实际测量资源体积。
5. 焦点色遵循原版：输入类黄/按钮薄荷；动画通常在 0.15–0.35 秒，兼容 `prefers-reduced-motion`，视频内 UI 不使用需要额外等待的打字机/全屏动画。
6. 统一使用 `naive-icons`，不用 emoji 或 Unicode 图案充当 UI 图标。已有 BingeUp 吉祥物是品牌图片，可保留。
7. 原版 Modal 的游戏款 SVG blob、原版 Title 燕尾飘带不可擅自改成普通矩形；但**不允许**为实现视觉强行将 Portal 弹窗放到视频内容脚本中。

### 2.2 页面映射

| 页面或场景 | 位置 | 建议组件 | 特殊要求 |
|---|---|---|---|
| Popup | `src/ui/popup/PopupApp.tsx` + popup.css | Button, Card, Switch, Tag, Divider | 当前约 340px；兼顾权限不可用/暂停/无活动页面的状态；不溢出 |
| Onboarding | `src/ui/onboarding/OnboardingApp.tsx` | Card, Radio, Button, Title | 保留词库/水平/网站选择语义；权限流程不变 |
| Options | `src/ui/options/OptionsApp.tsx` | Tabs, Switch, Select, Input, Button, Card, Modal（仅扩展页） | Select 必须受控；危险数据清除必须二次确认；保持完整无障碍 |
| Stats | `src/ui/stats/StatsApp.tsx` | Card, Progress, Tag, Tabs | 保留真实统计口径；不引入任务压力或假的进度 |
| Dev tools（开发用） | `src/ui/dev-tools/` | 按需使用 | 生产构建仍要排除，不能泄漏测试功能 |
| 视频题目/NewWord/Spelling/Continuous | `src/ui/overlay/OverlayApp.tsx` + `src/content/overlay-controller.tsx` | 经 PoC 可选 Button/Card/Input；复杂布局自实现原版设计 | 不使用原版 Modal/Drawer/Notification；保留 Shadow DOM 与视频控制 |
| 页面启用提示/失败恢复 | `src/content/enable-prompt.ts`、`playback-recovery-notice.ts` | 根据隔离策略自实现原版外观 | 不截获播放器的额外交互；不能改恢复行为 |

### 2.3 与当前业务语义的契约

不得根据新 UI 按钮位置推断学习动作。当前 `CONTEXT.md` 的术语是准绳：单题「提交」→ 反馈→「明白了」后返回；「提交并继续」进入连续模式；连续模式的「提交并结束」要提交答案并返回；「结束学习」不提交当前题；「跳过」不判错，进入对应冷却。保持所有 `OverlayAction` 类型、键盘快捷键、评分纠正和日志幂等语义。错误恢复必须保证视频可恢复或明确向用户提供恢复操作。

## 3. CSS、Shadow DOM 与资源隔离：架构硬规则

### 3.1 扩展独立页面

每个独立 UI 入口（popup/onboarding/options/stats）在现有页面 CSS 之前显式 `import 'animal-island-ui/style'`，样式只在**各自独立入口 bundle**导入一次，避免重复导入或全局导入到 background/content。渐进替换旧 `design-tokens.css` 和页面样式，保留布局专用 CSS，不再有旧蓝粉设计语义变量。不要一次删光旧样式：通过迁移 PR 分批替换后删除未使用定义。

### 3.2 Shadow DOM（优先实现的验证 PoC）

当前 Overlay host 被挂在 `document.documentElement`，`position:fixed; display:block; box-sizing:border-box; z-index:2147483647`，宽高位置来自目标播放器矩形。必须保留这个结构和当前 `.bingeup-overlay { position:absolute; inset:0; width:100%; height:100%; display:grid; place-items:center; }` 所代表的几何契约。

**不能只在扩展 page 的 `main.tsx` 导入 CSS**：ShadowRoot 中看不到页面的样式选择器和 `:root` 变量。先开独立 PoC 验证以下方法：

1. 通过 Vite/WXT 将包内发布 CSS（可优先试 `animal-island-ui/dist/index.css?inline`，**必须验证该路径确实可被当前版本打包解析**）作为构建时资源导入。不要运行时去 GitHub/npm/CDN 请求样式。
2. 为 ShadowRoot 建立单独的主题作用域。原包 CSS 中的 `:root { --animal-... }` 在 ShadowRoot 内不会自动提供宿主所需变量；采用 PostCSS AST 等受控方式把**仅 token 声明段**映射到 `:host`，不要把整份 CSS 简单地正则替换成 `:host`。独立验证原包 reset 选择器是否影响宿主。
3. 使用 `<style>` 注入到 shadow root，或经验证后用 `adoptedStyleSheets`；缓存处理结果，避免每次出题重复下载/解析和加载字体。初始 PoC 优先使用已有 `<style>` 挂载路径，先减少变量。
4. 验证 CSS 中 `url(...)` 字体资源路径：构建后浏览器页面必须能从 `chrome-extension://...` 成功请求已打包文件。若使用的 URL 需要宿主页访问资源，按最小范围声明 `web_accessible_resources`；不要将所有构建资产对全部网站开放。不要通过 blob/CDN 链接绕开 CSP。资源路径以真实打包产物为准。
5. 保留 `:host { all: initial; ... }` 的初始化职责，同时明确宿主 `display:block`；先重置再设 `--animal-*`。测试样式计算后的颜色、字体、阴影和尺寸，不是只测试 CSS 源字符串存在。
6. 自定义 Overlay 配套局部样式使用独立前缀或局部命名空间；源站 CSS 不得影响 BingeUp，BingeUp CSS 不能改变源站播放器与控件。
7. 对 `prefers-reduced-motion`、播放器全屏、窗口缩放、竖屏、DOM 替换、焦点及键盘事件逐项验证。

如果 PoC 无法可靠解决样式/字体资源问题，不得仓促把全量组件打进 content script。切换到**视觉精确的 Shadow DOM 局部实现**：从固定版本的设计规范推导 token 和 CSS，在 BingeUp 内独立维护问题卡/选项/反馈容器；保留可复用的纯展示 React 组件。结果必须符合原版视觉规范、并在文档说明未直接复用的组件及原因。

### 3.3 Portal 策略

- 在视频内容脚本中**禁止直接使用**库的 `Modal`、`Drawer`、命令式 `Notification`：当前源码的 Portal 目标是 `document.body`；Drawer 可能更改 `document.body` 的 overflow 和子元素变换；会破坏视频网站、Shadow DOM CSS 和 overlay 定位。
- 在**扩展独立页面**可以使用 `Modal` 作为清除数据确认等对话框，但测试 Escape、焦点圈、退出焦点还原、overflow 清理；Drawer 的背景 push 效果默认应禁用或仅在确认需要时启用。
- 若未来确需 Shadow DOM 浮层，新建 BingeUp 本地的 scoped `ShadowDialog/ShadowToast`，portal 目标显式指向 shadowRoot 内节点，焦点和滚动限制只针对本地容器；不得 patch 第三方库源码或通过 runtime monkey-patch `document.body`。
- Tooltip / Select 虽未必 Portal 到 body，仍须验证定位、裁剪与点击外部逻辑。优先在扩展独立页面使用复杂交互组件。

### 3.4 CSS import 与 bundle 检查

`animal-island-ui/style` 是运行时 CSS 的正式出口；包 root 的 TS 组件导入不是自动加载样式的可靠替代。确认最终 `@font-face`、CSS chunks 和图标被打包，MV3 不执行远程代码；验证 `sideEffects:false`/tree-shaking 没有误删样式。逐个检查 Chromium 和 Edge 的构建产物，不能只以 `npm run typecheck` 为成功标准。

## 4. 分阶段工作包（禁止一次性重写）

### M0：基线、安装、调研（单独 PR）

- 创建工作分支 `feat/animal-island-ui-migration`，记录 BingeUp 当前 HEAD，保存旧 UI 的 Popup/Options/Onboarding/Stats/Overlay 的截图基线。
- 安装/锁定 `animal-island-ui@2.1.1`、`classnames@2.5.1`，如果直接导入图标则将 `naive-icons@1.2.0` 列为项目的直接依赖；不要安装组件库源码仓库本身。
- 可安装 **项目级 Codex Skill**：`npx skills add guokaigdg/animal-island-ui --skill animal-island-ui-style -a codex --copy`。审查安装后文件与根 `AGENTS.md` 的关系；Skill 原版英文 `SKILL.md` 用于 agent，中文翻译供人审核。
- 增加 `docs/adr/0005-adopt-animal-island-ui.md`，记录原版配色、原生组件与内容脚本替代的边界、许可证处理。
- 运行并记录 `npm run typecheck`、`npm test`、`npm run lint`、`npm run build`、`npm run build:edge`，基线失败单独列出，禁止把旧问题归到新 PR。
- 验收：没有产品功能变更，依赖锁定，原有基线报告和截图可复现。

### M1：独立页面可行性验证（单独 PR）

- 仅修改 Popup 入口 `src/entrypoints/popup/main.tsx` 和少量 UI：导入原版样式，使用 Button/Card/Tag/Switch 做一个真实可见的垂直切片。
- 执行完整链接，包括可学习、暂停、没有当前标签页、权限不足等状态；保持调用 `messageClient` 的原接口与页面打开行为不变。
- 检查 320px–420px 窗口宽度以及放大 200%；发现尺寸冲突应调整**页面布局**，不篡改组件原版按钮圆角或阴影。
- 验收：真实扩展 Popup 视觉一致、所有原有状态正常、没有横向溢出，安装包能加载本地字体。

### M2：Popup 完整迁移与共享页面基础（单独 PR）

- 将 `src/ui/popup/PopupApp.tsx`、`src/entrypoints/popup/popup.css` 完整转成原版设计；改掉齿轮 Unicode 等非标准 UI 图标，使用 naive-icons。
- 建立精简的 `src/ui/island/` 基础模块，例如 `IslandPage.tsx`、`IslandSection.tsx`、`island-layout.css`、`island-theme.css`，仅封装**业务布局和语义**，不重造 UI 库已有的组件。
- 优先保留页面标题、错误状态、可点按区域与 aria 标签；清除旧蓝粉全局变量应在所有迁移完成后执行。
- 验收：Popup E2E、Popup 单元测试、截图比较均通过。

### M3：Onboarding、Options、Stats（可拆 2–3 个 PR）

- Onboarding：选词库、学习水平、启用网站、完成页采用原版 Card/Radio/Button/Title；不增加引导步骤，不更改权限策略。
- Options：用原版 Switch、Select、Input、Card、Button、Tabs 迁移设置；Select 的 `options` 类型是 `{key,label}[]`、`value` 为 key、`onChange(key)`。对现有 `DropdownSelect.tsx` 做适配/替换评估，而不是假设 Props 一样。
- 数据清除确认可在扩展页使用 `Modal variant="game"`，验证焦点陷阱和离开时滚动恢复；不得改变导入导出验证、二次确认或原子恢复。
- Stats：保留学习统计的来源/聚合方式和准确文案，用 Card/Progress/Tag 重新排版，不制造强制打卡、假的游戏等级或虚构进度。
- 验收：每页组件及浏览器 E2E/单元测试、窄宽度/大字体/键盘焦点/中文字体和数据持久化测试通过。

### M4：Shadow DOM CSS/字体 PoC（独立且可回滚 PR）

- 不先改真实学习流程；为 `OverlayController` 加最小可选的实验渲染，验证原版 Button/Card 的真实计算样式、CSS 变量与字体资产，并在 YouTube/Bilibili fixture 中测试。
- 确保 `document.documentElement` 宿主层与 ShadowRoot 的高度、宽度、位置、滚动保持现有契约。不要修改 `content-controller.ts` 的学习/恢复逻辑。
- 实际验证 `?inline` CSS 路径、token `:host` 映射、font `url(...)`、`web_accessible_resources` 必要性、生产 CSP、base URL、样式重入和销毁清理。
- 验收：视频遮罩正确呈现原版按钮颜色/字体/阴影；源网站没有新增的非 BingeUp 节点、样式和滚动副作用；页面隐藏及遮罩销毁无泄漏。

### M5：完整视频内 UI 迁移（单独 PR）

- 在不改变 `OverlayAction` 和业务规则的前提下迁移 `OverlayApp.tsx` 的新词、英中/中英选择、语境题、拼写题、单题反馈、连续学习上一题反馈与下一题、错误边界。
- 主卡从旧透明蓝白玻璃风格替换为原版羊皮纸 Card 风格；使用原版薄荷按钮/暖色反馈；视频遮罩底层保留必要暗化，绝不加全屏高成本 Loading 或 Modal。
- 选项卡可使用原版视觉的本地组件，保证选中/答对/答错在**文字及图形**上可识别；不会因 Button 原生布局挤掉“跳过”。
- 固定快捷键、业务操作类型、失败恢复；卡片需要在 16:9、9:16、窄播放器和小窗场景中保持可见、可滚动但不泄漏滚动到视频网站。
- 完整新建遮罩位置/响应式/样式隔离的单元和集成测试。
- 验收：每一个能退出的状态都不会使视频永久暂停；连续学习、答题评分、跳过冷却、评分纠正、错误恢复语义不变。

### M6：附属提示与最终清理（单独 PR）

- 迁移 `src/content/enable-prompt.ts` 和 `src/content/playback-recovery-notice.ts` 的可见样式；这些 DOM 若仍运行在宿主页，应使用严格作用域或独立 Shadow Root，不能对页面添加通用 CSS。
- 迁移 dev-tools（如果用户可见）但继续保证其不进入生产构建。
- 删除已无人引用的 `--bingeup-blue/pink` 设计变量、旧按钮类和旧视觉样式；保留命名为 `bingeup-` 的必要业务类及可测试的 DOM 稳定标识。
- 添加 MIT 版权声明到第三方许可文档（含 `Copyright (c) 2026 guokaigdg` 及相应 MIT 条款）；检查 `naive-icons` 和字体的许可证要求，不假设组件库 MIT 等于全部依赖没有额外条件。
- 更新 README 的 UI 截图及用户文档、ADR、验收矩阵。
- 验收：无旧蓝粉残留于用户可见页面（如图片属于品牌资产，单独按产品决定处理）；Chrome/Edge 生产产物中没有 dev-tools。

## 5. 测试矩阵与质量门

### 5.1 自动化（每个 PR 必跑）

- `npm run typecheck`
- `npm test`
- `npm run lint`
- `npm run build`
- `npm run build:edge`
- `npm run test:e2e`（需满足 Playwright 的本地浏览器安装和 fixture 前提；无法执行则明确记为未验证）。

需要新增/更新的测试建议：

- `tests/unit/ui/island-theme.test.ts`：主题变量覆盖与无旧色引用的静态规则（不要把颜色快照当成唯一证据）。
- `tests/unit/content/overlay-controller.test.ts`：固定宿主的 `display:block`、box sizing、目标矩形刷新、Shadow style 注入、不重复 root、卸载清理。
- `tests/integration/island-shadow-style.test.ts`：模拟宿主页颜色污染，检查 ShadowRoot 样式隔离及 token 初始化。
- `tests/unit/ui/OverlayApp.test.tsx`：提交/反馈/明白了、连续学习、快捷键、选中状态、输入、评分纠正和异步防重。
- `e2e/ui-visual.spec.ts`：Popup/Onboarding/Options/Stats 稳定 fixture 截图；字体就绪后截图，至少 320px、340px、420px 宽度、200% 缩放和 `prefers-reduced-motion`。
- `e2e/overlay-visual.spec.ts`：使用本地 HTML5 视频 fixture 做遮罩样式/布局与恢复，不依赖外部线上视频服务。

### 5.2 人工回归（M5/M6 必须完成，有截图或录屏证据）

| 场景 | 检查 |
|---|---|
| Bilibili 普通视频 / 多 P / 竖屏 | 主播放器遮罩居中、正确跟随视频、暂停/恢复 |
| YouTube 普通视频 / Shorts | 新视频触发、防重复、字幕不被布局错误遮住、暂停/恢复 |
| 直播 / 广告 / 缩略图预览 | 不改变过滤规则，不在不应显示时弹出 |
| 浏览器全屏 / 网页全屏 / 窗口缩放 / 滚动 | ShadowRoot UI 保持位置、尺寸与图层正确 |
| 多标签页 / 多站点冷却 | 全局冷却及页面独立显示行为不变 |
| 新词、题目、拼写、连续学习、纠错 | 每种可见状态与动作可完成，防重复提交 |
| 小尺寸播放器 / Popup 窄宽度 / 放大 | 按钮可见、文字不遮挡、必要滚动局部发生 |
| Shadow Root 异常卸载 / SPA 切换 / 背景隐藏 | 恢复保护有效、事件和监听器被清理 |
| 字体资源和 CSP | 无 Google Fonts/CDN，woff2 成功加载，无 CSP 错误 |
| MV3 安装与版本升级 | 数据不丢失、原有权限/导入导出/词库/冷却不受影响 |

### 5.3 可观察性能目标（拟定门槛，不是已测数值）

- 在 M0 记录 Chrome/Edge baseline：解压扩展包总字节、popup JS/CSS/font 大小、content script JS/CSS 大小、遮罩可交互延迟及进入/退出 DOM 节点计数。
- 每个阶段记录差值；若 content-script 新增 CSS/font 体积或主线程时间明显增长，提出具体优化而非直接扩大阈值。
- 建议作为初始审查目标：页面 UI 无明显输入延迟；短题打开不额外等待动画/网络；CPU 不持续高占用；不存在任何远程字体与长期运行的视觉定时器。精确阈值由 M0 的真实数据决定。

## 6. 设计风险与回退

- **全局 CSS 冲突：** 扩展页面的 `design-tokens.css` 与原版 CSS 变量/Reset 冲突 → 页面逐个过渡，遵守导入顺序，完全迁移后删旧规则。
- **ShadowRoot 无 token：** 包 CSS 的 `:root` 在 ShadowRoot 不等效 → 受控 AST 映射到 `:host`，检查计算样式。
- **字体加载失败：** CSS 字体地址相对宿主页解析、WAR 或 CSP 拦截 → 构建内本地资源路径验证，按最小范围公布可访问资源。
- **Portal 越界：** Modal/Drawer/Notification 向 `document.body` 输出 → 只在扩展独立页面使用；视频内写 scoped 局部组件。
- **旧布局回归：** `:host { all: initial }` 将 host 重置成 inline/组件被挤出 → 保留 host display、绝对铺满根节点和完整矩形测试，参考 `docs/overlay-layout-regression-lessons.md`。
- **视觉一致但业务坏了：** 用“跳过”“结束学习”错误替换函数 → 测试真实 `OverlayAction` 和 Domain 事件；禁止根据文案或按钮顺序推断。
- **包升级风险：** 后续 UI 库 Props/样式变化 → 精确锁版本，明确升级 PR，重新拍截图与测验字体。

发现关键验收失败时：停止合并，回退当阶段 PR/提交到上一个通过门槛的版本；原则上不回滚用户数据库，也不修改学习数据结构。

## 7. 建议项目文件结构（只新增必要部分）

```
src/
  ui/
    island/
      IslandPage.tsx               # 页面布局，不重复造 Button/Card
      IslandSection.tsx            # 共用业务区域容器
      island-theme.css             # 与原版运行时 token 对齐；页面根作用域
      island-layout.css            # 响应式和页面布局
      shadow-theme.ts              # ShadowRoot token 注入与缓存
      shadow-style-loader.ts       # 构建时 CSS 资源及 URL 处理（PoC 通过后）
    overlay/
      OverlayApp.tsx               # 保留状态机/OverlayAction
      IslandQuestionOption.tsx     # 需要自定义时按原版规范实现
      IslandOverlayFrame.tsx       # 自有布局，非第三方 Portal
  content/
    overlay-controller.tsx         # 保持定位、清理和恢复契约

tests/
  integration/island-shadow-style.test.ts
  unit/ui/island-theme.test.ts
  unit/content/overlay-controller.test.ts # 已有文件扩展

e2e/
  ui-visual.spec.ts
  overlay-visual.spec.ts

docs/
  adr/0005-adopt-animal-island-ui.md
  ui-migration-evidence.md
  third-party-notices.md
```

实际命名、目录需要尊重仓库已有风格。禁止为符合此草图而做无必要的目录搬迁。

## 8. Codex 执行工作流程与交付格式

1. **先做代码审查，不得直接改全部文件。** 读两仓库指定路径、现有 AGENTS.md 和 Skill，展示实际变更文件清单及风险。
2. 先实现 **M0 → M1**，完成一个单独 PR，附安装前后截图、体积对比和测试报告；M1 通过才推进 M2。
3. 每个后续阶段独立 commit/PR 或清晰 commit boundary。若正在执行一个阶段，不提前动下一阶段的大面积样式。
4. 每个阶段提交：修改文件清单、复用的原版组件及其 Props、不得复用的组件与原因、真实运行截图/录屏、构建与测试命令及实际结果、已知问题、回滚方法。
5. 不创建新的业务模型，不修改业务域名/类型。用户可见中文文案与按键语义不因换肤变化。
6. **不能声称通过未执行的 E2E 或人工验收。** 缺少 Chrome/Edge 可视化测试环境时标为「未验证」，列出可复现的操作步骤。
7. 合并最后一个 PR 前，执行完整回归矩阵，记录 ShadowRoot computed styles、浏览器 CSP 控制台、字体请求和两浏览器生产包。

### 建议的 Codex 首条任务

> 请阅读 `AGENTS.md`、`CONTEXT.md`、本文档及仓库已安装的 `animal-island-ui-style` Skill。以 `animal-island-ui@2.1.1` 的原版视觉设计和组件源码为真源，严格按本文从 M0 开始。**本轮只完成 M0 和 M1**：创建迁移分支、记录基线、安装锁定依赖、将 Popup 做成能正常运行的原版 Animal Island UI 视觉切片，保留所有业务语义，并给出真实构建、截图及测试证据。请勿在本轮修改视频 Overlay、数据模型或站点适配器。先报告风险和预期变更，再实施与验证。

## 9. 许可证与资料

- BingeUp：<https://github.com/F1rstDan/BingeUp>（Apache-2.0）
- Animal Island UI：<https://github.com/guokaigdg/animal-island-ui>（MIT；第三方代码和素材的完整许可需要根据 npm 依赖审查）
- 原版 Skill：<https://github.com/guokaigdg/animal-island-ui/blob/main/skills/animal-island-ui-style/SKILL.md>
- 组件设计规范：<https://github.com/guokaigdg/animal-island-ui/tree/main/docs/design-system>
- Skill 安装工具：<https://github.com/vercel-labs/skills>

本计划所列目标均尚需在 Codex 工作分支进行验证。
