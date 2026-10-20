---
date: 2026-10-21
title: "抓包脚本路径迁移（/root/magpie-mw → /root/workspace/magpie-mw）Consider 观察项留痕"
status: active
supersedes: null
---

# 抓包脚本路径迁移与历史归档引用 Consider 留痕（2026-10-21）

本文件记录 `fix/update-capture-path` 分支将抓包工具集脚本（`capture-body.mjs`、`capture.middleware.js`、`extract.py`）中的旧路径 `/root/magpie-mw/capture` 统一更新为 `/root/workspace/magpie-mw/capture` 并通过 B 档门禁后，针对历史归档文档中旧路径引用的 `consider` 级审查观察项留痕。

- **来源标注**：2026-10-21 B 档门禁审查结论、用户已过目。
- **凭据声明**：本记录不含任何 key、token、Authorization 等敏感凭据。

## Consider 级观察项（五要素）

### 观察项 1：历史归档文档仍保留旧路径 `/root/magpie-mw/` 引用

- **级别**：`consider`
- **出处**：`capture/FINDINGS.md` 与 `.agents/notes/` 历史归档文档（如 `2026-10-17-deepseek-sanitize-followup.md`、`2026-10-20-tail-tool-append-user.md` 等）
- **问题**：这些历史归档仍引用旧路径 `/root/magpie-mw/`（其中 `capture/FINDINGS.md` 另含 `magpie plugin add /root/magpie-mw/...` 旧命令）；后续如有人照 `FINDINGS.md` 中的旧命令直接操作会因路径不存在而失败。
- **建议**：上述文档属当期调查快照，本次不该顺手篡改历史快照；保持历史归档原文不变，避免破坏当期排障上下文证据。
- **不阻断理由**：历史归档为当期快照、非活跃配置或可执行文档，且本次已把源码脚本（`capture-body.mjs`、`capture.middleware.js`、`extract.py`）中的死引用全部修好，活跃文档 `AGENTS.md` 中的仓库结构与生产挂载路径亦已为规范路径 `/root/workspace/magpie-mw/`。
- **后续处置条件**：下次实际启用抓包时，在 `.agents/notes/` 中补一条路径迁移记录（说明抓包插件与脚本路径已迁至 `/root/workspace/magpie-mw/`）。
