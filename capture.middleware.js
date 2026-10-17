// capture.middleware.js — READ-ONLY capture of the request bodies pi sends to
// magpie for models whose name contains "deepseek-flash".
//
// Nothing is ever returned or written back into `body`: the hook returns
// undefined in every path, so magpie sends the request upstream untouched.
// Every failure is swallowed and only logged.
//
// Output: /root/magpie-mw/capture/req-<NN>-<ts>.json when the sandbox has a
// usable `fs`; otherwise the same JSON is emitted to the log in numbered
// chunks (REQCHUNK <NN>/<total> ...) which the operator reassembles.

const OUT_DIR = "/root/magpie-mw/capture"
const MARK = "deepseek-flash"
const CHUNK_LINE = 1500
const CHUNK_PAYLOAD = 1480
const TEXT_CLIP = 200
const THINK_CLIP = 120
const JSON_CLIP = 1200

let seq = 0
let fsMod = undefined

// nextSeq keeps the numbering running across requests: the counter file beside
// the records when there is a filesystem, otherwise module/global state.
function nextSeq() {
  const f = fsOf()
  if (f && typeof f.readFileSync === "function") {
    try {
      let n = 0
      try {
        n = parseInt(String(f.readFileSync(OUT_DIR + "/.seq", "utf8")).trim(), 10) || 0
      } catch (e) {
        n = 0
      }
      n = n + 1
      f.writeFileSync(OUT_DIR + "/.seq", String(n), "utf8")
      seq = n
      return n
    } catch (e) {
      /* fall through to in-memory */
    }
  }
  seq = seq + 1
  try {
    if (globalThis && typeof globalThis === "object") {
      globalThis.__captureSeq = (globalThis.__captureSeq || 0) + 1
      if (globalThis.__captureSeq > seq) seq = globalThis.__captureSeq
    }
  } catch (e) {
    /* ignore */
  }
  return seq
}

// fsOf returns a usable fs-like object, or null when the sandbox has none.
function fsOf() {
  if (fsMod !== undefined) return fsMod
  fsMod = null
  try {
    if (typeof fs !== "undefined" && fs && typeof fs.writeFileSync === "function") fsMod = fs
  } catch (e) {
    /* no global fs */
  }
  if (!fsMod) {
    try {
      if (typeof require === "function") {
        const m = require("fs")
        if (m && typeof m.writeFileSync === "function") fsMod = m
      }
    } catch (e) {
      /* no require */
    }
  }
  return fsMod
}

function stamp() {
  const d = new Date()
  const p = (n, w) => String(n).padStart(w, "0")
  return (
    String(d.getFullYear()) +
    p(d.getMonth() + 1, 2) +
    p(d.getDate(), 2) +
    "-" +
    p(d.getHours(), 2) +
    p(d.getMinutes(), 2) +
    p(d.getSeconds(), 2) +
    "-" +
    p(d.getMilliseconds(), 3)
  )
}

function clipText(s, n) {
  const t = typeof s === "string" ? s : s == null ? "" : String(s)
  return { len: t.length, head: t.slice(0, n) }
}

function clipJSON(v, n) {
  let s
  try {
    s = JSON.stringify(v)
  } catch (e) {
    s = "[unserializable:" + String(e) + "]"
  }
  if (s === undefined) s = "undefined"
  return { len: s.length, head: s.slice(0, n) }
}

function blockTypes(content) {
  if (content == null) return null
  if (typeof content === "string") return ["string"]
  if (Array.isArray(content)) {
    const out = []
    for (const b of content) {
      if (b == null) out.push("null")
      else if (typeof b === "string") out.push("string")
      else if (typeof b === "object") out.push(String(b.type || "object"))
      else out.push(typeof b)
    }
    return out
  }
  return [typeof content]
}

function contentText(content) {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    const parts = []
    for (const b of content) {
      if (typeof b === "string") parts.push(b)
      else if (b && typeof b === "object" && typeof b.text === "string") parts.push(b.text)
    }
    return parts.join("\n")
  }
  return ""
}

const THINK_KEYS = [
  "reasoning_content",
  "reasoning",
  "reasoning_details",
  "reasoning_text",
  "thinking",
  "thinking_content",
  "thought",
  "thoughts",
  "encrypted_reasoning_content",
  "signature",
  "redacted_thinking"
]

