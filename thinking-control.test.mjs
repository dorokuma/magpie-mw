import { onRequest, onProvider, meta, DIALECTS, PROFILES, STRIP_PARAM_PROFILES, SANITIZE_PROFILES } from "./thinking-control.middleware.js"

let pass = 0, fail = 0
function check(name, cond, info) {
  if (cond) { pass++; console.log("PASS", name) }
  else { fail++; console.log("FAIL", name, info === undefined ? "" : "-> " + JSON.stringify(info)) }
}
const Q = "arkapi/qwen3.8-flash-next"
const et = (o) => o && o.chat_template_kwargs && o.chat_template_kwargs.enable_thinking

// ── qwenChatTemplate 经 onRequest（命中 PROFILES） ──
let r
r = onRequest({ model: Q, reasoning_effort: "low" }, {})
check("qwen effort=low -> 开思考", et(r) === true && r.reasoning_effort === "low", { et: et(r), eff: r && r.reasoning_effort })

r = onRequest({ model: Q, reasoning_effort: "medium" }, {})
check("qwen effort=medium -> 开思考", et(r) === true && r.reasoning_effort === "medium", { et: et(r) })

r = onRequest({ model: Q, reasoning_effort: "none" }, {})
check("qwen effort=none -> 关思考且清掉effort", et(r) === false && r.reasoning_effort === undefined, { et: et(r), eff: r && r.reasoning_effort })

r = onRequest({ model: Q, reasoning_effort: "" }, {})
check("qwen effort='' -> 关思考", et(r) === false, { et: et(r) })

r = onRequest({ model: Q }, {})
check("qwen 无effort + closeWhenAbsent=false -> 开思考", et(r) === true, { et: et(r) })

r = onRequest({ model: Q, reasoning_effort: "low", chat_template_kwargs: { enable_thinking: true } }, {})
check("qwen 逃生舱 显式true -> 不改动", r === undefined, r)

r = onRequest({ model: Q, chat_template_kwargs: { enable_thinking: false } }, {})
check("qwen 逃生舱 显式false -> 不改动", r === undefined, r)

// ── 通用安全边界 ──
r = onRequest({ model: "arkapi/kimi-k3", reasoning_effort: "low" }, {})
check("未登记模型 -> 原样放行", r === undefined, r)

r = onRequest(null, {})
check("body=null -> 放行", r === undefined, r)

r = onRequest({ model: Q, reasoning_effort: 123 }, {})
check("qwen effort=非串123 -> 视为实义档开思考", et(r) === true, { et: et(r) })

// ── thinkingDisabled 方言单元（框架就绪，未在真实后端实测） ──
const TD = DIALECTS.thinkingDisabled
let b
b = { model: "x" }
check("TD apply off -> thinking.type=disabled", TD.apply(b, false) === true && b.thinking.type === "disabled", b)
check("TD apply off 幂等 -> 无需再改", TD.apply(b, false) === false, b)
b = { model: "x", thinking: { type: "disabled" } }
check("TD apply on 清掉 disabled", TD.apply(b, true) === true && b.thinking === undefined, b)
b = { model: "x" }
check("TD apply on 且本无thinking -> 无需改", TD.apply(b, true) === false, b)
check("TD escape 已带thinking.type -> true", TD.escape({ thinking: { type: "disabled" } }) === true)
check("TD escape 未带 -> false", TD.escape({}) === false)

// ── 注册表结构健全 ──
check("PROFILES 每项都有已注册方言", PROFILES.every(p => !!DIALECTS[p.dialect]), PROFILES.map(p => p.dialect))

// ── 插件元数据 meta（Magpie 插件注册 / Dashboard 标题显示名） ──
check("meta.id/name/description",
  meta && meta.id === "thinking-control" && meta.name === "Thinking Control" &&
  meta.description === "Normalize thinking/reasoning levels across OpenAI Responses, Chat Completions, Anthropic Messages, and Gemini APIs", meta)
