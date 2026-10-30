## 内测与版本规则

- 插件正在内测，尚未上线。
- 保持插件、数据库和内部存档格式等版本号不变。只有用户明确要求升级版本号时，才修改对应版本号；功能开发、修复和代码整理不构成升级授权。
- 不编写多版本兼容代码，不为旧的内部实现增加迁移、适配或兼容分支。直接维护当前实现。

## Agent skills

### Issue tracker

Issues 存放在 GitHub Issues（通过 `gh` CLI 操作）；外部 PR 不作为分流入口。见 `docs/agents/issue-tracker.md`。

### Triage labels

使用五个标准角色标签，名称为默认值（`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`）。见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文布局——根目录一份 `CONTEXT.md` + `docs/adr/`。见 `docs/agents/domain.md`。


### 提交前检查

推送前运行 `npm run check`。该命令等价于 CI 的 Lint / Format / Typecheck / Test 任务。涉及构建的改动再运行 `npm run build` 与 `npm run build:edge`。

### Git 提交规范

默认使用约 80% ASD-STE100 规范风格的简体中文编写 Git 提交信息；仅在用户明确指定其他语言时例外。
