# 词库整包切换验收记录

日期：2026-10-24（Asia/Shanghai）

> 维护者决定：本项目当前只有一位使用者，v1/v2 兼容回滚和 7 天保留不作为发布阻断项。相关步骤保留，供需要时参考。

## 已完成的自动化验收

| 项目 | 结果 |
|---|---|
| 全量候选包 | 5,376 原始 ID、5,374 有效词、5,374 固定题组、3 个词库 |
| 整包校验 | `npm run dictionary:verify-package` 通过 |
| 工程检查 | `npm run check`：60 个测试文件、1,013 个测试通过 |
| Chrome 构建 | `npm run build` 通过，产物 `.output/chrome-mv3` |
| Edge 构建 | `npm run build:edge` 通过，产物 `.output/edge-mv3` |
| E2E | 17 passed、33 skipped；跳过项为采集或真实站点人工矩阵，不计作通过证据 |
| 离线答题 | 新增 `e2e/dictionary-offline.spec.ts`：断网加载 schema 2 整包，完成新词展示、接受、出题和答案提交 |
| 内容脚本包 | 完整词库不在 content script bundle；`dictionaries.prev` 不再进入构建产物 |

## 包与回滚位置

- 运行包：`public/dictionaries/`，manifest schema 2。
- 候选包：`data/dictionary-rebuild/staging/`。
- 切换记录：`data/dictionary-rebuild/archive/switch-2026-10-23T20-43-21-936Z.json`。
- 旧 v1 包：`data/dictionary-rebuild/archive/legacy-v1-2026-10-23T20-43-21-936Z/`。

### SHA-256

运行包：

- `manifest.json`：`814a78780ee8f3f0057084eefd60d096a408e19d5fd8351f24c59f33677ab889`
- `words.json`：`eab481c1a2676f351a97b7c836cfb2d4e70fd058a0b45fb487c99412be3c90b4`
- `decks.json`：`eb3ab867c67c1957728b259b872006328df0cbaaaa87e85bc9dfcdcfb46a5900`
- `questions.json`：`8c465d5d4cad12d8401cde9b61f6c7fb4eb44309d5571a9b7a3599086db69c8e`
- `legacy-registry.json`：`f95c9cbaa37f558f40b60b1ab4b7028ce955a589ea1079de9703afe932c3ee6f`
- `source-metadata.json`：`092da0f0dff820a345a22973904491aa2fbe31b2ff0de2c097eccc00d50858cc`
- `LICENSE.txt`：`817848e3634aaed7a5bbf02c6327287ff72b58d1453b341a0b353c513058f489`

旧 v1 包：

- `manifest.json`：`2a1647168f3c414ec38bd98ebf3f8a5d77f690698caf6fc5d7839bd296e7fb01`
- `words.json`：`3683f1b385af60ee013d0de01e4f71ee0ed4948295a0f71e07e712fd4b0ba095`
- `decks.json`：`e6865082bda030a88822c5acee74301d9e83cb6d76c4b61c51f75d9dc94d0363`

## 回滚步骤

1. 在设置页导出当前 v2 数据。
2. 运行 `npm run dictionary:rollback -- --dry-run`，确认源包和当前 schema。
3. 运行 `npm run dictionary:rollback`。命令会把当前包归档到 `archive/pre-rollback-*`。
4. 运行 `npm run build` 与 `npm run build:edge`。
5. 重新加载扩展，导入第 1 步的 v2 备份，检查学习卡、历史和额度。
6. 回滚验收完成后，恢复 schema 2 包并再次构建。

完整的人工步骤见 [词库真机验收清单](dictionary-manual-acceptance.md)。

## 尚未完成的人工验收

- 在真实 Chrome 155 和 Edge 155 中以“加载已解压扩展”方式完成安装、升级和回滚。Playwright 无法在品牌浏览器中通过命令行加载扩展；Chrome 155 会关闭该进程。
- 系统英语语音的实际播放与不可用降级。云端或真实设备音频无法在无头环境中证明。
- 带真实 v1 用户数据升级到 v2，以及导出 v2、回滚到 v1、再导入 v2 的完整数据路径。
- 旧、新和兼容包保留 7 天的发布窗口。

以上项目未完成前，#64 保持打开，不能把整包验收写成全部通过。

