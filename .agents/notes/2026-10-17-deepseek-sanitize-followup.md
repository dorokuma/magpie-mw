# DeepSeek 兼容清洗（SANITIZE_PROFILES）Code Review 后续观察项记录（2026-10-17）

本文件记录针对 `/root/magpie-mw/thinking-control.middleware.js` 中 DeepSeek 兼容清洗逻辑（`SANITIZE_PROFILES`）Code Review 提出的两条 `consider` 级观察项、当前取舍原因及后续触发条件。

## 关联文件与基线校验

- `/root/magpie-mw/thinking-control.middleware.js`
  - `sha256`: `1631a118ea65e7f7fedd8e1813a31e9ceb32b324dd6701e101b8d951057de614`
- `/root/magpie-mw/thinking-control.test.mjs`
  - `sha256`: `2ad10fd720967e478ef91e62d064c17ce48f90f210d9d2b3e2a2369ec5d1e54a`

## Consider 级观察项与后续触发条件

### 观察项 1：`reasoning_content` 与 `reasoning_details` 同时非空时的处理策略

- **代码定位**：`/root/magpie-mw/thinking-control.middleware.js:181-188`（核心分支 `:183-186`）
- **当前行为**：当 `role === "assistant"` 的消息同时携带非空字符串 `reasoning_content` 与非空数组 `reasoning_details` 时，现有逻辑满足 `typeof msg.reasoning_content === "string" && msg.reasoning_content !== ""`，因此保留既有 `reasoning_content` 不变，并直接删除 `reasoning_details`，不对两者内容进行拼接或合并。
- **取舍原因**：当前主要接入的 `pi` 客户端在回传历史思考内容时仅发送 `reasoning_details` 数组，不会同时发送非空 `reasoning_content` 与 `reasoning_details`，实际线上触发双字段冲突的风险极低；保留既有非空 `reasoning_content` 可避免重复拼接同一段思考文本。
- **后续触发条件**：若未来接入其他客户端，且存在同时发送非空 `reasoning_content` 与 `reasoning_details` 且两者承载不同内容、需要合并保留的真实场景，再评估并设计去重或合并策略。

### 观察项 2：`tools[].function.parameters.required` 补齐 `[]` 的前置条件

- **代码定位**：`/root/magpie-mw/thinking-control.middleware.js:211`
- **当前行为**：对 `body.tools[].function.parameters` 补齐默认 `required: []` 时，当前仅在 `t.function.parameters.type === "object" && !Array.isArray(t.function.parameters.required)` 条件下触发。
- **取舍原因**：`pi` 客户端生成的工具定义 schema 始终显式包含 `type: "object"`，限定 `parameters.type === "object"` 最为稳妥，可避免误改非对象类型的参数定义。
- **后续触发条件**：若未来接入其他客户端或工具源，遇到省略 `type: "object"` 但直接声明了 `properties` 的合法 JSON Schema，并因此触发上游（如倍增网关 AJV）校验报错（`must have required property 'required'`），再将判断条件放宽以兼容此类 schema。
