---
date: 2026-10-20
title: "glm-5.3 剥离 prompt_cache_retention 修复记录、热加载验证与 Consider 留痕"
status: active
supersedes: null
---

# glm-5.3 剥离 prompt_cache_retention 修复与架构留痕（2026-10-20）

本文件记录 `fix/glm53-strip-cache-retention` 分支针对 `glm-5.3` / `glm-5-3` 模型剥离 `prompt_cache_retention` 顶层字段的根因分析、修复取舍、生产热加载验证证据、Magpie 网关无特征字普通 HTTP 400 不触发 failover 的架构事实，以及 B 档门禁 Code Review 提出的两条 `consider` 级观察项。

本记录不含任何 key、token、Authorization 之类凭据。

## 关联文件与基线校验

对当前工作区已通过审查的文件执行 `sha256sum` 校验，确认本阶段未改动任何代码与测试文件：

- `/root/workspace/magpie-mw/AGENTS.md`
  - 修改前 `HEAD` 版本 `sha256`: `2ba06eee9a52960ea4f4f13c225201c062bf2e41c8f35fdf6ac5ee5706f77f45`
  - 本次提交将包含的修改后版本（笔记落盘后另行同步修正热重载描述）`sha256`: `736f55b27ad592a110b9058cea1eb3643e81b54b9461cdb0623faee4c2b7a157`
- `/root/workspace/magpie-mw/thinking-control.middleware.js`
  - `sha256`: `09382559821e509eb2fb1eb142e7963906cfc17ef24187814e0d38f6616875b1`
- `/root/workspace/magpie-mw/thinking-control.test.mjs`
  - `sha256`: `55bd3bc2a8495c9b34fb0645719464c3009ca88f062ca3fc1bccdd61d8dc3338`

## 1. 现象与根因

- **线上报错现象**：`pi` 客户端调用 `group/glm-5.3` 路由至 `arkapi` 渠道时，请求全部失败并返回 HTTP `400`：
  ```text
  ArkAPI: bad_response_status_code
  ```
- **触发字段与上游校验差异**：ArkAPI 上游对请求体顶层字段 `prompt_cache_retention` 校验拒绝并返回 HTTP 400 `ArkAPI: bad_response_status_code`，但容忍 `prompt_cache_key` 字段。
- **受影响客户端范围**：
  - `pi` 客户端：经 `group/glm-5.3` 发送请求时必然携带 `prompt_cache_retention`（如 `"24h"`）与 `prompt_cache_key`，因此路由到 `arkapi` 时 100% 触发 400 失败。
  - `Minis` 客户端：请求体不发送 `prompt_cache_retention` 字段，故不受影响。

## 2. 修复方案与设计取舍

### 修复改动

在 `/root/workspace/magpie-mw/thinking-control.middleware.js` 的 `STRIP_PARAM_PROFILES` 列表中，紧随 `glm-5.3-flash` 条目之后新增独立规则项（第 107–110 行）：

```js
  {
    match: ["glm-5.3", "glm-5-3"],
    fields: ["prompt_cache_retention"],
  },
```

并在 `/root/workspace/magpie-mw/thinking-control.test.mjs`（第 327–341 行）新增 8 条断言，覆盖直连 `arkapi/glm-5.3`、连字符变体 `arkapi/glm-5-3`、同名组 `group/glm-5.3`、任意组名经 `onProvider(arkapi/glm-5.3)` 剥离、`onRequest` → `onProvider` 双阶段幂等，以及 `glm-5.3-flash` 仍同时剥离双字段不回归。

### 为何不合并进 `glm-5.3-flash` 或 `deepseek` 条目

1. **字段集合不同，合并会误伤缓存键**：
   - `glm-5.3-flash` 条目配置为 `fields: ["prompt_cache_key", "prompt_cache_retention"]`；而 `glm-5.3` 非 flash 档在 ArkAPI 上游可正常接受 `prompt_cache_key`，仅拒收 `prompt_cache_retention`。若将 `"glm-5.3"` 合并进 `glm-5.3-flash` 条目，会连带剥离 `glm-5.3` 的 `prompt_cache_key`，造成不必要的缓存能力降级。
   - `deepseek-v4-flash` 条目配置为 `fields: ["prompt_cache_key", "reasoning_effort"]`，模型族与目标剥离字段均不相同，更不应混同。
