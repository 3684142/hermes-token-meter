# Hermes Token Meter

[English](README.md) | **简体中文**

Hermes 桌面端状态栏的实时 Token 用量仪表：回复流式生成时显示本轮输入/输出 Token 和**滚动的一秒实时速度**；回合结束后固定显示整轮平均速度（`avg`），直到下一个回合开始。

## 功能特性

- **滚动的一秒实时速度** — `XX tok/s` 只统计最近 1,000 毫秒内收到的输出 Token，数字会随流式输出的真实节奏上升、下降，输出暂停一秒后自动归零（`0.0 tok/s`），而不是显示整轮的累计平均速度。
- **流式估算 + usage 校正** — 生成过程中监听 `message.delta` / `reasoning.delta` 事件，用轻量 tokenizer 本地估算（中日韩文 ≈ 1 字符 1 token，其他文本 ≈ 4 字符 1 token），即时显示；回合结束时用 Provider 返回的权威 `session.info.usage` 校正累计值并计算最终 `avg` 速度。
- **无虚假速度尖峰** — usage 延迟批量到达时只校正累计数字，不会算成速度窗口内的一瞬间爆发。
- **支持多模型调用回合** — 一个回合内多次模型调用、穿插工具调用时，流式尾部继续推进，不会在第一次 API 返回后冻结。
- **会话跟随** — 切换会话时仪表自动切换；空闲时显示整个会话的累计值（按 `(session_id, model)` 聚合所有模型行，会话中途换模型也不会少算）。

## 架构

| 部分 | 文件 | 作用 |
|---|---|---|
| 前端（渲染进程） | `plugin.js` | 事件驱动的状态机 + 状态栏徽标 + 弹出面板；订阅 `host.state.activeSessionId`、`message.start`、`message.delta`、`reasoning.delta`、`session.info` |
| 测试 | `plugin.test.mjs` | 12 个状态机场景 + 4 个显示断言 |
| 插件元数据 | `plugin.yaml` | `hermes plugins enable token-meter` 必需 |
| 后端（仪表盘） | `dashboard/plugin_api.py` | 轻量 FastAPI 路由，挂载在 `/api/plugins/token-meter/`；每个请求按 mtime 热重载 `impl.py` |
| 后端逻辑 | `dashboard/impl.py` | 只读查询 `state.db`；按 `(session_id, model)` 聚合 `session_model_usage` |
| 清单 | `dashboard/manifest.json` | 仪表盘插件发现（`tab.hidden: true` → 纯状态栏插件） |

核心设计规则：

- `message.start` 快照 usage 基线；`session.info.payload.running === false` 是**唯一**的回合结束信号——绝不用静默时长或 Token 增长推断回合边界（工具调用可能静默数分钟）。
- 速度窗口是严格 trailing 1,000 ms 的时间戳样本；每秒 tick 裁剪过期样本，静默窗口速度衰减到 `0.0 tok/s`。
- Provider usage 只校正累计计数，绝不注入速度窗口。
- 所有显示数字不带 `~` 前缀；估算状态通过弹出面板文字（`last 1s estimate` / `estimated average`）披露。

## 环境要求

- Hermes 桌面应用（面向其运行时插件 API）
- Node.js 22+（仅测试套件需要）
- Python 3.10+（仪表盘后端需要）

## 安装（普通用户，3 分钟）

> 安装前请先确认 Hermes 桌面应用已安装并可正常使用。

**方式一：使用 Release 安装包（推荐）**

1. 打开 [Releases 页面](https://github.com/3684142/hermes-token-meter/releases)，下载最新版的
   `hermes-token-meter-<版本>-install.zip`；
2. 解压后，把 `desktop-plugins/token-meter/` 整个目录复制到你的 Hermes 主目录下
   （`HERMES_HOME` 环境变量指向的目录，通常是 `~/.hermes`，Windows 上可能是
   `%LOCALAPPDATA%\hermes`）：
   ```
   <hermes-home>/desktop-plugins/token-meter/plugin.js
   <hermes-home>/desktop-plugins/token-meter/plugin.test.mjs
   ```
3. 再把 `plugins/token-meter/` 整个目录复制过去：
   ```
   <hermes-home>/plugins/token-meter/plugin.yaml
   <hermes-home>/plugins/token-meter/dashboard/manifest.json
   <hermes-home>/plugins/token-meter/dashboard/plugin_api.py
   <hermes-home>/plugins/token-meter/dashboard/impl.py
   ```
4. 在终端执行：`hermes plugins enable token-meter`
5. 重启 Hermes 桌面应用（后端需要在启动时挂载插件路由），底部状态栏应出现 Token 徽标。

**方式二：直接克隆仓库**

```bash
git clone https://github.com/3684142/hermes-token-meter.git
# 然后把 desktop-plugins/ 和 plugins/ 两个目录按上面的位置复制即可
```

**验证是否安装成功**

```bash
node <hermes-home>/desktop-plugins/token-meter/plugin.test.mjs
# 期望输出：token-meter state-machine tests: 12 passed; chip display assertions: 4 passed
```

## 开发

```bash
node --check plugin.js
node plugin.test.mjs
# token-meter state-machine tests: 12 passed; chip display assertions: 4 passed
```

## 许可

[MIT](LICENSE)
