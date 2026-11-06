# Magpie 跨 resource（cross-resource）会话亲和性调查笔记 — 2026-11-05/06

- 结构化标签：[pattern:cross-resource-conversation-affinity]
- 范围：AgentRouter（linuxdo / github 两个渠道侧资源）上 Responses 会话续跑失败（400 "created under a different account" 类）的取证与边界分析。本笔记为调查记录，不是修复方案，未做任何代码/配置改动。
- 匿名约定：会话记 C1（另三个槽位 C2/C3/C4 未提供原件），账号记 A（linuxdo 侧）/ B（github 侧）；不输出真实 conv 值、用户标识、密钥、headers、完整 response_id/rest 原值。
- 同标签既有记录：本仓 `.agents/notes/` 精确检索 `[pattern:cross-resource-conversation-affinity]`，除本文件外 0 次命中（本文件内共 3 处）。
- 门禁档位备注：本文件为纯文档新增（预期 A 档）。已核对 `package.json`（仅 `scripts.test`，无文档校验）、无 `Makefile`、无 `.github/workflows` 文档校验。本轮 worker 未提交、未申请任何提交门禁。

## 结论分级

为避免把转述当实测，所有结论按证据层级分级：

- **L1 本 worker 本轮亲核**：仅"独立原件核验"一节中 affinity.rest 安全复核条目（2026-11-06 快照）。
- **L2 主代理已核原件**（行号/SHA/字段由主代理取证，本笔记按主代理结论收录）：二进制与 buildinfo、插件源码与元数据、plugins.json 投影、错误会话行、routing/usage/journal 行级对应、C1 的 87 条对应关系。
- **L3 主控探针回传（原探针产物未提供，未独立核对）**：w69 的 hook 观察（has_messages/has_input、keys）、Chat→Responses 注入推断、账号 A≠B 声称。

**没有任何一项被宣布为"已全部证实"**；分层修复建议仅按上述层级标注依赖关系。

## 主控探针回传（未独立核对原探针产物）

以下为"用户在本会话转述的 w69 主控实测，原探针产物未提供"，列为 L3：

- w69 实测：ItemStrip 的 hook 被调用，观测到 `has_messages=true`、`has_input=false`，body keys 包含 `model`、`messages`；Chat 形态消息内无 `previous_response_id`/`conversation`/`item_reference` 指针，也无 `fc_*` 历史 item id。
- 主控推断：Magpie 在 Chat→Responses 转换阶段注入与 conv 关联的历史指针；ItemStrip 的 `onProvider` 在注入点之前执行，因此拿不到这些指针。该推断尚未由本 worker 实测，也未对照 Magpie Go 源码确认。
- 主控声称：两个渠道的 `New-Api-User` 为不同账号，即账号 A（linuxdo 侧）≠ 账号 B（github 侧）；原始探针/脱敏比对原件未取得。注意：即便 A≠B 成立，不同的代理层账号也不能单独证明其底层 OpenAI resource 一定不同。

## 独立原件核验

### 二进制与版本（L2）

- `/root/.local/bin/magpie` 与 `/proc/738/exe` 同字节同 hash，70848674 字节；SHA256=`865bb0687995acb56da968b8ef0d2a6c6989fb118363537142e4c09a25e04622`。
- `/.go.buildinfo`（主代理白名单提取）：module `github.com/yetone/magpie`，version `v0.1.3010`，`vcs.revision=234903cb231aa8290b13637ae9a2c0742715946f`，`vcs.time=2026-11-05T03:05:38Z`，`vcs.modified=false`。

### 插件与注册（L2）

- 三个自定义插件的源码/包元数据在本仓。`thinking-control` 与 `agentrouter-itemstrip` 磁盘版本均为 0.1.1；`minis` 为 agent 类型插件，不是请求清理 middleware。
- ItemStrip 生产软链 `/root/.config/magpie/plugins/agentrouter-itemstrip.middleware.js` → `/root/workspace/magpie-mw/agentrouter-itemstrip/agentrouter-itemstrip.middleware.js`；两端 SHA256=`d603723a5bbb9f98a9b3cd2919e583cf9436b17b63f4f5a27d7722cc6d04cecf`，8711 字节（旧 scout 报的 6559 字节不采信）。
- `/root/.config/magpie/plugins.json` 主代理安全投影：index1 spec=`/root/workspace/magpie-mw`，index2=`/root/workspace/magpie-mw/minis`，index3=`/root/workspace/magpie-mw/agentrouter-itemstrip`。ItemStrip options：`providers=[agentrouter-github,agentrouter-linuxdo]`，`models=[gpt-6.1-sol,gpt-6-astra]`，`dropTypes=[reasoning]`；其余两项无 options；三项均无显式 `enabled`。**数组顺序不是已证实的 hook 执行顺序**；也不能据此断言"默认表漏了 GitHub"。

### ItemStrip / ThinkingControl 源码事实（L2）

