# magpie 网关最小抓包 — FINDINGS

任务标记 `[MARK-MAGPIE-CAPTURE-MIN-20261011]`。目标：只记录、不拦不改，把 pi 发往 magpie、模型含
`deepseek-flash` 的请求体完整取回，弄清上游 AgentRouter / New API 需要什么参数。

结论一句话：**pi（openai-completions 客户端）发给 magpie 的是标准 OpenAI Chat Completions 请求**，
顶层 9 个键，`reasoning_effort:"high"` 有、`thinking`/`enable_thinking` 没有；工具历史里思维链走
**`reasoning_details`（数组，元素键 `type|text|format|index`）**，不是 `reasoning_content`；14 个工具里
`tinyfish_fetch`、`vcc_recall`、`ctx_stats` 三个 **`parameters` 里没有 `required`**。

---

## 0. 环境（实测，与原任务书有偏差）

| 项 | 任务书说法 | 实测（命令依据） |
| --- | --- | --- |
| service ExecStart | `magpie web --gateway` | `/root/.local/bin/magpie web --no-open --addr 127.0.0.1:3426`（`cat /etc/systemd/system/magpie.service`） |
| 网关监听 | `127.0.0.1:8000` + 直连口 `3425` | `*:3425`（网关，pid=当前 magpie）、`127.0.0.1:3426`（Web UI）（`ss -ltnp`） |
| pi 侧 baseUrl | — | `http://127.0.0.1:3425/v1`（`/root/.pi/agent/models.json` 第 3–6 行，`api=openai-completions`） |

即：**没有 8000 端口**；pi 的全部流量走 3425 这个网关口，中间件挂在这里才生效。其余事实与任务书一致。

中间件运行时（moejs 沙盒）实测能力：`CAPTURE_INIT loaded fs=undefined require=undefined`
→ **沙盒里没有 `fs`、没有 `require`**，所以写文件那条路走不通，实际走的是 journald 分片（见 §2）。

次要来源（仅供交叉确认模块形态，未改动任何东西）：npm 包
`@magpie-community/middleware-param-override@0.1.0` / `middleware-model-map@0.1.1` 的
`*.middleware.js`，确认导出形态是 ESM `export function onRequest(body, ctx)`，返回 `undefined` 表示
不改请求，`ctx` 有 `model/path/protocol/agent/stream/options/state/reject`。

---

## 1. 抓包中间件与挂载方式

- 中间件绝对路径：`/root/magpie-mw/capture.middleware.js`（`export function onRequest(body, ctx)`）
- 挂载：`/root/.local/bin/magpie plugin add /root/magpie-mw/capture.middleware.js`
  → `✓ added /root/magpie-mw/capture.middleware.js`；`magpie plugin list` 显示 `gateway middleware  onRequest`
- 作用域：只读。`onRequest` 所有分支都 `return undefined`，从不返回/写回 body；整体 `try/catch`，
  失败只打日志。过滤：`String((body&&body.model)||'').indexOf('deepseek-flash')>=0`，其它流量直接返回、不打印。
- 生效方式：改插件后 `systemctl restart magpie`（`plugins.json` 里已注册，重启后随首个命中请求编译加载）。

### 沙盒限制（实测，影响产物形态）

1. 沙盒无 `fs`/`require` → 记录走 **journald 分片**：每片一行、每行 ≤1500 字符，
   格式 `REQCHUNK <序号>/<总片数> [<第几片>] <紧凑 JSON 片段>`，前后各有
   `CAPTURE_REQ <NN> begin|end model=... bytes=... via=journald file=...`。
2. **同一实例有输出上限 ≈58 片 / ≈86 KB**：超过会被中断（末尾没有 `end` 行，JSON 被截断）。
   我自己的主代理会话请求体 ~130–200 KB，记录必然超限 —— 这也是"看起来没抓到"的真实原因（见 §5）。