check("meta 字段齐全且为字符串", meta && typeof meta.id === "string" && typeof meta.name === "string" && typeof meta.description === "string" && Object.keys(meta).length === 3, meta && Object.keys(meta))

// ── 本次修复新增：放行不改 body / 边界 / 方言语义 / catch 日志 ──

// 未登记模型放行时 body 原样未动（深比较）
const other = { model: "arkapi/kimi-k3", reasoning_effort: "low", temperature: 0.5, messages: [{ role: "user", content: "hi" }] }
const otherSnap = JSON.stringify(other)
r = onRequest(other, {})
check("未登记模型 -> body 深比较原样未动", r === undefined && JSON.stringify(other) === otherSnap, other)

// 数组 body 放行且数组内容不变
const arrBody = [{ model: Q, reasoning_effort: "none" }]
const arrSnap = JSON.stringify(arrBody)
r = onRequest(arrBody, {})
check("数组 body -> 放行且内容不变", r === undefined && JSON.stringify(arrBody) === arrSnap, arrBody)

// reasoning_effort 为 null 按未带处理（closeWhenAbsent=false -> 保持开）
r = onRequest({ model: Q, reasoning_effort: null }, {})
check("qwen effort=null -> 按未带处理(保持开)", et(r) === true && r.reasoning_effort === null, { et: et(r) })

// closeEffort 里的 off 档能关思考
r = onRequest({ model: Q, reasoning_effort: "off" }, {})
check("qwen effort=off -> 关思考且清掉effort", et(r) === false && r.reasoning_effort === undefined, { et: et(r), eff: r && r.reasoning_effort })

// closeWhenAbsent=true 的注册项：未带 effort 时关思考（临时注册，跑完 pop）
PROFILES.push({ dialect: "qwenChatTemplate", match: ["kimi-tmp-closeabsent"], closeEffort: ["none"], closeWhenAbsent: true })
try {
  r = onRequest({ model: "arkapi/kimi-tmp-closeabsent" }, {})
  check("closeWhenAbsent=true 未带effort -> 关思考", et(r) === false, { et: et(r) })
} finally {
  PROFILES.pop()
}
check("临时注册项已 pop 掉", PROFILES.every(p => p.match.indexOf("kimi-tmp-closeabsent") < 0))

// catch 分支：仍返回 undefined，且打了一条含 model 与错误摘要的 console.error
let caught
const origError = console.error
const errMsgs = []
console.error = function () { errMsgs.push(Array.prototype.join.call(arguments, " ")) }
try {
  const boom = { model: Q, get reasoning_effort() { throw new Error("boom-effort") } }
  caught = onRequest(boom, {})
} finally {
  console.error = origError
}
check("catch 分支 -> 仍返回 undefined", caught === undefined, caught)
check("catch 分支 -> console.error 恰好一次", errMsgs.length === 1, errMsgs)
check("catch 日志含 model 与错误摘要", errMsgs.length === 1 && errMsgs[0].indexOf("THINKMW error") === 0 &&
  errMsgs[0].indexOf(Q) >= 0 && errMsgs[0].indexOf("boom-effort") >= 0, errMsgs)

