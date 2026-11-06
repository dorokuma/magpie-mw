import { meta, onProvider } from "./agentrouter-itemstrip.middleware.js"

let pass = 0, fail = 0
function check(name, cond, info) {
  if (cond) { pass++; console.log("PASS", name) }
  else { fail++; console.log("FAIL", name, info === undefined ? "" : "-> " + JSON.stringify(info)) }
}

const AR = { provider: { id: "agentrouter", name: "AgentRouter-GitHub", model: "gpt-6.1-sol" } }
let r

// ── meta 元数据 ──
check("meta.id/name/description",
  meta && meta.id === "agentrouter-itemstrip" && meta.name === "AgentRouter Item Strip" &&
  meta.description === "Strip input item IDs and reasoning items for stateless AgentRouter upstream requests", meta)

// ── 非目标 provider / 非 /v1/responses 放行 ──
const otherProv = { input: [{ type: "function_call", id: "fc_1", call_id: "c1", name: "f", arguments: "{}" }] }
r = onProvider(otherProv, { provider: { id: "openai", name: "openai", model: "gpt-6.1-sol" } })
check("非目标 provider -> 原样放行", r === undefined && otherProv.input[0].id === "fc_1", r)

const chatBody = { messages: [{ role: "user", content: "hi" }] }
r = onProvider(chatBody, AR)
check("非 /v1/responses（messages 形态）-> 原样放行", r === undefined && chatBody.messages.length === 1, r)

const otherModel = { input: [{ type: "function_call", id: "fc_1", call_id: "c1", name: "f", arguments: "{}" }] }
r = onProvider(otherModel, { provider: { id: "agentrouter", name: "x", model: "gpt-6.1-pro" } })
check("provider 命中但 model 不匹配 -> 原样放行", r === undefined && otherModel.input[0].id === "fc_1", r)

// ── 子串伪造 provider 不得命中（精确查表，非 includes）──
const fakeProv = { input: [{ type: "function_call", id: "fc_1", call_id: "c1", name: "f", arguments: "{}" }] }
r = onProvider(fakeProv, { provider: { id: "my-agentrouter-test", name: "x", model: "gpt-6.1-sol" } })
check("子串伪造 provider (my-agentrouter-test) -> 不触发", r === undefined && fakeProv.input[0].id === "fc_1", r)

// ── 第二目标 provider agentrouter-linuxdo 精确命中 ──
const lnxBody = { input: [{ type: "message", id: "m1", role: "user", content: [{ type: "input_text", text: "q" }] }] }
r = onProvider(lnxBody, { provider: { id: "agentrouter-linuxdo", name: "x", model: "gpt-6.1-sol" } })
check("agentrouter-linuxdo 精确命中 -> 剥 id", r !== undefined && r.input[0].id === undefined, r)

// ── 目标 provider+model：剥离 5 类 id 并丢弃 reasoning ──
const idBody = { input: [
  { type: "function_call", id: "fc_1", call_id: "c1", name: "read", arguments: "{}" },
  { type: "custom_tool_call", id: "ct_1", call_id: "c2", name: "t", input: "{}" },
  { type: "function_call_output", id: "fo_1", call_id: "c1", output: "ok" },
  { type: "custom_tool_call_output", id: "co_1", call_id: "c2", output: "ok2" },
  { type: "message", id: "msg_1", role: "assistant", content: [{ type: "output_text", text: "hi" }] },
  { type: "reasoning", id: "rs_1", encrypted_content: "blob" },
  { type: "compaction", id: "cp_1", content: "keep-me" },
] }
r = onProvider(idBody, AR)
check("目标命中 -> 5 类 id 剥离 + reasoning 整条丢 + compaction 等非目标类型原样",
  r !== undefined && r.input.length === 6 &&
  r.input.slice(0, 5).every(i => i.id === undefined) &&
  r.input[0].call_id === "c1" && r.input[2].output === "ok" &&
  r.input[4].role === "assistant" &&
  r.input[5].type === "compaction" && r.input[5].id === "cp_1" && r.input[5].content === "keep-me" &&
  !r.input.some(i => i.type === "reasoning"), r)

