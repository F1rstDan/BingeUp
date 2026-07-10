# Issue tracker: GitHub

本仓库的 issue 和 PRD 存放在 GitHub issues 中。所有操作使用 `gh` CLI。

## Conventions

- **创建 issue**：`gh issue create --title "..." --body "..."`。多行 body 用 heredoc。
- **读取 issue**：`gh issue view <number> --comments`，用 `jq` 过滤评论并获取标签。
- **列出 issue**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，配合适当的 `--label` 和 `--state` 过滤。
- **评论 issue**：`gh issue comment <number> --body "..."`
- **添加 / 移除标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **关闭**：`gh issue close <number> --comment "..."`

仓库从 `git remote -v` 推断——在 clone 内运行 `gh` 会自动识别。

## Pull requests as a triage surface

**PRs as a request surface: no.** _(若本仓库将外部 PR 视为功能请求，则改为 `yes`；`/triage` 会读取此标志。)_

设为 `yes` 时，PR 与 issue 走相同的标签和状态，使用 `gh pr` 等价命令：

- **读取 PR**：`gh pr view <number> --comments`，以及 `gh pr diff <number>` 获取 diff。
- **列出待分流的外部 PR**：`gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`，仅保留 `authorAssociation` 为 `CONTRIBUTOR`、`FIRST_TIME_CONTRIBUTOR` 或 `NONE` 的项（丢弃 `OWNER`/`MEMBER`/`COLLABORATOR`）。
- **评论 / 标签 / 关闭**：`gh pr comment`、`gh pr edit --add-label`/`--remove-label`、`gh pr close`。

GitHub 的 issue 和 PR 共享同一编号空间，因此裸 `#42` 可能是任一——用 `gh pr view 42` 解析，失败则回退到 `gh issue view 42`。

## When a skill says "publish to the issue tracker"

创建一个 GitHub issue。

## When a skill says "fetch the relevant ticket"

运行 `gh issue view <number> --comments`。

## Wayfinding operations

供 `/wayfinder` 使用。**map** 是一个单一 issue，其子 issue 作为 ticket。

- **Map**：一个标记为 `wayfinder:map` 的 issue，承载 Notes / Decisions-so-far / Fog 正文。`gh issue create --label wayfinder:map`。
- **Child ticket**：作为 GitHub sub-issue 链接到 map 的 issue（对 sub-issues 端点调用 `gh api`）。若 sub-issues 不可用，则把子项加入 map 正文的 task list，并在子正文顶部写 `Part of #<map>`。标签：`wayfinder:<type>`（`research`/`prototype`/`grilling`/`task`）。认领后，ticket 分配给驱动的开发者。
- **Blocking**：GitHub 的**原生 issue 依赖**——规范的、UI 可见的表示。用 `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>` 添加边，其中 `<blocker-db-id>` 是 blocker 的数字 **database id**（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`，_不是_ `#number` 或 `node_id`）。GitHub 通过 `issue_dependencies_summary.blocked_by` 报告（仅未关闭的 blocker——实时门控）。若依赖不可用，则回退到子正文顶部的 `Blocked by: #<n>, #<n>` 行。当所有 blocker 关闭时，ticket 解除阻塞。
- **Frontier query**：列出 map 的未关闭子项（`gh issue list --state open`，限定到 map 的 sub-issues / task list），丢弃任何有未关闭 blocker（`issue_dependencies_summary.blocked_by > 0`，或 `Blocked by` 行中有未关闭 issue）或已分配 assignee 的项；按 map 顺序首个胜出。
- **Claim**：`gh issue edit <n> --add-assignee @me`——会话的第一次写入。
- **Resolve**：`gh issue comment <n> --body "<answer>"`，然后 `gh issue close <n>`，最后把上下文指针（gist + 链接）追加到 map 的 Decisions-so-far。