// thinkingDisabled 经 onRequest（临时注册）走关/开两条路径
PROFILES.push({ dialect: "thinkingDisabled", match: ["relay-tmp-td"], closeEffort: ["none"], closeWhenAbsent: false })
try {
  const M = "relay-tmp-td"
  r = onRequest({ model: M, reasoning_effort: "none" }, {})
  check("TD 经 onRequest 关 -> thinking.type=disabled 且清掉 effort",
    r && r.thinking && r.thinking.type === "disabled" && !("reasoning_effort" in r), r)

  r = onRequest({ model: M, reasoning_effort: "none", thinking: { budget_tokens: 4096 } }, {})
  check("TD 经 onRequest 关 -> 保留 thinking 其它字段",
    r && r.thinking.type === "disabled" && r.thinking.budget_tokens === 4096 && !("reasoning_effort" in r), r)

  const openBody = { model: M, reasoning_effort: "low", thinking: { budget_tokens: 4096 } }
  const openSnap = JSON.stringify(openBody)
  r = onRequest(openBody, {})
  check("TD 经 onRequest 开 -> 带其它字段的 thinking 不丢字段(原样放行)",
    r === undefined && JSON.stringify(openBody) === openSnap, openBody)

  r = onRequest({ model: M, reasoning_effort: "low" }, {})
  check("TD 经 onRequest 开 -> 无 thinking 无需改", r === undefined, r)
} finally {
  PROFILES.pop()
}
check("thinkingDisabled 临时注册项已 pop 掉", PROFILES.every(p => p.match.indexOf("relay-tmp-td") < 0))

// thinkingDisabled apply：已 disabled 时也清掉 effort（经 onRequest 走不到，escape 先拦）
b = { model: "x", thinking: { type: "disabled" }, reasoning_effort: "none" }
check("TD apply off 已disabled + 有effort -> 清掉 effort 返回 true",
  TD.apply(b, false) === true && !("reasoning_effort" in b) && b.thinking.type === "disabled", b)
b = { model: "x", thinking: { type: "disabled" } }
check("TD apply off 已disabled 且无effort -> 无需改", TD.apply(b, false) === false, b)
b = { model: "x", thinking: { budget_tokens: 4096 } }
check("TD apply off 非disabled -> 置type且保留其它字段",
  TD.apply(b, false) === true && b.thinking.type === "disabled" && b.thinking.budget_tokens === 4096, b)
b = { model: "x", thinking: { type: "disabled", budget_tokens: 4096 } }
check("TD apply on 带其它字段 -> 不动不丢字段",
  TD.apply(b, true) === false && b.thinking.type === "disabled" && b.thinking.budget_tokens === 4096, b)

// ── STRIP_PARAM_PROFILES：glm-5.3-flash / glm-5-3-flash 剥离不支持参数 ──
r = onRequest({ model: "arkapi/glm-5.3-flash", prompt_cache_key: "k1", prompt_cache_retention: "24h", temperature: 0.7 }, {})
check("glm-5.3-flash 剥离 prompt_cache_* 并返回 body",
  r !== undefined && !("prompt_cache_key" in r) && !("prompt_cache_retention" in r) && r.temperature === 0.7, r)

r = onRequest({ prompt_cache_key: "k2", prompt_cache_retention: "1h" }, { model: "group/glm-5-3-flash" })
check("group/glm-5-3-flash (ctx.model) 剥离 prompt_cache_* 并返回 body",
  r !== undefined && !("prompt_cache_key" in r) && !("prompt_cache_retention" in r), r)

r = onRequest({ model: "glm-5.3-flash", temperature: 0.7 }, {})
check("glm-5.3-flash 不含剥离字段 -> 返回 undefined", r === undefined, r)

const unregCache = { model: "arkapi/kimi-k3", prompt_cache_key: "k3", prompt_cache_retention: "24h" }
r = onRequest(unregCache, {})
check("未登记模型带 prompt_cache_* -> 原样放行返回 undefined",
  r === undefined && unregCache.prompt_cache_key === "k3" && unregCache.prompt_cache_retention === "24h", unregCache)

STRIP_PARAM_PROFILES.push({ match: ["qwen3.8-flash-next"], fields: ["prompt_cache_key"] })
try {
  r = onRequest({ model: Q, reasoning_effort: "none", prompt_cache_key: "k4" }, {})
  check("参数剥离与思考控制同时命中 -> 叠加修改并返回 body",
    r !== undefined && !("prompt_cache_key" in r) && et(r) === false && !("reasoning_effort" in r), r)
} finally {
  STRIP_PARAM_PROFILES.pop()
}

