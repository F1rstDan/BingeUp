# Domain Docs

工程技能在探索代码库时，应如何消费本仓库的领域文档。

## Before exploring, read these

- 根目录的 **`CONTEXT.md`**，或者
- 根目录的 **`CONTEXT-MAP.md`**（若存在）——它指向每个上下文一份 `CONTEXT.md`。阅读与主题相关的每一份。
- **`docs/adr/`**——阅读与你即将工作区域相关的 ADR。在多上下文仓库中，还要检查 `src/<context>/docs/adr/` 中的上下文范围决策。

若这些文件不存在，**静默继续**。不要标记其缺失；不要预先建议创建。`/domain-modeling` 技能（经 `/grill-with-docs` 和 `/improve-codebase-architecture` 到达）会在术语或决策真正被解决时惰性创建它们。

## File structure

单上下文仓库（大多数仓库）：

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

多上下文仓库（根目录存在 `CONTEXT-MAP.md`）：

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← 系统级决策
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← 上下文特定决策
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## Use the glossary's vocabulary

当你的输出命名一个领域概念（在 issue 标题、重构提案、假设、测试名中）时，使用 `CONTEXT.md` 中定义的术语。不要漂移到词汇表明确避免的同义词。

若你需要的概念还不在词汇表中，那是一个信号——要么你在发明项目不使用的语言（重新考虑），要么存在真实缺口（记下来给 `/domain-modeling`）。

## Flag ADR conflicts

若你的输出与现有 ADR 矛盾，显式地提出而不是静默覆盖：

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
