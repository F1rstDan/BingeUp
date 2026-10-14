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