// ── 历史指针整体放行 ──
const ptrPrev = { previous_response_id: "resp_1", input: [{ type: "function_call", id: "fc_1", call_id: "c1", name: "f", arguments: "{}" }] }
r = onProvider(ptrPrev, AR)
check("带 previous_response_id -> 整体放行", r === undefined && ptrPrev.input[0].id === "fc_1", r)

const ptrConv = { conversation: "conv_1", input: [{ type: "function_call", id: "fc_1", call_id: "c1", name: "f", arguments: "{}" }] }
r = onProvider(ptrConv, AR)
check("带 conversation -> 整体放行", r === undefined && ptrConv.input[0].id === "fc_1", r)

const ptrRef = { input: [
  { type: "item_reference", id: "fc_ref" },
  { type: "function_call", id: "fc_1", call_id: "c1", name: "f", arguments: "{}" },
] }
r = onProvider(ptrRef, AR)
check("input 含 item_reference -> 整体放行（严禁剥离）", r === undefined && ptrRef.input[0].id === "fc_ref" && ptrRef.input[1].id === "fc_1", r)

// ── 无改动返回 undefined ──
const cleanBody = { input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "q" }] }] }
r = onProvider(cleanBody, AR)
check("无可改内容 -> 返回 undefined（幂等）", r === undefined, r)

// ── ctx.options.providers 覆盖：自定义列表精确生效、默认被替换 ──
const customProv = { input: [{ type: "message", id: "m1", role: "user", content: [{ type: "input_text", text: "q" }] }] }
r = onProvider(customProv, { provider: { id: "myrelay", name: "myrelay", model: "gpt-6.1-sol" }, options: { providers: ["myrelay"] } })
check("options.providers 自定义 -> 精确命中自定义供应商并剥 id", r !== undefined && r.input[0].id === undefined, r)

const overridden = { input: [{ type: "message", id: "m1", role: "user", content: [{ type: "input_text", text: "q" }] }] }
r = onProvider(overridden, { provider: { id: "agentrouter", name: "x", model: "gpt-6.1-sol" }, options: { providers: ["myrelay"] } })
check("options.providers 覆盖后默认 agentrouter 不再命中", r === undefined && overridden.input[0].id === "m1", r)

const fakeOverride = { input: [{ type: "message", id: "m1", role: "user", content: [{ type: "input_text", text: "q" }] }] }
r = onProvider(fakeOverride, { provider: { id: "my-myrelay-x", name: "x", model: "gpt-6.1-sol" }, options: { providers: ["myrelay"] } })
check("options.providers 仍为精确匹配 -> 子串伪造不触发", r === undefined && fakeOverride.input[0].id === "m1", r)

// ── ctx.options.models 覆盖 ──
const mOverride = { input: [{ type: "message", id: "m1", role: "user", content: [{ type: "input_text", text: "q" }] }] }
r = onProvider(mOverride, { provider: { id: "agentrouter", name: "x", model: "gpt-7-x" }, options: { models: ["gpt-7-x"] } })
check("options.models 覆盖 -> 自定义模型精确命中剥 id", r !== undefined && r.input[0].id === undefined, r)
const mDefaultGone = { input: [{ type: "message", id: "m1", role: "user", content: [{ type: "input_text", text: "q" }] }] }
r = onProvider(mDefaultGone, { provider: { id: "agentrouter", name: "x", model: "gpt-6.1-sol" }, options: { models: ["gpt-7-x"] } })
check("options.models 覆盖后默认模型不再命中", r === undefined && mDefaultGone.input[0].id === "m1", r)

