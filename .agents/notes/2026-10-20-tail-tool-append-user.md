# AgentRouter `content[].thinking` 上游 400 与末尾 `role:"tool"` 追加 `user` 修复记录（2026-10-20）

记录针对上游报错 `AgentRouter-GitHub: The content[].thinking in the thinking mode must be passed back to the API`（`type: invalid_request_error`，request_id `9d1e4a1a-611b-4c34-9d5f-c12d7de607b9`，trace_id `d933e5069a33b469a1bbd0c17bdfbcff`）的根因定位与本次修复。

## 根因

两件事叠加，**不是**「剥离中间件没跑」：

1. **provider 走了 Anthropic 协议转换**：`/root/.config/magpie/providers.json` 中 `agentrouter`（AgentRouter-GitHub）与 `agentrouter-linuxdo` 的 `"baseAPI"` 被改成 `"anthropic"`，Magpie 把客户端 OpenAI Chat 请求转成 Anthropic `/v1/messages` 再发上游。`AgentRouter` 在 Anthropic 形态下开启 thinking 时，会校验每一轮 assistant 是否回传了 `thinking` 块。
2. **触发条件是消息列表末尾为 `role: "tool"`**：2026-10-11 探针实验（`audit.jsonl.1:33495`，原 `/root/magpie-mw/exp/RESULTS.md`）结论为「末条=tool 报错率 30–60%；末条=user/assistant 报错率 0 / ~120 次」，且与历史是否携带 `reasoning_details` / `reasoning_content` / `reasoning_effort` 无关。现场铁证：`/root/.config/magpie/routing/2026-10-19.jsonl` 22:32:15 末条为 `tool` → 400；22:33:15 用户补一句「继续」使末条变 `user` → 同一会话同模型立即 200。
3. **中间件当时确实验证过自身已生效**：journald 22:32:15 打出 `THINKMW strip model=agentrouter/deepseek-v4-flash fields=prompt_cache_key,reasoning_effort` 与 `THINKMW sanitize ... actions=developer->system,assistant_content_empty,tools_required`，说明报错与 `reasoning_effort` 是否剥离无关。

## 历史回归说明

2026-10-11 曾实现过规避机制：末条为 `tool` 时在末尾追加一条非空 `user` 消息 `(tool results above)`，实测 12/12 成功。但在 2026-10-17 的 `thinking-control.middleware.js` 重构（`fcccf51` 之后的重构提交）中，只保留了 `developer->system`、`reasoning_details->reasoning_content`、`assistant_content_empty`、`tools_required` 四项清洗规则，遗漏了这条追加逻辑，导致漏洞在生产裸奔。

## 修复内容（双管齐下）

1. **中间件防御网归位**：`SANITIZE_PROFILES` 的 `deepseek-v4-flash` / `deepseek-v4.1-flash` / `deepseek-flash` 项新增 `tailToolResultAppendUser: true`；`applyProfiles` 中当 `sp.tailToolResultAppendUser !== false` 且末条消息 `role === "tool"` 时，追加 `{ role: "user", content: "(tool results above)" }`，置 `sanitized = true` 并记录日志 action `tail_tool_append_user`。追加后末条变为 `user`，双阶段钩子再次经过天然幂等（返回 `undefined`），不重复追加。
2. **消除协议转换摩擦**：`/root/.config/magpie/providers.json` 中 `agentrouter` 与 `agentrouter-linuxdo` 的 `"baseAPI"` 由 `"anthropic"` 改回 `"chat"`（其余字段、URL、models、凭据不变），Magpie 不再做 OpenAI→Anthropic 转换。

## 影响面

- 仅命中 `SANITIZE_PROFILES` 中登记的 deepseek 系列模型串；未登记模型（如 `gpt-4o`）即使末条为 `role:"tool"` 也原样放行，不改变行为。
- 追加的 `user` 消息内容为固定短串，仅改变消息列表尾部结构，不影响已注册的 `STRIP_PARAM_PROFILES` / 思考控制逻辑，也不改 `tools` schema。

## 回滚方式

- 中间件侧：删除 `SANITIZE_PROFILES` 对应项中的 `tailToolResultAppendUser: true`（或从 `applyProfiles` 移除该判断块），行为即回到本次改动前；备份见同目录 `.bak-20261019-230445-tail-tool`。
- 网关配置侧：把 `/root/.config/magpie/providers.json` 中两个 provider 的 `"baseAPI"` 改回 `"anthropic"`（备份见同目录 `providers.json.bak-20261019-230820-baseapi-chat`）。两侧任一回滚均可独立生效，互不依赖。
- 任一侧改动后都需 `systemctl restart magpie` 才对网关生效（插件宿主不热重载）。

## 后续观察项

- 末尾为 `tool` 的规避属形态层面的兼容处理；若上游后续放宽 Anthropic 形态下的 thinking 回传校验，可重新评估是否保留追加逻辑。当前按上游现状保留。
- 边界分支（空 `messages` 数组、末条为 `null`/非对象）实现侧已有守卫，暂无专项测试；后续触碰该区域时补。

## 关联

- 问题排查（只读报告）：`/root/.config/magpie/routing/2026-10-19.jsonl` 第 1033–1035 行、journald `THINKMW` 日志。
- 历史实验：`audit.jsonl.1:33495`，采集报告见 `capture/FINDINGS.md`。