3. 实例生命周期短：`CAPTURE_INIT` 在多个请求上重复出现，序号在重开实例时从 01 重来
   （探针 3 连击实测：第 1 击 INIT+01，第 2 击 INIT+01，第 3 击 02）。

---

## 2. 产物清单（绝对路径）

| 路径 | 说明 |
| --- | --- |
| `/root/magpie-mw/capture.middleware.js` | 抓包中间件（只读） |
| `/root/magpie-mw/extract.py` | 把 `REQCHUNK` 分片重组成 JSON（`--log`/`--prefix` 指定来源） |
| `/root/magpie-mw/analyze.py` | 结构化分析（工具表/字段/消息结构，只输出结构，不抄正文） |
| `/root/magpie-mw/backup-20261011-183253/` | 备份：`plugins.json`、`settings.json`、`providers.json`（`cp -p`，md5 一致 `bd93cf861f20716dab742fbfaf673ce3`） |

抓包产物（`/root/magpie-mw/capture/`）：

| 文件 | 内容 |
| --- | --- |
| `run1-reassembled-01-seq01.json` | 触发 1 第 1 轮，body 37105 B，24 片，JSON 完整 |
| `run1-reassembled-02-seq01.json` | 触发 1 第 2 轮，body 40545 B，25 片，JSON 完整 |
| `run2-reassembled-01-seq01.json` / `-02-seq01.json` | 触发 2（对照组）两轮，37096 / 55275 B，完整 |
| `run3-reassembled-01-seq01.json` / `-02-seq01.json` | 触发 3（对照组）两轮，37096 / 54777 B，完整 |
| `reassembled-01-seq01.json` / `reassembled-02-seq01.json` | = 触发 2 的副本（`run2-*` 的别名） |
| `run1-reassembled-04-seq03.json` | 另一路 `deepseek-flash` 流量（非本次触发，agent=pi 其余会话），完整 |
| `run1-reassembled-03-seq01.json.raw`、`-05-seq04.json.raw`、`-06-seq01.json.raw` | 被沙盒中断的**不完整**记录（截断在字符串中间），保留作证据 |
| `tools-run-run1.json` / `-run2.json` / `-run3.json` | 每轮 tools 数组原文（三份 md5 相同，工具集稳定） |
| `analysis-run{1,2,3}-rec0{1,2}.txt` | 逐轮结构分析输出 |
| `journal-20261011-1844.log` / `-1848.log` / `-1852.log` | 三段时间窗的 journald 原始切片（含分片原文） |
| `pi-run-{1,2,3}.out` | 三次触发运行 pi 的 stdout |
| `/root/magpie-mw/capture/FINDINGS.md` | 本报告 |

> 记录里含对话文本（developer/user/tool 内容），全部只落在本机 `/root/magpie-mw/`，**未外发**；
> 本报告只引用工具 schema 等非敏感结构 + 字段名/长度。

---

## 3. 触发的确切命令与时间

pi 侧模型串：CLI `--model magpie/group/deepseek-flash`；**请求体里的 `model` 是 `group/deepseek-flash`**。
无头调用按 `pi --help` 确认：`--print/-p` 非交互、`--thinking <level>`、`--no-session`（默认带工具，未加
`--no-tools`）。

```bash
# 触发 1（搜索类工具，run1）18:44:16 起
systemctl restart magpie && sleep 2 && systemctl is-active magpie   # 先重启，清空实例
setsid bash -c 'cd /root; exec pi --model magpie/group/deepseek-flash --thinking high --no-session \
  -p "先用 tinyfish_search 工具搜索一次 magpie gateway middleware usemagpie，然后只回答第一条搜索结果标题。必须先调用工具再回答。标记 mw-probe-20261011。" \
  > /root/magpie-mw/capture/pi-run-1.out 2>&1' &
# 触发 2（fetch 类工具）18:47:26 起；触发 3（与触发 2 完全相同，作对照）18:49:56 起：
#   … -p "先用 tinyfish_fetch 工具抓取 https://usemagpie.ai/docs/ 一次，然后只回答该页面标题一句话…标记 mw-probe{2,3}-20261011。"
```