// ── ctx.options.dropTypes 覆盖 ──
const dOverride = { input: [
  { type: "compaction", id: "cp_1", content: "c" },
  { type: "reasoning", id: "rs_1" },
  { type: "message", id: "m1", role: "user", content: [] },
] }
r = onProvider(dOverride, { ...AR, options: { dropTypes: ["compaction"] } })
check("options.dropTypes 覆盖 -> 丢 compaction 保留 reasoning（仍剥 id）",
  r !== undefined && r.input.length === 2 && r.input[0].type === "reasoning" && r.input[0].id === undefined &&
  r.input[1].type === "message" && r.input[1].id === undefined, r)

// ── 归一化：大小写/空白不影响精确匹配 ──
const normBody = { input: [{ type: "message", id: "m1", role: "user", content: [] }] }
r = onProvider(normBody, { provider: { id: "  AgentRouter ", name: "x", model: "gpt-6.1-sol" } })
check("provider id 大小写/空白归一化后精确命中", r !== undefined && r.input[0].id === undefined, r)

// ── call_id 归一化：超长 ID 确定性改写（≤40），call 与 output 配对一致 ──
const LONG_ID = "call_" + "x".repeat(61) // 65 字符，复现上游 input[].call_id 超限 400
const normAr = { input: [
  { type: "function_call", call_id: LONG_ID, name: "read", arguments: "{}" },
  { type: "function_call_output", call_id: LONG_ID, output: "ok" },
] }
r = onProvider(normAr, { provider: { id: "agentrouter", name: "x", model: "gpt-6.1-sol" } })
check("超长 call_id（65 字符）-> 归一化到 ≤40 且配对一致",
  r !== undefined &&
  r.input[0].call_id.length <= 40 && r.input[1].call_id.length <= 40 &&
  r.input[0].call_id === r.input[1].call_id &&
  r.input[0].call_id !== LONG_ID &&
  r.input[0].call_id.slice(0, 24) === LONG_ID.slice(0, 24) &&
  r.input[0].call_id.charAt(24) === "_", r)

// ── 确定性：同一原值两次映射得同一新值（跨请求也一致）──
const normAgain = { input: [
  { type: "function_call", call_id: LONG_ID, name: "read", arguments: "{}" },
] }
r = onProvider(normAgain, { provider: { id: "agentrouter", name: "x", model: "gpt-6.1-sol" } })
check("同一原 ID 再次进来 -> 映射结果与首次相同（确定性）",
  r !== undefined && r.input[0].call_id === normAr.input[0].call_id, r)

// ── ≤40 的 call_id 不动，无其它改动返回 undefined ──
const SHORT_ID = "call_" + "y".repeat(20) // 25 字符
const shortBody = { input: [
  { type: "function_call", call_id: SHORT_ID, name: "read", arguments: "{}" },
  { type: "function_call_output", call_id: SHORT_ID, output: "ok" },
] }
r = onProvider(shortBody, AR)
check("call_id ≤40 -> 原样不动，返回 undefined（幂等）",
  r === undefined && shortBody.input[0].call_id === SHORT_ID && shortBody.input[1].call_id === SHORT_ID, r)

// ── 归一化只限 4 类工具项类型：message 项的 call_id 不在规范范围内不动 ──
const msgCallId = { input: [
  { type: "message", call_id: LONG_ID, role: "assistant", content: [] },
] }
r = onProvider(msgCallId, AR)
check("非 4 类工具项类型上的超长 call_id -> 不动",
  r === undefined && msgCallId.input[0].call_id === LONG_ID, r)

// ── messages 形态：tool_calls[].id 与 tool 消息 tool_call_id 同样归一化 ──
const MSG_ID = "toolu_" + "z".repeat(60) // 66 字符
const chatClamp = { messages: [
  { role: "assistant", content: null, tool_calls: [
    { id: MSG_ID, type: "function", function: { name: "read", arguments: "{}" } },
  ] },
  { role: "tool", tool_call_id: MSG_ID, content: "ok" },
] }
r = onProvider(chatClamp, { provider: { id: "agentrouter-github", name: "x", model: "gpt-6-astra" } })
check("messages 形态（agentrouter-github）-> tool_calls.id 与 tool_call_id 归一化且配对一致",
  r !== undefined &&
  r.messages[0].tool_calls[0].id.length <= 40 &&
  r.messages[1].tool_call_id.length <= 40 &&
  r.messages[0].tool_calls[0].id === r.messages[1].tool_call_id &&
  r.messages[0].tool_calls[0].id !== MSG_ID, r)

