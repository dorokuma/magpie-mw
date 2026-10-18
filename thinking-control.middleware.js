// thinking-control.middleware.js — magpie gateway 智能思考开关与请求清洗中间件（通用注册表版）
//
// 要解决的问题：不少自部署模型（尤其 vLLM 跑的 Qwen 等）只认真正的"关思考"字段，
// 不认 pi 发来的 reasoning_effort，导致在 pi 里选"关闭"也关不掉。本中间件把 pi 的
// 思考意图翻译成"该后端真正生效"的关/开字段。
//
// 安全边界：只处理 PROFILES / STRIP_PARAM_PROFILES / SANITIZE_PROFILES 命中的 model；
// 其它请求一律原样放行（返回 undefined = 不动）。任何异常也原样放行（同时打一条
// THINKMW 错误日志便于排查）。绝不主动改未登记的模型。
// 规则只按真实模型子串（及可选的 providers 供应商子串）匹配，绝不硬编码 group/smartass
// 这类分组名。分组名在 onRequest 阶段原样放行，等 onProvider 拿到真实 provider 再处理。
//
// 智能开/关（不锁死）：按 pi 发来的 reasoning_effort 决定这一次要不要思考——
//   effort ∈ profile.closeEffort        -> 关思考
//   请求没带 effort                       -> 按 profile.closeWhenAbsent（缺省=开，保持后端默认）
//   其它（low/medium/xhigh…实义档）      -> 开思考
// 逃生舱：请求里调用方已经显式带了该方言的关/开字段，一律尊重、绝不覆盖。
//
// 让 pi 能发出"关闭"信号：这些模型的 reasoning_effort 档由 magpie 的
// settings.json -> modelEfforts 控制（不是 models.json，不受 magpie 重写 models.json 影响）。
// 给目标模型加一档 "none"，pi 里就能选"关闭"、发 reasoning_effort:"none"，本中间件据此关。
//
// ── 怎么给一个新模型开启这套智能关思考 ─────────────────────────────
//   1) 在 PROFILES 里给它的方言加一行 match（model 串包含任一子串即命中）；
//   2) 若该后端"关思考"用的是还没登记的字段方言，在 DIALECTS 里加一个方言（apply/escape）；
//   3) 在 magpie settings.json 的 modelEfforts 里给该模型加 "none" 档。
//   契约提醒：新方言的 apply 必须保留 body 中与本方言无关的既有字段（不得整体替换对象），
//   并且只在确实改动了 body 时才返回 true（false = 无需改、由中间件原样放行）。
//   先对目标后端实测确认方言的"关"字段真能关掉 reasoning_content，再挂进 PROFILES。

// ── 方言：把"关/开思考"落成具体请求字段 ─────────────────────────────
export const DIALECTS = {
  // vLLM / HF chat-template 系（Qwen3.5/3.8 等）。
  // 实测(2026-10-12, arkapi vllm-0.28 qwen3.8-flash-next)：
  //   enable_thinking:false -> reasoning_tokens=0；true -> >0；且压过 reasoning_effort。
  qwenChatTemplate: {
    escape(body) {
      return !!(body.chat_template_kwargs &&
        typeof body.chat_template_kwargs.enable_thinking !== "undefined")
    },
    apply(body, on) {
      body.chat_template_kwargs = Object.assign({}, body.chat_template_kwargs, { enable_thinking: on })
      if (!on) delete body.reasoning_effort // 该后端不认 effort，关掉时清掉免干扰
      return true
    },
  },

  // New-API / Anthropic 风格 relay：thinking:{type:"disabled"}。
  // 关思考：保留 body.thinking 既有字段、只把 type 置为 disabled（不整体替换成只含
  //   type 的对象，免得丢掉 budget_tokens 等字段），并清掉 reasoning_effort；若 type
  //   本就是 disabled 则标记无需再改，但 reasoning_effort 存在时仍要清掉。
  // 开思考：只有 body.thinking 恰为"仅带 type:disabled"的空壳时才整体删除；只要对象
  //   里除 type 外还有其它字段，就一律不动、不丢字段。
  // 返回值仍是"是否改动了 body"（true=改了，false=无需改、原样放行）。
  // 契约（body.thinking 非对象时的取舍）：关思考时若 body.thinking 不是对象（含 null、字符串等），
  //   视为该字段无既有内容，直接以对象形式覆盖为 disabled（不保留任何既有内容）；开思考时同理
  //   不做类型修复、原样返回不改动。若将来确遇后端真的发送字符串型 thinking 字段，需人工确认
  //   真实语义后再决定是否放宽。
  // 注：此为通用框架预置，未对每个具体后端逐一实测——挂进 PROFILES 前先对目标后端发一发确认。
  thinkingDisabled: {
    escape(body) { return !!(body.thinking && typeof body.thinking.type !== "undefined") },
    apply(body, on) {
      if (!on) {
        let changed = false
        if (!(body.thinking && body.thinking.type === "disabled")) {
          // 保留既有字段，只覆盖 type；body.thinking 不是对象时按空对象起手
          const base = (body.thinking && typeof body.thinking === "object") ? body.thinking : {}
          body.thinking = Object.assign({}, base, { type: "disabled" })
          changed = true
        }
        if ("reasoning_effort" in body) { delete body.reasoning_effort; changed = true }
        return changed
      }
      if (!body.thinking || body.thinking.type !== "disabled") return false
      if (Object.keys(body.thinking).some(function (k) { return k !== "type" })) return false
      delete body.thinking
      return true
    },
  },
}