`CAPTURE_REQ` 时间戳（journald 实测）：

| 运行 | 第 1 轮 | 第 2 轮 |
| --- | --- | --- |
| 触发 1 | 18:44:17.865，bytes=37105 | 18:44:21.799，bytes=40545 |
| 触发 2 | 18:47:27.272，bytes=37096 | 18:47:32.579，bytes=55275 |
| 触发 3 | 18:49:56.970，bytes=37096 | 18:50:00.789，bytes=54777 |

两轮证据链：`/root/.config/magpie/usage.jsonl` 同刻有 `agent=pi, req=group/deepseek-flash,
provider=clinepass, served=deepseek/deepseek-v4-flash, status=200` 的条目（如 18:44:17.866962902、
18:44:21.800985422），与两条记录一一对应；第 2 轮的 `tool` 消息里带着第 1 轮的工具结果，说明确实是
"第一轮带 tools、第二轮带 tool 结果和 assistant 历史"的 ≥2 轮请求。
触发 1 里 assistant 的工具调用参数原文（非敏感）：`tinyfish_search {"query":"magpie gateway middleware usemagpie"}`；
触发 2/3：`tinyfish_fetch {"url":"https://usemagpie.ai/docs/","format":"markdown"}`。

---

## 4. 四问答案

### a) `tools` 与 `tinyfish_fetch` 的 `parameters`

三份 `tools_json` md5 一致（`808ae57a01…`），共 **14 个工具**：`read, edit, write, codemode,
tinyfish_search, tinyfish_fetch, vcc_recall, codegraph, ctx_run, ctx_fs, ctx_git, ctx_kb, ctx_bg, ctx_stats`。

`tinyfish_fetch` 的 `parameters` **原文**（`/root/magpie-mw/capture/tools-run-run3.json`，逐字）：

```json
"parameters": {
  "type": "object",
  "properties": {
    "url": { "type": "string", "description": "Single URL to fetch." },
    "urls": { "type": "array", "items": { "type": "string" }, "minItems": 1, "maxItems": 10,
              "description": "URLs to fetch. TinyFish accepts up to 10 URLs per request." },
    "format": { "type": "string", "enum": ["markdown","html","json"],
                "description": "Output format for extracted content (default markdown)." },
    "links": { "type": "boolean", "description": "Include page hyperlinks in each result." },
    "image_links": { "type": "boolean", "description": "Include image URLs in each result." },
    "maxBytes": { "type": "number", "minimum": 1000, "maximum": 200000,
                  "description": "Maximum bytes to return to the model (default 50KB, max 200KB)." },
    "timeoutMs": { "type": "number", "minimum": 1000, "maximum": 180000,
                   "description": "Client timeout in milliseconds (default 150000)." }
  }
}
```

**关键结论：`tinyfish_fetch` 的 `parameters` 里没有 `required`**（只有 `type` + `properties`）。
对照 `tinyfish_search` 是有 `required: ["query"]` 的。

**缺 `required` 的工具共 3 个**（6 份记录一致）：

| 工具 | `parameters` 键 |
| --- | --- |
| `tinyfish_fetch` | `type`, `properties` |
| `vcc_recall` | `type`, `properties` |
| `ctx_stats` | `type`, `properties` |

其余 11 个都有 `required`，分别是：`read:["path"]`、`edit:["path","edits"]`、
`write:["path","content"]`、`codemode:["code"]`、`tinyfish_search:["query"]`、`codegraph:["action"]`、
`ctx_run:["action"]`、`ctx_fs:["action"]`、`ctx_git:["action"]`、`ctx_kb:["action"]`、`ctx_bg:["action"]`。

