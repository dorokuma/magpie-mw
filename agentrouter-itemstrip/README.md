# @local/middleware-agentrouter-itemstrip

Strip inline OpenAI **Responses API** item IDs and `reasoning` items for stateless AgentRouter upstream requests.

为 AgentRouter 无状态回放请求剥掉 OpenAI **Responses API** 内联历史项的 `id` 与 `reasoning` 整条，让重放历史不再被上游 400 拒掉。

## 背景 · Background

向 `agentrouter` / `agentrouter-linuxdo` 的 `gpt-6.1-sol` 重放上一次响应里的 inline 历史项（`function_call` / `custom_tool_call` / `function_call_output` / `custom_tool_call_output` / `message`）时，只要这些项仍带着上游签发的 `item.id`（`fc_*`、`msg_*`），上游有较高概率回 `400`（如 "The requested item was created under a different account …"）；只删 `id`、保留 `call_id`/`arguments`/`output`/内容时同样负载稳定 `200`。

## 生效条件 · When it applies

仅当**同时**满足以下条件才动手：

- 只挂 `onProvider`：路由选定真实渠道之后才处理，绝不在 `onRequest` 阶段猜渠道；
- `ctx.provider.id` 精确命中 `providers` 列表（默认 `["agentrouter", "agentrouter-linuxdo"]`）——精确相等（大小写/空白归一化后），**不做子串匹配**，`my-agentrouter-test` 这类伪造 id 不会命中；
- `ctx.provider.model` 精确命中 `models` 列表（默认 `["gpt-6.1-sol"]`）；
- `body.input` 为数组（`/v1/responses` 形态）；chat 的 `messages` 原样不动。

## 两类处理 · Two actions

| 动作 | 对象 | 行为 |
| --- | --- | --- |
| 剥 ID | `function_call` / `custom_tool_call` / `function_call_output` / `custom_tool_call_output` / `message` 项 | 仅删除 `id` 字段；`call_id`、`name`、`arguments`、`output`、`content`、`status`、`phase` 全部保留 |
| 整条丢弃 | `reasoning` 项（`dropTypes` 可覆盖） | 整条移除：不留空壳、不动 `encrypted_content` 密文 |

其它未知类型（如 `compaction`）一律原样保留。所有查表用无原型对象 + `hasOwnProperty` 显式判定，避免上游可控的 `item.type` 命中原型键（`constructor`/`toString`/`__proto__` 等）被误判。

## 历史指针整体放行 · History pointers pass through

请求带以下任一服务端历史指针时**整体原样放行**（只记一条边界日志）：

- `previous_response_id` 非空；
- `conversation` 指针；
- 任一 `item.type === "item_reference"` 项。

这些指针指向服务端已存资源，悄悄删指针等于"丢历史换 200"，因此本插件绝不触碰。

## 代价说明 · Reasoning trade-off

`reasoning` 项整条丢弃是为"无状态回放"取稳：上游对带 id 的 reasoning 项同样会 400。代价是模型看不到上一轮的思考轨迹，可能轻微影响连续性并让模型重做一部分推理（多花 reasoning token）。实测中"删掉 reasoning 的 id、保留 encrypted_content"也能 200，故整条丢是保守选择而非已证实根因。

## Options · 动态参数

在 Magpie Web UI 插件行的 **Options** 中编辑 JSON（`Ctrl+Enter` 保存，热生效）。三项均可覆盖，且匹配语义始终是**精确相等**（元素 `trim().toLowerCase()` 后精确查表），绝不退化成子串命中；空数组或非数组 = 使用默认值：

```json
{
  "providers": ["agentrouter", "agentrouter-linuxdo"],
  "models": ["gpt-6.1-sol"],
  "dropTypes": ["reasoning"]
}
```

- `providers`：覆盖默认 provider 精确查表（默认 `["agentrouter", "agentrouter-linuxdo"]`）。
- `models`：覆盖底层模型精确匹配（默认 `["gpt-6.1-sol"]`）。
- `dropTypes`：覆盖整条丢弃的 `item.type` 列表（默认 `["reasoning"]`）。

## 返回值契约 · Return contract

- 无实际改动返回 `undefined`（幂等：第二次进来没有 id 可删、没有 reasoning 可丢，就什么都不做）。
- 仅在实际修改了 `body` 时才返回 `body`。
- 任何异常 `try/catch` 原样放行（返回 `undefined`，打一条 `ARITEMSTRIP error=…` 日志），绝不阻断网关流量；严禁返回 `null`。
- 日志只含固定前缀 `ARITEMSTRIP` + provider/model + 字段类型计数，绝不打正文/ID/密文/secret。

## 测试 · Test

```bash
node agentrouter-itemstrip/agentrouter-itemstrip.test.mjs
# 或随仓库全量测试
npm test
```
