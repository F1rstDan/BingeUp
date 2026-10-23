# 内置词库重建数据

本目录保存用 AI 重建内置词库所需的冻结种子、身份注册表和批次数据。运行产物不在生成过程中覆盖 `public/dictionaries/`。

- `seed.json`：原始 5,376 个 ID 的一次性身份种子。只保存词形、词频、难度、词库成员关系和 ECDICT 出处，不保存旧释义、例句或音标。
- `registry-decisions.json`：需要人工复核的少量身份决策。其余 ID 由种子确定性推导为保留。
- `legacy-registry.json`：生成的身份注册表。每个原始 ID 都有保留、纠正、合并或停用结论。它是身份去向的唯一数据来源。
- `batches/`：批次输入、候选输出、题组和复核状态。
- `staging/`：全部检查通过后合并的候选包，不直接进入扩展包。
- `staging-pilot/`：100 词试批候选包，用于离线演示和早期验收。
- `sources/`：固定 IPA 快照及第三方许可文本。

重新生成身份文件：

```bash
node scripts/dictionary-rebuild/build-seed.ts
```

该命令只在旧词库仍位于 `public/dictionaries/` 时可用。切换正式词库后，`seed.json` 与 `legacy-registry.json` 作为冻结依据保留。

## 当前进度

2026-10-24：身份注册表已冻结并通过核对；原始 ID 5,376 个，有效词 5,374 个，`w-negro` 因过时且具冒犯性停用。100 词试批已完成生成、全量独立复核和修复复核，`staging-pilot/` 已通过全量检查。主词库 211 个批次全部 verified；全量 `staging/` 已生成并通过整包校验，包含 5,374 个有效词、5,374 个固定题组、3 个词库和完整来源许可。正式词库尚未切换。

## 续跑命令

```bash
npm run dictionary:status
npx tsx scripts/dictionary-rebuild/pipeline.ts accept <batchId>
npx tsx scripts/dictionary-rebuild/pipeline.ts ipa-list
npx tsx scripts/dictionary-rebuild/pipeline.ts ipa-apply <file>
npx tsx scripts/dictionary-rebuild/pipeline.ts review <batchId> <review.json>
npm run dictionary:build
```

每个已验证批次和状态应形成独立 Git 提交。不要把未复核的批次标为 `verified`，也不要在生成过程中覆盖 `public/dictionaries/`。