function thinkText(v, n) {
  let s
  if (typeof v === "string") s = v
  else {
    try {
      s = JSON.stringify(v)
    } catch (e) {
      s = "[unserializable]"
    }
  }
  if (s === undefined) s = "undefined"
  const out = { json_type: typeof v, len: s.length, head: s.slice(0, n), tail: s.slice(-60) }
  try {
    const p = typeof v === "string" ? JSON.parse(v) : v
    if (Array.isArray(p)) {
      out.items = p.length
      out.item_keys = p.map((x) => (x && typeof x === "object" ? Object.keys(x).join("|") : typeof x))
    } else if (p && typeof p === "object") {
      out.top_keys = Object.keys(p)
    }
  } catch (e) {
    /* not JSON: string reasoning */
  }
  return out
}

function thinkFields(o) {
  const out = {}
  if (!o || typeof o !== "object") return out
  const seen = {}
  for (const k of THINK_KEYS) {
    if (Object.prototype.hasOwnProperty.call(o, k)) {
      seen[k] = 1
      out[k] = thinkText(o[k], THINK_CLIP)
    }
  }
  for (const k of Object.keys(o)) {
    if (seen[k]) continue
    if (!/reason|think|thought/i.test(k)) continue
    out[k] = thinkText(o[k], THINK_CLIP)
  }
  return out
}

function summarizeMessage(m) {
  const o = m && typeof m === "object" ? m : {}
  const c = o.content
  const rec = {
    role: o.role === undefined ? null : o.role,
    keys: Object.keys(o),
    content_type: c === null ? "null" : typeof c,
    content_block_types: blockTypes(c),
    content_len: typeof c === "string" ? c.length : c == null ? null : blockTypes(c) ? (Array.isArray(c) ? c.length : null) : null,
    content_head: clipText(contentText(c), TEXT_CLIP),
    has_tool_calls: Object.prototype.hasOwnProperty.call(o, "tool_calls"),
    tool_calls: null,
    has_tool_call_id: Object.prototype.hasOwnProperty.call(o, "tool_call_id"),
    tool_call_id: Object.prototype.hasOwnProperty.call(o, "tool_call_id") ? clipText(o.tool_call_id, 60) : null,
    name: o.name === undefined ? null : o.name,
    reasoning_fields: thinkFields(o)
  }
  const tc = o.tool_calls
  if (Array.isArray(tc)) {
    rec.tool_calls = tc.map((t) => {
      const f = t && t.function && typeof t.function === "object" ? t.function : {}
      return {
        id: t && t.id !== undefined ? clipText(t.id, 60) : null,
        type: t ? t.type : null,
        function_name: f.name === undefined ? null : f.name,
        arguments_len: typeof f.arguments === "string" ? f.arguments.length : null,
        arguments_head: clipText(f.arguments, TEXT_CLIP),
        keys: t && typeof t === "object" ? Object.keys(t) : []
      }
    })
  } else if (tc != null) {
    rec.tool_calls = clipJSON(tc, TEXT_CLIP)
  }
  return rec
}

const SCALAR_KEYS = [
  "temperature",
  "top_p",
  "top_k",
  "max_tokens",
  "max_completion_tokens",
  "tool_choice",
  "parallel_tool_calls",
  "reasoning_effort",
  "reasoning",
  "thinking",
  "thinking_budget",
  "enable_thinking",
  "reasoning_summary",
  "include_reasoning",
  "stream",
  "stream_options",
  "n",
  "stop",
  "seed",
  "frequency_penalty",
  "presence_penalty",
  "response_format",
  "logprobs",
  "user",
  "verbosity",
  "store",
  "metadata"
]

function scalarFields(body) {
  const out = {}
  for (const k of SCALAR_KEYS) {
    out[k] = Object.prototype.hasOwnProperty.call(body, k) ? clipJSON(body[k], 400) : null
  }
  return out
}

function otherTopLevelScalars(body) {
  const skip = {}
  for (const k of SCALAR_KEYS) skip[k] = 1
  skip.model = 1
  skip.messages = 1
  skip.tools = 1
  const out = {}
  for (const k of Object.keys(body)) {
    if (skip[k]) continue
    const v = body[k]
    if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = clipJSON(v, 200)
    else out[k] = { type: Array.isArray(v) ? "array" : typeof v, json: clipJSON(v, 200) }
  }
  return out
}