// ── SANITIZE_PROFILES & STRIP_PARAM_PROFILES：deepseek-v4-flash / v4.1-flash / flash 全量清洗 ──
check("SANITIZE_PROFILES 已导出且非空", Array.isArray(SANITIZE_PROFILES) && SANITIZE_PROFILES.length > 0)

const dsReq = {
  model: "group/deepseek-v4.1-flash",
  prompt_cache_key: "ds-cache-1",
  reasoning_effort: "high",
  messages: [
    { role: "developer", content: "sys-rule" },
    { role: "user", content: "hello" },
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "c1", type: "function", function: { name: "f1", arguments: "{}" } }],
      reasoning_details: [
        { type: "reasoning.text", text: "step1-" },
        { type: "reasoning.text", text: "step2" },
      ],
    },
    { role: "tool", tool_call_id: "c1", content: "ok" },
  ],
  tools: [
    { type: "function", function: { name: "f1", parameters: { type: "object", properties: { a: { type: "string" } } } } },
    { type: "function", function: { name: "f2", parameters: { type: "object", required: ["b"], properties: { b: { type: "string" } } } } },
  ],
}
r = onRequest(dsReq, {})
check("deepseek 全量清洗 -> 剥离顶层非标参数 + developer转system + reasoning_details转reasoning_content + null转空串 + 末尾tool追加user + 补tools.required",
  r !== undefined &&
  !("prompt_cache_key" in r) &&
  !("reasoning_effort" in r) &&
  r.messages.length === 5 &&
  r.messages[0].role === "system" &&
  r.messages[2].content === "" &&
  r.messages[2].reasoning_content === "step1-step2" &&
  !("reasoning_details" in r.messages[2]) &&
  r.messages[3].role === "tool" &&
  r.messages[4].role === "user" &&
  r.messages[4].content === "(tool results above)" &&
  Array.isArray(r.tools[0].function.parameters.required) &&
  r.tools[0].function.parameters.required.length === 0 &&
  r.tools[1].function.parameters.required.length === 1 &&
  r.tools[1].function.parameters.required[0] === "b",
  r)

// 已清洗合规的 deepseek 请求再次经过 onRequest -> 保持幂等返回 undefined
const r2 = onRequest(r, {})
check("deepseek 已合规请求幂等 -> 返回 undefined", r2 === undefined && r.messages.length === 5, r2)

// 空 reasoning_details 且无 reasoning_content / content: undefined -> 补空串并删 reasoning_details
const dsEmpty = {
  model: "deepseek-v4-flash",
  messages: [{ role: "assistant", reasoning_details: [] }],
}
r = onRequest(dsEmpty, {})
check("deepseek 空 reasoning_details + 无 content -> 均补空串并删 reasoning_details",
  r !== undefined &&
  r.messages[0].reasoning_content === "" &&
  r.messages[0].content === "" &&
  !("reasoning_details" in r.messages[0]),
  r)

// 未登记模型带 developer / reasoning_details / 缺 required -> 原样不动返回 undefined
const unregSan = {
  model: "arkapi/kimi-k3",
  messages: [
    { role: "developer", content: "sys" },
    { role: "assistant", content: null, reasoning_details: [{ type: "reasoning.text", text: "t" }] },
  ],
  tools: [{ type: "function", function: { name: "f1", parameters: { type: "object", properties: {} } } }],
}
const unregSanSnap = JSON.stringify(unregSan)
r = onRequest(unregSan, {})
check("未登记模型带非标结构 -> 原样放行返回 undefined",
  r === undefined && JSON.stringify(unregSan) === unregSanSnap, unregSan)

// ── 任意组名不锁死：onRequest 原样放行，onProvider 按真实供应商/模型精确处理 ──
const anyGroupSnapSrc = { model: "group/any-custom-group", prompt_cache_key: "pk-any-1", prompt_cache_retention: "24h", temperature: 0.6 }
const anyGroupSnap = JSON.stringify(anyGroupSnapSrc)
r = onRequest(anyGroupSnapSrc, { state: {} })
check("任意组名 onRequest -> 原样放行返回 undefined",
  r === undefined && JSON.stringify(anyGroupSnapSrc) === anyGroupSnap, anyGroupSnapSrc)

