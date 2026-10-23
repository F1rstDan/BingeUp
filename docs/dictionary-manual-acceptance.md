# 词库真机验收清单

本清单用于完成 #64 中无法在无头环境证明的部分。每项记录浏览器版本、结果和异常。

## 准备

- 构建 Chrome：`npm run build`，产物在 `.output/chrome-mv3`。
- 构建 Edge：`npm run build:edge`，产物在 `.output/edge-mv3`。
- 记录浏览器版本：Chrome 菜单 → 帮助 → 关于；Edge 同理。
- 如要测试已有安装升级，先保留旧版扩展目录和旧版用户数据。

## 1. 干净安装

Chrome：打开 `chrome://extensions`，启用开发者模式，选择“加载已解压的扩展程序”，指向 `.output/chrome-mv3`。Edge：打开 `edge://extensions`，指向 `.output/edge-mv3`。

检查：

- 扩展加载无错误，service worker 正常。
- 首次打开不出现空白页或词库校验错误。
- 能进入学习页并看到新词。

## 2. 断网学习

在开发者工具 Network 面板选择 Offline，或断开网络。

检查：

- 三个词库仍可切换。
- 新词、英选中、中选英、语境和拼写题仍可生成。
- 提交答案后显示反馈，学习卡的下次复习时间更新。
- 刷新扩展页面后进度仍在。

自动化已覆盖同一路径：`e2e/dictionary-offline.spec.ts`。真机仍需确认扩展页面和系统环境。

## 3. 系统语音

打开新词卡，点击左上角带框喇叭按钮和例句前的喇叭按钮。

检查：

- 使用设备本地英语语音，不请求网络。
- 停止、重试和切换词卡时行为正确。
- 没有本地英语语音时显示可理解的降级提示，学习仍可继续。
- 记录系统语音名称、语言和是否本地。

## 4. 已有安装升级

1. 在旧版扩展中创建至少一张学习卡并记录历史、每日额度和设置。
2. 用新构建覆盖加载扩展，保持同一浏览器配置目录。
3. 打开设置页和学习页。

检查：

- 旧学习卡、历史答案、统计和额度未丢失。
- 合卡和停用记录按注册表转换，没有半迁移。
- 新词库可以继续出题和提交。

## 5. 兼容回滚

先运行 dry-run：

```powershell
npm run dictionary:rollback -- --dry-run
```

确认源包是 schema 1 后，先导出当前 v2 数据，再执行：

```powershell
npm run dictionary:rollback
npm run build
npm run build:edge
```

重新加载扩展，导入刚才的 v2 备份。

检查：

- 回滚后扩展仍能加载旧词库并出题。
- 导入 v2 备份后，新进度、历史和额度可用。
- 合卡新增进度不会被错误拆回两张卡。
- 记录回滚前后 manifest schema 和包哈希。

回滚完成后恢复新包：

```powershell
npm run dictionary:switch
npm run build
npm run build:edge
```

## 6. 保留窗口

- 旧 v1 包：`data/dictionary-rebuild/archive/legacy-v1-*`
- 切换前 v2 包：`data/dictionary-rebuild/archive/pre-rollback-*`
- 切换记录：`data/dictionary-rebuild/archive/switch-*.json` 和 `rollback-*.json`

从首版发布起至少保留 7 天，并覆盖本次 Beta 验收。到期前不要删除这些目录。

## 记录表

| 项目 | Chrome | Edge |
|---|---|---|
| 浏览器版本 | | |
| 干净安装 | | |
| 断网出题与提交 | | |
| 系统语音可用 | | |
| 语音不可用降级 | | |
| 已有安装升级 | | |
| v2 导出 | | |
| 回滚到 v1 | | |
| 回滚后导入 v2 | | |
| 恢复 schema 2 | | |

未完成的项目保持为空，不写成通过。

