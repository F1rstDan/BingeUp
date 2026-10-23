# 词库流水线

本文说明内置词库的来源、构建和运行方式。本文依据 2026-10-24 的仓库实现。

## 重建流水线（规格 #54）

新内置词库的冻结依据、批次状态和候选包位于 `data/dictionary-rebuild/`。2026-10-24 已切换：运行中的 `public/dictionaries/` 是 schema 2 新词库；切换前的旧 v1 包归档在 `data/dictionary-rebuild/archive/legacy-v1-*`。

```bash
npm run dictionary:seed       # 从旧词库身份元数据生成 seed.json 和身份注册表
npm run dictionary:check      # 逐旧 ID 核对注册表、成员关系、哈希和稳定元数据
npm run dictionary:prepare    # 冻结 100 词试批和其余稳定 ID 批次
npm run dictionary:status     # 查看批次状态和失败项
npx tsx scripts/dictionary-rebuild/pipeline.ts accept <batchId>
npx tsx scripts/dictionary-rebuild/pipeline.ts review <batchId> <review.json>
npm run dictionary:build -- --pilot  # 仅用已通过试批生成演示包
npm run dictionary:build      # 全部批次通过后生成正式 staging 候选包
npm run dictionary:switch     # 把 staging 切换为正式 public/dictionaries
npm run dictionary:rollback -- --dry-run  # 检查可回滚的旧包
```

`seed.json` 只保存旧 ID、规范词形、词频、难度和词库成员关系，不保存旧释义、例句或音标。`legacy-registry.json` 是身份去向的唯一来源；`state.json` 只保存批次、哈希、用量和复核绑定。`plan-overrides.json` 记录独立复核后停用的可选题型或需要排除的干扰项。

批次输入每批 25 词。生成内容只包含一个主词性、一个主释义、最多两个其他义项、例句、翻译和表层词形；IPA 从 `sources/en_US.txt` 固定快照合入，多候选和缺项必须逐词选择或独立转写。固定题组在接收批次时生成并写入 `questions.jsonl`，审计理由写入 `audit.json`。

试批 100 词必须逐词独立复核。后续批次按冻结样本复核，困难项额外复核。复核失败时批次回到 `needs-fix`，已接受内容保留。只有全部批次验证且候选包全量检查通过，才允许写入 staging 和切换正式词库。

正式包包含 `words.json`、`decks.json`、`questions.json`、`legacy-registry.json`、`manifest.json`、`source-metadata.json`、`LICENSE.txt` 和 `licenses/`。运行时先校验 manifest 与文件哈希，再校验词条、题组引用和身份注册表；任一失败都拒绝加载，避免资源混版。

当前全量包包含 5,376 个原始 ID、5,374 个有效词、5,374 个固定题组和 3 个词库。`public/dictionaries/` 与 `data/dictionary-rebuild/staging/` 内容一致，`data/dictionary-rebuild/archive/switch-*.json` 记录切换时间和新包哈希。

需要兼容回滚时，先运行 `npm run dictionary:rollback -- --dry-run` 确认源包，再运行 `npm run dictionary:rollback`，然后重新构建。回滚前先导出当前 v2 数据；回滚后导入该 v2 备份以恢复新进度。命令会把切换前的包归档到 `archive/pre-rollback-*`。不要把旧包留在 `public/`，否则 WXT 会把它一起打进扩展包。

### 旧 ECDICT 构建器（历史，待清理）

以下内容描述旧词库，只用于切换前的兼容和来源追溯。

### 旧来源（历史）

内置词库来自 ECDICT 的固定快照 `bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b`。ECDICT 使用 MIT License。许可证保存在 `public/dictionaries/LICENSE.txt`。

词库包含日常高频、四级和六级。三个词库可以包含同一单词。同一单词只有一条 `WordRecord`，用户也只有一张学习卡。

### 旧构建（历史）

在仓库根目录运行：

```bash
npx tsx scripts/build-dictionary/build.ts
```

构建器写出 `words.json`、`decks.json`、`manifest.json`、`source-metadata.json` 和 `LICENSE.txt`。首次运行下载 CSV 和许可证。后续运行使用缓存。

当前仓库未固定 `tsx`。`npx` 可能临时下载该工具。需要可复现构建时，应固定 `tsx` 版本。

构建内容可重复。`generatedAt` 和 `importedAt` 使用当前时间，所以文件不保证逐字节一致。如果校验失败，构建器仍会写出产物，并以非零状态退出。此时不应发布产物。

**警告：** 不要在正式工作区运行 `scripts/build-dictionary/build-sample.ts`。该脚本会覆盖 `public/dictionaries/`。

### 旧数据约定（历史）

`surfaceFormInExample` 是例句中实际出现的目标词形。语境题使用该值作为正确答案。该词形应在例句中按整词、忽略大小写恰好出现一次。

`frequencyRank` 越小，单词越常用。`DeckRecord.wordDifficulties` 保存单词在该词库中的难度。通用难度按词频计算：不高于 3000 为 1，3001–8000 为 2，8001–15000 为 3，其他为 4。Oxford 3000 词为 1。修改规则后，应提高 `difficultyRuleVersion`。

构建器校验字段、词性、例句和重复 lemma。构建器不检查语义级同义冲突，也不检查干扰项是否唯一。

## 运行

`BuiltInWordBank` 在后台服务中读取 manifest。schema 2 会加载 `words.json`、`decks.json`、`questions.json`、`legacy-registry.json`、`source-metadata.json` 和 `LICENSE.txt`，校验哈希与引用后再缓存到内存；schema 1 只读取 `words.json` 和 `decks.json`，用于兼容回滚。加载失败后，下一次读取会重试。完整词库不进入内容脚本 bundle，也不保存到 IndexedDB。更新词库后，应重新加载扩展或重启后台服务。

运行时不应从远程地址下载词库。

候选新词只来自当前词库。系统先排除已有学习卡的单词，再按自评水平选择难度区间：

- 初级：1–2，然后 3、4。
- 中级：2–3，然后 1、4。
- 高级：3–4，然后 2、1。

在每个区间中，系统按 `frequencyRank` 升序取前 50 个候选，再随机选择一个。优先区间为空时，系统进入下一个区间。所有区间为空时，系统不生成新词展示。
