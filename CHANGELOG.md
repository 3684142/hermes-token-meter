# Changelog

All notable changes to this project are documented in this file.

## [v1.4.0] - 2026-08-13

Initial public release.

### Added

- Rolling one-second output speed (`XX tok/s`) in the status bar while a
  response streams — reflects only the last 1,000 ms, decays to `0.0 tok/s`
  on pause, never a cumulative average.
- Stream-first token estimates from `message.delta` / `reasoning.delta`
  (CJK ≈ 1 token/char, other text ≈ 1 token/4 chars), corrected by provider
  `session.info.usage` at turn end (`avg`).
- No synthetic speed spikes: late batch usage updates correct cumulative
  counters only, never the speed window.
- Multi-call turns: tool calls and multiple model calls keep the stream tail
  moving instead of freezing after the first API response.
- Session following: switching conversations switches the meter; idle state
  shows session totals aggregated across all `(session_id, model)` rows.
- No `~` prefixes on displayed numbers; estimation status is disclosed in the
  popover (`last 1s estimate`, `estimated average`).

### Infrastructure

- Canonical layout: `desktop-plugins/token-meter/` (frontend) +
  `plugins/token-meter/` (backend).
- One-command installers: `install.sh` (Linux/macOS/Git-Bash) and
  `install.ps1` (Windows PowerShell), both `HERMES_HOME`-aware.
- GitHub Actions CI (`check.yml`): `node --check` + state-machine tests on
  every push/PR.
- Bilingual docs: `README.md` / `README.zh-CN.md`, `INSTALL.md` /
  `INSTALL.zh-CN.md`.

[v1.4.0]: https://github.com/3684142/hermes-token-meter/releases/tag/v1.4.0