- `agentrouter-itemstrip.middleware.js`：第 85–92 行读取 `ctx.options`；103–113 行 `pointerOf`（`previous_response_id`/`conversation`/`item_reference` 指针检测，空值等细节以源码为准，不能概括为"只要字段存在即命中"）；116–142 行 `onProvider` 入口条件；145–175 行统计并清理。
- 行为：仅实现 `onProvider`；`body.input` 非数组时静默放行；provider/model 不匹配时放行；命中历史指针则整体原样放行。无指针时按登记 type 删除 `item.id`、保留 `call_id`，默认整条丢弃 `reasoning`；strip/drop 均为 0 时也无日志输出。
- `thinking-control.middleware.js` 导出 `onRequest`/`onProvider`；但本次请求中它是否实际被调用，不能从源码声明推出。

### 错误会话与路由原件（L2）

- 客户端会话原件：`/root/.pig/agent/sessions/--root--/2026-11-04T11-50-10-787Z_01a1a665-2c63-713c-bde3-7055b5d41d94.jsonl` 行 989/991/993/995，四条均在 `assistant.errorMessage` 命中错误样本，`role=assistant`，`stopReason=error`，`api=openai-completions`，`provider=magpie`，`model=group/smartass`。
- 对应 routing 原件 `/root/.config/magpie/routing/2026-11-05.jsonl.gz`（已轮转压缩；取证时路径为 `.jsonl`）行 1918/2320/2378/2381：`tries.id=agentrouter-github`，`model=gpt-6-astra`，`status=400`。
- 注意：客户端 API 元数据不等于最终 wire body；不得把会话记录里无 `input` 字段当作"真实请求无 input"。
- 四条错误关联 trace（仅作错误关联索引，不作响应引用 ID、不作根因）：`84b98bab15418be804359153db3a1e36`、`6711ec55b79f95adcb1d21e70f82e857`、`0e4e33a00d56bd9b287f2bf1ea202284`、`a130d4e93fbaa5dbc6055c84a4d4ee17`。

### systemd 与 journal（L2）

- `/etc/systemd/system/magpie.service`；已核 `MainPID=738`，`active/running`，`StandardOutput=journal`，`StandardError=inherit`。
- 已核 2026-11-05 journal 快照 125 条：四条 trace 各命中 1 条且均属 PID 738；`THINKMW` 与 `ARITEMSTRIP` 前缀日志均 0 条（unit=`magpie.service`，限 2026-11-05 快照，不声称之后一直为 0）。无标记日志不排除 hook 被调用或走了指针放行分支。

### usage 原件对应（L2）

- `/root/.config/magpie/usage.jsonl` 行 127012/127426/127487/127491 分别对应 routing 1918/2320/2378/2381：`provider=agentrouter-github`，`model=gpt-6-astra`，`status=400`，`response_id` 非空=false，`providerAccount` 为空。**不得把空 `providerAccount` 当作 `New-Api-User` 相同或不同的证明。**

### affinity.rest 安全复核（L1，本 worker 本轮亲核，2026-11-06 快照）

- 原件 `/root/.config/magpie/affinity.json`：复合键 → 状态对象（当时共 91 键），无顶层 `rest` 字段。
- 方法：从 routing 1918 行 `conv` 字段取 C1 值（仅内存），在 affinity 键名按 `|<C1>` 后缀定位。命中 **2** 个键：
  - 键 A：`devin/swe-2|C1`（2 段）；成员含 `rest`(str, len=5)、`who`(非空 str)、`model=swe-2`、`turn=29`、`at=2026-11-05T20:49:32.124184564+08:00`、`cacheRead=245248`。
  - 键 B：`group/smartass|<24 字符中段>|C1`（3 段）；成员同上且另有 `stoodIn=true`、`turn=16`、`at=2026-11-05T12:41:52.280092502+08:00`、`cacheRead=217920`。`who` 与键 A 相同（bool 比较），`rest` 与键 A 相同（bool 比较，len=5）。
  - `who` 值为真实用户标识，按匿名约定不落盘。
- 此前主代理用 `'group/smartass|'+conv` 做 exact lookup 返回空：现已确认原因是该键为 **3 段**复合键（`group/smartass` 与 C1 之间还有一段 24 字符键段），不能写成"rest 已清空/不存在"。中段含义未确认。
- `rest`（len=5）与六条关联 `usage.response_id` 逐一相等比较（bool）：r844/u125915(200)=false、r847/u125918(200)=false、r1918/u127012(400)=false、r2320/u127426(400)=false、r2378/u127487(400)=false、r2381/u127491(400)=false。即快照中两个 affinity 条目的 `rest` 均不等于任何一条关联 usage 的 `response_id`（200 条目的 response_id 非空，400 条目为空）。
- 本快照只能证明读取时刻状态，不冒充失败当时状态；不得由"同 conv 的 linuxdo 成功→github 失败"直接宣称"同一历史指针已证实跨账号发送"。

## conv 时间线

