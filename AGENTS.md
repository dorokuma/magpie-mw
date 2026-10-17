# Agent 协作指南 (AGENTS.md)

## 1. 项目定位

`magpie-mw` 是面向本机 Magpie LLM 网关（`127.0.0.1:3425`）的自定义网关中间件与请求抓包/上游兼容性探针工具集：

- `thinking-control.middleware.js`：生产环境网关中间件插件（导出 `onRequest(body, ctx)` 及 `DIALECTS`、`PROFILES`、`STRIP_PARAM_PROFILES`、`SANITIZE_PROFILES`），负责将客户端（如 `pi`）发送的 `reasoning_effort` 智能翻译为各后端方言真正生效的思考开关字段（如 `qwenChatTemplate` 的 `chat_template_kwargs.enable_thinking`、`thinkingDisabled` 的 `thinking.type: "disabled"`），并按模型子串执行不支持顶层参数剥离（`STRIP_PARAM_PROFILES`）与消息/工具 Schema 兼容性清洗（`SANITIZE_PROFILES`）。
- `capture.middleware.js`：只读抓包中间件（所有分支均 `return undefined`，绝不修改上游请求），在无 `fs` 的沙盒环境下通过 journald 分片（`REQCHUNK`）输出请求结构与摘要。
- `extract.py` / `analyze.py`：日志分片重组工具（从 journald 或日志文件提取 `REQCHUNK` 还原为完整 JSON 记录）与结构化分析脚本（输出顶层字段、工具表与消息结构摘要，不抄录对话正文）。
- `capture-body.mjs`：抓包体加载器，从抓包记录 JSON 中按原始字段顺序精确重建真实请求体对象（供离线测试与探针复用）。
- `probe-variants.mjs`：上游兼容性探针变体生成器，基于 `capture-body.mjs` 加载的真实多轮抓包体生成多种请求结构变体（`/tmp/mwvariants/*.json`），用于探测上游网关（如 AgentRouter / New API）的参数校验规则。

## 2. 目录结构

```text
/root/workspace/magpie-mw/
├── AGENTS.md                        # Agent 协作指南与仓库规范
├── .gitignore                       # Git 忽略规则（排除备份与本地抓包产物）
├── thinking-control.middleware.js   # 生产网关中间件（思考控制、参数剥离、结构清洗）
├── thinking-control.test.mjs        # 生产中间件全量单元测试
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
  node thinking-control.test.mjs
  ```
- 每次修改 `thinking-control.middleware.js` 或测试代码后，必须运行 `node thinking-control.test.mjs` 并确保全部断言通过（零失败、退出码为 0）。
- **提交规范**：遵循工作区全局 `commit-msg` 与 `pre-push` hook 规范（Conventional Commits 白名单类型，主题 ≤72 字，冒号后恰好一空格，严禁过程噪声词与凭据入库）。

## 4. 修改纪律与运行时约束

- **修改前备份与轮转**：修改任何 `.middleware.js`（或配套测试文件）前，必须先在同一目录创建带时间戳的 `.bak` 备份文件（命名格式 `<filename>.bak-YYYYMMDD-HHMMSS-<tag>`）；同目录同文件的 `.bak` 备份最多保留 **3 个**（超出时清理最旧备份）。
- **生产挂载与重启生效**：生产插件注册在 `/root/.config/magpie/plugins.json` 中（规范路径 `/root/workspace/magpie-mw/thinking-control.middleware.js`）。Magpie 插件宿主不热重载，修改 `.middleware.js` 后必须执行：
  ```bash
  systemctl restart magpie && sleep 2 && systemctl is-active magpie
  ```
  确认服务恢复 `active`，并通过 `magpie plugin list` 核验插件路径与 `on` 状态正常。
- **moejs 沙盒约束**：
  - 网关中间件运行在 Magpie 内置的 `moejs` 沙盒中：**无 `fs`、无 `require`、无网络访问能力**。
  - 生产中间件必须采用**纯 ES 兼容写法**（无 Node.js 内置模块依赖、无外部 npm 包依赖），保证沙盒与本地 Node 测试环境双端可直接加载。
  - **异常 `try/catch` 原样放行**：`onRequest(body, ctx)` 整体必须包裹在 `try/catch` 中；遇到任何异常时记录错误日志并原样放行（返回 `undefined`），绝不阻断正常网关流量。
  - **返回值契约**：仅在实际修改了 `body` 时才返回 `body`，未命中规则或无需修改时必须返回 `undefined`；多阶段处理须遵守组合返回值契约 `modified = stripped || sanitized`，当思考控制未命中、命中逃生舱或方言 `apply` 返回 `false` 时，统一按 `return modified ? body : undefined` 返回，防止前序参数剥离或结构清洗改动丢失。

## 5. 决策记录与本地产物声明

- **决策与遗留项记录**：架构决策、线上排障记录与 Code Review 后续观察项统一记录在 [.agents/notes/](.agents/notes/) 目录下（如 [2026-10-12-thinking-control-thinking-level-fix.md](.agents/notes/2026-10-12-thinking-control-thinking-level-fix.md)、[2026-10-17-deepseek-sanitize-followup.md](.agents/notes/2026-10-17-deepseek-sanitize-followup.md)）。
- **本地运行产物不入库**：`capture/` 目录下的抓包样本、日志切片与对话正文（含隐私内容，除已脱敏的结构化调查报告 `capture/FINDINGS.md` 外），以及所有 `*.bak*` 备份文件和 `backup-*/` 历史备份目录，均属本地运行产物，已在 `.gitignore` 中忽略，严禁入库。