r = onProvider(anyGroupSnapSrc, {
  model: "group/any-custom-group",
  provider: { id: "gugugaga", name: "gugugaga", model: "glm-5.3-flash" },
  state: {},
})
check("任意组名 onProvider gugugaga/glm-5.3-flash -> 剥离 prompt_cache_* 并返回 body",
  r !== undefined && !("prompt_cache_key" in r) && !("prompt_cache_retention" in r) && r.temperature === 0.6 && r.model === "group/any-custom-group", r)

const dsGroup = {
  model: "group/any-custom-group",
  prompt_cache_key: "ds-cache-g",
  reasoning_effort: "high",
  messages: [
    { role: "developer", content: "sys-rule" },
    { role: "user", content: "hello" },
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "c1", type: "function", function: { name: "f1", arguments: "{}" } }],
      reasoning_details: [
        { type: "reasoning.text", text: "step1-" },
        { type: "reasoning.text", text: "step2" },
      ],
    },
  ],
  tools: [
    { type: "function", function: { name: "f1", parameters: { type: "object", properties: { a: { type: "string" } } } } },
  ],
}
r = onRequest(dsGroup, { state: {} })
check("任意组名 deepseek 形态 onRequest -> 原样放行",
  r === undefined && dsGroup.messages[0].role === "developer" && ("prompt_cache_key" in dsGroup) && ("reasoning_effort" in dsGroup), dsGroup)
r = onProvider(dsGroup, {
  model: "group/any-custom-group",
  provider: { id: "agentrouter", name: "AgentRouter-GitHub", model: "deepseek-v4-flash" },
  state: {},
})
check("任意组名 onProvider agentrouter/deepseek-v4-flash -> 剥离顶层参数并清洗消息/Schema",
  r !== undefined &&
  !("prompt_cache_key" in r) &&
  !("reasoning_effort" in r) &&
  r.messages[0].role === "system" &&
  r.messages[2].content === "" &&
  r.messages[2].reasoning_content === "step1-step2" &&
  !("reasoning_details" in r.messages[2]) &&
  Array.isArray(r.tools[0].function.parameters.required) &&
  r.tools[0].function.parameters.required.length === 0,
  r)

const qwenGroup = { model: "group/any-custom-group", reasoning_effort: "none" }
r = onRequest(qwenGroup, { state: {} })
check("任意组名 qwen 形态 onRequest -> 原样放行并记下 effort",
  r === undefined && qwenGroup.reasoning_effort === "none", qwenGroup)
r = onProvider(qwenGroup, {
  model: "group/any-custom-group",
  provider: { id: "arkapi", name: "arkapi", model: "qwen3.8-flash-next" },
  state: {},
})
check("任意组名 onProvider arkapi/qwen3.8-flash-next -> qwenChatTemplate 关思考",
  r !== undefined && et(r) === false && !("reasoning_effort" in r) && r.model === "group/any-custom-group", r)

const direct = { model: Q, reasoning_effort: "none" }
const directCtx = { state: {} }
r = onRequest(direct, directCtx)
check("直连 qwen onRequest -> 翻译思考开关",
  r !== undefined && et(r) === false && !("reasoning_effort" in r), r)
const afterDirect = onProvider(direct, Object.assign({ provider: { id: "arkapi", name: "arkapi", model: "qwen3.8-flash-next" } }, directCtx))
check("直连模型 onRequest 后再经 onProvider -> 幂等返回 undefined",
  afterDirect === undefined && et(direct) === false && !("reasoning_effort" in direct), direct)