### b) 顶层字段清单 / `reasoning_effort` 等

稳定 9 个顶层键（三轮两阶段全同）：

```
model, messages, stream, prompt_cache_key, stream_options, store,
max_completion_tokens, tools, reasoning_effort
```

| 键 | 出现 | 实测值（第 1 轮 / 第 2 轮） |
| --- | --- | --- |
| `model` | 有 | `"group/deepseek-flash"` |
| `stream` | 有 | `true` |
| `stream_options` | 有 | `{"include_usage":true}` |
| `store` | 有 | `false` |
| `prompt_cache_key` | 有 | 38 字符带引号的 uuid 串（会话亲和/缓存键） |
| `max_completion_tokens` | 有 | 148541/148544（轮1）、144636/140504/140649（轮2）—— 随输入增长而下降 |
| `tools` | 有 | 14 个，见 a) |
| `reasoning_effort` | **有** | `"high"`（来自 `--thinking high`）→ **是 `reasoning_effort`，不是 `thinking`** |
| `thinking` / `enable_thinking` / `reasoning` / `thinking_budget` / `include_reasoning` / `reasoning_summary` | **无** | 不在 `top_level_keys` 里（记录中体现为 `null` = 键不存在） |
| `temperature` / `top_p` / `top_k` / `max_tokens` / `tool_choice` / `parallel_tool_calls` / `n` / `stop` / `seed` / `frequency_penalty` / `presence_penalty` / `response_format` / `logprobs` / `user` / `verbosity` / `metadata` | **无** | 同上 |

即 pi 只发 `max_completion_tokens`（不发 `max_tokens`），不发 `temperature`；上游若要归一化，
这是"少参"方向的问题。记录器的 `null` 语义为"键不存在"（`top_level_keys` 可交叉验证）。

### c) 两轮 `messages` 结构差异

第 1 轮 2 条、第 2 轮 4 条（三条触发运行完全相同）：

| 轮 | 消息 | role | keys | 关键点 |
| --- | --- | --- | --- | --- |
| 1 | [0] | `developer` | `role, content` | `content` 为**字符串**，15793 字符（会话设定类长提示；pi 用 `developer` 角色承载 system） |
| 1 | [1] | `user` | `role, content` | `content` 是**数组**，1 个 `{type:"text"}` 块 |
| 2 | [2] | `assistant` | `role, content, tool_calls, reasoning_details` | `content` 为 `null`（`content_type=null`）；**有 `reasoning_details`、没有 `reasoning_content`** |
| 2 | [3] | `tool` | `role, content, tool_call_id` | `content` 为字符串（16453/16454 字符的工具结果），`tool_call_id` 与 [2] 的 `tool_calls[0].id` 相同 |

**`reasoning_details` 精确结构**（触发 3 第 2 轮实测，字段名/长度/结构）：

- 字段名：`reasoning_details`（**不是** `reasoning_content`、也不是 `reasoning`）
- 值类型：**数组对象**（`json_type=object`；触发 3 记录里 `items=1`）
- 长度：触发 3 序列化后 559 字符；触发 2 为 1032 字符；触发 1 第一版记录器只截到 252 字符
- 元素键：`type | text | format | index`，取值形如
  `[{"type":"reasoning.text","text":"<思维链文本>","format":"unknown","index":0}]`
  （`text` 为推理正文，`format` 实测为 `"unknown"`，`index` 从 0 递增）
- 触发 3 记录尾 60 字符：`or codemode? Direct is fine.","format":"unknown","index":0}]` → 证实是数组且
  元素以 `type/text/format/index` 结尾，**没有签名（signature）字段**
- 在 `tool_calls` 的写法上：`tool_calls: [{id:"call_00_…", type:"function", function:{name, arguments}}]`，
  `arguments` 是 **JSON 字符串**（如 `{"url":"https://usemagpie.ai/docs/","format":"markdown"}`，56 字符）
