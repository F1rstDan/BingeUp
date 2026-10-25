---
status: accepted
date: 2026-10-14
---

# 统一采用 Animal Island UI 原版视觉语言

所有面向用户的界面采用 `animal-island-ui` 的原版视觉语言，使 Popup、安装引导、设置页、统计页和视频内学习界面保持一致。非危险主按钮使用薄荷主色，这是对库默认奶油主按钮的有意偏离；其余颜色、形状、动效和图标规则沿用库。

组件库和字体随扩展本地打包，内容脚本保持 Shadow DOM 隔离；组件与 Portal 的使用边界见 [界面实现约束](../ui-implementation-contract.md)。

更改组件库后，验证扩展页面、视频内界面、字体加载和构建产物。
