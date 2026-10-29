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
//   * 只认精确 provider id（agentrouter / agentrouter-linuxdo）+ 精确底层 model（gpt-6.1-sol），
//     不做子串匹配，也不拿 body.model 猜（那还是分组名）。provider/model/dropTypes 的
//     可覆盖数组从 ctx.options.providers / models / dropTypes 读，归一化
//     trim().toLowerCase() 后精确查表，绝不退化成子串命中（防 my-agentrouter-test 这类伪造）。
//   * 所有查表都用无原型对象（Object.create(null)）+ hasOwnProperty 显式判定：
//     item.type 是上游可控字符串，普通对象字面量查表会继承
//     constructor / toString / valueOf / __proto__ 等原型键，
//     会把未知类型误判成“要整条丢”或“要删 id”的类型（审查 M1/C1）。
//   * 只处理 Array 形的 body.input（Responses 协议）；chat 的 messages 原样不动。
//   * 有历史指针的请求整个放行：previous_response_id 非空、任一 item_reference、
//     conversation 指针 —— 这些指向服务端已存资源，这里没有可展开的完整内联历史，
//     悄悄删指针会“丢历史换 200”，所以原样放行只记一条边界日志。
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

var AR_PROVIDERS = arTable(["agentrouter", "agentrouter-linuxdo"])
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

// 整条丢弃的类型：reasoning（思考轨迹）。密文不进日志、不进返回值以外的任何地方。
var AR_DROP_TYPES = arTable(["reasoning"])

// ctx.options 支持（package.json 的 magpie.options 提供默认值，Magpie 运行时注入）：
//   providers: 非空数组时覆盖 AR_PROVIDERS（元素 trim().toLowerCase() 后精确查表）。
//   models:    非空数组时按同法精确匹配 ctx.provider.model（默认等价于 [AR_MODEL]）。
//   dropTypes: 非空数组时覆盖 AR_DROP_TYPES（整条丢弃的 item.type 列表，同法精确查表）。
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
  return {
    providers: normList(o.providers),
    models: normList(o.models),
    dropTypes: normList(o.dropTypes),
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
  for (var i = 0; i < input.length; i++) {
    var it = input[i]
    if (it && typeof it === "object" && it.type === "item_reference") return "item_reference"
  }
  return ""
}

export function onProvider(body, ctx) {
  try {
    if (!body || typeof body !== "object" || Array.isArray(body)) return
    var input = body.input
    if (!Array.isArray(input)) return

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
    if (opts.models) { if (!arHas(arTable(opts.models), modelKey)) return }
    else if (pmodel !== AR_MODEL) return

    var tag = "provider=" + pid + " model=" + pmodel

    var ptr = pointerOf(body, input)
    if (ptr !== "") {
      logLine(tag + " pass=pointer:" + ptr)
      return
    }

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
    if (strip === 0 && drop === 0) return

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
    logLine(tag + " stripped_id=" + strip + " (" + counts.join(",") + ") dropped_reasoning=" + drop)
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
