# magpie-agent-minis

Minis（OpenMinis Android 客户端）在 Magpie Dashboard 上的图标与连接说明面板。Minis 只作为客户端与 Magpie 网关通信；本插件提供官方 App 图标（`icon.png`）与元数据，不在本机做任何 CLI 文件改写。

## 元数据 · Meta

`minis.agent.js` 导出 `meta`（同时以 `agent` 与 default 的 `meta`/`agent` 键暴露，兼容两种命名导入）：

| 字段 | 值 | 说明 |
| --- | --- | --- |
| `id` | `minis` | 插件标识 |
| `name` | `Minis` | Dashboard 标题显示名 |
| `description` | `OpenMinis Android client icon and endpoint profile for Magpie Dashboard` | 插件描述 |
| `icon` | `data:image/png;base64,…` | 官方 App 图标内联 base64（与 `icon.png` 字节一致，PNG 签名 `89504e470d0a1a0a`） |
| `bin` | `minis` | 关联可执行名 |
| `dir` | `/root/.local/share/minis-agent` | 本机配置目录 |
| `config` | `/root/.local/share/minis-agent/models.json` | 配置文件路径 |
| `format` | `json` | 配置格式 |
| `notice` | `OpenMinis Android App client icon (configured on mobile device; no local CLI file modifications)` | 面板提示：在手机上配置，本机不改 CLI 文件 |

`connect()` 返回 `{}`：无本地 CLI 接管动作，Dashboard 的 Agents 面板仅展示图标与连接说明。

## 图标来源 · Icon source

图标取自 OpenMinis 官方仓库 `https://github.com/OpenMinis/openminis.github.io` 的 `icon-dark.png`（31621 字节 PNG），内联为 `data:image/png;base64,…` 字符串，与 `icon.png` 文件逐字节一致。

## 测试 · Test

```bash
node minis/minis.test.mjs
# 或随仓库全量测试
npm test
```
