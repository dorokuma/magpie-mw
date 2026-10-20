// capture-body.mjs — rebuild a request body out of one capture record in
// /root/workspace/magpie-mw/capture, so tests and live probes work on the REAL shape pi
// sent, not on something written by hand.
//
// The tools array comes byte for byte from the record's `tools_json` (that file
// is byte-identical to tools-run-run3.json, md5 808ae57a0160b059d160647d0dc937d1).
// Scalars come from the record's parsed field summary. Long text was clipped by
// the recorder (120 char head + 60 char tail for reasoning text, 200 for the
// message heads), so the text is real but its middle is elided — enough for a
// rule that only moves text around, and never a hand-written expectation.

import { readFileSync } from "node:fs"
import assert from "node:assert/strict"

export const CAP = "/root/workspace/magpie-mw/capture"

function scalarOf(rec, key) {
  const c = rec.scalar_fields[key]
  assert.ok(c && typeof c.head === "string", "capture has no scalar " + key)
  assert.equal(c.len, c.head.length, "scalar " + key + " was clipped by the recorder")
  return JSON.parse(c.head)
}

function otherOf(rec, key) {
  const c = (rec.other_top_level || {})[key]
  assert.ok(c && typeof c.head === "string", "capture has no top-level " + key)
  assert.equal(c.len, c.head.length, "top-level " + key + " was clipped by the recorder")
  return JSON.parse(c.head)
}

// capturedReasoningDetails rebuilds the assistant's reasoning_details array from
// the recorder's head/tail snapshot of the real one.
function capturedReasoningDetails(msg) {
  const f = (msg.reasoning_fields || {}).reasoning_details
  if (!f) return null
  const head = String(f.head || "")
  const tail = String(f.tail || "")
  const headRe = /^\s*\[\s*\{\s*"type"\s*:\s*"reasoning\.text"\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)$/
  const tailRe = /^((?:[^"\\]|\\.)*)"\s*,\s*"format"\s*:\s*"([^"]*)"\s*,\s*"index"\s*:\s*(\d+)\s*\}\s*\]\s*$/
  const hm = headRe.exec(head)
  const tm = tailRe.exec(tail)
  assert.ok(hm && tm, "could not read the captured reasoning_details")
  const text = JSON.parse('"' + hm[1] + tm[1] + '"')
  assert.ok(f.item_keys && f.item_keys[0] === "type|text|format|index", "captured item keys changed")
  return [{ type: "reasoning.text", text: text, format: tm[2], index: Number(tm[3]) }]
}

function messageOf(m) {
  const o = { role: m.role }
  if (m.content_type === "null") o.content = null
  else if (m.content_type === "string") o.content = m.content_head.head
  else if (Array.isArray(m.content_block_types)) {
    o.content = m.content_block_types.map((t) => ({ type: t, text: m.content_head.head }))
  }
  if (m.has_tool_calls && Array.isArray(m.tool_calls)) {
    o.tool_calls = m.tool_calls.map((t) => ({
      id: t.id.head,
      type: t.type,
      function: { name: t.function_name, arguments: t.arguments_head.head }
    }))
  }
  if (m.has_tool_call_id) o.tool_call_id = m.tool_call_id.head
  const rd = capturedReasoningDetails(m)
  if (rd) o.reasoning_details = rd
  return o
}

// bodyOf rebuilds the request body of one captured round, key by key in the
// order the capture recorded the top-level keys.
export function bodyOf(file) {
  const rec = JSON.parse(readFileSync(CAP + "/" + file, "utf8"))
  const body = {}
  for (const k of rec.top_level_keys) {
    if (k === "model") body.model = rec.model
    else if (k === "messages") body.messages = (rec.messages || []).map(messageOf)
    else if (k === "tools") body.tools = JSON.parse(rec.tools_json)
    else if (Object.prototype.hasOwnProperty.call(rec.scalar_fields, k)) body[k] = scalarOf(rec, k)
    else body[k] = otherOf(rec, k)
  }
  return { rec, body }
}
