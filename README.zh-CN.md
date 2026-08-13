# token-meter

<p align="center">
  <img alt="Hermes Desktop plugin" src="https://img.shields.io/badge/Hermes-Desktop%20Plugin-2f81f7?style=flat-square">
  <img alt="JavaScript ESM" src="https://img.shields.io/badge/JavaScript-ESM-f7df1e?style=flat-square&logo=javascript&logoColor=111111">
  <img alt="Python FastAPI backend" src="https://img.shields.io/badge/Python-FastAPI-3776ab?style=flat-square&logo=python&logoColor=white">
  <img alt="License MIT" src="https://img.shields.io/badge/License-MIT-22c55e?style=flat-square">
  <a href="https://github.com/3684142/hermes-token-meter/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/3684142/hermes-token-meter?style=flat-square&label=release"></a>
  <a href="https://github.com/3684142/hermes-token-meter/actions/workflows/check.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/3684142/hermes-token-meter/check.yml?branch=main&style=flat-square&label=check"></a>
</p>

[English](README.md) | **简体中文**

流式生成时的状态栏效果：

```text
Tokens ↑36.6k ↓1.4k  77.8 tok/s
```

## 功能特性

- **滚动的一秒实时速度** — `XX tok/s` 只统计最近 1,000 毫秒内收到的输出
  Token，数字随流式输出的真实节奏上升、下降，输出暂停一秒后衰减到
  `0.0 tok/s`——绝不是整轮的累计平均速度。
- **流式估算 + usage 校正** — 生成过程中监听 `message.delta` /
  `reasoning.delta` 事件，用轻量 tokenizer 本地估算（中日韩文 ≈ 1 字符 1
  token，其他文本 ≈ 4 字符 1 token）即时显示；回合结束时用 Provider 返回的
  权威 `session.info.usage` 校正累计值并计算最终 `avg` 速度。
- **无虚假速度尖峰** — usage 延迟批量到达时只校正累计数字，不会算成速度
  窗口内的一瞬间爆发。
- **支持多模型调用回合** — 一个回合内多次模型调用、穿插工具调用时，流式
  尾部继续推进，不会在第一次 API 返回后冻结。
- **会话跟随** — 切换会话时仪表自动切换；空闲时显示整个会话的累计值（按
  `(session_id, model)` 聚合所有模型行，会话中途换模型也不会少算）。

## 工作原理

| 事件 | 作用 |
|---|---|
| `host.state.activeSessionId` | 跟随当前可见的桌面会话；切换会话即重置仪表 |
| `message.start` | 回合开始，快照 usage 基线 |
| `message.delta` / `reasoning.delta` | 把带时间戳的 Token 估算追加进 trailing 1,000 ms 速度窗口 |
| `session.info` | `running === false` 结束回合；`usage` 校正累计值 |

设计规则：

- `session.info.payload.running === false` 是**唯一**的回合结束信号——绝不
  用静默时长或 Token 增长推断回合边界（工具调用可能静默数分钟）。
- 速度窗口是严格 trailing 1,000 ms 的时间戳样本；每秒 tick 裁剪过期样本，
  静默窗口速度衰减到 `0.0 tok/s`。
- Provider usage 只校正累计计数，绝不注入速度窗口作为速率样本。
- 所有显示数字不带 `~` 前缀；估算状态通过弹出面板文字（`last 1s
  estimate` / `estimated average`）披露。
- 后端按 `(session_id, model)` 聚合 `session_model_usage`——只读最新一行会
  静默丢失其他模型行的 Token。

## 文件结构

```text
token-meter/
├── install.sh                  # 一键安装脚本（Linux/macOS/Git-Bash）
├── install.ps1                 # 一键安装脚本（Windows PowerShell）
├── desktop-plugins/
│   └── token-meter/
│       ├── plugin.js           # 前端：事件驱动状态机 + 状态栏徽标 + 弹出面板
│       └── plugin.test.mjs     # 状态机测试 + 显示断言
├── plugins/
│   └── token-meter/
│       ├── __init__.py         # Python 包标记
│       ├── plugin.yaml         # 插件元数据（`hermes plugins enable` 必需）
│       └── dashboard/
│           ├── manifest.json   # 仪表盘插件发现（纯状态栏插件）
│           ├── plugin_api.py   # 轻量 FastAPI 路由，按请求热重载 impl.py
│           └── impl.py         # 只读查询 state.db
├── INSTALL.md
├── INSTALL.zh-CN.md
├── README.md
└── README.zh-CN.md
```

## 安装

**方式一：一键安装脚本（推荐）**

```bash
git clone https://github.com/3684142/hermes-token-meter.git
cd hermes-token-meter
chmod +x install.sh          # 仅当可执行位丢失时（如从 zip 解压）
./install.sh                  # Linux / macOS / Git-Bash on Windows
# Windows PowerShell 则执行：
# powershell -ExecutionPolicy Bypass -File install.ps1
```

脚本会把两个目录复制到 `$HERMES_HOME`（默认 `~/.hermes`；可用
`HERMES_HOME=/path/to/profile` 或 `-HermesHome` 指定其他配置目录），并在
Hermes CLI 可用时自动启用插件。

**方式二：Release 安装包**

从 [Releases 页面](https://github.com/3684142/hermes-token-meter/releases)
下载 `hermes-token-meter-<版本>-install.zip`，解压后把两个目录复制到你的
Hermes 主目录（包含 `state.db` 的目录——`HERMES_HOME`，通常为
`~/.hermes`，Windows 上常为 `%LOCALAPPDATA%\hermes`）：

```text
desktop-plugins/token-meter/  →  <hermes-home>/desktop-plugins/token-meter/
plugins/token-meter/          →  <hermes-home>/plugins/token-meter/
```

**方式三：手动复制**

```bash
git clone https://github.com/3684142/hermes-token-meter.git
cp -r desktop-plugins/token-meter <hermes-home>/desktop-plugins/
cp -r plugins/token-meter         <hermes-home>/plugins/
```

然后启用并重启：

```bash
hermes plugins enable token-meter
```

重启 Hermes 桌面应用——仪表盘后端路由在启动时挂载，状态栏右下角会出现
Token 徽标。**注意：⌘K 热重载桌面插件不会重新挂载 Python 后端，改后端后
必须重启桌面应用。**

验证：

```bash
node <hermes-home>/desktop-plugins/token-meter/plugin.test.mjs
# token-meter state-machine tests: 12 passed; chip display assertions: 4 passed
```

## 更新

直接替换文件（git 安装的则 `git pull --ff-only`）。如果仪表盘后端有改动，
重启一次桌面应用让新的 `dashboard/` 路由挂载。

## 开发

```bash
node --check plugin.js
node plugin.test.mjs
```

## 许可

MIT
