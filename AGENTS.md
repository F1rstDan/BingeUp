## Agent skills

### Issue tracker

Issues 存放在 GitHub Issues（通过 `gh` CLI 操作）；外部 PR 不作为分流入口。见 `docs/agents/issue-tracker.md`。

### Triage labels

使用五个标准角色标签，名称为默认值（`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`）。见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文布局——根目录一份 `CONTEXT.md` + `docs/adr/`。见 `docs/agents/domain.md`。


### Git 提交规范

默认使用约 80% ASD-STE100 规范风格的简体中文编写 Git 提交信息；仅在用户明确指定其他语言时例外。