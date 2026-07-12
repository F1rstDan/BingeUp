# 题目卡遮罩布局回归修复经验

## 背景

这次学习遮罩的主要问题是：题目卡出现在视频区域上半部，而不是视频区域的垂直中心；Bilibili 和 YouTube 都能复现。与此同时，题目卡右侧曾出现额外滚动条，底部按钮因此可能被遮住。

本次记录只总结已经完成的布局、站点目标和交互修复。题目卡的半透明玻璃视觉效果仍未得到用户侧确认；按当前决定，不再继续调整透明度、背景或模糊参数。

## 根因

### 1. 共享遮罩宿主没有真正占满目标区域

`OverlayController.open()` 会把 Shadow DOM 宿主节点追加到 `document.documentElement`，再根据视频区域的 `getBoundingClientRect()` 设置宿主的 `left`、`top`、`width` 和 `height`。

统一视觉样式后，Shadow DOM 共用的 `SHADOW_DESIGN_TOKENS` 保留了 `:host { all: initial; }`。这会重置宿主的默认样式；对于一个没有显式 `display` 的 `div`，它会回到 inline 的布局行为。inline 盒不会按预期参与 `width`、`height` 的区域布局。

同时，`.bingeup-overlay` 从原来明确定位并铺满宿主的结构变成了普通的 grid 子节点。结果是：宿主虽然收到了视频区域尺寸，遮罩根节点却按题目卡内容收缩，背景的水平边界也就落在视频区域上半部。

这解释了为什么问题同时出现在 Bilibili 和 YouTube：两个适配器最终都经过同一个 `OverlayController`，共享同一套 Shadow DOM 布局。

### 2. Bilibili 还有一个独立的目标元素选择问题

Bilibili 的视频元素可能同时位于 `.bpx-player-video-wrap` 和 `.bpx-player-container` 中。直接使用一次 `closest()` 会返回更近的内层包裹元素，导致遮罩只覆盖视频内部区域，而不是完整播放器区域。

这个问题与共享宿主尺寸问题不同，但会产生相似的“遮罩区域不对”现象，因此排查时需要同时确认：

1. 适配器返回的是哪个目标元素。
2. 目标元素的矩形是否是期望的视频区域。
3. 遮罩宿主和 Shadow DOM 内根节点是否都铺满了这个矩形。

## 修复方式

### 遮罩布局

- `.bingeup-overlay` 恢复为 `position: absolute; inset: 0`。
- 保留 `display: grid; place-items: center`，让题目卡相对整个遮罩区域垂直、水平居中。
- 保留 `width: 100%; height: 100%`，并设置 `overflow: visible`，避免遮罩根节点制造额外滚动区域。
- 创建宿主时显式设置 `display: block` 和 `box-sizing: border-box`，抵消 `:host { all: initial; }` 对宿主布局的影响。

### Bilibili 目标区域

`getOverlayTarget()` 按完整可见区域优先级选择：

1. `.bpx-player-container`
2. `#bilibili-player`
3. `.bpx-player-video-wrap`
4. 视频自身的矩形作为回退

这样可以避免把内层视频包裹误认为整个播放器区域。

### 交互与视频状态

此前的交互修复还确立了以下规则：

- 单题底部按钮按固定语义排列：跳过、提交并继续、提交。
- 连续学习底部按钮按固定语义排列：跳过、继续、明白了；按钮文字可随模式变化，但语义必须稳定。
- 答错后的学习信息直接展开，不依赖额外折叠操作。
- 题目出现前、异步切换题目以及打开遮罩时都检查并暂停视频，避免异步边界让视频继续播放。

按钮显示文字属于界面层，实际行为应由稳定的 `OverlayAction` 语义驱动，不能通过按钮位置或文案反推业务动作。

## 验证链路

本次布局问题按以下链路检查：

```text
触发题目
  -> 站点适配器返回 overlayTarget
  -> OverlayController.open() 创建 Shadow DOM 宿主
  -> updatePosition() 写入目标区域矩形
  -> .bingeup-overlay 使用 absolute + inset: 0 铺满宿主
  -> grid place-items: center 将题目卡放到区域中心
  -> 提交/跳过/关闭时移除宿主并恢复视频状态
```

对应的回归保护包括：

- `tests/unit/content/overlay-controller.test.ts`：从公开 DOM 行为检查宿主的 `display`、`box-sizing`，并检查 Shadow DOM 根节点具有绝对定位规则。
- `tests/integration/bilibili-adapter.test.ts`：覆盖嵌套 Bilibili 播放器容器，确认选择外层完整区域。
- 交互和暂停行为由 `OverlayApp`、`content-controller` 的单元/集成测试覆盖。

修复后的验证结果：

- `npm test`：30 个测试文件、636 个测试通过。
- `npm run typecheck`：通过。
- `npm run build`：通过；仍有仓库已有的 `src/public` 缺失提示。
- `npm run lint`：当前仓库没有可用的 ESLint 可执行文件或配置，因此未能执行。

## 半透明玻璃效果的边界

当前源码中的 `.bingeup-card` 仍包含 `rgba(255, 255, 255, .86)`、`-webkit-backdrop-filter: blur(10px)` 和 `backdrop-filter: blur(10px)`。但用户侧截图中没有看到明确的半透明玻璃效果。

这里必须区分两件事：

- **已确认**：布局根因和跨站点居中修复已由代码测试覆盖。
- **未确认**：目标浏览器实际合成后的半透明/背景模糊视觉效果。

本次不继续改动该视觉参数。若将来重新处理，应先在实际 Bilibili 和 YouTube 页面中检查 computed style、遮罩层级、背景合成和截图结果，再决定是视觉参数问题还是浏览器合成条件问题，不能仅凭源码中的 CSS 值判断“玻璃效果已生效”。

## 后续排查清单

- 遇到多个站点同时出现布局回归时，先检查共享的 `OverlayController` 和 Shadow DOM 宿主，再检查站点适配器。
- 使用 `:host { all: initial; }` 时，必须显式定义宿主的 `display`、定位方式和盒模型。
- 给 fixed 宿主写入 `width`、`height` 不等于其 Shadow DOM 子树已经铺满；要同时验证宿主和根节点的布局职责。
- 视觉回归优先与最后一个已知正常版本比较；本次历史基线显示旧版 `.bingeup-overlay` 明确使用了 `position: absolute`、`top/left: 0` 和 `width/height: 100%`。
- 测试应覆盖“目标矩形 -> 宿主内联样式 -> Shadow DOM 根节点填充 -> 题目卡居中”的完整链路，而不是只断言某个 CSS 字符串。

## 相关提交

- `e9ff45b`：统一视觉样式时重构遮罩 CSS，移除了原有的根节点绝对定位。
- `68ec2d1`：统一学习操作语义并修复暂停时序。
- `ce2d084`：修复 Bilibili 播放器外层目标选择。
- `d560ef1`：恢复遮罩宿主和根节点的完整区域布局，并加入布局回归测试。
