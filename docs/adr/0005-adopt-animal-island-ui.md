# Adopt animal-island-ui original visual language for all user-facing UI

BingeUp 所有面向用户的界面（视频遮罩、启用提示、播放恢复提示、Popup、安装引导、设置页、统计页）采用 animal-island-ui（MIT）的原版视觉语言：奶油/羊皮纸底色、薄荷主色、暖棕色文字、50px 胶囊按钮、12px 最小交互圆角、主/危险主按钮的 3D 堆叠阴影、Nunito + Noto Sans SC 字体、原版动效与 naive-icons 图标。界面不另创主题；非 danger 的 primary 按钮按产品要求使用薄荷主色，这是对库默认奶油主按钮的有意偏离，3D 结构与动效仍沿用库。在 Shadow DOM / Portal 约束下，可按原版规范在 BingeUp 内实现局部呈现组件，但不得改动用 OverlayAction 表达的业务语义、键盘快捷键、视频暂停/恢复与触发冷却行为。已否决的替代：保留旧蓝粉自绘风格、遮罩维持自绘仅换设计令牌、字体仅拉丁并让中文走系统回退。

内容脚本（Shadow DOM）边界：Modal、Drawer、Image 预览和 Notification 会 Portal 到 document.body，可能修改宿主页滚动与子元素，禁止在内容脚本中使用；扩展独立页面不受此限。视频遮罩宿主的定位与铺满契约遵守 docs/overlay-layout-regression-lessons.md。

代价与约束：组件库及字体作为本地资源随扩展打包，不使用 Google Fonts/CDN；依赖版本以 package.json 与 lockfile 为准；保留库与字体的版权信息，第三方声明见 THIRD-PARTY-NOTICES.md。截图只用于人工验收，不建立像素比对基线。
