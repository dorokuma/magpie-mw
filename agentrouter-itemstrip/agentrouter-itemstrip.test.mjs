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

console.log("\n" + pass + " passed, " + fail + " failed")
if (fail) process.exit(1)
