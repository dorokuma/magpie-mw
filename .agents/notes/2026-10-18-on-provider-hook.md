# onProvider 钩子：按真实供应商与底层模型做首次请求剥离/清洗（2026-10-18）

本文件记录 `feat/on-provider-hook` 引入的双阶段钩子机制，以及该改动通过 B 档门禁（`verifier` + `reviewer` + `gate_scan`）后、reviewer 提出的两条 `consider` 级观察项。观察项当前无行为影响，本轮只落盘、不改生产代码。

本记录不含任何 key、token、Authorization 之类凭据。

## 关联文件与基线校验

本轮落盘前对已通过验证的三文件做了 `sha256sum`，确认与门禁基线一致，且本笔记之外未再改动它们：

- `/root/workspace/magpie-mw/AGENTS.md`
  - `sha256`: `2ba06eee9a52960ea4f4f13c225201c062bf2e41c8f35fdf6ac5ee5706f77f45`
- `/root/workspace/magpie-mw/thinking-control.middleware.js`
  - `sha256`: `903c5edb48854b7d567b6ba4dc457c81c9dbeeffd2b250d14096cee44fdb7e23`
- `/root/workspace/magpie-mw/thinking-control.test.mjs`
  - `sha256`: `624c5efbd73ca3d5764bea96a0aefaad24ea15fb7ea0bbb657b299098c070047`

## 背景与机制

客户端经分组路由时，`onRequest` 看到的 `body.model` / `ctx.model` 仍是分组名（如 `group/...`）。规则表不得硬编码任何具体组名：分组名在 `onRequest` 阶段不锁死、原样放行。直连 `provider/model` 仍在 `onRequest` 按模型串完成剥离、清洗与思考翻译。

通过逆向本机 Magpie 二进制 `/root/.local/bin/magpie` 查明：路由选定具体渠道后，`(*Run).Tried`（地址 `0x1145ba0`）会挂载

```text
ctx.provider = { id, name, account, model }
```

并调用 `onProvider(body, ctx)`。此时 `body.model` 仍可能是分组名；真实供应商取 `ctx.provider.id`（回退 `name`），底层模型取 `ctx.provider.model`，目标模型串拼为 `id + "/" + model`，再走与 `onRequest` 同一套 `applyProfiles`。因此无需硬编码任何 `group/*` 组名，第 1 次请求即可按真实供应商与底层模型精准剥离/清洗。

effort 优先读 `body.reasoning_effort`。若请求带该字段且 `ctx.state` 为对象，`onRequest` 先写入 `ctx.state.savedEffort` 并置 `ctx.state.hasSavedEffort`，避免后续剥离丢掉原始意图；字段已被剥离时 `onProvider` 回退 `ctx.state.savedEffort`。只在实际改了 `body` 时返回 `body`，否则返回 `undefined`。直连模型若已在 `onRequest` 处理完，`onProvider` 必须幂等并返回 `undefined`。两钩子整体包在 `try/catch` 中，异常时记录错误日志并原样放行，严禁返回 `null`。

## Consider 级观察项

### 观察项 1：`onRequest` 写入 `savedEffort` 后立即读回的两个 `if` 可合并

- **代码定位**：`/root/workspace/magpie-mw/thinking-control.middleware.js:246`（写入与紧随其后的读回两个 `if`）
- **当前行为**：第一个 `if` 在 `ctx.state` 为对象、请求带 `reasoning_effort` 且尚未 `hasSavedEffort` 时写入 `ctx.state.savedEffort` 并置 `ctx.state.hasSavedEffort = true`。第二个 `if` 立刻检查同一 `ctx.state.hasSavedEffort`，再把值拷回局部变量 `hasSavedEffort` / `savedEffort`。
- **取舍原因**：两个条件在当前控制流下等价于「刚写入或此前已写入则读回」。合并成一次判断不会改变返回值、剥离结果或思考翻译。当前无行为影响，本轮不改已通过验证的中间件。
- **后续触发条件**：下次顺手改 `onRequest` 的 effort 保存路径时，可将写入与读回收成一段，避免重复的 `ctx.state` 对象判断。合并前后须保持：无 `ctx.state`、`state` 非对象、未带 `reasoning_effort`、以及已有 `hasSavedEffort` 时的局部变量与 `ctx.state` 内容不变。

### 观察项 2：`profileMatches` 只取模型串第一个 `/` 之前作为 provider 段

- **代码定位**：`/root/workspace/magpie-mw/thinking-control.middleware.js:163`（`profileMatches` 内 `model.indexOf("/")` 与 `model.slice(0, slash)`）
- **当前行为**：配置了 `providers` 时，除传入的 `providerId` 外，还从模型串取第一个 `/` 之前的一段作为 `modelProvider`，再对 `providers` 子串做包含匹配。
- **取舍原因**：当前两条真实路径都只有一层 `/`：直连客户端模型串是 `provider/model`；`onProvider` 拼接的目标串是 `id + "/" + model`。这两种形态下第一段就是供应商，匹配正确。多层 `/` 嵌套（例如供应商 id 或模型名自身再含 `/`，使第一段不再是完整 provider）只是理论边界，现网输入未出现。当前无行为影响，本轮不改匹配函数。
- **后续触发条件**：若真实 `ctx.provider.id` 或直连模型串出现多层 `/`，且 `providers` 子串因此对不中第一段或误中第一段，再改为使用显式 `providerId` 优先、或按约定的完整 provider 段匹配，而不是只切第一段。
