# 2026-10-28/29 三个自定义插件补齐官方标准元数据 / 图标 / 文档 / 测试

分支：`feat/magpie-plugins-metadata`（worktree `.wt/magpie-mw/feat-magpie-plugins-metadata`）。

## 背景

仓库内 3 个自定义 Magpie 插件此前缺官方标准的插件元数据（`package.json` 的 `magpie` 字段与 `export const meta`）、图标与 README，Dashboard 无法正确展示。本次为三者统一补齐元数据、图标、文档与单元测试，生产逻辑与既有约束 100% 保持不变（唯一例外见文末"附带修复"）。

## 三个插件

| 目录 | 插件 id | meta.name | 入口 | 图标 |
| --- | --- | --- | --- | --- |
| `./`（仓库根） | `thinking-control` | `Thinking Control` | `thinking-control.middleware.js` | `icon.svg` |
| `agentrouter-itemstrip/` | `agentrouter-itemstrip` | `AgentRouter Item Strip` | `agentrouter-itemstrip.middleware.js` | `icon.svg` |
| `minis/` | `minis` | `Minis` | `minis.agent.js` | `icon.png`（OpenMinis 官方 PNG） |

## 改动明细

### 通用约定

- 每个插件目录一份 `package.json`：`magpie` 字段给出 Magpie 插件注册信息——中间件插件用 `magpie.middleware` 指入口（agent 插件用 `magpie.agent`），`magpie.icon` 指图标，`magpie.options` 提供 `ctx.options` 运行时默认值；`name`/`description`/`keywords`/`license` 等 npm 常规字段齐全。
- 入口文件导出 `export const meta = { id, name, description }`（`name` 为 Title Case 展示名），供插件注册与 Dashboard 标题。
- 每插件一份 README.md（功能、规则表、options 参数表、测试方式）。
- 根 `package.json` 加 `scripts.test`，`npm test` 顺序跑三个测试文件。

### Thinking Control（根目录）

- 新增 `package.json`（`magpie.middleware`/`icon`/`options`：log、extraProfiles、extraStripParams、extraSanitizeModels）、`icon.svg`、`README.md`。
- `thinking-control.middleware.js`：顶部新增 `export const meta`；新增 `ctxOptions(ctx)` 与 `logInfo(opts)`，支持 `ctx.options.log`（false 静默 THINKMW 常规日志，异常日志保留）、`extraProfiles`/`extraStripParams`/`extraSanitizeModels` 追加规则表。未传 options 时行为与原版 100% 一致。
- `thinking-control.test.mjs`：新增 meta 断言与 4 组 ctx.options 用例（log 静默、extraProfiles、extraStripParams、extraSanitizeModels，均带"未传 options 不影响"对照）。

### AgentRouter Item Strip（`agentrouter-itemstrip/`）

- 新增 `package.json`（`magpie.options`：providers/models/dropTypes 覆盖默认值）、`icon.svg`、`README.md`、`agentrouter-itemstrip.test.mjs`。
- `agentrouter-itemstrip.middleware.js`：新增 `export const meta`；新增 `normList`/`optionsOf`/`logLine`，`ctx.options.providers`/`models`/`dropTypes` 经 trim+lowercase 归一化后**精确**查表覆盖默认（绝不子串命中）；默认表与匹配/剥离/指针放行逻辑不变。

### Minis（`minis/`）

- `minis.agent.js` 恢复为生产版 OpenMinis 图标插件（42914 字节）：`meta` 含 `id`/`name`/`description`/`bin`/`dir`/`config`/`format`/`notice`，`meta.icon` 内嵌 `data:image/png;base64` 官方图标；导出 `agent === meta`、`connect()` 返回 `{}`、default 导出 `{ meta, agent, connect }`。
- `minis/icon.png`：OpenMinis 官方 PNG（31621 字节，PNG 签名 `89504e470d0a1a0a`），与 `meta.icon` base64 解码字节完全一致（测试断言比对）；`minis/icon.svg` 已删除。
- 新增 `package.json`（`magpie.agent`/`icon`）、`README.md`、`minis.test.mjs`（meta 字段、导出一致性、connect()、icon 字节一致性、PNG 签名共 10 条断言）。

### 仓库规范

- `AGENTS.md`：项目定位、目录结构、测试命令（`npm test`）、`package.json` 元数据规范与 `export const meta` 约定、备份纪律（`.middleware.js` → 插件源码 `.middleware.js`/`.agent.js`）相应更新。

## 附带修复（测试驱动的真实缺陷）

`agentrouter-itemstrip.middleware.js`：`ctx.options.dropTypes` 覆盖默认（如 `["compaction"]`）时，`reasoning` 项会存活但仍带上游 `item.id`——上游 item id 正是本中间件要消除的 400 根因，与自身测试规格"覆盖后仍剥 id"不符。修复：把 `reasoning` 并入 `AR_ID_TYPES` 剥 id 表（默认配置下 drop 判定在前、行为不变；覆盖后存活的 reasoning 仍剥 id）。测试 17/18 → 18/18。

## 测试结果

`npm test`（根目录，退出码 0）：

- `thinking-control.test.mjs`：77 passed, 0 failed
- `agentrouter-itemstrip/agentrouter-itemstrip.test.mjs`：18 passed, 0 failed
- `minis/minis.test.mjs`：10 passed, 0 failed

合计 105 条断言全绿。

## 遗留 / 观察项

- `.bak*` 备份（含本次修复前的 r4 备份）保留在本 worktree 本地，`.gitignore` 已排除不入库。
- `plugins.json` 注册与 Dashboard 实际展示效果未在本次范围内验证，如需可在合并后用 `magpie plugin list` 核对。
