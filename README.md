# 刷刷升级（BingeUp）

> 刷着刷着，就升级了。

刷刷升级是一款浏览器插件，在你刷 Bilibili、YouTube 等视频网站时，利用视频切换的自然间隙，轻量弹出英语单词学习题。刷视频时，顺手学点东西。

## 功能特性

- **视频暂停弹题** — 切换视频时自动暂停，弹出单词题目，答完或跳过立即恢复播放
- **三种选择题 + 拼写题** — 英文选中文、中文选英文、例句语境选择，连续模式支持拼写
- **新词学习 & 间隔复习** — 新词先展示后测试，已学单词由 FSRS 算法自动调度复习
- **智能冷却与降频** — 正常答题后冷却 2 分钟；连续跳过自动延长冷却、甚至暂停，不打扰你
- **连续学习模式** — 想多学几题？提交并继续，视频保持暂停，一口气刷完
- **学习统计** — 今日答题数、复习词数、已掌握词数，展示积累但不制造打卡焦虑
- **数据导出 / 导入** — 学习数据可备份、恢复，也可一键清除
- **Bilibili & YouTube 支持** — 横屏视频、竖屏 Shorts、直播均可运行

## 安装

### 下载安装包

从 [Releases](https://github.com/F1rstDan/BingeUp/releases) 下载最新版 `bingeup-v{version}.zip`，解压后：

1. 打开 Chrome 浏览器，进入 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择解压后的文件夹

### 从源码构建

```bash
git clone https://github.com/F1rstDan/BingeUp.git
cd bingeup
npm install
npm run build
```

构建产物在 `dist/` 目录，按上述步骤加载即可。

## 使用说明

1. 安装后首次打开 Bilibili 或 YouTube，插件会自动启用
2. 进入视频页面，识别到视频后立即弹出第一道题
3. 选择一个选项，点击「提交」答题并恢复视频，或点击「跳过」直接返回
4. 想多学几题？点击「提交并继续」进入连续学习模式
5. 点击浏览器工具栏的插件图标，可查看当前状态、暂停或进入设置

## 本地开发

**前置要求**：Node.js 20+

所有开发命令的唯一来源是 `package.json` 的 `scripts` 字段。下表列出日常使用的命令：

| 用途               | 命令                   | 说明                                   |
| ------------------ | ---------------------- | -------------------------------------- |
| 安装依赖           | `npm install`          | 安装 `package.json` 中声明的全部依赖   |
| 开发模式（Chrome） | `npm run dev`          | 启动 WXT 开发服务器，带 HMR            |
| 开发模式（Edge）   | `npm run dev:edge`     | 以 Edge 为目标浏览器启动开发服务器     |
| 类型检查           | `npm run typecheck`    | `tsc --noEmit`，不产出文件             |
| 单元测试           | `npm test`             | `vitest run`，一次性运行全部用例       |
| 测试监听模式       | `npm run test:watch`   | `vitest`，文件变更时重跑               |
| Lint 检查          | `npm run lint`         | `eslint .`，扫描全项目                 |
| Lint 自动修复      | `npm run lint:fix`     | `eslint . --fix`                       |
| 格式化             | `npm run format`       | `prettier --write .`，统一代码风格     |
| 格式化检查         | `npm run format:check` | `prettier --check .`，CI 用            |
| 生产构建（Chrome） | `npm run build`        | `wxt build` + 内容脚本清单校验         |
| 生产构建（Edge）   | `npm run build:edge`   | `wxt build -b edge` + 内容脚本清单校验 |
| 打包 zip           | `npm run zip`          | `wxt zip`，产出可发布的扩展包          |

> 命令脚本以 `package.json` 为唯一真实来源；本表仅作索引，新增命令请同步更新此处。

## 技术栈

- [WXT](https://wxt.dev/) — 浏览器扩展框架
- React 18 + TypeScript
- Tailwind CSS
- IndexedDB — 本地数据存储
- [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) — 间隔复习算法
- Vitest — 单元测试
- Manifest V3

## 许可证

[Apache-2.0](LICENSE)
