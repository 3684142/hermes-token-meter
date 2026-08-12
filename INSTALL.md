# Token Meter — Manual Install

Copy the two directories into your Hermes home directory (the folder that
contains `state.db`, usually `~/.hermes` or the path of your `HERMES_HOME`
environment variable; on Windows commonly `%LOCALAPPDATA%\hermes`):

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

Then enable the plugin and (re)start the Hermes desktop app:

```
hermes plugins enable token-meter
```

- The frontend (`plugin.js`) hot-reloads on save.
- The dashboard backend mounts at backend startup; if the meter stays on the
  default dot, restart the desktop app once.
- After install, verify with:

```
node desktop-plugins/token-meter/plugin.test.mjs
# token-meter state-machine tests: 12 passed; chip display assertions: 4 passed
```

中文安装说明见 [INSTALL.zh-CN.md](INSTALL.zh-CN.md)。