// ── 注册表：想智能关哪个模型，加一行即可 ───────────────────────────
// match:         model 串含任一子串即命中
// closeEffort:   pi 的 reasoning_effort ∈ 此列表 -> 关思考（默认含 "none"）
// closeWhenAbsent: 请求没带 reasoning_effort 时是否算关（缺省 false = 开，保持后端默认）
export const PROFILES = [
  {
    dialect: "qwenChatTemplate",
    match: ["qwen3.8-flash-next", "qwen-3.8-flash", "qwen3.8-flash", "qwen3.8-27b"],
    closeEffort: ["none", "off", ""],
    closeWhenAbsent: false,
  },
  // 示例（确认后端后取消注释并改成真实模型名）：
  // { dialect: "thinkingDisabled", match: ["some-deepseek-relay-model"], closeEffort: ["none"], closeWhenAbsent: false },
]

// ── 不支持参数剥离表：按 model 子串剥离后端拒绝的顶层字段 ───────────
// match:     模型串含任一子串即命中（直连 body.model/ctx.model，或 onProvider 的 provider/model）
// providers: 可选。配置后还须供应商 id/name（或模型串里的 provider 段）含任一子串才命中；
//            未配置则只按 match 匹配，不锁死任何组名。
// fields:    命中后若 body 中存在该字段则 delete，且确保钩子返回 body
export const STRIP_PARAM_PROFILES = [
  {
    match: ["glm-5.3-flash", "glm-5-3-flash"],
    fields: ["prompt_cache_key", "prompt_cache_retention"],
  },
  {
    match: ["deepseek-v4-flash", "deepseek-v4.1-flash", "deepseek-flash"],
    fields: ["prompt_cache_key", "reasoning_effort"],
  },
]

// ── 规范化/清洗配置表：按 model 子串对 messages / tools 做结构清洗 ──
// match:     模型串含任一子串即命中（直连或 onProvider 的 provider/model）
// providers: 可选。配置后还须供应商 id/name（或模型串里的 provider 段）含任一子串才命中。
export const SANITIZE_PROFILES = [
  {
    match: ["deepseek-v4-flash", "deepseek-v4.1-flash", "deepseek-flash"],
    developerToSystem: true,
    assistantReasoningDetailsToContent: true,
    assistantNullContentToEmpty: true,
    toolsEnsureRequiredArray: true,
  },
]

