# Adopt animal-island-ui original visual language for all user-facing UI

BingeUp 所有面向用户的界面（视频遮罩、启用提示、播放恢复提示、Popup、安装引导、设置页、统计页）统一采用 animal-island-ui（MIT）的原版视觉语言：奶油/羊皮纸底色、薄荷主色、暖棕色文字、50px 胶囊按钮与 12px 最小交互圆角、仅原版主/危险主按钮使用 3D 堆叠阴影、Nunito + Noto Sans SC 字体、原版动效与 naive-icons 图标；最终视觉零偏离，不自创主题。实现方式允许等效：在 Shadow DOM / Portal 约束下，可按原版规范在 BingeUp 内实现局部呈现组件，但不得改动用 OverlayAction 表达的业务语义、键盘快捷键、视频暂停/恢复与触发冷却行为。已否决的替代：保留旧蓝粉自绘风格、遮罩维持自绘仅换设计令牌、字体仅拉丁并让中文走系统回退（省约 3.3MB）。

内容脚本（Shadow DOM）边界：视频遮罩内使用库组件前，必须先通过 M4 的 Shadow DOM 样式/字体 PoC（:root 令牌映射到 :host、字体资源以 chrome-extension:// 路径加载并在最小范围声明 web_accessible_resources）；Modal、Drawer、Image 预览通过 createPortal 挂到 document.body，Notification 在 document.body 新建 React Root——这些组件都会渲染到宿主文档并可能修改宿主页滚动与子元素，禁止在内容脚本中使用，扩展独立页面不受此限。遮罩宿主定位与铺满契约继续遵守 docs/overlay-layout-regression-lessons.md 的既有结论。

代价与约束：依赖锁定 animal-island-ui@2.2.1（实施时复核版本与 lockfile；直接导入 naive-icons 时将其声明为直接依赖，版本 ≥1.6.0），接受 classnames peer 与 naive-icons 运行依赖；字体全量本地打包（9 个 woff2 约 3.4MB，含 3 个中文子集），扩展页面与视频遮罩共用同一份 files/ 交付路径；工单 #46 去重后实测解包体积 7,765,057 B、安装 zip 4,892,913 B，不使用 Google Fonts/CDN。验证标准为每阶段 typecheck/test/lint/build/build:edge 全绿加关键组件与 Shadow DOM 隔离测试，辅以 B 站/YouTube 真站手测；截图仅作为证据，不引入像素比对基线。许可证与第三方声明在 M6 汇总，保留库与字体的版权信息（见仓库根目录 THIRD-PARTY-NOTICES.md）。

迁移按《BingeUp × Animal Island UI 迁移实施计划》M0→M6 分阶段执行，每阶段独立 PR。计划文档 v1.0 与本文档不一致之处（版本基线、字体体积实测、Portal 清单、截图口径、技能安装步骤）以本文档与实施时复核为准。勘误（2026-10-14，工单 #46）：早期复核记录中“Modal 没有 variant 属性”的表述有误——2.2.1 的类型声明为 ModalProps.variant?: 'default' | 'game'，设置页危险操作确认实际使用 variant="game"（关闭打字机）；计划文档中 Modal variant="game" 的用法与锁定版本一致。
