---
status: accepted
date: 2026-07-13
---

# 使用固定 ECDICT 快照作为内置词库来源

日常高频、四级和六级词库使用 ECDICT 的固定 commit `bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b`。该来源声明 MIT License，内容可追溯，并允许随扩展离线分发。

构建在本地完成，运行时只加载生成的内置 JSON。固定快照保证内容可复现，代价是更新词库必须显式升级快照并重新执行完整校验。构建流程见 [词库流水线](../dictionary-pipeline.md)。
