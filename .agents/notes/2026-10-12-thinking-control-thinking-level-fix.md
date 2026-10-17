# thinking-control 思考开关修复记录（2026-10-12）

本目录不是 git 仓库、无提交历史可查，故把本轮决策与状态落盘留痕。本记录不含任何 key、token、
Authorization 之类凭据，也不贴请求原文里的敏感头。

## 日期与范围

日期：2026-10-12。

本轮改动本目录两个文件：

- `thinking-control.middleware.js`
  - `onRequest` 的 `catch` 分支：由原先的"完全静默放行"改为"仍原样放行（返回 undefined），但
    额外打一条 `THINKMW error model=<model> err=<msg>` 的 `console.error` 日志"，便于线上排查；
    异常时行为不变、不改变放行语义。
  - `DIALECTS.thinkingDisabled.apply` 的关/开语义修正：
    - 关思考：保留 `body.thinking` 既有字段，只把 `type` 置为 `disabled`（不整体替换成只含
      `type` 的对象，避免丢掉 `budget_tokens` 等字段）；若 `type` 本已是 `disabled` 则标记无需
      再改，但 `reasoning_effort` 存在时仍要清掉。返回值为"是否真的改动了 body"。
    - 开思考：只有 `body.thinking` 恰为"仅带 `type:"disabled"` 的空壳"时才整体删除；只要对象里
      除 `type` 外还有其它字段，就一律不动、不丢字段。
- `thinking-control.test.mjs`
  - 在测试文件末尾补了 19 条用例，覆盖本次修复新增/触达的分支：未登记模型放行时 body 深比较
    原样未动、数组 body 放行且内容不变、`reasoning_effort=null` 按未带处理、`closeEffort` 里的
    `off` 档能关思考、`closeWhenAbsent=true` 的临时注册项、`catch` 分支行为与日志、以及
    `thinkingDisabled` 经 `onRequest` 与直接 `apply` 的关/开两条路径与保字段语义。

## 备份文件名（改动前原件）

本轮之前（131727 批次）的两个原件备份：

- `thinking-control.middleware.js.bak-20261012-131727-thinkmwfix2`
- `thinking-control.test.mjs.bak-20261012-131727-thinkmwfix2`

本次补注释（notes 批次）新增的备份：

- `thinking-control.middleware.js.bak-20261012-142404-notes`（补注释前的中间件原件，供 diff 对照）

（本目录中已有的其它 `.bak-` 文件与测试文件本轮一律未动。）

## 两条建议项状态

1. 先 FAIL 后 PASS 的对照证据：已由 verifier 第二轮补齐——旧模块（备份件）跑出 8 条失败，现行模块
   跑出 35 通过、0 失败，两轮差集恰为那 8 条，回退可复现、修复到位。
2. 非对象 `thinking` 的取舍注释：本轮已在 `DIALECTS.thinkingDisabled` 段补上契约说明（关思考时若
   `body.thinking` 不是对象含 `null`/字符串等，视为无既有内容、直接以对象形式覆盖为 disabled；开思考
   时同理不做类型修复、原样返回不改动；若将来确遇后端真的发送字符串型 `thinking` 字段，需人工确认真实
   语义后再决定是否放宽）。文件头"新增方言与模型"步骤也补了同类契约提醒：方言 `apply` 必须保留 body
   中与本方言无关的既有字段、不得整体替换对象，且只在确实改动了 body 时才返回 true。

## 运维事实：线上加载与重启

本轮改动落在 `/root/.config/magpie/plugins.json` 第 13 行登记的 spec 路径上。但运行中的插件宿主不
热重载，需重启 magpie 网关才会加载新代码。本版改动对线上流量行为零变化——仅异常路径多一条日志，
外加一个尚未挂进任何 `PROFILES` 项的方言（`thinkingDisabled`）——故未专门重启，留待下次自然重启生效。
（本会话正在使用的 3425/3426 网关即属此类，本轮不重启。）

