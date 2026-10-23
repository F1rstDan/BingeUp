# 词库流水线

本文说明内置词库的来源、构建和运行方式。本文依据 2026-10-23 的仓库实现。

## 来源

内置词库来自 ECDICT 的固定快照 `bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b`。ECDICT 使用 MIT License。许可证保存在 `public/dictionaries/LICENSE.txt`。

词库包含日常高频、四级和六级。三个词库可以包含同一单词。同一单词只有一条 `WordRecord`，用户也只有一张学习卡。

## 构建

在仓库根目录运行：

```bash
npx tsx scripts/build-dictionary/build.ts
```

构建器写出 `words.json`、`decks.json`、`manifest.json`、`source-metadata.json` 和 `LICENSE.txt`。首次运行下载 CSV 和许可证。后续运行使用缓存。

当前仓库未固定 `tsx`。`npx` 可能临时下载该工具。需要可复现构建时，应固定 `tsx` 版本。

构建内容可重复。`generatedAt` 和 `importedAt` 使用当前时间，所以文件不保证逐字节一致。如果校验失败，构建器仍会写出产物，并以非零状态退出。此时不应发布产物。

**警告：** 不要在正式工作区运行 `scripts/build-dictionary/build-sample.ts`。该脚本会覆盖 `public/dictionaries/`。

## 数据约定

`surfaceFormInExample` 是例句中实际出现的目标词形。语境题使用该值作为正确答案。该词形应在例句中按整词、忽略大小写恰好出现一次。

`frequencyRank` 越小，单词越常用。`DeckRecord.wordDifficulties` 保存单词在该词库中的难度。通用难度按词频计算：不高于 3000 为 1，3001–8000 为 2，8001–15000 为 3，其他为 4。Oxford 3000 词为 1。修改规则后，应提高 `difficultyRuleVersion`。

构建器校验字段、词性、例句和重复 lemma。构建器不检查语义级同义冲突，也不检查干扰项是否唯一。

## 运行

`BuiltInWordBank` 在后台服务中加载 `words.json` 和 `decks.json`，然后缓存到内存。加载失败后，下一次读取会重试。完整词库不进入内容脚本 bundle，也不保存到 IndexedDB。更新词库后，应重新加载扩展或重启后台服务。

运行时不应从远程地址下载词库。

候选新词只来自当前词库。系统先排除已有学习卡的单词，再按自评水平选择难度区间：

- 初级：1–2，然后 3、4。
- 中级：2–3，然后 1、4。
- 高级：3–4，然后 2、1。

在每个区间中，系统按 `frequencyRank` 升序取前 50 个候选，再随机选择一个。优先区间为空时，系统进入下一个区间。所有区间为空时，系统不生成新词展示。