// 规则是否命中：match 对模型串做子串匹配；配置了 providers 时还须供应商 id/name
// 或模型串 "provider/model" 的 provider 段含任一 providers 子串。未配 providers 则只看 match。
function profileMatches(profile, model, providerId) {
  if (!profile || !Array.isArray(profile.match)) return false
  if (!profile.match.some(function (m) { return model.indexOf(m) >= 0 })) return false
  if (!Array.isArray(profile.providers) || profile.providers.length === 0) return true
  const pid = providerId != null ? String(providerId) : ""
  const slash = model.indexOf("/")
  const modelProvider = slash >= 0 ? model.slice(0, slash) : ""
  return profile.providers.some(function (p) {
    const needle = p != null ? String(p) : ""
    if (!needle) return false
    return (pid && pid.indexOf(needle) >= 0) || (modelProvider && modelProvider.indexOf(needle) >= 0)
  })
}

// onRequest 与 onProvider 共用的剥离 / 清洗 / 思考控制。
// model 是用来匹配规则的目标模型串；providerId 供规则项可选的 providers 精确限定。
// savedEffort 优先于 body.reasoning_effort（字段已被前序阶段剥离时回退用）。
// 只在实际改了 body 时返回 true。
function applyProfiles(body, ctx, model, providerId, savedEffort, hasSavedEffort) {
  let stripped = false
  const strippedFields = []
  for (let i = 0; i < STRIP_PARAM_PROFILES.length; i++) {
    const sp = STRIP_PARAM_PROFILES[i]
    if (!sp || !Array.isArray(sp.fields)) continue
    if (!profileMatches(sp, model, providerId)) continue
    for (let j = 0; j < sp.fields.length; j++) {
      const f = sp.fields[j]
      if (f in body) {
        if (f === "reasoning_effort" && !hasSavedEffort) {
          hasSavedEffort = true
          savedEffort = body.reasoning_effort
        }
        delete body[f]
        stripped = true
        strippedFields.push(f)
      }
    }
  }
  if (stripped) {
    console.log("THINKMW strip model=" + model + " fields=" + strippedFields.join(","))
  }

  let sanitized = false
  const sanitizeActions = []
  function addSanitizeAction(act) {
    if (sanitizeActions.indexOf(act) < 0) sanitizeActions.push(act)
  }
  for (let i = 0; i < SANITIZE_PROFILES.length; i++) {
    const sp = SANITIZE_PROFILES[i]
    if (!profileMatches(sp, model, providerId)) continue

    if (Array.isArray(body.messages)) {
      for (let j = 0; j < body.messages.length; j++) {
        const msg = body.messages[j]
        if (!msg || typeof msg !== "object") continue
        if (sp.developerToSystem !== false && msg.role === "developer") {
          msg.role = "system"
          sanitized = true
          addSanitizeAction("developer->system")
        }
        if (msg.role === "assistant") {
          if (sp.assistantReasoningDetailsToContent !== false && Array.isArray(msg.reasoning_details)) {
            let rcText = ""
            for (let k = 0; k < msg.reasoning_details.length; k++) {
              const item = msg.reasoning_details[k]
              rcText += (item && typeof item.text === "string") ? item.text : ""
            }
            if (typeof msg.reasoning_content !== "string" || msg.reasoning_content === "") {
              if (rcText.length > 0) {
                msg.reasoning_content = rcText
              } else if (!("reasoning_content" in msg) || msg.reasoning_content == null) {
                msg.reasoning_content = ""
              }
            }
            delete msg.reasoning_details
            sanitized = true
            addSanitizeAction("reasoning_details->reasoning_content")
          }
          if (sp.assistantNullContentToEmpty !== false && (msg.content === null || typeof msg.content === "undefined")) {
            msg.content = ""
            sanitized = true
            addSanitizeAction("assistant_content_empty")
          }
        }
      }
    }

    if (sp.toolsEnsureRequiredArray !== false && Array.isArray(body.tools)) {
      for (let j = 0; j < body.tools.length; j++) {
        const t = body.tools[j]
        if (
          t &&
          t.function &&
          t.function.parameters &&
          typeof t.function.parameters === "object" &&
          !Array.isArray(t.function.parameters)
        ) {
          if (t.function.parameters.type === "object" && !Array.isArray(t.function.parameters.required)) {
            t.function.parameters.required = []
            sanitized = true
            addSanitizeAction("tools_required")
          }
        }
      }
    }
  }
  if (sanitized) {
    console.log("THINKMW sanitize model=" + model + " actions=" + sanitizeActions.join(","))
  }

  const modified = stripped || sanitized
  const prof = PROFILES.find(function (p) { return profileMatches(p, model, providerId) })
  if (!prof) return modified
  const D = DIALECTS[prof.dialect]
  if (!D) return modified
  if (D.escape(body)) return modified // 逃生舱：调用方已指定，尊重不动

  const eff = hasSavedEffort ? savedEffort : body.reasoning_effort
  const absent = (eff === undefined || eff === null)
  const off = absent ? prof.closeWhenAbsent === true
                     : (prof.closeEffort.indexOf(String(eff)) >= 0)

  if (!D.apply(body, !off)) return modified // 方言认为无需改，则原样放行
  console.log("THINKMW model=" + model + " dialect=" + prof.dialect + " effort=" + String(eff) + " thinking=" + (!off))
  return true
}