2. **多条目叠加天然兼容**：
   - `stripUnsupportedParams` 会顺序遍历所有命中的 `STRIP_PARAM_PROFILES` 规则。当请求模型为 `glm-5.3-flash` 时，先命中 flash 条目剥离 `prompt_cache_key` 与 `prompt_cache_retention`，随后虽子串命中 `glm-5.3` 条目但 `prompt_cache_retention` 已不存在，二次检查无副作用，职责边界清晰。

### 为何不加 `providers: ["arkapi"]` 限定

1. **字段性质无损**：`prompt_cache_retention` 仅是缓存保留周期提示，剥离后即使请求路由至其他供应商，上游也只是回退到默认/自动缓存保留策略，对模型推理结果与工具调用正确性完全无损。
2. **保留 `group/glm-5.3` 在 `onRequest` 直配即生效路径**：`profileMatches` 在配置了 `providers` 时，在 `onRequest` 阶段（无 `ctx.provider`）会取 `model` 第一个 `/` 前的前缀（即 `"group"`）去匹配 `providers`。若加上 `providers: ["arkapi"]`，`group/glm-5.3` 在 `onRequest` 阶段因 `"group"` 不含 `"arkapi"` 而被跳过，破坏「组名含模型串时在 `onRequest` 直配即生效」的直观路径。

## 3. 生产生效证据与中间件热加载结论

修改落盘后，直接观察本机生产环境 Magpie 网关运行状态、journald 日志与路由记录：

1. **剥离日志已打出**（`journald` 中 `magpie` 服务日志）：
   ```text
   THINKMW strip model=group/glm-5.3 fields=prompt_cache_retention
   ```
2. **真实业务流量恢复 200**：
   随后 `/root/.config/magpie/routing/2026-10-20.jsonl` 路由记录中 `pi` 客户端真实请求的字段转述显示（注：该行系 `/root/.config/magpie/routing/2026-10-20.jsonl` 路由记录的字段转述，`journald` 中无该行）：
   ```text
   agent=pi model=group/glm-5.3 provider=arkapi status=200
   ```
3. **服务进程未重启证明**：
   执行 `systemctl show magpie -p ActiveEnterTimestamp` 核查，服务启动时间戳仍为 `2026-10-18 09:45:39`，期间未发生任何重启。

> **重要结论（纠正既有假设）**：**Magpie 网关中间件插件是热加载生效的，修改 `.middleware.js` 后无需执行 `systemctl restart magpie` 重启服务，至多 1 秒内被下一请求拾取。** 此前 `2026-10-12-thinking-control-thinking-level-fix.md` 与 `AGENTS.md` 中关于“插件宿主不热重载、修改后必须重启 magpie 服务”的假设与实际运行机制不符，特此留痕纠正。

## 4. Magpie 组路由 HTTP 400 不 Failover 的架构事实与决策依据

针对「为何 `group/glm-5.3` 在 `arkapi` 返回 400 时没有自动 failover 到组内其他渠道」的只读调查（scout）结论如下：

1. **主程序错误分类与容灾语义**：
   - Magpie 主程序的 failure 分类不止 `credit`、`quota`、`rate`、`verify`、`other` 五类（`routing.go` 中另有 `auth`、`canceled`、`refused`、`shape`、`restricted`、`overflow`、`proxy` 等），且 **HTTP `400` 并非一律不 failover**——当 400 响应命中 `shapeWords`、`unservedWords`、`retiredWords`、`overflow` 词表时，会以 `failShape` / `failOverflow` 重试下一候选（官方文档 `docs/subsystems/gateway-routing.md` 有 `TestGroupFailsOverCommandCodesBare400` 测试佐证）。
   - **准确结论**：**无特征字的普通 400（如本次 ArkAPI 的 `ArkAPI: bad_response_status_code`）才归 `failOther`（日志记为 `fail:"other"`）且不 failover**（官方文档设有 `TestNoFallbackForOtherErrors` 验证该行为）。本次缺陷中「该裸 400 未触发 failover」即源于此。
