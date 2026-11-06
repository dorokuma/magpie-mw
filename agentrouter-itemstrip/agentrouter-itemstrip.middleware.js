// agentrouter-itemstrip.middleware.js — AgentRouter 上 gpt-6.1-sol 回放 inline 历史时剥掉 item.id
//
// 现象（实测见 /root/workspace/ar-400-fix-evidence.md）：向 agentrouter / agentrouter-linuxdo
// 的 gpt-6.1-sol 重放上一次响应里的 inline 历史项（function_call / message / reasoning）时，
// 只要那些项还带着上游发的 item.id（fc_*、msg_*），上游有较高概率回 400
// （“The requested item was created under a different account …” / invalid request），
// 只删掉 item.id、保留 call_id/arguments/output/内容时同样负载稳定 200。
//
// 安全边界（宁可不改，也不误改）：
//   * 只挂 onProvider：路由定了真实渠道之后才动手，绝不在 onRequest 阶段猜渠道。
//   * 只认精确 provider id（agentrouter / agentrouter-linuxdo / agentrouter-github），
//     不做子串匹配，也不拿 body.model 猜（那还是分组名）。provider/model/dropTypes 的
//     可覆盖数组从 ctx.options.providers / models / dropTypes 读，归一化
//     trim().toLowerCase() 后精确查表，绝不退化成子串命中（防 my-agentrouter-test 这类伪造）。
//   * call_id 归一化只门控 provider（不限底层模型，clampModels 可选限制）：实测上游对
//     input[].call_id 有 64 字符硬上限，跨 provider 回放历史会带来 65 字符 call_id 直接 400。
//     长度 >40（或 ctx.options.callIdMax 正整数覆盖）的 ID 改写为确定性短值
//     slice(0,24)+"_"+fnv1a64hex.slice(0,15)，同原值恒得同新值，call 与 output 配对不断；
//     覆盖 body.input 的 call_id 与 body.messages 的 tool_calls[].id / tool_call_id 两形态，
//     但只对无历史指针的完整内联请求执行——带指针的请求其配对在服务端，单边改写会断。
//   * item.id 剥离与 reasoning 丢弃额外门控精确底层模型 gpt-6.1-sol（models 可覆盖）。
//   * 所有查表都用无原型对象（Object.create(null)）+ hasOwnProperty 显式判定：
//     item.type 是上游可控字符串，普通对象字面量查表会继承
//     constructor / toString / valueOf / __proto__ 等原型键，
//     会把未知类型误判成“要整条丢”或“要删 id”的类型（审查 M1/C1）。
//   * item.id 剥离与 reasoning 丢弃只处理 Array 形 body.input（Responses 协议）；chat 的
//     messages 仅参与无指针时的 call_id 归一化，其余字段原样不动。
//   * 有历史指针的请求整个放行（连 call_id 归一化也跳过）：previous_response_id 非空、
//     任一 item_reference、conversation 指针 —— 这些指向服务端已存资源，这里没有可展开的
//     完整内联历史，配对的 call 侧也在服务端，单边 clamp 会断配对；悄悄删指针更会
//     "丢历史换 200"，所以原样放行只记一条边界日志。
//   * 无实际改动返回 undefined（幂等：第二次进来没有 id 可删，就什么都不做）。
//   * 日志只有固定前缀 + provider/model + 字段类型计数，绝不打正文/ID/密文/secret。
//
// reasoning 项的处理与代价：整条丢弃（不留空壳、不动密文）。这是为“无状态回放”取稳：
// 上游对带 id 的 reasoning 项同样会 400。代价是模型看不到上一轮的思考轨迹，
// 可能轻微影响连续性并让模型重做一部分推理（多花 reasoning token）。
// 注意：实测里“删掉 reasoning 的 id、保留 encrypted_content”也能 200，
// 所以 encrypted_content 本身并不是已证实的必要删除项，这里整条丢是保守选择而非已证实根因。

export const meta = {
  id: "agentrouter-itemstrip",
  name: "AgentRouter Item Strip",
  description: "Strip input item IDs and reasoning items for stateless AgentRouter upstream requests",
}

// 无原型表：普通对象字面量会继承 Object.prototype 的 constructor/toString/valueOf/__proto__ 等键，
// 用 [key] 直接查这些名字会得到真值，把上游可控的 item.type 误判成要处理类型。
function arTable(pairs) {
  var t = Object.create(null)
  for (var i = 0; i < pairs.length; i++) t[pairs[i]] = true
  return t
}