const directGlm = { model: "gugugaga/glm-5.3-flash", prompt_cache_key: "g1", prompt_cache_retention: "24h" }
r = onRequest(directGlm, { state: {} })
check("直连 glm onRequest -> 剥离 prompt_cache_*", r !== undefined && !("prompt_cache_key" in r) && !("prompt_cache_retention" in r), r)
const afterGlm = onProvider(directGlm, { model: "gugugaga/glm-5.3-flash", provider: { id: "gugugaga", model: "glm-5.3-flash" }, state: {} })
check("直连 glm onRequest 后再经 onProvider -> 幂等返回 undefined", afterGlm === undefined, directGlm)

// ── STRIP_PARAM_PROFILES：glm-5.3 / glm-5-3 非 flash 档仅剥离 prompt_cache_retention ──
const glm53Direct = { model: "arkapi/glm-5.3", prompt_cache_key: "k-53", prompt_cache_retention: "24h", reasoning_effort: "high" }
r = onRequest(glm53Direct, { state: {} })
check("arkapi/glm-5.3 onRequest -> 剥离 prompt_cache_retention 并保留 prompt_cache_key", r !== undefined && !("prompt_cache_retention" in r) && r.prompt_cache_key === "k-53" && r.reasoning_effort === "high", r)
check("arkapi/glm-5.3 已清洗请求二次经 onRequest -> 幂等返回 undefined", onRequest(glm53Direct, { state: {} }) === undefined && !("prompt_cache_retention" in glm53Direct), glm53Direct)
check("arkapi/glm-5.3 已清洗请求再经 onProvider -> 幂等返回 undefined", onProvider(glm53Direct, { model: "arkapi/glm-5.3", provider: { id: "arkapi", model: "glm-5.3" }, state: {} }) === undefined && !("prompt_cache_retention" in glm53Direct), glm53Direct)
const glm53Dash = { model: "arkapi/glm-5-3", prompt_cache_key: "k-5-3", prompt_cache_retention: "24h" }
check("arkapi/glm-5-3 连字符模型名 -> 同样剥离 prompt_cache_retention 并保留 prompt_cache_key", onRequest(glm53Dash, {}) !== undefined && !("prompt_cache_retention" in glm53Dash) && glm53Dash.prompt_cache_key === "k-5-3", glm53Dash)
const glm53Group = { model: "group/glm-5.3", prompt_cache_key: "k-grp", prompt_cache_retention: "24h" }
check("group/glm-5.3 经 onRequest -> 剥离 prompt_cache_retention 并保留 prompt_cache_key", onRequest(glm53Group, { state: {} }) !== undefined && !("prompt_cache_retention" in glm53Group) && glm53Group.prompt_cache_key === "k-grp", glm53Group)
check("group/glm-5.3 经 onRequest 后再经 onProvider -> 幂等返回 undefined", onProvider(glm53Group, { model: "group/glm-5.3", provider: { id: "arkapi", model: "glm-5.3" }, state: {} }) === undefined && !("prompt_cache_retention" in glm53Group), glm53Group)
const glm53AnyGrp = { model: "group/any-custom-group", prompt_cache_key: "k-any53", prompt_cache_retention: "24h" }
check("任意组名经 onRequest 放行后由 onProvider(arkapi/glm-5.3) 剥离 prompt_cache_retention 且二次幂等", onRequest(glm53AnyGrp, { state: {} }) === undefined && onProvider(glm53AnyGrp, { model: "group/any-custom-group", provider: { id: "arkapi", model: "glm-5.3" }, state: {} }) !== undefined && !("prompt_cache_retention" in glm53AnyGrp) && glm53AnyGrp.prompt_cache_key === "k-any53" && onProvider(glm53AnyGrp, { model: "group/any-custom-group", provider: { id: "arkapi", model: "glm-5.3" }, state: {} }) === undefined, glm53AnyGrp)
const glm53FlashReg = { model: "arkapi/glm-5.3-flash", prompt_cache_key: "k-fl", prompt_cache_retention: "24h" }
check("glm-5.3-flash 不回归 -> 仍同时剥离 prompt_cache_key 与 prompt_cache_retention 且二次幂等", onRequest(glm53FlashReg, {}) !== undefined && !("prompt_cache_key" in glm53FlashReg) && !("prompt_cache_retention" in glm53FlashReg) && onRequest(glm53FlashReg, {}) === undefined, glm53FlashReg)

