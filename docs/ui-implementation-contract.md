# 界面实现约束

本文记录当前界面的实现约束。视觉方向见 [ADR 0003](./adr/0003-adopt-animal-island-ui.md)。本文依据 2026-10-23 的仓库实现。

## 扩展页面

扩展页面的每个入口只导入一次 `animal-island-ui/style`。页面 CSS 只处理布局。布局样式通过 `--island-*` 别名读取 `--animal-*`。

非危险主按钮使用薄荷色。覆盖规则位于 `src/ui/island/island-theme.css` 和 `src/ui/island/shadow-styles.ts`。其他按钮和控件使用组件库的默认外观。

## 内容脚本

视频遮罩、答题反馈、启用提示和播放恢复提示使用独立 ShadowRoot。内容脚本不应向宿主页注入全局样式。

ShadowRoot 依次注入宿主重置、组件库 CSS 和外壳 CSS。`shadow-styles.ts` 将顶层 `:root` 自定义属性映射到 `:host`，并改写字体 URL。遮罩布局规则见 [遮罩布局回归经验](./overlay-layout-regression-lessons.md)。

正确、错误和选中状态应同时使用文字或图标，不应只靠颜色。

## Portal

`Modal`、`Drawer`、图片预览和 `Notification` 会向 `document.body` 添加节点或 React Root。内容脚本不应使用这些组件。扩展页面可以使用 `Modal`。

## 字体

字体随扩展本地打包。内容脚本不应引用远程字体。`shadow-styles.ts` 使用 `?raw` 读取组件库 CSS，并通过 `document.fonts` 注册字体，因为 Chromium 不加载 ShadowRoot 内的 `@font-face`。

`wxt.config.ts` 复制字体文件，并限制 `web_accessible_resources` 的范围。`npm run build` 和 `npm run build:edge` 会检查字体资源的产物。第三方许可见 `THIRD-PARTY-NOTICES.md`。

## 验证

修改界面后，运行 `npm run check`、`npm run build` 和 `npm run build:edge`。然后在 Bilibili 和 YouTube 检查遮罩布局、字体加载和视频恢复。

视觉改动不应改变学习动作、视频播放、全局冷却或数据存储的语义。