// 显式判定：只认自有键，命中不了任何原型键（双保险，配合 Object.create(null)）。
function arHas(tbl, key) {
  return Object.prototype.hasOwnProperty.call(tbl, key) === true
}

var AR_PROVIDERS = arTable(["agentrouter", "agentrouter-linuxdo", "agentrouter-github"])
var AR_MODEL = "gpt-6.1-sol"

// 只删 item.id 的 inline 历史项类型。其它类型（含未知类型）一律不动。
// reasoning 也在剥 id 表内：默认它在 AR_DROP_TYPES、drop 判定在前会先整条丢，
// 默认路径行为不变；仅当 ctx.options.dropTypes 覆盖掉默认、reasoning 得以保留时，
// 仍需要剥掉上游 item id（上游 item id 正是 400 根因）。
var AR_ID_TYPES = arTable([
  "function_call",
  "custom_tool_call",
  "function_call_output",
  "custom_tool_call_output",
  "message",
  "reasoning",
])

// call_id 归一化默认阈值：上游 input[].call_id 硬上限实测 64，留余量压到 ≤40。
var AR_CALLID_MAX = 40
var AR_CALLID_KEEP = 24
var AR_CALLID_HASH = 15

// 纯 ES 确定性哈希：FNV-1a 64 位（对 UTF-16 code unit 逐个 xor+乘 prime），
// 不用 BigInt、不依赖任何 Node 内置模块，moejs 沙盒可直接加载。
// 状态用 hi/lo 两个 32 位肢表示，所有中间乘积 < 2^53 安全整数，输出稳定 16 位小写 hex。
// offset basis = 0xcbf29ce484222325，prime = 0x100000001b3 = 0x1b3 + 0x100*2^32。
function arHashHex(s) {
  var lo = 0x84222325
  var hi = 0xcbf29ce4
  for (var i = 0; i < s.length; i++) {
    lo = (lo ^ s.charCodeAt(i)) >>> 0
    // (hi*2^32 + lo) * prime mod 2^64：
    //   lo' = lo*0x1b3 (mod 2^32)；hi' = hi*0x1b3 + lo*0x100 + floor(lo*0x1b3 / 2^32) (mod 2^32)
    var a = lo
    var nlo = a * 0x1b3
    hi = (hi * 0x1b3 + a * 0x100 + Math.floor(nlo / 4294967296)) % 4294967296
    lo = nlo % 4294967296
  }
  var loHex = ("0000000" + lo.toString(16)).slice(-8)
  var hiHex = ("0000000" + hi.toString(16)).slice(-8)
  return hiHex + loHex
}

// 确定性改写：同原值恒得同新值（fnv1a-64 前 15 hex + 原值前缀），保证 call 与
// output 配对不断、跨请求一致；默认（maxLen=40）即任务规定的
// 原值.slice(0,24) + "_" + fnv1a64hex(原值).slice(0,15)，总长 40。
// callIdMax < 40 时按比例收缩前缀与哈希段（≥3 保证分隔符空间；≤2 直接截哈希），
// 确保改写结果不长于 maxLen——否则改写后仍超阈值，下一轮会再次命中（幂等被破坏）。
function clampId(s, maxLen) {
  if (typeof s !== "string" || s.length <= maxLen) return null
  var hex = arHashHex(s)
  var keep = AR_CALLID_KEEP
  var hlen = AR_CALLID_HASH
  if (maxLen <= 2) return hex.slice(0, maxLen)
  if (keep + 1 + hlen > maxLen) {
    var total = maxLen - 1
    keep = Math.max(1, Math.floor(total / 2))
    hlen = total - keep
  }
  return s.slice(0, keep) + "_" + hex.slice(0, hlen)
}

// 整条丢弃的类型：reasoning（思考轨迹）。密文不进日志、不进返回值以外的任何地方。
var AR_DROP_TYPES = arTable(["reasoning"])