- 四槽位表：C1=已核（四条既有 trace 经主代理比较同属一个 conv，**不是四个 conv**）；C2/C3/C4=未提供原件与标识，槽位留空。
- C1 规模：至第 4 次失败共有 87 条 routing 记录，与 87 条 usage 按 `route_id` 对应（L2）。
- C1 关键事件（当地时间 +08:00，L2）：

| routing 行 | usage 行 | 时间 | provider / model | status | response_id 非空 | providerAccount |
|---|---|---|---|---|---|---|
| 844 | 125915 | 2026-11-05T10:08:15.255559059+08:00 | agentrouter-linuxdo / gpt-6-astra | 200 | true | 空 |
| 847 | 125918 | 2026-11-05T10:09:31.583592521+08:00 | agentrouter-linuxdo / gpt-6-astra | 200 | true | 空 |
| 1918 | 127012 | 2026-11-05T15:54:36.790635337+08:00 | agentrouter-github / gpt-6-astra | 400 | false | 空 |
| 2320 | 127426 | 2026-11-05T19:06:35.881531667+08:00 | agentrouter-github / gpt-6-astra | 400 | false | 空 |
| 2378 | 127487 | 2026-11-05T19:14:05.544594104+08:00 | agentrouter-github / gpt-6-astra | 400 | false | 空 |
| 2381 | 127491 | 2026-11-05T19:14:28.506246667+08:00 | agentrouter-github / gpt-6-astra | 400 | false | 空 |

- 形态：C1 上午在 linuxdo 连续成功，下午/晚间路由到 github 后连续 400；符合"跨资源续跑"嫌疑面，但同一指针跨账号发送**未证实**。

## 账号差异证据边界

- 已知边界：usage/routing 中 `providerAccount` 均为空，不能证明两端 `New-Api-User` 相同或不同；A≠B 目前仅是主控声称（L3）。
- 即便 A≠B 成立，也不单独证明底层 OpenAI resource 不同；反之亦然。
- 未读取 `providers.json`/`auth.json`/`hosts.yml`/`.env`/`logins.json`/`plugin-auth.json` 等凭据类文件来补此证明，按凭据纪律保持不读。
- affinity `who` 字段两条相同（bool），只说明 Magpie 侧归一化的用户标识相同，不能推出上游账号相同。

## 分层修复建议（仅建议，未实施，未评审）

1. **宿主状态边界（优先）**：服务器历史引用（`rest`/response 指针）应绑定真实 provider/account/resource 身份；跨资源路由不得无条件沿用旧指针。能完整内联恢复历史才考虑去指针，否则应保持原资源续跑或明确报错，不静默丢历史。
2. **协议边界**：在 Responses 最终出站形态与资源身份已确定处校验引用。若主控"Chat 阶段 hook 无指针、转换后注入"的观察成立，则当前只认 `input` 数组的 ItemStrip 无法修掉转换后新注入的字段；不得以扩 provider 匹配表或全局删 ID 代替宿主修复。
3. **插件层**：保留 `item.id` 与 `call_id` 的区别、无副作用的精确匹配；不无条件删除 `previous_response_id`。
4. **验证层**：未来仅以 mock 双资源 A/B、合成历史 ID 做对照——同资源续跑、跨资源续跑、无完整历史、工具 `call_id` 保真；只记录存在性/类型/计数与关联别名，不碰真实服务。当前未运行任何该探针。

## 未闭环项

- C2/C3/C4 会话原件与标识未提供，"四个 conv 时间线"仅能交付 C1。
- w69 探针原始产物未提供：hook 观察与"转换后注入指针"推断未独立核对，未对照 Magpie Go 源码。
- 账号 A/B 的 `New-Api-User` 原始值与底层 resource 身份比对原件未取得（凭据文件按纪律不读）。
- 400 的上游原始错误响应体/完整 headers 未取证（正文与 headers 不入笔记）。
- affinity 快照为 2026-11-06 时刻；失败当时（2026-11-05 下午）的 affinity 状态未取得；三段复合键中段的语义未确认。
- "跨资源沿用同一历史指针导致 400"是嫌疑面，非已证根因；需要宿主侧（Magpie 源码/修复）与验证层探针闭环。

[pattern:cross-resource-conversation-affinity] MARK-WORKER-MAGPIE-XRES-NOTE-W6C-20261105-01

## 上游立项（2026-11-06）

- Issue: https://github.com/yetone/magpie/issues/5477 —「Cross-provider routing reuses foreign conversation/previous_response_id pointer → HTTP 400 on switch」
- 关联：#4525（input[].id 超 64）、#5266（msg_ 前缀缺失）同族第三变体
- 主张：转换层注入的 conversation/previous_response_id 指针应按目标 provider+account 一致性决定是否保留/内联展开/回源路由；middleware 层修不了（指针在 onProvider 之后才注入）
- Magpie 宿主版本：0.1.3110（提交 issue 时上游最新 0.1.3125）
