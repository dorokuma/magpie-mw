# Agent 协作指南 (AGENTS.md)

## 1. 项目定位

`magpie-mw` 是面向本机 Magpie LLM 网关（`127.0.0.1:3425`）的自定义网关插件与请求抓包/上游兼容性探针工具集，含 3 个自定义插件（见第 2 节目录结构）：

- `thinking-control.middleware.js`（插件 `Thinking Control`，仓库根目录）：生产环境网关中间件插件（导出 `meta`、`onRequest(body, ctx)`、`onProvider(body, ctx)` 及 `DIALECTS`、`PROFILES`、`STRIP_PARAM_PROFILES`、`SANITIZE_PROFILES`）。双阶段钩子：`onRequest` 在路由前按客户端模型串（直连 `provider/model`）做思考翻译、参数剥离与结构清洗；分组名（如 `group/...`）不锁死、原样放行。`onProvider` 在 Magpie 选定具体渠道后触发，用 `ctx.provider`（`{ id, name, account, model }`）拼出真实 `id/model` 再走同一套规则，使第 1 次请求即按底层模型精确剥离/清洗。规则项可选用 `providers` 限定供应商子串、用 `match` 限定模型子串；未配 `providers` 时只按 `match`。负责将客户端（如 `pi`）发送的 `reasoning_effort` 智能翻译为各后端方言真正生效的思考开关字段（如 `qwenChatTemplate` 的 `chat_template_kwargs.enable_thinking`、`thinkingDisabled` 的 `thinking.type: "disabled"`），并按模型子串执行不支持顶层参数剥离（`STRIP_PARAM_PROFILES`）与消息/工具 Schema 兼容性清洗（`SANITIZE_PROFILES`）。
- `agentrouter-itemstrip/agentrouter-itemstrip.middleware.js`（插件 `AgentRouter Item Strip`）：AgentRouter 无状态回放中间件（导出 `meta` 与 `onProvider`）。只在路由定渠道后按精确 provider id + 精确底层 model 命中，剥掉 inline 历史项的上游 `item.id`（`function_call`/`custom_tool_call`/`function_call_output`/`custom_tool_call_output`/`message`/`reasoning`）并默认整条丢弃 `reasoning` 项，规避上游 "created under a different account" 400。带 `previous_response_id`/`conversation`/`item_reference` 历史指针的请求整体放行；`ctx.options.providers`/`models`/`dropTypes` 可在运行时覆盖默认表（归一化后精确匹配，绝不退化为子串）。
- `minis/minis.agent.js`（插件 `Minis`）：OpenMinis 安卓客户端图标与端点资料面板 agent 插件（导出 `meta`、`agent`、`connect`），`meta.icon` 内嵌 OpenMinis 官方 PNG 图标的 `data:image/png;base64` 数据（与 `minis/icon.png` 字节一致），`connect()` 返回空对象——OpenMinis 在移动端配置，不落地本机 CLI 文件。
- `capture.middleware.js`：只读抓包中间件（所有分支均 `return undefined`，绝不修改上游请求），在无 `fs` 的沙盒环境下通过 journald 分片（`REQCHUNK`）输出请求结构与摘要。
- `extract.py` / `analyze.py`：日志分片重组工具（从 journald 或日志文件提取 `REQCHUNK` 还原为完整 JSON 记录）与结构化分析脚本（输出顶层字段、工具表与消息结构摘要，不抄录对话正文）。
- `capture-body.mjs`：抓包体加载器，从抓包记录 JSON 中按原始字段顺序精确重建真实请求体对象（供离线测试与探针复用）。
- `probe-variants.mjs`：上游兼容性探针变体生成器，基于 `capture-body.mjs` 加载的真实多轮抓包体生成多种请求结构变体（`/tmp/mwvariants/*.json`），用于探测上游网关（如 AgentRouter / New API）的参数校验规则。

## 2. 目录结构

```text
/root/workspace/magpie-mw/
├── AGENTS.md                        # Agent 协作指南与仓库规范
├── .gitignore                       # Git 忽略规则（排除备份与本地抓包产物）
├── package.json                     # Thinking Control 插件元数据 + npm test 聚合脚本
├── icon.svg                         # Thinking Control 插件图标
├── README.md                        # Thinking Control 插件说明文档
├── thinking-control.middleware.js   # 生产网关中间件（思考控制、参数剥离、结构清洗）
├── thinking-control.test.mjs        # 生产中间件全量单元测试
├── agentrouter-itemstrip/           # AgentRouter Item Strip 插件目录
│   ├── package.json                 # 插件元数据（magpie.middleware/icon/options）
│   ├── icon.svg                     # 插件图标
│   ├── README.md                    # 插件说明文档
│   ├── agentrouter-itemstrip.middleware.js  # item.id / reasoning 剥离中间件
│   └── agentrouter-itemstrip.test.mjs       # 单元测试
├── minis/                           # Minis（OpenMinis 安卓客户端图标）agent 插件目录
│   ├── package.json                 # 插件元数据（magpie.agent/icon）
│   ├── icon.png                     # OpenMinis 官方 PNG 图标
│   ├── README.md                    # 插件说明文档
│   ├── minis.agent.js               # agent 插件（meta 内嵌 icon base64）
│   └── minis.test.mjs               # 单元测试
├── capture.middleware.js            # 只读请求抓包中间件
├── capture-body.mjs                 # 抓包记录请求体重建加载器
├── probe-variants.mjs               # 上游兼容性探针变体生成器
├── extract.py                       # journald REQCHUNK 分片重组脚本
├── analyze.py                       # 抓包记录结构化分析脚本
├── .agents/
│   └── notes/                       # 架构决策、修复记录与 Code Review 观察项
└── capture/
    └── FINDINGS.md                  # 脱敏结构化调查报告（其余抓包样本本地保留不入库）
```