// ctx.options 支持（package.json 的 magpie.options 提供默认值，Magpie 运行时注入）：
//   providers:   非空数组时覆盖 AR_PROVIDERS（元素 trim().toLowerCase() 后精确查表），
//                同时门控 call_id 归一化与 item.id 剥离两类处理。
//   models:      非空数组时按同法精确匹配 ctx.provider.model，仅门控 item.id 剥离 /
//                reasoning 丢弃（默认等价于 [AR_MODEL]），不影响 call_id 归一化。
//   dropTypes:   非空数组时覆盖 AR_DROP_TYPES（整条丢弃的 item.type 列表，同法精确查表）。
//   callIdMax:   正整数覆盖 call_id 归一化阈值 40；小数向下取整，取整后 <1（含 0.5→0、
//                0、负数）即非法，回退默认——否则 hex.slice(0,0) 会把所有 ID 清空。
//                阈值之下 ID 一律不动。
//   clampModels: 非空数组时把 call_id 归一化限定到这些底层模型（同法精确查表），默认不限。
// 空数组或非数组 = 使用默认；匹配语义始终是精确相等，绝不做子串命中。
function normList(v) {
  if (!Array.isArray(v) || v.length === 0) return null
  var out = []
  for (var i = 0; i < v.length; i++) {
    if (typeof v[i] !== "string") continue
    var s = v[i].trim().toLowerCase()
    if (s) out.push(s)
  }
  return out.length ? out : null
}
function optionsOf(ctx) {
  var o = ctx && typeof ctx.options === "object" && ctx.options !== null ? ctx.options : {}
  // 取整后 <1（0.5→0、0、负数）属非法，回退默认 40——否则 clampId 里 hex.slice(0,0)
  // 会把所有超长 ID 清成空串。
  var callIdMax =
    typeof o.callIdMax === "number" && isFinite(o.callIdMax) ? Math.floor(o.callIdMax) : null
  if (callIdMax !== null && callIdMax < 1) callIdMax = null
  return {
    providers: normList(o.providers),
    models: normList(o.models),
    dropTypes: normList(o.dropTypes),
    callIdMax: callIdMax,
    clampModels: normList(o.clampModels),
  }
}

function logLine(text) {
  try {
    console.log("ARITEMSTRIP " + text)
  } catch (e) {
    // 日志本身出错不外抛
  }
}

// 是否带服务端历史指针；带就整个放行（返回指针名，空串表示没有）。
function pointerOf(body, input) {
  if (typeof body.previous_response_id === "string" && body.previous_response_id.length > 0) {
    return "previous_response_id"
  }
  if (body.previous_response_id != null && body.previous_response_id !== "") return "previous_response_id"
  if (body.conversation != null) return "conversation"
  if (!Array.isArray(input)) return ""
  for (var i = 0; i < input.length; i++) {
    var it = input[i]
    if (it && typeof it === "object" && it.type === "item_reference") return "item_reference"
  }
  return ""
}

// 参与 call_id 归一化的 input 项类型（只改 call_id 字段，不碰 item.id）。
var AR_CALLID_INPUT_TYPES = arTable([
  "function_call",
  "function_call_output",
  "custom_tool_call",
  "custom_tool_call_output",
])

// 归一化 input 项与 messages 形态中的超长 ID。就地改写并统计各字段命中数；
// 只统计不存在的字段不动，绝不打 ID 值本身。
function clampFieldCounts(counts) {
  var parts = []
  for (var k in counts) {
    if (Object.prototype.hasOwnProperty.call(counts, k)) parts.push(k + ":" + counts[k])
  }
  return parts.join(",")
}
function clampCallIds(body, maxLen) {
  var counts = Object.create(null)
  var total = 0
  var input = body.input
  if (Array.isArray(input)) {
    for (var i = 0; i < input.length; i++) {
      var it = input[i]
      if (!it || typeof it !== "object") continue
      if (!arHas(AR_CALLID_INPUT_TYPES, typeof it.type === "string" ? it.type : "")) continue
      var nv = clampId(it.call_id, maxLen)
      if (nv !== null) {
        it.call_id = nv
        counts["call_id"] = (counts["call_id"] || 0) + 1
        total++
      }
    }
  }
  var msgs = body.messages
  if (Array.isArray(msgs)) {
    for (var j = 0; j < msgs.length; j++) {
      var m = msgs[j]
      if (!m || typeof m !== "object") continue
      var tcs = m.tool_calls
      if (Array.isArray(tcs)) {
        for (var q = 0; q < tcs.length; q++) {
          var tc = tcs[q]
          if (!tc || typeof tc !== "object") continue
          var nv2 = clampId(tc.id, maxLen)
          if (nv2 !== null) {
            tc.id = nv2
            counts["tool_calls.id"] = (counts["tool_calls.id"] || 0) + 1
            total++
          }
        }
      }
      var nv3 = clampId(m.tool_call_id, maxLen)
      if (nv3 !== null) {
        m.tool_call_id = nv3
        counts["tool_call_id"] = (counts["tool_call_id"] || 0) + 1
        total++
      }
    }
  }
  return total > 0 ? total + " (" + clampFieldCounts(counts) + ")" : ""
}

