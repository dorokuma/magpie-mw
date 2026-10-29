import { meta, agent, connect } from "./minis.agent.js"
import defaultExport from "./minis.agent.js"
import { readFileSync } from "node:fs"

let pass = 0, fail = 0
function check(name, cond, info) {
  if (cond) { pass++; console.log("PASS", name) }
  else { fail++; console.log("FAIL", name, info === undefined ? "" : "-> " + JSON.stringify(info)) }
}

// ── meta 字段（与生产原件 /root/.local/share/magpie-agents/minis.agent.js 对齐）──
check("meta.id/name", meta && meta.id === "minis" && meta.name === "Minis", meta)
check("meta.description", meta.description === "OpenMinis Android client icon and endpoint profile for Magpie Dashboard", meta && meta.description)
check("meta.bin/dir/config/format",
  meta.bin === "minis" &&
  meta.dir === "/root/.local/share/minis-agent" &&
  meta.config === "/root/.local/share/minis-agent/models.json" &&
  meta.format === "json", meta)
check("meta.notice", meta.notice === "OpenMinis Android App client icon (configured on mobile device; no local CLI file modifications)", meta && meta.notice)
check("meta.icon 为 data:image/png;base64 前缀", typeof meta.icon === "string" && meta.icon.startsWith("data:image/png;base64,"), meta && typeof meta.icon)

// ── 命名导出与 default 一致性 ──
check("agent === meta（双命名导出）", agent === meta, { agentIsMeta: agent === meta })
check("default 导出含 meta/agent/connect", defaultExport && defaultExport.meta === meta && defaultExport.agent === meta && typeof defaultExport.connect === "function", defaultExport && Object.keys(defaultExport))

// ── connect() 返回空对象 ──
const c = connect()
check("connect() 返回 {}", c && typeof c === "object" && Object.keys(c).length === 0, c)

// ── icon base64 与 icon.png 字节一致性 + PNG 签名 ──
const pngBytes = Buffer.from(meta.icon.slice("data:image/png;base64,".length), "base64")
const diskBytes = readFileSync(new URL("./icon.png", import.meta.url))
check("icon base64 解码字节与 icon.png 完全一致", Buffer.compare(pngBytes, diskBytes) === 0, { decoded: pngBytes.length, disk: diskBytes.length })
check("PNG 签名 89504e470d0a1a0a", pngBytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a", pngBytes.subarray(0, 8).toString("hex"))

console.log("\n" + pass + " passed, " + fail + " failed")
if (fail) process.exit(1)