## 3. 开发与测试约定

- **测试命令**：
  ```bash
  npm test
  ```
  在仓库根目录执行，顺序跑 `thinking-control.test.mjs`、`agentrouter-itemstrip/agentrouter-itemstrip.test.mjs`、`minis/minis.test.mjs` 三个插件的单元测试（见根 `package.json` 的 `scripts.test`）；也可按需单跑对应 `node <file>.test.mjs`。
- 每次修改任一插件源码或测试代码后，必须运行 `npm test` 并确保全部断言通过（零失败、退出码为 0）。
- **插件元数据规范**：每个插件目录一份 `package.json`，`magpie` 字段描述 Magpie 插件注册信息——中间件插件用 `magpie.middleware` 指向入口文件（agent 插件用 `magpie.agent`），`magpie.icon` 指向图标文件，`magpie.options` 提供 `ctx.options` 默认值（可选）。插件入口文件同时导出 `export const meta = { id, name, description }`，`name` 采用 Title Case 展示名（如 `Thinking Control`、`AgentRouter Item Strip`、`Minis`），供 Magpie Dashboard 标题显示。
- **提交规范**：遵循工作区全局 `commit-msg` 与 `pre-push` hook 规范（Conventional Commits 白名单类型，主题 ≤72 字，冒号后恰好一空格，严禁过程噪声词与凭据入库）。

## 4. 修改纪律与运行时约束

- **修改前备份与轮转**：修改任何插件源码（`.middleware.js` / `.agent.js`）或配套测试文件前，必须先在同一目录创建带时间戳的 `.bak` 备份文件（命名格式 `<filename>.bak-YYYYMMDD-HHMMSS-<tag>`）；同目录同文件的 `.bak` 备份最多保留 **3 个**（超出时清理最旧备份）。
- **生产挂载与热重载生效**：生产插件注册在 `/root/.config/magpie/plugins.json` 中（规范路径 `/root/workspace/magpie-mw/thinking-control.middleware.js`）。Magpie 插件宿主会热重载中间件文件，修改 `.middleware.js` 后**通常无需重启**即可生效；可通过查看 `magpie` journal 中该中间件输出的日志行（如 `THINKMW` 前缀日志）或发起一次真实请求观察路由/清洗日志进行可选核验。热重载存在极小概率延迟或失败，**若核验未生效再执行**：
  ```bash
  systemctl restart magpie && sleep 2 && systemctl is-active magpie
  ```
  确认服务恢复 `active`，并通过 `magpie plugin list` 核验插件路径与 `on` 状态正常。
- **moejs 沙盒约束**：
  - 网关中间件运行在 Magpie 内置的 `moejs` 沙盒中：**无 `fs`、无 `require`、无网络访问能力**。
  - 生产中间件必须采用**纯 ES 兼容写法**（无 Node.js 内置模块依赖、无外部 npm 包依赖），保证沙盒与本地 Node 测试环境双端可直接加载。
  - **异常 `try/catch` 原样放行**：`onRequest(body, ctx)` 与 `onProvider(body, ctx)` 整体必须包裹在 `try/catch` 中；遇到任何异常时记录错误日志并原样放行（返回 `undefined`），绝不阻断正常网关流量。严禁返回 `null`。
  - **双阶段钩子**：`onRequest` 看到的 `body.model` / `ctx.model` 仍是客户端传入值。直连模型在此阶段完成剥离、清洗与思考翻译；若 `ctx.state` 为对象且请求带 `reasoning_effort`，先写入 `ctx.state.savedEffort`（`hasSavedEffort`），避免后续剥离丢掉原始意图。`onProvider` 在路由选定渠道后调用：`body.model` 仍可能是分组名，真实供应商与底层模型取自 `ctx.provider.id`（回退 `name`）与 `ctx.provider.model`，目标模型串为 `id + "/" + model`。effort 优先读 `body.reasoning_effort`，已被剥离则回退 `ctx.state.savedEffort`。返回修改后的 `body` 即替换发往该 provider 的请求体。直连模型若已在 `onRequest` 处理完，`onProvider` 必须幂等并返回 `undefined`。
  - **返回值契约**：仅在实际修改了 `body` 时才返回 `body`，未命中规则或无需修改时必须返回 `undefined`；多阶段处理须遵守组合返回值契约 `modified = stripped || sanitized`，当思考控制未命中、命中逃生舱或方言 `apply` 返回 `false` 时，统一按 `return modified ? body : undefined` 返回，防止前序参数剥离或结构清洗改动丢失。规则表不得硬编码具体组名。

## 5. 决策记录与本地产物声明

- **决策与遗留项记录**：架构决策、线上排障记录与 Code Review 后续观察项统一记录在 [.agents/notes/](.agents/notes/) 目录下（如 [2026-10-12-thinking-control-thinking-level-fix.md](.agents/notes/2026-10-12-thinking-control-thinking-level-fix.md)、[2026-10-17-deepseek-sanitize-followup.md](.agents/notes/2026-10-17-deepseek-sanitize-followup.md)）。
- **本地运行产物不入库**：`capture/` 目录下的抓包样本、日志切片与对话正文（含隐私内容，除已脱敏的结构化调查报告 `capture/FINDINGS.md` 外），以及所有 `*.bak*` 备份文件和 `backup-*/` 历史备份目录，均属本地运行产物，已在 `.gitignore` 中忽略，严禁入库。
