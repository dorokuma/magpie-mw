# magpie-thinking-control

`Thinking Control` — magpie 网关智能思考开关与请求清洗中间件。

不少自部署模型（尤其 vLLM 跑的 Qwen 等）只认真正的"关思考"字段，不认客户端（如 pi）发来的 `reasoning_effort`，导致在客户端里选"关闭"也关不掉。本中间件把思考意图翻译成"该后端真正生效"的关/开字段，并按模型子串执行参数剥离与消息/工具 Schema 兼容性清洗。

## 功能 · Features

- **思考翻译**：`reasoning_effort` → 各后端方言真正生效的开关字段（如 `chat_template_kwargs.enable_thinking`、`thinking.type: "disabled"`）。
- **参数剥离**：按模型剥离后端不支持的顶层参数（`STRIP_PARAM_PROFILES`）。
- **结构清洗**：按模型做消息/工具 Schema 兼容性清洗（`SANITIZE_PROFILES`）。
- **双阶段钩子**：`onRequest`（路由前，按客户端模型串）+ `onProvider`（渠道选定后，按 `ctx.provider` 真实 `id/model`），第 1 次请求即按底层模型精确处理。
- **分组名放行**：`group/...` 分组名不锁死，原样放行，等 `onProvider` 拿到真实 provider 再处理。
- **异常原样放行**：任何异常 `try/catch` 后打 `THINKMW` 错误日志并返回 `undefined`，绝不阻断网关流量，严禁返回 `null`。

## 方言与清洗规则 · Dialects & rules

### DIALECTS（思考开关方言）

| dialect | 关思考字段 | 说明 |
| --- | --- | --- |
| `qwenChatTemplate` | `chat_template_kwargs.enable_thinking = false` | vLLM / HF chat-template 系（Qwen3.5/3.8 等） |
| `thinkingDisabled` | `thinking.type = "disabled"` | 通用 `thinking.type` 系（框架就绪） |

### 匹配规则 · Matching

- 规则项可按 `match` 限定模型子串（命中任一即匹配），可选 `providers` 限定供应商子串；未配 `providers` 时只按 `match`。
- 逃生舱：请求里已显式带有该方言的关/开字段时一律尊重、绝不覆盖。
- `closeWhenAbsent`：请求未带 effort 时是否关思考（缺省 = 开，保持后端默认）。
- 规则表不得硬编码具体分组名。

### 清洗动作 · Sanitize actions

`SANITIZE_PROFILES` 按模型子串命中后执行：`developer` → `system` 角色归一、`assistant.content = null` → `""`、`tool_calls` 缺 `content` 补空串等兼容性修正（具体动作见 `thinking-control.middleware.js`）。

## Options 参数表 · Options

在 Magpie Web UI 插件行的 **Options** 中编辑 JSON（`Ctrl+Enter` 保存，热生效）：

```json
{
  "log": true,
  "extraProfiles": [],
  "extraStripParams": [],
  "extraSanitizeModels": []
}
```

| 参数 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `log` | boolean | `true` | `false` 时静默 `THINKMW` 常规 info 日志（异常日志仍保留） |
| `extraProfiles` | array | `[]` | 追加在 `PROFILES` 之后参与方言匹配的规则项（同型） |
| `extraStripParams` | array | `[]` | 追加在 `STRIP_PARAM_PROFILES` 之后参与字段剥离的规则项（`{ match, fields }`） |
| `extraSanitizeModels` | array | `[]` | 模型子串追加进 `SANITIZE_PROFILES` 首个匹配项的 `match`（无匹配项时新建一项） |

未传 options 时行为与原版 100% 一致；空数组或非数组 = 使用默认。

## 模型匹配规则 · Model matching

- `onRequest` 阶段：匹配目标是客户端传入的 `body.model` / `ctx.model`（直连 `provider/model` 形态）；分组名不命中。
- `onProvider` 阶段：匹配目标为 `ctx.provider.id`（回退 `name`）+ `ctx.provider.model` 拼出的真实 `id/model` 串。
- effort 优先读 `body.reasoning_effort`，已被剥离则回退 `ctx.state.savedEffort`。
- 仅在实际修改了 `body` 时才返回 `body`；未命中或无需修改时返回 `undefined`（直连模型已在 `onRequest` 处理完时 `onProvider` 必须幂等返回 `undefined`）。

## 插件家族 · Plugin family

| 目录 | 插件 | 用途 |
| --- | --- | --- |
| `./` | `Thinking Control` | 思考翻译 + 参数剥离 + 结构清洗中间件 |
| `agentrouter-itemstrip/` | `AgentRouter Item Strip` | AgentRouter 无状态回放的 item ID / reasoning 剥离 |
| `minis/` | `Minis` | OpenMinis 安卓客户端图标与连接说明面板 |

## 测试 · Test

```bash
npm test
# 或单跑
node thinking-control.test.mjs
```
