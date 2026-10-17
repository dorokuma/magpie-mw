// probe-variants.mjs — write the shapes one might send back for the agent's
// second turn, all derived from the REAL captured round-2 body, so the live
// probe can find out which one AgentRouter accepts.
//
//   node probe-variants.mjs            → writes /tmp/mwvariants/*.json
//
// v0 = as captured (no patch)                v3 = rc + Anthropic-style thinking block
// v1 = + reasoning_content (the rule)        v4 = thinking block + rc, no reasoning_details
// v2 = rc, no reasoning_details              v5 = rc, no reasoning_effort
// v6 = as captured, no reasoning_effort

import { writeFileSync, mkdirSync } from "node:fs"
import { bodyOf } from "./capture-body.mjs"

const OUT = "/tmp/mwvariants"
mkdirSync(OUT, { recursive: true })

const A = 2 // the assistant message in the captured round-2 body
const { body } = bodyOf("run3-reassembled-02-seq01.json")
const text = body.messages[A].reasoning_details.map((x) => x.text).join("")
if (!text) throw new Error("no reasoning text in the capture")

const clone = () => JSON.parse(JSON.stringify(body))
const variants = {}
variants.v0_captured = clone()
{
  const b = clone()
  b.messages[A].reasoning_content = text
  variants.v1_rc = b
}
{
  const b = clone()
  b.messages[A].reasoning_content = text
  delete b.messages[A].reasoning_details
  variants.v2_rc_nodetails = b
}
{
  const b = clone()
  b.messages[A].reasoning_content = text
  b.messages[A].content = [{ type: "thinking", thinking: text }]
  variants.v3_rc_thinkingblock = b
}
{
  const b = clone()
  b.messages[A].reasoning_content = text
  b.messages[A].content = [{ type: "thinking", thinking: text }]
  delete b.messages[A].reasoning_details
  variants.v4_block_rc_nodetails = b
}
{
  const b = clone()
  b.messages[A].reasoning_content = text
  delete b.reasoning_effort
  variants.v5_rc_noeffort = b
}
{
  const b = clone()
  delete b.reasoning_effort
  variants.v6_noeffort = b
}

for (const [name, v] of Object.entries(variants)) writeFileSync(OUT + "/" + name + ".json", JSON.stringify(v))
console.log("wrote " + Object.keys(variants).length + " bodies to " + OUT + ":")
for (const name of Object.keys(variants)) console.log("  " + OUT + "/" + name + ".json")