- `tool` 角色消息：`{role:"tool", content:"<字符串结果>", tool_call_id:"call_00_…"}`（无 `name` 字段）

（第 1 轮 `messages` 里没有任何推理字段；两轮都不存在 `reasoning_content`。）

### d) 格式判定 + `ctx` 可枚举键

**OpenAI Chat Completions 格式**，不是 Anthropic：
`messages[].role` + `messages[].tool_calls`（`function.name/arguments`）+ `role:"tool"` 消息，顶层是
`model/messages/stream/tools`；**没有** `system` 顶层字段、没有 `tool_use`/`tool_result` 内容块。
`ctx.protocol = "chat"`、`ctx.path = "/v1/chat/completions"`、`ctx.agent = "pi"`、`ctx.stream = true`
也印证走的是 chat 通道。

`ctx` 可枚举键全清单（顺序即枚举顺序）：

```
protocol, model, stream, path, agent, options, state, reject
```

取值：`protocol="chat"`、`model="group/deepseek-flash"`、`stream=true`、
`path="/v1/chat/completions"`、`agent="pi"`、`options={}`（本次未设 options）、`state={}`、
`reject` 为函数（`ctx.reject(status,message)` 可拒绝请求，本中间件从不调用）。

---

## 5. 坑与未取到项

1. **沙盒没有 `fs`**：任务书设想的"写 `req-NN.json`"不通，实际走 journald 分片。
   `extract.py` 负责把分片还原成 JSON（三份成品 JSON 均 `json=valid`）。
2. **分片有硬上限（≈58 片 / ≈86 KB）**：主代理自己的会话请求体 130–200 KB，记录到 58 片就被中断
   （`reassembled-03.raw` / `-05.raw` / `-06.raw` 就是被截断的），随后该实例失效，于是**同一时间窗内
   小请求也可能完全不被记录**。第一版"触发失败"就是这个原因，不是中间件没挂上。
3. **规避办法（本次采用）**：`systemctl restart magpie` 与 pi 触发放在**同一条 bash** 里先重启再打流量，
   让触发请求成为新实例的首批请求（首轮 37 KB、次轮 40–55 KB，均在限额内）。
4. **工作目录拿不到 `/root/magpie-mw/capture` 建目录前写文件会失败**：中间件不建目录（沙盒无 fs），
   目录由宿主命令 `mkdir -p` 预先建好。
5. 未取到项：
   - `reasoning_details[0].text` 的**全文**（记录器按设计只留 120 字头 + 60 字尾，避免把整段思维链抄进日志）。
   - 主代理大请求（>86 KB）的**完整**记录（受 §5.2 上限限制，只有不完整片段）。
   - 未做参数覆盖/剥离实验（本任务只要"取回请求体"，未改任何路由/参数）。
6. 服务单元/端口与任务书不一致（§0），按源码事实执行：中间件挂在网关（3425）实际生效。

## 6. 收尾状态

- `magpie plugin off /root/magpie-mw/capture.middleware.js` → `✓ … is off`；
  `plugins.json` 中该项变为 `{"spec":"/root/magpie-mw/capture.middleware.js","off":true}`，
  三个 `@magpie-community/opencode-*-auth@latest` 仍在且 `on`。
- `systemctl restart magpie` 后：`active`，MainPID=622376，`ActiveEnterTimestamp=18:52:07`，
  `GET /v1/models → 200`、`GET / (web) → 401`（与改动前基线一致）；
  重启后 journald 无任何 `CAPTURE*` 行，且关掉后再打一次真实 `POST /v1/chat/completions`（→200）
  依旧**零抓包行**，确认中间件已停。
- `/root` 不是 git 仓库（`git -C /root rev-parse` → "不是 git 仓库"），所有新建产物都在
  `/root/magpie-mw/` 下，无提交动作；临时调试目录 `/tmp/mwtest` 已删除。
