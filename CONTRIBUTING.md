# Contributing

Thanks for considering a contribution to token-meter!

## Development setup

```bash
git clone https://github.com/3684142/hermes-token-meter.git
cd hermes-token-meter
node --check desktop-plugins/token-meter/plugin.js
node desktop-plugins/token-meter/plugin.test.mjs
```

The frontend is a single ESM file (`plugin.js`) with a pure state machine
between `// TOKEN_METER_CORE_START` and `// TOKEN_METER_CORE_END`. The test
suite imports that core section directly — keep the core free of DOM/React
imports so tests can run in plain Node.

## What to check before opening a PR

- `node plugin.test.mjs` passes (state-machine + display assertions).
- Backend changes: `python -m py_compile` on `plugins/token-meter/dashboard/`.
- The status-bar chip stays readable in narrow widths; no `~` prefixes on
  displayed numbers (estimation is disclosed in words in the popover).
- No personal or machine-specific data (paths, accounts, keys) is added —
  everything is `HERMES_HOME`-relative at runtime.
- README updates for user-visible changes; keep `README.md` and
  `README.zh-CN.md` in sync.

## Release process

1. Bump `version` in `plugins/token-meter/plugin.yaml` and
   `plugins/token-meter/dashboard/manifest.json`.
2. Add a `CHANGELOG.md` entry.
3. Tag and publish:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
gh release create vX.Y.Z --generate-notes
```