export function onProvider(body, ctx) {
  try {
    if (!body || typeof body !== "object" || Array.isArray(body)) return

    var prov = ctx && ctx.provider && typeof ctx.provider === "object" ? ctx.provider : null
    if (!prov) return
    var pid = prov.id != null ? String(prov.id) : ""
    var pmodel = prov.model != null ? String(prov.model) : ""

    var opts = optionsOf(ctx)
    var providers = opts.providers ? arTable(opts.providers) : AR_PROVIDERS
    var dropTypes = opts.dropTypes ? arTable(opts.dropTypes) : AR_DROP_TYPES
    var pidKey = pid.trim().toLowerCase()
    var modelKey = pmodel.trim().toLowerCase()
    if (!arHas(providers, pidKey)) return

    var tag = "provider=" + pid + " model=" + pmodel

    // 历史指针判定在一切改写之前：带 previous_response_id/conversation/
    // item_reference 的请求其 function_call_output 的 call 侧在服务端（input/
    // messages 并非完整内联历史），clamp 单边改写会让配对断裂，剥 id 等于
    // "丢历史换 200"。所以整体原样放行（连归一化也跳过），只记一条边界日志。
    var input = body.input
    var ptr = pointerOf(body, input)
    if (ptr !== "") {
      logLine(tag + " pass=pointer:" + ptr)
      return
    }

    // call_id 归一化：provider 门控、不限底层模型（clampModels 可选限制），
    // 只对无历史指针的完整内联请求执行。改动就地发生，只统计字段数。
    var clamped = ""
    if (opts.clampModels === null || arHas(arTable(opts.clampModels), modelKey)) {
      clamped = clampCallIds(body, opts.callIdMax !== null ? opts.callIdMax : AR_CALLID_MAX)
    }

    // item.id 剥离 / reasoning 丢弃只作用 Responses 形态（Array 形 body.input）；
    // chat 的 messages 除 call_id 归一化外原样不动。该路径仍按原有模型门控。
    if (!Array.isArray(input)) {
      if (clamped !== "") {
        logLine(tag + " clamped_call_id=" + clamped)
        return body
      }
      return
    }
    if (opts.models) { if (!arHas(arTable(opts.models), modelKey)) { if (clamped !== "") { logLine(tag + " clamped_call_id=" + clamped); return body } return } }
    else if (pmodel !== AR_MODEL) { if (clamped !== "") { logLine(tag + " clamped_call_id=" + clamped); return body } return }

    // 先数一遍：没有要改的就原样放行，绝不先改再返回 undefined。
    var strip = 0
    var drop = 0
    var byType = Object.create(null)
    for (var j = 0; j < input.length; j++) {
      var it2 = input[j]
      if (!it2 || typeof it2 !== "object") continue
      var t = typeof it2.type === "string" ? it2.type : "?"
      if (arHas(dropTypes, t)) {
        drop++
        continue
      }
      if (arHas(AR_ID_TYPES, t) && it2.id !== undefined) {
        strip++
        byType[t] = (byType[t] || 0) + 1
      }
    }
    if (strip === 0 && drop === 0) {
      if (clamped !== "") {
        logLine(tag + " clamped_call_id=" + clamped)
        return body
      }
      return
    }

    var out = []
    for (var k = 0; k < input.length; k++) {
      var item = input[k]
      if (!item || typeof item !== "object") {
        out.push(item)
        continue
      }
      var t2 = typeof item.type === "string" ? item.type : "?"
      if (arHas(dropTypes, t2)) continue // 整条丢：不篡改密文、不留空壳
      if (arHas(AR_ID_TYPES, t2) && item.id !== undefined) delete item.id // 只删 id
      out.push(item) // call_id/name/arguments/output/内容/status/phase 全保留
    }
    body.input = out

    var counts = []
    for (var key in byType) {
      if (Object.prototype.hasOwnProperty.call(byType, key)) counts.push(key + ":" + byType[key])
    }
    logLine(tag + " stripped_id=" + strip + " (" + counts.join(",") + ") dropped_reasoning=" + drop +
      (clamped !== "" ? " clamped_call_id=" + clamped : ""))
    return body
  } catch (e) {
    var msg = ""
    try {
      msg = e && e.message ? String(e.message) : String(e)
    } catch (_) {
      msg = "<unprintable>"
    }
    logLine("error=" + msg)
    return
  }
}

export default { meta, onProvider }