function logHookError(body, ctx, e) {
  let m = ""
  let msg = ""
  try { m = (body && body.model != null) ? String(body.model) : (ctx && ctx.model != null ? String(ctx.model) : "") } catch (_) { m = "<unprintable>" }
  try { msg = (e && e.message) ? String(e.message) : String(e) } catch (_) { msg = "<unprintable>" }
  try { console.error("THINKMW error model=" + m + " err=" + msg) } catch (_) { /* 日志本身出错也不外抛 */ }
}

export function onRequest(body, ctx) {
  try {
    if (!body || typeof body !== "object" || Array.isArray(body)) return
    const rawModel = body.model != null ? body.model : (ctx && ctx.model != null ? ctx.model : "")
    const model = String(rawModel)

    // 分组路由前 body.model 仍是组名。把原始 reasoning_effort 存进 ctx.state，
    // 供 onProvider 在字段已被剥离后仍能按原始意图翻译思考开关。
    let hasSavedEffort = false
    let savedEffort
    if (ctx && ctx.state && typeof ctx.state === "object" && ("reasoning_effort" in body) && !ctx.state.hasSavedEffort) {
      ctx.state.savedEffort = body.reasoning_effort
      ctx.state.hasSavedEffort = true
    }
    if (ctx && ctx.state && typeof ctx.state === "object" && ctx.state.hasSavedEffort) {
      hasSavedEffort = true
      savedEffort = ctx.state.savedEffort
    }

    const modified = applyProfiles(body, ctx, model, "", savedEffort, hasSavedEffort)
    return modified ? body : undefined
  } catch (e) {
    logHookError(body, ctx, e)
    return
  }
}

// Magpie 在路由选定具体渠道后调用。此时 body.model / ctx.model 仍是客户端分组名，
// ctx.provider = { id, name, account, model } 才是真实供应商与底层模型。
// 返回修改后的 body 即替换发往该 provider 的请求体；返回 undefined 即原样放行。严禁返回 null。
export function onProvider(body, ctx) {
  try {
    if (!body || typeof body !== "object" || Array.isArray(body)) return
    const prov = ctx && ctx.provider && typeof ctx.provider === "object" ? ctx.provider : null
    const pId = prov ? String(prov.id || prov.name || "") : ""
    const pModel = prov && prov.model != null ? String(prov.model) : ""
    const targetModel = (pId && pModel) ? (pId + "/" + pModel)
      : (pModel || (body && body.model != null ? String(body.model) : "") || (ctx && ctx.model != null ? String(ctx.model) : ""))

    let hasSavedEffort = false
    let savedEffort
    if ("reasoning_effort" in body) {
      hasSavedEffort = true
      savedEffort = body.reasoning_effort
    } else if (ctx && ctx.state && typeof ctx.state === "object" && ctx.state.hasSavedEffort) {
      hasSavedEffort = true
      savedEffort = ctx.state.savedEffort
    }

    const modified = applyProfiles(body, ctx, targetModel, pId, savedEffort, hasSavedEffort)
    return modified ? body : undefined
  } catch (e) {
    logHookError(body, ctx, e)
    return
  }
}