// ── agentrouter-github + input 形态：命中归一化但不命中剥离模型时仍只归一化 ──
const ghInput = { input: [
  { type: "function_call", id: "fc_1", call_id: LONG_ID, name: "read", arguments: "{}" },
] }
r = onProvider(ghInput, { provider: { id: "agentrouter-github", name: "x", model: "gpt-6-astra" } })
check("agentrouter-github + 非 gpt-6.1-sol -> 归一化 call_id、item.id 保留（剥离仍限模型）",
  r !== undefined && r.input[0].call_id.length <= 40 && r.input[0].id === "fc_1", r)

// ── 非目标 provider：超长 call_id 也不动 ──
const otherClamp = { input: [
  { type: "function_call", call_id: LONG_ID, name: "read", arguments: "{}" },
] }
r = onProvider(otherClamp, { provider: { id: "openai", name: "x", model: "gpt-6.1-sol" } })
check("非目标 provider -> 超长 call_id 不动，返回 undefined",
  r === undefined && otherClamp.input[0].call_id === LONG_ID, r)

// ── 带历史指针仍归一化（归一化先于 pointer 放行），但 item.id 不剥 ──
const ptrClamp = { previous_response_id: "resp_1", input: [
  { type: "function_call", id: "fc_1", call_id: LONG_ID, name: "read", arguments: "{}" },
] }
r = onProvider(ptrClamp, AR)
check("带 previous_response_id + 超长 call_id -> 归一化执行、item.id 保留",
  r !== undefined && r.input[0].call_id.length <= 40 && r.input[0].id === "fc_1", r)

// ── 幂等：归一化后的 body 再次进入不再有改动 ──
r = onProvider(normAr, { provider: { id: "agentrouter", name: "x", model: "gpt-6.1-sol" } })
check("归一化后再次进入 -> 返回 undefined（幂等）", r === undefined, r)

// ── options.clampModels：限定归一化模型范围 ──
const cmHit = { input: [
  { type: "function_call", call_id: LONG_ID, name: "f", arguments: "{}" },
] }
r = onProvider(cmHit, { provider: { id: "agentrouter-github", name: "x", model: "gpt-6-astra" }, options: { clampModels: ["gpt-6-astra"] } })
check("options.clampModels 命中 -> 归一化生效", r !== undefined && r.input[0].call_id.length <= 40, r)
const cmMiss = { input: [
  { type: "function_call", call_id: LONG_ID, name: "f", arguments: "{}" },
] }
r = onProvider(cmMiss, { provider: { id: "agentrouter-github", name: "x", model: "gpt-6-astra" }, options: { clampModels: ["gpt-7-x"] } })
check("options.clampModels 未命中 -> 不归一化", r === undefined && cmMiss.input[0].call_id === LONG_ID, r)

// ── options.callIdMax：覆盖默认 40 阈值 ──
const cmx = { input: [
  { type: "function_call", call_id: SHORT_ID, name: "f", arguments: "{}" },
] }
r = onProvider(cmx, { provider: { id: "agentrouter", name: "x", model: "gpt-6.1-sol" }, options: { callIdMax: 20 } })
check("options.callIdMax=20 -> 25 字符 ID 被压到 ≤20",
  r !== undefined && r.input[0].call_id.length <= 20 && r.input[0].call_id !== SHORT_ID, r)

console.log("\n" + pass + " passed, " + fail + " failed")
if (fail) process.exit(1)
