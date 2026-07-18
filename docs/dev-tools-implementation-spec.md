# BingeUp 开发工具实现规格与验收矩阵

状态：已实现，自动化验证通过；真实浏览器题型冒烟待完成
来源：[审定 BingeUp 开发工具按钮的实现规格](https://github.com/F1rstDan/BingeUp/issues/28)  
实现任务：应在独立 issue 中承接；本文只定义目标、接口、状态语义和验收证据。

## 1. 目标

仅在 WXT 开发服务器构建中，为插件面板提供一组真实数据驱动的开发工具：

- 指定弹出新词展示、英选中、中选英、语境选择或拼写题；
- 查看当前词库摘要、全部学习卡、复习日志、学习会话和卡内 FSRS 状态；
- 复用现有“清除学习进度”能力；
- 题目提交继续写入真实学习卡和复习日志，但开发交互不改变视频、全局冷却、首次触发状态或学习会话。

正式构建不得包含开发工具入口、页面、运行时消息或后台处理。

## 2. 范围

### 2.1 包含

- 插件面板底部的“开发工具”折叠区；
- 五个独立题卡按钮；
- 当前词库摘要；
- 独立 `dev-tools.html` 数据页；
- “清除学习进度”确认操作；
- Chrome 与 Edge 开发环境；
- 生产产物排除检查。

### 2.2 不包含

- 通用调试框架、远程诊断、数据编辑或数据导入；
- 生产用户可访问的隐藏入口；
- 跨词库寻找测试单词；
- 测试题型之间的自动回退；
- 对网站开关、主动暂停等 `BehaviorEventRecord` 的展示；
- 清除学习进度之外的数据修改按钮。

## 3. 已确认的产品规则

### 3.1 可见性与页面能力

- 开发环境中，“开发工具”在插件面板的所有状态下都显示，包括受保护页面、缺少主机权限、内容脚本未注入和正常页面。
- 数据摘要、查看详细数据和清除学习进度只依赖 Background，始终可用。
- 弹题卡按钮只有在当前标签页存在可响应的开发内容脚本时才启用。
- 内容脚本不可用时，按钮保持禁用并显示具体原因；不能等点击失败后才说明。
- 当前已有学习交互或另一交互正在准备时，弹题请求被拒绝并提示“当前已有学习界面”。不得关闭、替换或覆盖原交互。

### 3.2 选词与建卡

- “新词”沿用现有候选新词规则，从当前词库选择一个尚无学习卡的单词；展示本身不创建学习卡。
- 其他四种题型先从“当前词库内已有学习卡”中随机选择。
- 学习卡由所有词库共享；“当前词库内已有学习卡”必须用当前词库的 `wordIds` 与 `CardRecord.wordId` 求交集，不能用 `CardRecord.deckId` 判断。
- 若当前词库没有符合题型要求的已有学习卡，则从当前词库选择未学单词，按“知道了”的相同规则创建 `stage: 'short-term'`、`origin: 'accepted-new'` 的真实学习卡，再生成指定题型。
- 开发入口不检查 `dailyNewWordLimit`，但自动创建的学习卡仍计入今日新词。因此今日新词数允许超过上限，且正常学习流程当天可能不再提供候选新词。
- 有多张可用学习卡时随机选择；随机源必须可注入，以便测试固定结果。
- 不跨词库寻找单词。

### 3.3 题型数据要求

| 按钮 | 请求值 | 输出 `LearningItem` | 特殊要求 |
| --- | --- | --- | --- |
| 新词 | `new-word` | `new-word-presentation` | 必须是当前词库未学单词 |
| 英选中 | `en-to-zh` | `question` / `en-to-zh` | 需要三个有效中文释义干扰项 |
| 中选英 | `zh-to-en` | `question` / `zh-to-en` | 需要三个不重复英文干扰项 |
| 语境 | `context-choice` | `question` / `context-choice` | 目标单词必须有可生成空位的例句，并需要三个有效干扰项 |
| 拼写 | `spelling` | `spelling-question` / `spelling` | 不受 `spellingEnabled` 设置限制，不需要选择题干扰项 |

- 指定题型不得按学习阶段改成其他题型。
- 选择题干扰项池沿用正式学习规则，可使用全部内置单词；目标单词仍必须属于当前词库。
- 一个候选学习卡无法生成有效题目时，继续尝试其他随机候选；全部失败后再考虑从未学单词自动建卡。
- 自动建卡前必须先验证该单词能生成目标题型，避免“建卡成功但没有题卡可显示”的半完成状态。
- “语境”没有可用例句时提示“当前词库没有可用例句”，不得回退为中选英。
- 当前词库没有未学单词或其他可用内容时返回明确空状态，不得显示为系统故障。

### 3.4 开发交互的状态语义

- 开发题卡使用 `document.documentElement` 和 `full-page` 遮罩。
- 不检查全局暂停、网站启用状态、全局冷却或每日新词上限。
- 不暂停或恢复视频。
- 题目提交使用现有提交逻辑，真实更新学习卡、复习日志和 FSRS 状态；提交来源记为现有 `manual`，不新增领域来源。
- 新词的“知道了”和“我认识，换一个”继续写入真实学习进度。
- 开发模式中的“我认识，换一个”完成写入后关闭当前交互，不自动加载下一张普通学习卡。
- 跳过不修改单词学习状态。
- 交互结束时关闭遮罩，但不调用：
  - `cooldownStore.recordOutcome`；
  - `siteState.markFirstQuestionHandled`；
  - `sessionLogger.save`；
  - 视频暂停或恢复模块。
- 开发交互期间到达的自然触发仍进入现有待处理队列；开发交互结束后按正式冷却和站点规则重新判断，不因开发交互获得额外许可。
- 遮罩或提交发生内部错误时，必须关闭遮罩并释放开发交互状态；已由底层原子操作成功写入的数据不伪装成回滚成功。

## 4. 模块与接口设计

复杂规则必须收敛到下列三个深模块。调用方不得复制选词、建卡、过滤或错误映射逻辑。

### 4.1 指定题卡准备模块

**位置建议**：`src/dev-tools/dev-learning-item.ts`  
**运行位置**：Background  
**职责**：解析当前词库、筛选学习卡、随机选词、验证题型数据、必要时创建短期学习卡，并返回准确的 `LearningItem`。

接口：

```ts
export type DevCardType =
  | 'new-word'
  | 'en-to-zh'
  | 'zh-to-en'
  | 'context-choice'
  | 'spelling';

export type PrepareDevCardResult =
  | { ok: true; item: LearningItem }
  | {
      ok: false;
      reason:
        | 'no-unlearned-word'
        | 'no-learning-content'
        | 'no-context-example'
        | 'insufficient-question-data';
    };

export interface DevLearningItemModule {
  prepare(cardType: DevCardType): Promise<PrepareDevCardResult>;
}
```

接口不暴露词库 ID、学习卡 ID、随机选择次数或是否自动建卡；这些是模块实现细节。调用方只说明需要的题型，并处理一个可判别结果。

实现约束：

1. 从 `AppSettings.selectedDeckId` 读取当前词库；无效 ID 使用与正式学习相同的默认词库规则。
2. 读取当前词库 `wordIds`、全部学习卡和所需单词数据。
3. 新词请求直接使用正式候选新词选择规则，但跳过每日上限检查。
4. 其他题型先随机遍历当前词库已有学习卡，尝试精确生成题目。
5. 无可用学习卡时，选择满足题型前置条件的未学单词；验证题目数据完整后创建短期学习卡。
6. 并发创建同一单词时沿用 `CardRepository` 的 `byWordId` 唯一约束；若另一调用先成功，读取已有学习卡并继续生成，不得重复建卡。
7. 题目提交不经过本模块，继续走现有 `LearningService` 提交接口。

### 4.2 开发数据读取模块

**位置建议**：`src/dev-tools/dev-data.ts`  
**运行位置**：Background  
**职责**：提供当前词库摘要和详细只读快照。

```ts
export interface DevDeckSummary {
  deck: { id: string; name: string };
  wordCount: number;
  learningCardCount: number;
  stageCounts: Record<CardStage, number>;
}

export interface DevDataSnapshot {
  cards: CardRecord[];
  reviewLogs: ReviewLogRecord[];
  sessionLogs: SessionLogRecord[];
}

export interface DevDataModule {
  getCurrentDeckSummary(): Promise<DevDeckSummary>;
  getSnapshot(): Promise<DevDataSnapshot>;
}
```

约束：

- `wordCount` 是当前词库 `wordIds` 的数量。
- `learningCardCount` 和 `stageCounts` 只统计 `wordId` 属于当前词库的学习卡。
- `stageCounts` 必须包含 `new`、`short-term`、`long-term`、`self-reported-known` 四个键，零值不能省略；界面使用 `CONTEXT.md` 中的中文术语。
- `getSnapshot()` 返回全部学习卡、复习日志和学习会话，不按当前词库过滤。
- FSRS 视图从 `cards[].schedulerState` 派生，不增加重复的权威数据或单独消息。
- 不读取或返回 `BehaviorEventRecord`。
- IndexedDB 或词库读取失败时抛出明确错误；调用方显示错误状态，不能转换成零值或空数组。

### 4.3 开发交互编排模块

**位置**：`ContentController` 内的开发交互路径，或由其持有的内部模块  
**运行位置**：Content Script  
**职责**：原子检查交互占用、向 Background 请求题卡、打开全页遮罩，并按开发副作用策略结束交互。

```ts
export type ShowDevCardResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'interaction-active'
        | 'no-unlearned-word'
        | 'no-learning-content'
        | 'no-context-example'
        | 'insufficient-question-data'
        | 'failed';
    };

showDevCard(cardType: DevCardType): Promise<ShowDevCardResult>;
```

约束：

- 对 `active` 与 `triggerInProgress` 的检查和占用必须在同一同步步骤完成，避免检查后等待 Background 时被自然触发抢占。
- 占用失败不得请求或创建学习数据。
- Background 返回空状态或失败后必须释放占用，且不得打开遮罩。
- 开发交互与正式交互共用一个遮罩动作入口，不能注册会覆盖正式处理器的第二个 `OverlayPort.onAction`。
- `ActiveInteraction` 应记录一个私有副作用策略（例如 `effects: 'standard' | 'dev'`），由统一的结束路径决定是否写冷却、首次触发和学习会话；不得复制整套动作处理器。
- 生产代码中可以保留不具备外部入口的通用状态编排，但不得保留可调用的开发消息处理、开发页面或开发 UI。

## 5. 消息契约

开发消息与正式 `ExtensionMessage` / `ContentMessage` 分文件定义，建议放在 `src/dev-tools/messages.ts`。生产代码不得把这些消息加入正式运行时路由。

### 5.1 Popup → Content Script

```ts
export type DevContentMessage =
  | { type: 'DEV_PING' }
  | { type: 'DEV_SHOW_CARD'; cardType: DevCardType };

export type DevPingResponse = { ok: true };
export type DevShowCardResponse = ShowDevCardResult;
```

- Popup 加载后向当前标签页发送 `DEV_PING`。
- 没有接收者、1 秒内未响应或非 `{ ok: true }` 响应都视为内容脚本不可用。
- 点击题卡按钮只发送 `DEV_SHOW_CARD`；Popup 不先向 Background 取 `LearningItem`，避免选词和交互占用之间产生竞态。

### 5.2 Content Script / Popup / 数据页 → Background

```ts
export type DevExtensionMessage =
  | { type: 'DEV_PREPARE_CARD'; cardType: DevCardType }
  | { type: 'DEV_GET_DECK_SUMMARY' }
  | { type: 'DEV_GET_DATA_SNAPSHOT' };
```

响应分别为 `PrepareDevCardResult`、`DevDeckSummary` 和 `DevDataSnapshot`。

- Background 继续使用现有 `__bingeupError` 传输不可恢复错误。
- 空内容属于可判别业务结果，不使用异常。
- `CLEAR_LEARNING_PROGRESS` 是设置页也在使用的正式消息，开发工具直接复用；它不会被生产排除。

## 6. UI 规格

### 6.1 插件面板

“开发工具”位于插件面板最底部，视觉上在反馈入口之前；默认展开。插件面板不设置固定高度或最大高度，`html`、`body`、`#app` 和面板容器均按内容自适应；紧凑布局使正常状态无需滚动。现有受保护页面和缺权限页面会提前返回，因此实现时必须抽出共享面板外壳，保证这些分支也渲染开发工具，不能只在普通分支的 `FeedbackLink` 前插入组件。

面板内容分两组，仍可通过标题收起：

```text
开发工具
├─ 弹题卡
│  ├─ 新词
│  ├─ 英选中
│  ├─ 中选英
│  ├─ 语境
│  └─ 拼写
└─ 数据
   ├─ 当前词库名称
   ├─ 单词数 / 学习卡数 / 阶段分布
   ├─ 查看详细数据
   └─ 清除学习进度
```

交互要求：

- 五个题卡按钮紧凑排列、使用小号字体，并有可访问名称。
- 内容脚本不可用时五个按钮整体禁用，旁边显示原因；数据按钮不受影响。
- 单次弹题请求期间禁用五个按钮，防止重复发送。
- 成功打开题卡后关闭 Popup；失败则保持 Popup 并显示对应中文提示。
- 失败原因使用固定映射，不能把业务空状态统称为“系统错误”：

| 原因 | 中文提示 |
| --- | --- |
| `interaction-active` | 当前已有学习界面 |
| `no-unlearned-word` | 当前词库没有未学单词 |
| `no-learning-content` | 当前词库没有可用单词 |
| `no-context-example` | 当前词库没有可用例句 |
| `insufficient-question-data` | 当前词库缺少生成该题型所需的数据 |
| `failed` | 无法打开测试题卡，请重试 |

- 摘要加载中显示“加载中…”，空值显示数字 `0`，错误显示错误原因和“重试”。
- “查看详细数据”打开 `chrome.runtime.getURL('/dev-tools.html')`。
- “清除学习进度”必须说明这是全局操作，会清除所有词库共享的学习卡、复习日志、学习会话和指标源事件，而不是只清当前词库；用户确认后才发送消息。
- 清除成功后重新加载摘要并显示成功提示；失败时保留现有数据显示错误。

### 6.2 详细数据页

最小完整页面包含：

- 刷新按钮和最近刷新时间；
- 学习卡 JSON 区；
- 复习日志 JSON 区；
- 学习会话 JSON 区；
- FSRS 状态表，只列出拥有 `schedulerState` 的学习卡，展示 `stability`、`difficulty`、`reps`、`lapses`、`state`、`scheduledDays`、`learningSteps` 和 `lastReviewAt`。

每个区显示记录数。无记录时显示明确空状态；读取失败时整页显示错误和重试按钮，不保留会被误认为最新的旧快照。本任务不增加编辑、删除、过滤、导出或复制功能。

## 7. 生产构建排除

仅用 `import.meta.env.DEV` 隐藏 JSX 不足以满足要求。实现必须同时做到：

1. 在 `wxt.config.ts` 的 `entrypoints:found` hook 中，当 `wxt.config.command === 'build'` 时移除名为 `dev-tools` 的入口；开发服务器保留该入口。
2. Popup 中通过 `import.meta.env.DEV` 包裹开发 UI 的动态导入，使生产构建不生成开发 UI chunk。
3. Background 与 Content Script 只在 `import.meta.env.DEV` 分支中动态导入开发消息处理模块；正式路由不包含开发消息 case。
4. 开发消息、客户端和处理器全部位于 `src/dev-tools/`，不得被生产入口的非开发分支静态导入。
5. 新增 `scripts/verify-dev-tools-production.mjs`，并接入 `build` 与 `build:edge`，验证：
   - 产物不存在 `dev-tools.html`；
   - 产物不存在名称含 `dev-tools` 的 JS/CSS chunk；
   - Background、Content Script 和 Popup 产物中不存在 `DEV_SHOW_CARD`、`DEV_PREPARE_CARD`、`DEV_GET_DECK_SUMMARY`、`DEV_GET_DATA_SNAPSHOT` 或“开发工具”界面文本。

`CLEAR_LEARNING_PROGRESS` 属于正式设置功能，生产产物保留它是预期行为。

## 8. 文件级变更范围

| 文件 | 变更 | 职责 |
| --- | --- | --- |
| `wxt.config.ts` | 修改 | 生产构建排除 `dev-tools` 入口 |
| `package.json` | 修改 | 将生产排除验证接入 Chrome / Edge 构建 |
| `scripts/verify-dev-tools-production.mjs` | 新建 | 检查生产产物无开发入口和运行时消息 |
| `src/dev-tools/messages.ts` | 新建 | 开发消息与可判别响应类型 |
| `src/dev-tools/dev-learning-item.ts` | 新建 | 指定题型选词、验证、建卡和生成 |
| `src/dev-tools/dev-data.ts` | 新建 | 当前词库摘要与详细快照 |
| `src/dev-tools/background-handler.ts` | 新建 | Background 开发消息适配器 |
| `src/dev-tools/content-handler.ts` | 新建 | Content 开发消息适配器 |
| `src/dev-tools/message-client.ts` | 新建 | Popup / 数据页开发消息客户端 |
| `src/entrypoints/background.ts` | 修改 | DEV 分支动态分发开发消息 |
| `src/content/bootstrap.ts` | 修改 | DEV 分支动态注册 ping / 弹题监听 |
| `src/content/content-controller.ts` | 修改 | 统一交互占用与开发副作用策略 |
| `src/learning/learning-service.ts` | 修改 | 仅提取正式与开发流程确实共用的候选选择或建卡逻辑；不添加开发消息知识 |
| `src/ui/popup/PopupApp.tsx` | 修改 | 共享面板外壳和 DEV 动态入口 |
| `src/ui/popup/DevTools.tsx` | 新建 | 折叠区、状态探测、题卡与数据操作 |
| `src/ui/popup/dev-tools.css` | 新建 | 由 DEV 动态模块导入的插件面板开发工具样式，生产构建不生成对应 CSS |
| `src/entrypoints/dev-tools/index.html` | 新建 | 开发数据页入口 |
| `src/entrypoints/dev-tools/main.tsx` | 新建 | 数据页挂载 |
| `src/entrypoints/dev-tools/dev-tools.css` | 新建 | 数据页样式 |
| `src/ui/dev-tools/DevToolsApp.tsx` | 新建 | 详细数据与 FSRS 视图 |

测试文件按现有目录补充，不创建第二套测试框架：

- `tests/unit/dev-tools/dev-learning-item.test.ts`
- `tests/unit/dev-tools/dev-data.test.ts`
- `tests/integration/content-controller.test.ts`
- `tests/unit/content/bootstrap.test.ts`
- `tests/unit/background/message-router.test.ts` 或独立 `background-handler.test.ts`
- `tests/unit/popup/PopupApp.test.tsx`
- `tests/unit/dev-tools/DevToolsApp.test.tsx`

## 9. 验收矩阵

自动化证据必须覆盖“输入 → 处理 → 状态变化 → 输出 → 上下游影响”。表中“状态变化”为持久化和运行状态的变化；“影响”明确列出不得发生的副作用。

### 9.1 指定题卡与学习状态

| ID | 输入 | 处理 | 状态变化 | 输出 | 上下游影响 / 证据 |
| --- | --- | --- | --- | --- | --- |
| C1 | 当前词库有未学单词，点“新词” | 使用正式候选规则选词 | 展示时不建卡 | `new-word-presentation` | 不检查额度；单元测试断言卡数不变 |
| C2 | 当前词库有多张学习卡，点任一选择题按钮 | 按 `wordIds` 过滤并随机选择，精确生成题型 | 打开前不改学习数据 | 返回按钮标注的 `QuestionType` | 不按 `card.deckId` 过滤；固定随机源测试 |
| C3 | 当前词库有学习卡，点“拼写”且设置关闭拼写 | 精确生成拼写题 | 打开前不改数据 | `spelling-question` | 不读取 `spellingEnabled` 作为门禁 |
| C4 | 没有学习卡但有合格未学单词 | 预检题目数据，创建短期学习卡 | 新增一张 `accepted-new` 学习卡 | 打开指定题型 | 即使今日额度已满仍成功；今日新词统计增加 |
| C5 | 今日新词已达上限，连续使用开发按钮自动建卡 | 每次都绕过额度检查 | 今日新词数超过上限 | 每次均打开指定题型 | 随后的正式 `getNextItem()` 不再返回候选新词 |
| C6 | “语境”无现成卡但有带有效例句的未学单词 | 预检例句与干扰项后建卡 | 新增短期学习卡 | `context-choice` 且题干含空位 | 不回退题型 |
| C7 | 当前词库没有可用例句 | 遍历已有卡与未学单词后结束 | 无建卡、无日志 | `no-context-example` | Popup 显示“当前词库没有可用例句” |
| C8 | 选择题缺少三个有效干扰项 | 依次尝试全部候选 | 无半成品学习卡 | `insufficient-question-data` | 不跨词库选目标词，不显示错误题卡 |
| C9 | 当前词库没有未学单词和学习卡 | 完成当前词库搜索 | 无状态变化 | `no-learning-content` | 不跨词库寻找 |
| C10 | 两次并发为同一未学单词建卡 | 由 `byWordId` 唯一约束串行收敛 | 最终只有一张学习卡 | 两次均使用实际卡 ID 或一方返回可理解结果 | 无重复学习卡 |
| C11 | 对开发选择题或拼写题提交答案 | 走现有提交与 FSRS 调度 | 更新学习卡并新增一条复习日志 | 显示真实答题反馈 | 不写学习会话、冷却或首次触发状态 |
| C12 | 新词点“知道了” | 走现有接受新词规则 | 新增短期学习卡 | 关闭开发交互 | 计入今日新词，不写学习会话 |
| C13 | 新词点“我认识，换一个” | 走现有自报认识规则 | 新增自报认识学习卡 | 关闭开发交互 | 不加载下一张普通题卡 |
| C14 | 开发题卡直接跳过 | 关闭遮罩 | 学习卡与复习日志不变 | Popup 已关闭，页面恢复无遮罩 | 不写冷却或学习会话 |

### 9.2 交互占用与页面状态

| ID | 输入 | 处理 | 状态变化 | 输出 | 上下游影响 / 证据 |
| --- | --- | --- | --- | --- | --- |
| I1 | 已有正式学习交互，点击开发题卡 | 原子检查占用并拒绝 | 原交互完全不变 | `interaction-active` | 不请求 Background、不关闭遮罩、不恢复视频 |
| I2 | 正式触发正在异步准备，点击开发题卡 | 原子检查 `triggerInProgress` | 原触发继续 | `interaction-active` | 不创建学习卡 |
| I3 | 开发题卡准备中到达自然触发 | 自然触发进入现有待处理队列 | 开发交互继续 | 开发题卡正常显示 | 结束后正式流程重新检查站点与冷却 |
| I4 | 全局暂停、网站关闭或冷却未结束，但内容脚本存在 | 只检查交互占用 | 设置和冷却不变 | 开发题卡正常显示 | 不解除暂停、不改网站设置 |
| I5 | 页面有正在播放的视频 | 打开全页开发遮罩 | 播放状态不变 | 遮罩挂在 `document.documentElement` | 不调用 pause / restore |
| I6 | Content Script 不存在 | `DEV_PING` 无接收者 | 无状态变化 | 五个题卡按钮禁用并说明原因 | 摘要、数据页、清除仍可用 |
| I7 | 受保护页或缺权限页打开 Popup | 渲染共享面板外壳 | 无状态变化 | 开发工具可见、弹题禁用 | 不影响正式状态提示 |
| I8 | Background 取题或遮罩打开失败 | 清理开发占用并关闭可能存在的遮罩 | 已完成的底层原子写入如实保留 | `failed` / 可重试提示 | 下一次正式或开发交互仍可启动 |

### 9.3 数据与清除

| ID | 输入 | 处理 | 状态变化 | 输出 | 上下游影响 / 证据 |
| --- | --- | --- | --- | --- | --- |
| D1 | 当前词库与学习卡跨词库共享 | 用当前 `deck.wordIds` 过滤学习卡 | 无 | 正确单词数、学习卡数和四阶段分布 | 不依赖学习卡创建时的 `deckId` |
| D2 | 打开详细数据页 | 一次读取三类权威记录 | 无 | 全部 cards / reviewLogs / sessionLogs | 不读取 BehaviorEventRecord |
| D3 | 学习卡含 `schedulerState` | 从学习卡派生 FSRS 行 | 无 | 展示全部 SchedulerState 字段 | 不保存重复 FSRS 副本 |
| D4 | 三类记录均为空 | 返回真实空数组 | 无 | 每区显示 0 和空状态 | 不显示加载失败 |
| D5 | IndexedDB 或词库读取失败 | 错误向上传递 | 无 | 显示错误原因和重试 | 不把失败转换成 0 或空数组 |
| D6 | 用户取消清除确认 | 不发送消息 | 无 | 保持原数据显示 | 所有存储不变 |
| D7 | 用户确认清除 | 复用 `CLEAR_LEARNING_PROGRESS` | 清空学习卡、复习日志、学习会话和指标源事件，并重建网站状态基线 | 摘要刷新为 0、显示成功 | 单词、词库、长期设置和网站设置保留 |
| D8 | 清除失败 | 保留当前 UI 快照并显示失败 | 数据库事务不应部分提交 | 错误提示 | 不显示“清除成功” |

### 9.4 生产排除与回归

| ID | 输入 | 处理 | 状态变化 | 输出 | 上下游影响 / 证据 |
| --- | --- | --- | --- | --- | --- |
| P1 | `npm run build` | 构建 Chrome 正式产物并执行排除脚本 | 生成 `.output/chrome-mv3` | 构建成功 | 无 `dev-tools.html`、开发 chunk、消息字符串或界面文本 |
| P2 | `npm run build:edge` | 构建 Edge 正式产物并执行排除脚本 | 生成 `.output/edge-mv3` | 构建成功 | 排除条件与 Chrome 相同 |
| P3 | WXT 开发服务器 | 保留开发入口和 DEV 动态模块 | 生成开发产物 | Popup 显示开发工具，`dev-tools.html` 可打开 | 五个题型人工冒烟通过 |
| P4 | 生产 Popup 各状态 | 运行现有 Popup 测试与 E2E | 无 | 不显示开发工具 | 正式状态、开始学习和设置入口无回归 |
| P5 | 正式自然/主动学习 | 运行 ContentController 集成测试 | 正常写冷却、首次触发和学习会话 | 行为与改动前一致 | 开发副作用策略不污染正式路径 |

## 10. 实现完成门槛

实现任务只有同时满足以下条件才可交付：

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run build:edge
```

另外必须在 WXT 开发服务器加载 Chrome 开发扩展，人工验证：

1. 正常页面五个按钮分别打开准确题型；
2. 受保护页面仍显示开发工具，但弹题按钮禁用；
3. 详细数据页能看到刚完成题目的学习卡、复习日志和 FSRS 状态；
4. 清除确认取消不改数据，确认后摘要和详细数据归零；
5. 已有学习界面时开发按钮返回可理解提示且原界面不变。

## 11. 已验证事实与未验证前提

已通过当前仓库验证：

- WXT `0.20.27` 会自动发现 `src/entrypoints/dev-tools/index.html` 为独立入口；本地依赖实现提供 `entrypoints:found` hook，且 `wxt.config.command` 在开发服务器为 `serve`、正式构建为 `build`。
- 当前 `LearningService.getNextItem()` 不能保证指定题型；题型由学习阶段和设置自动决定，因此不能直接用于五个开发按钮。
- 当前 `ContentController` 使用单一 `active` 和 `triggerInProgress` 编排交互，直接覆盖 `active` 会丢失原交互状态。
- 当前 Popup 的受保护页与缺权限页会提前返回，不能通过在普通分支末尾插入组件实现“始终显示”。
- 当前 `clearLearningProgress()` 实际清除学习卡、复习日志、学习会话和指标源事件，并保留词库与单词。
- FSRS 权威状态已存放在 `CardRecord.schedulerState`，无需建立独立存储。
- 已通过 `npm test`（809 tests）、`npm run typecheck`、`npm run lint`、Chrome/Edge 正式构建及开发工具生产排除脚本。
- 已启动 WXT 开发服务器并确认开发产物包含 `dev-tools.html` 与开发消息处理产物。

未验证前提：

- 本文规定的生产动态导入已由 Chrome/Edge 正式构建和产物检查验证未生成开发入口、chunk、消息标识或界面文案。
- 尚未在真实浏览器页面完成五种题型、受保护页、清除后详情页等人工冒烟；自动化测试覆盖消息边界、Popup 状态、题卡准备和交互编排。
- 真实内置词库是否为每种题型提供足够数据不是规格前提；数据不足必须按可判别空状态处理。