STRIP_PARAM_PROFILES.push({ match: ["glm-5.3-flash"], providers: ["gugugaga"], fields: ["temperature"] })
try {
  const otherVendor = { model: "group/any-custom-group", temperature: 0.4, prompt_cache_key: "pk-scope" }
  const otherR = onProvider(otherVendor, {
    model: "group/any-custom-group",
    provider: { id: "other-vendor", name: "other-vendor", model: "glm-5.3-flash" },
    state: {},
  })
  const gugugaga = { model: "group/any-custom-group", temperature: 0.4, prompt_cache_key: "pk-scope" }
  const guguR = onProvider(gugugaga, {
    model: "group/any-custom-group",
    provider: { id: "gugugaga", name: "gugugaga", model: "glm-5.3-flash" },
    state: {},
  })
  check("providers: [\"gugugaga\"] 只命中该供应商：剥离 temperature，其它供应商只剥未限定的 prompt_cache_*",
    otherR !== undefined && !("prompt_cache_key" in otherR) && otherR.temperature === 0.4 &&
    guguR !== undefined && !("prompt_cache_key" in guguR) && !("temperature" in guguR) &&
    otherR.model === "group/any-custom-group" && guguR.model === "group/any-custom-group",
    { otherR, guguR })
} finally {
  STRIP_PARAM_PROFILES.pop()
}

// ── tailToolResultAppendUser：末条 role=tool 追加 user 及幂等/边界验证 ──
const dsTailDirect = { model: "agentrouter/deepseek-v4-flash", messages: [{ role: "user", content: "q" }, { role: "tool", tool_call_id: "c1", content: "res" }] }
const tailLogs = [], origLog = console.log
console.log = function () { tailLogs.push(Array.prototype.join.call(arguments, " ")); origLog.apply(console, arguments) }
try { r = onRequest(dsTailDirect, { state: {} }) } finally { console.log = origLog }
const afterTailDirect = onProvider(dsTailDirect, { model: "agentrouter/deepseek-v4-flash", provider: { id: "agentrouter", name: "AgentRouter-GitHub", model: "deepseek-v4-flash" }, state: {} })
check("直连 deepseek-v4-flash 末条 role=tool -> 追加 user + 日志含 tail_tool_append_user + 二次调用幂等返回 undefined",
  r !== undefined && r.messages.length === 3 && r.messages[2].role === "user" && r.messages[2].content === "(tool results above)" &&
  tailLogs.some(l => l.indexOf("tail_tool_append_user") >= 0) && afterTailDirect === undefined && dsTailDirect.messages.length === 3, { r, afterTailDirect, tailLogs })

const dsTailGroup = { model: "group/smartass", messages: [{ role: "user", content: "q" }, { role: "tool", tool_call_id: "c2", content: "res2" }] }
const arCtx = { model: "group/smartass", provider: { id: "agentrouter", name: "AgentRouter-GitHub", model: "deepseek-v4-flash" }, state: {} }
const reqTailG = onRequest(dsTailGroup, arCtx), provTailG = onProvider(dsTailGroup, arCtx), provTailG2 = onProvider(dsTailGroup, arCtx)
check("分组路由 onProvider agentrouter/deepseek-v4-flash 末条 role=tool -> 追加 user 且二次调用幂等返回 undefined",
  reqTailG === undefined && provTailG !== undefined && provTailG.messages.length === 3 &&
  provTailG.messages[2].role === "user" && provTailG.messages[2].content === "(tool results above)" && provTailG2 === undefined, { reqTailG, provTailG, provTailG2 })

