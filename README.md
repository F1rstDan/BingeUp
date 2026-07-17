<p align="center">
  <img src="./docs/assets/readme/hero.svg" width="100%" alt="刷刷升级：在视频自然间隙学一个词，再继续播放">
</p>

<p align="center">
  <strong>刷着刷着，就升级了。</strong><br>
  一款把轻量英语学习放进视频自然间隙的浏览器扩展。
</p>

<p align="center">
  Chrome / Edge · Bilibili / YouTube · React + TypeScript · Apache-2.0
</p>

## 先看它怎么工作

当你进入新视频，刷刷升级会暂停主视频并盖上一道轻量学习题。答完或跳过后，视频从原进度继续；如果你想多学几题，也可以主动进入连续学习。

<p align="center">
  <img src="./docs/assets/readme/showcase.png" width="100%" alt="刷刷升级真实产品界面合集：视频内学习、安装引导、连续答题和插件状态控制">
</p>

<p align="center"><sub>真实运行界面：视频内学习、连续答题、首次引导与快捷控制。</sub></p>

## 学习被放在间隙里，而不是待办清单里

- **自然触发**：进入新视频时出现学习界面；长视频定时学习由用户主动开启。
- **轻量完成**：新词展示、选择题和拼写题都在浮层内完成，不离开当前页面。
- **到期优先**：长期复习由 FSRS 调度；没有到期复习时再展示候选新词。
- **懂得退后**：正常完成后进入全局冷却，连续跳过会逐级延长冷却。
- **随时多学**：选择“提交并继续”即可保持视频暂停，连续处理多个学习项目。

<p align="center">
  <img src="./docs/assets/readme/workflow.svg" width="100%" alt="新视频触发、暂停主视频、学习一个词、继续播放并进入冷却的流程">
</p>

## 现在可以做什么

| 场景 | 能力 |
| --- | --- |
| 视频学习 | Bilibili 与 YouTube 的普通视频、竖屏视频和直播识别 |
| 学习内容 | 日常高频、四级、六级三套内置词库，可选择学习水平 |
| 题型 | 英选中、中选英、例句语境选择与拼写题 |
| 复习 | 新词短期巩固 + FSRS 长期复习调度 |
| 节奏 | 默认冷却、连续跳过降频、全局暂停、连续学习 |
| 数据 | 今日统计、导出、恢复备份、清除学习进度或全部数据 |

> [!NOTE]
> 学习进度、设置与复习记录保存在浏览器本地。内置词库随扩展提供，不会混入用户备份。

## 本地安装

当前仓库尚未发布预编译 Release。最短可用路径是从源码构建：

```bash
git clone https://github.com/F1rstDan/BingeUp.git
cd BingeUp
npm install
npm run build
```

然后在 Chrome 或 Edge 中：

1. 打开扩展管理页：Chrome 为 `chrome://extensions/`，Edge 为 `edge://extensions/`。
2. 开启「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择构建产物目录 `.output/chrome-mv3`；Edge 构建请先运行 `npm run build:edge`，再选择 `.output/edge-mv3`。
5. 打开 Bilibili 或 YouTube，完成首次引导后进入一个视频。

### 升级到新版本

1. 拉取最新代码并重新构建：`git pull && npm install && npm run build`（Edge 另需 `npm run build:edge`）。
2. 回到扩展管理页，在「刷刷升级」卡片上点击「重新加载」（circular 箭头图标）。
3. 学习进度、设置与复习记录保存在浏览器本地 IndexedDB，升级不会清除；如遇不兼容变更，请先按下方「数据备份」导出。

### 卸载

1. 在扩展管理页的「刷刷升级」卡片上点击「移除」。
2. 卸载会一并清除该扩展的本地数据（学习进度、设置、词库）。如需保留，请先导出备份。

### 数据备份

- **导出**：设置页 →「数据管理」→「导出数据」，会下载一个 `bingeup-backup-YYYY-MM-DD.json`。备份仅包含用户数据（学习进度、设置、网站配置），不含随扩展分发的内置词库。
- **导入 / 恢复**：设置页 →「数据管理」→「导入数据」，选择此前导出的 JSON 即可原子恢复；导入失败会保持原数据不变。
- **重置**：「清除学习进度」仅删除学习卡 / 复习日志 / 会话；「清除全部数据」还会删除网站设置与本地词库。

## 反馈

Beta 阶段的问题与建议，欢迎通过扩展内入口反馈：Popup 或设置页底部的「反馈问题或建议」会打开预填的 [GitHub Issues](https://github.com/F1rstDan/BingeUp/issues) 新建页面（自动带上扩展版本与浏览器信息，便于复现）。本扩展不设账号、不做任何远程行为分析或数据上报。

## 开发

前置要求：Node.js 22+。

```bash
npm install          # 安装依赖
npm run dev          # Chrome 开发模式，支持 HMR
npm run typecheck    # TypeScript 类型检查
npm test             # 运行测试
npm run lint         # ESLint 检查
npm run build        # Chrome 生产构建
```

<details>
<summary><strong>全部项目命令</strong></summary>

| 用途 | 命令 |
| --- | --- |
| Chrome 开发模式 | `npm run dev` |
| Edge 开发模式 | `npm run dev:edge` |
| 类型检查 | `npm run typecheck` |
| 单元 / 集成测试 | `npm test` |
| 测试监听 | `npm run test:watch` |
| 浏览器 E2E（本地手动） | `npm run test:e2e` |
| Lint 检查 / 修复 | `npm run lint` / `npm run lint:fix` |
| 格式化 / 检查 | `npm run format` / `npm run format:check` |
| Chrome / Edge 构建 | `npm run build` / `npm run build:edge` |
| 打包 zip | `npm run zip` |

</details>

项目基于 [WXT](https://wxt.dev/)、React 18、TypeScript、IndexedDB、[ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) 与 Manifest V3。领域术语见 [CONTEXT.md](./CONTEXT.md)，架构决策见 [docs/adr](./docs/adr)。

## License

[Apache License 2.0](./LICENSE)
