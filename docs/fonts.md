# 界面字体

- 英文与数字：Nunito，随 animal-island-ui 样式和字体资产一起打包，使用 500 / 700 / 900 三档。
- 中文：寒蝉半圆体 ChillRoundM，v1.805，来自 https://github.com/Warren2060/ChillRound ，使用 SIL Open Font License 1.1。
- 字体文件：`public/fonts/ChillRoundM.otf`。许可文本：`public/licenses/ChillRoundM-OFL.txt`。

页面侧在 `src/ui/styles/base.css` 声明 `@font-face` 并覆盖 `--animal-font-family`；遮罩与反馈 Shadow DOM 在 `src/ui/island/shadow-styles.ts` 追加同一字体声明，并通过 FontFace API 注册。字体文件通过 `wxt.config.ts` 的 `web_accessible_resources` 暴露给内容脚本。

回退顺序为 `Nunito, ChillRoundM, Noto Sans SC, ...`：拉丁字符优先 Nunito，中文字符使用 ChillRoundM，字体缺失时回退到 Noto Sans SC 和系统字体。