const dsTailUser = { model: "deepseek-v4-flash", messages: [{ role: "tool", tool_call_id: "c1", content: "ok" }, { role: "user", content: "done" }] }
const dsTailAsst = { model: "deepseek-v4-flash", messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "ans" }] }
check("deepseek-v4-flash 末条已是 user 或 assistant -> 不追加返回 undefined",
  onRequest(dsTailUser, {}) === undefined && dsTailUser.messages.length === 2 && onRequest(dsTailAsst, {}) === undefined && dsTailAsst.messages.length === 2)

const gptTailTool = { model: "gpt-4o", messages: [{ role: "user", content: "hi" }, { role: "tool", tool_call_id: "c1", content: "ok" }] }
check("未命中模型 (gpt-4o) 末条为 role=tool -> 原样放行返回 undefined",
  onRequest(gptTailTool, {}) === undefined && gptTailTool.messages.length === 2 && gptTailTool.messages[1].role === "tool")

// ── ctx.options 动态支持：log / extraProfiles / extraStripParams / extraSanitizeModels ──

// log:false 静默常规 info 日志（行为本身不变）
const optQuietLogs = [], origQL = console.log
console.log = function () { optQuietLogs.push(Array.prototype.join.call(arguments, " ")) }
try {
  r = onRequest({ model: Q, reasoning_effort: "none" }, { options: { log: false } })
} finally { console.log = origQL }
check("options.log=false -> 静默 THINKMW 常规日志且行为不变", et(r) === false && r.reasoning_effort === undefined && optQuietLogs.length === 0, { r, optQuietLogs })

// extraProfiles：追加在 PROFILES 之后参与方言匹配
const extraProfBody = { model: "vendor/custom-thinker-9", reasoning_effort: "none" }
r = onRequest(extraProfBody, { options: { extraProfiles: [{ dialect: "qwenChatTemplate", match: ["custom-thinker-9"], closeEffort: ["none"], closeWhenAbsent: false }] } })
check("options.extraProfiles -> 追加方言匹配并关思考", et(r) === false && r.reasoning_effort === undefined, { r })
r = onRequest({ model: "vendor/custom-thinker-9", reasoning_effort: "none" }, {})
check("未传 options 时同模型不受 extraProfiles 影响 -> 原样放行", r === undefined, r)

// extraStripParams：追加在 STRIP_PARAM_PROFILES 之后参与字段剥离
const extraStripBody = { model: "vendor/custom-strip-7", custom_flag: true, keep_me: 1 }
r = onRequest(extraStripBody, { options: { extraStripParams: [{ match: ["custom-strip-7"], fields: ["custom_flag"] }] } })
check("options.extraStripParams -> 追加剥离自定义字段", r !== undefined && !("custom_flag" in r) && r.keep_me === 1, { r })
r = onRequest({ model: "vendor/custom-strip-7", custom_flag: true }, {})
check("未传 options 时同模型不受 extraStripParams 影响 -> 原样放行", r === undefined, r)

// extraSanitizeModels：其模型子串追加进 SANITIZE_PROFILES 匹配列表
const extraSanBody = { model: "vendor/custom-san-3", messages: [{ role: "developer", content: "sys" }, { role: "assistant", content: null }] }
r = onRequest(extraSanBody, { options: { extraSanitizeModels: ["custom-san-3"] } })
check("options.extraSanitizeModels -> 追加清洗匹配并规范化消息",
  r !== undefined && r.messages[0].role === "system" && r.messages[1].content === "", { r })
r = onRequest({ model: "vendor/custom-san-3", messages: [{ role: "developer", content: "sys" }] }, {})
check("未传 options 时同模型不受 extraSanitizeModels 影响 -> 原样放行", r === undefined, r)

console.log("\n" + pass + " passed, " + fail + " failed")
if (fail) process.exit(1)