2. **中间件钩子边界**：
   - Magpie 插件机制仅向中间件暴露 `onRequest`、`onProvider`、`onEvent`、`onResponse` 四个生命周期钩子，**不存在 `onError` 或 `onFailover` 钩子**，中间件无法在收到上游 400 后介入错误分类或触发渠道重试。
3. **配置层能力边界**：
   - Magpie 已证实的容灾机制为组内候选顺序重试与 provider `Fallback` 模型，配置层无任何状态码容灾开关，无法通过配置开启「无特征字 400 触发 failover」。
4. **线上历史数据佐证**：
   - `/root/.config/magpie/routing/` 目录下 `2026-10-06` 至 `2026-10-20` 各 `jsonl(.gz)`（全天、不含 `.bak`）中，行级含 `"status":400` 的记录合计 **354** 条（`grep '"status":400'` 行级口径，reviewer 于 2026-10-20 独立重计：全天 354、截至当日 12:00 为 353、顶层 `status==400` 口径为 353、任一 try 含 400 口径为 354、含 `.bak` 为 358——各自然口径均无 355，故取行级全天 354 并注明口径）。
   - **failover 0 次**为基于源码设计（无特征字裸 400 归 `failOther` 不 failover）与路由日志中未观察到 400 后续候选拉起的间接推断，非独立计数证据（本仓只读环境无法精确复核上游日志全量，此处以间接证据为准）。
5. **决策依据**：
   - 若要让无特征字普通 HTTP 400 触发组内 failover，必须修改 Magpie 主程序源码并重新编译部署；本项目定位为网关外挂中间件，明确不采取侵入主程序源码的方案。
   - 本次通过中间件在请求发往上游前剥离 `prompt_cache_retention`，已**从源头消除 `arkapi` 的 400 报错**，因此无需改动主程序即可彻底闭环。

## 5. Consider 级观察项与后续处置条件

### 观察项 1：`STRIP_PARAM_PROFILES` 新增 `glm-5.3` 条目未配置 `providers` 限定

- **代码定位**：`/root/workspace/magpie-mw/thinking-control.middleware.js:107-110`
- **当前行为**：新增条目 `{ match: ["glm-5.3", "glm-5-3"], fields: ["prompt_cache_retention"] }` 未设置 `providers` 限定；任何供应商下模型串包含 `"glm-5.3"` 或 `"glm-5-3"` 的请求均会被剥离 `prompt_cache_retention`。
- **取舍原因**：Reviewer 判定维持现状可接受：一方面 `prompt_cache_retention` 仅是缓存保留时长提示字段，剥离后上游回退自动缓存策略，无损业务正确性；另一方面若加 `providers: ["arkapi"]`，组名 `group/glm-5.3` 在 `onRequest` 阶段按首段 `"group"` 匹配 `providers` 会被跳过，反而破坏「直配组名即在 `onRequest` 生效」的路径。
- **后续处置条件**：未来若接入某个必须依赖 `prompt_cache_retention` 字段才能开启关键缓存能力的新上游供应商，再为该条目追加 `providers: ["arkapi"]` 限定（届时分组请求统一在 `onProvider` 阶段按 `ctx.provider.id` 精确剥离），并同步补齐限定供应商的单测用例。

### 观察项 2：`thinking-control.test.mjs` 部分新增调用传入空 `ctx`（`{}`）而非 `{ state: {} }`

- **代码定位**：`/root/workspace/magpie-mw/thinking-control.test.mjs:334`（`onRequest(glm53Dash, {})`）与 `:341`（`onRequest(glm53FlashReg, {})`）
- **当前行为**：个别单测调用 `onRequest` 时第 2 参数传入 `{}`，未显式附带 `state: {}` 属性。
- **取舍原因**：`onRequest` 实现内部对 `ctx.state` 已设有 `ctx && typeof ctx.state === "object" && ctx.state !== null` 类型守卫，传入 `{}` 无任何运行时副作用或行为偏差，且属于测试文件既有混合风格，本轮保持已审测试文件不动。
- **后续处置条件**：后续在 `thinking-control.test.mjs` 新增测试用例时，建议统一传入 `{ state: {} }` 以保持风格一致并贴合生产环境 `ctx` 形态。
