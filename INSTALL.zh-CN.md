# Token Meter — 手动安装指南

将两个目录复制到你的 Hermes 主目录（包含 `state.db` 的目录，即 `HERMES_HOME`
环境变量指向的位置，通常为 `~/.hermes`；Windows 上常为 `%LOCALAPPDATA%\hermes`）：

```
hermes-token-meter/
├── desktop-plugins/token-meter/plugin.js        → <hermes-home>/desktop-plugins/token-meter/plugin.js
├── desktop-plugins/token-meter/plugin.test.mjs  → <hermes-home>/desktop-plugins/token-meter/plugin.test.mjs
└── plugins/token-meter/
    ├── plugin.yaml                              → <hermes-home>/plugins/token-meter/plugin.yaml
    └── dashboard/
        ├── manifest.json                        → <hermes-home>/plugins/token-meter/dashboard/manifest.json
        ├── plugin_api.py                        → <hermes-home>/plugins/token-meter/dashboard/plugin_api.py
        └── impl.py                              → <hermes-home>/plugins/token-meter/dashboard/impl.py
```

然后启用插件并（重新）启动 Hermes 桌面应用：

```
hermes plugins enable token-meter
```

- 前端（`plugin.js`）保存后热重载。
- 仪表盘后端在应用启动时挂载；如果状态栏徽标一直不出现，请重启一次桌面应用。
- 安装后验证：

```
node desktop-plugins/token-meter/plugin.test.mjs
# token-meter state-machine tests: 12 passed; chip display assertions: 4 passed
```
