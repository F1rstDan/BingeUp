# ADR 003: ECDICT 词库构建流水线与运行时加载

**状态**: 已采纳  
**日期**: 2026-07-13  
**关联 Issue**: [#25](https://github.com/F1rstDan/BingeUp/issues/25)

## 背景

Issue #25 要求交付首发词库（日常高频、四级、六级），并建立可重复运行的离线构建流程。需要决定：数据源、构建流水线位置、运行时加载策略、数据模型变更。

## 决策

### 1. 数据源：ECDICT（MIT License）

使用 ECDICT 固定 commit `bc015ed2` 的快照数据。仓库当前声明为 MIT License。
- 词条、释义、词频、考试标签：来自 ECDICT
- 例句：从 ECDICT `detail` 字段提取，校验通过后使用
- 来源元数据记录在 `public/dictionaries/source-metadata.json`

### 2. 构建流水线

- 位置：`scripts/build-dictionary/`
- 输出：`public/dictionaries/`（words.json, decks.json, manifest.json, source-metadata.json, LICENSE.txt）
- 可重复运行，幂等
- 提供 `build-sample.ts` 用于生成测试用样本数据

### 3. 运行时加载

- `BuiltInWordBank` 从 `public/dictionaries/` 加载 JSON 文件
- 首次加载后缓存到内存（不常驻完整词库到 bundle）
- `WordBankPort` 全部异步化

### 4. 数据模型变更

**WordRecord 新增字段**：
- `surfaceFormInExample?: string` — 例句中目标词的表层词形（如 abandoned），用于语境选择题
- `exampleSentence` / `exampleTranslation` 改为可选（无例句时不能用于语境题）

**DeckRecord 新增字段**：
- `wordDifficulties?: Record<string, number>` — 词库内每个单词的难度

**难度计算**：
- `WordRecord.difficulty`：基于词频的通用难度
- `DeckRecord.wordDifficulties`：词库内相对难度

### 5. 候选新词选择

- 当前词库只从对应成员中选择
- 自评水平对应优先难度区间：beginner [1,2], intermediate [2,3], advanced [3,4]
- 逐级扩展：优先区间无候选时，扩展到相邻难度
- 区间内随机选择（非固定顺序）

## 后果

- 构建流水线需要开发者手动运行（或 CI 集成）
- 示例数据可通过 `build-sample.ts` 快速生成，无需下载完整 ECDICT
- 后续需要添加 IndexedDB 持久化以避免每次加载时内存占用全量词库