function summarizeCtx(ctx) {
  const out = { enumerable_keys: [], values: {} }
  if (!ctx || typeof ctx !== "object") {
    out.type = typeof ctx
    return out
  }
  let keys = []
  try {
    keys = Object.keys(ctx)
  } catch (e) {
    keys = []
  }
  out.enumerable_keys = keys
  for (const k of keys) {
    let v
    try {
      v = ctx[k]
    } catch (e) {
      out.values[k] = "[throws]"
      continue
    }
    if (typeof v === "function") out.values[k] = "[function]"
    else if (v === null || v === undefined || typeof v === "string" || typeof v === "number" || typeof v === "boolean") out.values[k] = clipJSON(v, JSON_CLIP)
    else {
      let ks = null
      try {
        ks = Object.keys(v)
      } catch (e) {
        ks = null
      }
      out.values[k] = { type: Array.isArray(v) ? "array" : typeof v, keys: ks, json: clipJSON(v, JSON_CLIP) }
    }
  }
  for (const k of ["model", "path", "protocol", "agent", "stream", "session_id", "request_id", "id"]) {
    if (!Object.prototype.hasOwnProperty.call(ctx, k)) continue
    try {
      out["__" + k] = clipJSON(ctx[k], 200)
    } catch (e) {
      /* ignore */
    }
  }
  return out
}

function emitChunks(rec, text) {
  const total = Math.max(1, Math.ceil(text.length / CHUNK_PAYLOAD))
  const width = String(total).length
  const pad = (i) => String(i).padStart(width, "0")
  for (let i = 0; i < total; i++) {
    const head = "REQCHUNK " + rec.seq + "/" + total + " [" + pad(i + 1) + "] "
    const payload = text.slice(i * CHUNK_PAYLOAD, (i + 1) * CHUNK_PAYLOAD)
    console.log(head + payload)
  }
  return "journald"
}

function emit(rec) {
  const minify = () => {
    try {
      return JSON.stringify(rec)
    } catch (e) {
      return JSON.stringify({ seq: rec.seq, error: "stringify failed: " + String(e) })
    }
  }
  const f = fsOf()
  rec.file = OUT_DIR + "/req-" + String(rec.seq).padStart(2, "0") + "-" + stamp() + ".json"
  if (f) {
    rec.via = "fs"
    rec.bytes = 0
    let text = ""
    try {
      text = JSON.stringify(rec, null, 2)
    } catch (e) {
      text = ""
    }
    try {
      f.writeFileSync(rec.file, text, "utf8")
      rec.bytes = text.length
      return "fs"
    } catch (e) {
      rec.fs_error = String(e && e.message ? e.message : e)
    }
  }
  // journald fallback: one line per chunk, compact JSON, so the chunks are
  // plain log lines and reassemble by concatenation without separators.
  rec.via = "journald"
  rec.bytes = 0
  let out = minify()
  rec.bytes = out.length
  out = minify()
  return emitChunks(rec, out)
}

export function onRequest(body, ctx) {
  try {
    const model = String((body && body.model) || "")
    if (model.indexOf(MARK) < 0) return undefined
    const n = nextSeq()
    const n2 = (i) => String(i).padStart(2, "0")
    let raw = ""
    try {
      raw = JSON.stringify(body)
    } catch (e) {
      raw = ""
    }
    console.log("CAPTURE_REQ " + n2(n) + " begin model=" + model + " bytes=" + raw.length)

    const rec = {
      seq: n,
      captured_at: new Date().toISOString(),
      model: body && body.model !== undefined ? body.model : null,
      stream: body && body.stream !== undefined ? body.stream : null,
      raw_bytes: raw.length,
      top_level_keys: body && typeof body === "object" ? Object.keys(body) : [],
      scalar_fields: scalarFields(body || {}),
      other_top_level: otherTopLevelScalars(body || {}),
      tools_present: !!(body && body.tools),
      tools_count: body && Array.isArray(body.tools) ? body.tools.length : null,
      tools_json: body && body.tools !== undefined ? JSON.stringify(body.tools, null, 2) : null,
      messages_count: body && Array.isArray(body.messages) ? body.messages.length : null,
      messages: body && Array.isArray(body.messages) ? body.messages.map(summarizeMessage) : null,
      ctx: summarizeCtx(ctx)
    }

    const via = emit(rec)
    const written = rec.file || "(no file)"
    console.log("CAPTURE_REQ " + n2(n) + " end model=" + model + " bytes=" + raw.length + " via=" + via + " file=" + written)
  } catch (e) {
    try {
      console.log("CAPTURE_ERR " + String(e && e.stack ? e.stack : e))
    } catch (e2) {
      /* nothing left to do */
    }
  }
  return undefined
}

try {
  console.log("CAPTURE_INIT loaded fs=" + typeof fs + " require=" + typeof require + " out=" + OUT_DIR)
} catch (e) {
  /* ignore */
}
