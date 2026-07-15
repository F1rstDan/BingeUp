## Agent skills

### Issue tracker

Issues 存放在 GitHub Issues（通过 `gh` CLI 操作）；外部 PR 不作为分流入口。见 `docs/agents/issue-tracker.md`。

### Triage labels

使用五个标准角色标签，名称为默认值（`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`）。见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文布局——根目录一份 `CONTEXT.md` + `docs/adr/`。见 `docs/agents/domain.md`。

### Code review agent

执行 `/code-review` 时，Standards 与 Spec 两个审查轴必须各自使用项目自定义智能体 `code-reviewer`；此规则覆盖该技能中原有的 `general-purpose` 子智能体选择，但不改变其余流程。两个实例必须并行启动，并设置 `fork_turns="none"`，不得继承父任务的对话轮次；只向各实例传入该审查轴所需的固定点、提交列表、diff 命令、规范或需求材料。
